/**
 * Cloudflare Worker for Wedding Photo Processing
 * Uses Durable Objects for professional-scale processing
 * Handles wedding-scale albums (500MB+ videos, 2-3GB collections)
 */

import { WeddingZipProcessor } from './wedding-zip-processor';
import { sendEmail, sendErrorEmail } from './email';

// Circuit breaker configuration to prevent infinite loops
const REQUEST_TRACKING = new Map();
const GLOBAL_REQUEST_TRACKING = new Map();
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 2;
const CIRCUIT_BREAKER_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const GLOBAL_RATE_LIMIT = 3; // Max 3 requests per minute per email/IP
const GLOBAL_RATE_WINDOW = 60 * 1000; // 1 minute window

/**
 * Circuit breaker system to prevent infinite retry loops
 */
function checkCircuitBreaker(requestId) {
  const now = Date.now();
  const tracking = REQUEST_TRACKING.get(requestId) || { 
    attempts: 0, 
    lastAttempt: 0,
    firstAttempt: now,
    errors: []
  };
  
  // Clean up old tracking entries (older than 30 minutes)
  if (now - tracking.firstAttempt > CIRCUIT_BREAKER_TIMEOUT) {
    REQUEST_TRACKING.delete(requestId);
    return checkCircuitBreaker(requestId); // Start fresh
  }
  
  // Check max retries exceeded
  if (tracking.attempts >= MAX_RETRIES) {
    console.error(`🚫 Circuit breaker OPEN [${requestId}]: Max retries (${MAX_RETRIES}) exceeded`);
    throw new Error(`Circuit breaker: Maximum ${MAX_RETRIES} attempts exceeded. Request blocked to prevent infinite loops.`);
  }
  
  // Check backoff period
  const timeSinceLastAttempt = now - tracking.lastAttempt;
  const requiredBackoff = Math.pow(BACKOFF_MULTIPLIER, tracking.attempts) * 1000;
  
  if (tracking.attempts > 0 && timeSinceLastAttempt < requiredBackoff) {
    console.warn(`⏳ Circuit breaker BACKOFF [${requestId}]: ${requiredBackoff}ms required, ${timeSinceLastAttempt}ms elapsed`);
    throw new Error(`Circuit breaker: Backoff period not met. Wait ${Math.ceil((requiredBackoff - timeSinceLastAttempt) / 1000)}s before retry.`);
  }
  
  // Update tracking
  tracking.attempts++;
  tracking.lastAttempt = now;
  REQUEST_TRACKING.set(requestId, tracking);
  
  console.log(`✅ Circuit breaker CHECK [${requestId}]: Attempt ${tracking.attempts}/${MAX_RETRIES}, backoff ${requiredBackoff}ms`);
  
  return tracking;
}

/**
 * Record circuit breaker success - resets failure count
 */
function recordCircuitBreakerSuccess(requestId) {
  REQUEST_TRACKING.delete(requestId);
  console.log(`🎉 Circuit breaker SUCCESS [${requestId}]: Request completed successfully, tracking cleared`);
}

/**
 * Record circuit breaker failure - adds to error history
 */
function recordCircuitBreakerFailure(requestId, error) {
  const tracking = REQUEST_TRACKING.get(requestId);
  if (tracking) {
    tracking.errors.push({
      timestamp: Date.now(),
      message: error.message,
      type: error.constructor.name
    });
    REQUEST_TRACKING.set(requestId, tracking);
    console.error(`❌ Circuit breaker FAILURE [${requestId}]: ${error.message} (Attempt ${tracking.attempts}/${MAX_RETRIES})`);
  }
}

/**
 * Global rate limiter to prevent infinite loops with new requestIds
 */
function checkGlobalRateLimit(email, clientIP) {
  const now = Date.now();
  const key = `${email}:${clientIP}`;
  
  // Clean up old entries first
  for (const [trackingKey, requests] of GLOBAL_REQUEST_TRACKING.entries()) {
    const validRequests = requests.filter(timestamp => now - timestamp < GLOBAL_RATE_WINDOW);
    if (validRequests.length === 0) {
      GLOBAL_REQUEST_TRACKING.delete(trackingKey);
    } else {
      GLOBAL_REQUEST_TRACKING.set(trackingKey, validRequests);
    }
  }
  
  // Get current request timestamps for this email/IP
  const requests = GLOBAL_REQUEST_TRACKING.get(key) || [];
  
  // Filter to only recent requests (within rate window)
  const recentRequests = requests.filter(timestamp => now - timestamp < GLOBAL_RATE_WINDOW);
  
  console.log(`🌐 Global rate limit check [${key}]: ${recentRequests.length}/${GLOBAL_RATE_LIMIT} requests in last ${GLOBAL_RATE_WINDOW/1000}s`);
  
  // Check if rate limit exceeded
  if (recentRequests.length >= GLOBAL_RATE_LIMIT) {
    console.error(`🚫 GLOBAL RATE LIMIT EXCEEDED [${key}]: ${recentRequests.length} requests in ${GLOBAL_RATE_WINDOW/1000}s (limit: ${GLOBAL_RATE_LIMIT})`);
    return false;
  }
  
  // Add current request timestamp
  recentRequests.push(now);
  GLOBAL_REQUEST_TRACKING.set(key, recentRequests);
  
  console.log(`✅ Global rate limit OK [${key}]: ${recentRequests.length}/${GLOBAL_RATE_LIMIT} requests`);
  return true;
}

/**
 * Analyze collection and determine routing strategy
 */
function analyzeCollectionForRouting(photos, requestId) {
  const GOOGLE_CLOUD_THRESHOLD = 200 * 1024 * 1024; // 200MB threshold for Google Cloud routing
  
  let totalEstimatedSize = 0;
  let largeFileCount = 0;
  let videoCount = 0;
  let maxSingleFileSize = 0;
  const largeFiles = [];
  let hasVeryLargeFile = false;
  
  for (const photo of photos) {
    const estimatedSize = photo.size || 5 * 1024 * 1024; // Default 5MB if unknown
    totalEstimatedSize += estimatedSize;
    maxSingleFileSize = Math.max(maxSingleFileSize, estimatedSize);
    
    // Check if this file exceeds Google Cloud threshold
    if (estimatedSize > GOOGLE_CLOUD_THRESHOLD) {
      hasVeryLargeFile = true;
      largeFiles.push({
        fileName: photo.fileName,
        sizeMB: (estimatedSize / 1024 / 1024).toFixed(2)
      });
    }
    
    // Track files over 80MB as "large" 
    if (estimatedSize > 80 * 1024 * 1024) {
      largeFileCount++;
    }
    
    if (/\.(mp4|mov|avi|webm)$/i.test(photo.fileName)) {
      videoCount++;
    }
  }
  
  const largestFileMB = maxSingleFileSize / 1024 / 1024;
  
  // Routing decision: If ANY file >200MB, route entire collection to Google Cloud
  const shouldUseGoogleCloud = hasVeryLargeFile;
  
  const analysis = {
    totalFiles: photos.length,
    totalEstimatedSizeMB: (totalEstimatedSize / 1024 / 1024).toFixed(2),
    largestFileMB: largestFileMB.toFixed(2),
    largeFileCount,
    videoCount,
    largeFiles,
    hasVeryLargeFile,
    shouldUseGoogleCloud,
    routingDecision: shouldUseGoogleCloud ? 'google-cloud' : 'cloudflare-worker',
    riskLevel: shouldUseGoogleCloud ? 'high' : largestFileMB > 80 ? 'medium' : 'low'
  };
  
  console.log(`🎯 Collection analysis [${requestId}]:`, {
    totalSizeMB: analysis.totalEstimatedSizeMB,
    largestFileMB: analysis.largestFileMB,
    routing: analysis.routingDecision,
    reason: shouldUseGoogleCloud ? `File(s) >200MB detected` : `All files ≤200MB`,
    risk: analysis.riskLevel
  });
  
  return analysis;
}

/**
 * Route request to Google Cloud Function for large file processing
 */
async function routeToGoogleCloud(eventId, email, photos, requestId, env) {
  console.log(`🚀 Routing to Google Cloud [${requestId}]: Large files detected`);
  
  try {
    // Prepare payload for Google Cloud Function
    const payload = {
      eventId,
      email,
      photos,
      requestId,
      timestamp: Date.now(),
      source: 'cloudflare-worker'
    };
    
    // Call Google Cloud Function
    const googleCloudUrl = env.GOOGLE_CLOUD_FUNCTION_URL;
    if (!googleCloudUrl) {
      throw new Error('Google Cloud Function URL not configured');
    }
    
    console.log(`📡 Calling Google Cloud Function [${requestId}]: ${googleCloudUrl}`);
    
    const response = await fetch(googleCloudUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY || ''}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Cloud Function error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`✅ Google Cloud Function accepted [${requestId}]:`, result);
    
    return result;
    
  } catch (error) {
    console.error(`❌ Google Cloud routing failed [${requestId}]:`, error);
    throw new Error(`Google Cloud processing failed: ${error.message}`);
  }
}

export { WeddingZipProcessor };

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const { eventId, email, photos, requestId } = body;

      if (!eventId || !email || !photos || !Array.isArray(photos)) {
        return new Response(JSON.stringify({ 
          error: 'Missing required fields: eventId, email, photos' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GLOBAL RATE LIMITING - Check first to prevent new requestId bypass
      const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      if (!checkGlobalRateLimit(email, clientIP)) {
        console.error(`🚫 GLOBAL RATE LIMIT EXCEEDED [${email}:${clientIP}]: Request blocked`);
        return new Response(JSON.stringify({
          error: 'Too many requests',
          reason: `Rate limit exceeded: maximum ${GLOBAL_RATE_LIMIT} requests per minute`,
          email,
          requestId,
          action: 'Stop retrying. Wait 1 minute before submitting a new request.'
        }), {
          status: 429, // Too Many Requests
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': '60' // Force 60 second wait
          },
        });
      }

      // Circuit breaker check to prevent infinite loops per requestId
      try {
        checkCircuitBreaker(requestId);
      } catch (circuitBreakerError) {
        console.error(`🚫 Circuit breaker blocked request [${requestId}]:`, circuitBreakerError.message);
        return new Response(JSON.stringify({
          error: 'Request blocked by circuit breaker',
          reason: circuitBreakerError.message,
          requestId,
          action: 'Request blocked to prevent infinite loops. Please wait before retrying.'
        }), {
          status: 429, // Too Many Requests
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': '60' // Suggest 60 second retry
          },
        });
      }

      // Analyze collection for smart routing
      const routingAnalysis = analyzeCollectionForRouting(photos, requestId);
      
      console.log(`🎯 Processing [${requestId}]: ${photos.length} files, ${routingAnalysis.totalEstimatedSizeMB}MB total`);
      
      // SMART ROUTING: Check if we should use Google Cloud for large files
      if (routingAnalysis.shouldUseGoogleCloud) {
        console.log(`🌤️ Routing to Google Cloud [${requestId}]: Files >200MB detected`);
        
        try {
          const googleCloudResult = await routeToGoogleCloud(eventId, email, photos, requestId, env);
          
          // Record circuit breaker success for Google Cloud routing
          recordCircuitBreakerSuccess(requestId);
          
          return new Response(JSON.stringify({
            success: true,
            message: `Processing ${photos.length} files with Google Cloud for large video support. Email will be sent when complete.`,
            requestId,
            estimatedTime: '5-15 minutes',
            processing: 'google-cloud-functions',
            collectionAnalysis: {
              totalSizeMB: routingAnalysis.totalEstimatedSizeMB,
              videoCount: routingAnalysis.videoCount,
              largeFileCount: routingAnalysis.largeFileCount,
              riskLevel: routingAnalysis.riskLevel,
              routingReason: `Large files detected: ${routingAnalysis.largeFiles.map(f => `${f.fileName} (${f.sizeMB}MB)`).join(', ')}`
            },
            capabilities: {
              maxVideoSize: '500MB+ per file',
              maxCollectionSize: 'Unlimited (Google Cloud)',
              supportedFiles: 'All wedding media formats',
              processingType: 'Google Cloud Functions with high memory'
            }
          }), {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
          });
          
        } catch (googleCloudError) {
          console.error(`❌ Google Cloud routing failed [${requestId}], falling back to Cloudflare:`, googleCloudError);
          // Fall through to Cloudflare processing as backup
        }
      }
      
      // Route to Cloudflare Durable Object for standard processing
      console.log(`⚡ Using Cloudflare processing [${requestId}]: All files ≤200MB`);
      
      const objectId = env.WEDDING_ZIP_PROCESSOR.idFromName(requestId);
      const durableObject = env.WEDDING_ZIP_PROCESSOR.get(objectId);

      // Send request to Durable Object
      const durableObjectResponse = await durableObject.fetch(new Request('https://dummy.url/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, email, photos, requestId })
      }));

      if (!durableObjectResponse.ok) {
        const errorData = await durableObjectResponse.json();
        console.error(`❌ Durable Object error [${requestId}]:`, errorData);
        recordCircuitBreakerFailure(requestId, new Error(errorData.error || 'Durable Object failed'));
        throw new Error(`Durable Object processing failed: ${errorData.error || 'Unknown error'}`);
      }

      const durableResult = await durableObjectResponse.json();
      console.log(`✅ Durable Object started [${requestId}]:`, durableResult.status);

      // Record circuit breaker success for orchestration
      recordCircuitBreakerSuccess(requestId);

      // Determine estimated time based on collection size
      const estimatedTime = photos.length > 100 ? '10-20 minutes' : 
                           photos.length > 50 ? '5-10 minutes' : '2-5 minutes';

      return new Response(JSON.stringify({
        success: true,
        message: `Processing ${photos.length} files with professional wedding-scale system. Email will be sent when complete.`,
        requestId,
        estimatedTime,
        processing: 'durable-object-streaming',
        collectionAnalysis: {
          totalSizeMB: routingAnalysis.totalEstimatedSizeMB,
          videoCount: routingAnalysis.videoCount,
          largeFileCount: routingAnalysis.largeFileCount,
          riskLevel: routingAnalysis.riskLevel
        },
        capabilities: {
          maxVideoSize: '200MB per file (Cloudflare)',
          maxCollectionSize: 'Professional scale',
          supportedFiles: 'All wedding media formats',
          processingType: 'Professional Durable Object processing'
        }
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
