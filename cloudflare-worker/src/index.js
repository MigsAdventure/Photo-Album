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
 * Pre-flight memory check to prevent Worker crashes
 */
function analyzeMemoryRequirements(photos, requestId) {
  const MAX_SINGLE_FILE_SIZE = 500 * 1024 * 1024; // 500MB max per individual file
  
  let totalEstimatedSize = 0;
  let largeFileCount = 0;
  let videoCount = 0;
  let maxSingleFileSize = 0;
  const tooLargeFiles = [];
  
  for (const photo of photos) {
    const estimatedSize = photo.size || 5 * 1024 * 1024; // Default 5MB if unknown
    totalEstimatedSize += estimatedSize;
    maxSingleFileSize = Math.max(maxSingleFileSize, estimatedSize);
    
    // Track files over 600MB as "large" but still processable
    if (estimatedSize > 600 * 1024 * 1024) {
      largeFileCount++;
    }
    
    // Track files over 500MB as potentially too large for Worker
    if (estimatedSize > MAX_SINGLE_FILE_SIZE) {
      tooLargeFiles.push({
        fileName: photo.fileName,
        sizeMB: (estimatedSize / 1024 / 1024).toFixed(2)
      });
    }
    
    if (/\.(mp4|mov|avi|webm)$/i.test(photo.fileName)) {
      videoCount++;
    }
  }
  
  const largestFileMB = maxSingleFileSize / 1024 / 1024;
  const canProcessLargestFile = maxSingleFileSize <= MAX_SINGLE_FILE_SIZE;
  
  const analysis = {
    totalFiles: photos.length,
    totalEstimatedSizeMB: (totalEstimatedSize / 1024 / 1024).toFixed(2),
    largestFileMB: largestFileMB.toFixed(2),
    largeFileCount,
    videoCount,
    tooLargeFiles,
    canProcessLargestFile,
    canUseWorker: canProcessLargestFile,
    riskLevel: !canProcessLargestFile ? 'high' : largestFileMB > 300 ? 'medium' : 'low'
  };
  
  console.log(`🔍 Memory analysis [${requestId}]:`, {
    totalSizeMB: analysis.totalEstimatedSizeMB,
    largestFileMB: analysis.largestFileMB,
    canUseWorker: analysis.canUseWorker,
    risk: analysis.riskLevel
  });
  
  return analysis;
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
      const memoryAnalysis = analyzeMemoryRequirements(photos, requestId);
      
      console.log(`🎯 Processing [${requestId}]: ${photos.length} files, ${memoryAnalysis.totalEstimatedSizeMB}MB total`);
      
      // Route to Durable Object for professional processing
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
          totalSizeMB: memoryAnalysis.totalEstimatedSizeMB,
          videoCount: memoryAnalysis.videoCount,
          largeFileCount: memoryAnalysis.largeFileCount,
          riskLevel: memoryAnalysis.riskLevel
        },
        capabilities: {
          maxVideoSize: '500MB per file',
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
