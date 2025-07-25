// R2 URL generation and fallback service
// Handles cost-effective display using R2 with Firebase fallback

export interface R2UrlConfig {
  preferR2: boolean;
  fallbackTimeout: number; // ms to wait before falling back to Firebase
  cacheResults: boolean;
}

// Default configuration
const defaultConfig: R2UrlConfig = {
  preferR2: true,
  fallbackTimeout: 3000, // 3 seconds
  cacheResults: true
};

// Cache for R2 URL availability checks
const urlCache = new Map<string, { url: string; isWorking: boolean; timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Generate R2 public URL from R2 key
export const generateR2Url = (r2Key: string): string | null => {
  if (!r2Key || typeof r2Key !== 'string') {
    return null;
  }

  // Get R2 public domain from environment (fallback to default pattern)
  const r2Domain = process.env.REACT_APP_R2_PUBLIC_DOMAIN || `pub-${process.env.REACT_APP_R2_ACCOUNT_ID}.r2.dev`;
  
  if (!r2Domain) {
    console.warn('⚠️ R2 public domain not configured');
    return null;
  }

  // Generate the public URL
  const r2Url = `https://${r2Domain}/${r2Key}`;
  
  console.log('🔗 Generated R2 URL:', r2Url);
  return r2Url;
};

// Check if URL is accessible (with caching)
export const checkUrlAvailability = async (url: string, useCache: boolean = true): Promise<boolean> => {
  // Check cache first
  if (useCache && urlCache.has(url)) {
    const cached = urlCache.get(url)!;
    const isExpired = Date.now() - cached.timestamp > CACHE_DURATION;
    
    if (!isExpired) {
      console.log('📋 Using cached URL result:', cached.isWorking ? 'WORKING' : 'FAILED');
      return cached.isWorking;
    }
  }

  try {
    console.log('🧪 Testing URL availability:', url);
    
    // Use HEAD request for efficiency
    const response = await fetch(url, { 
      method: 'HEAD',
      signal: AbortSignal.timeout(3000) // 3 second timeout
    });
    
    const isWorking = response.ok;
    console.log('🧪 URL test result:', isWorking ? 'WORKING' : 'FAILED', `(${response.status})`);
    
    // Cache the result
    if (useCache) {
      urlCache.set(url, {
        url,
        isWorking,
        timestamp: Date.now()
      });
    }
    
    return isWorking;
    
  } catch (error) {
    console.log('🧪 URL test failed:', error instanceof Error ? error.message : 'Unknown error');
    
    // Cache negative result
    if (useCache) {
      urlCache.set(url, {
        url,
        isWorking: false,
        timestamp: Date.now()
      });
    }
    
    return false;
  }
};

// Smart URL selection - returns best available URL
export const getOptimalMediaUrl = async (
  firebaseUrl: string, 
  r2Key?: string,
  config: Partial<R2UrlConfig> = {}
): Promise<{ url: string; source: 'r2' | 'firebase'; tested: boolean }> => {
  const finalConfig = { ...defaultConfig, ...config };
  
  // Always have Firebase as fallback
  const fallbackResult = { url: firebaseUrl, source: 'firebase' as const, tested: false };
  
  // If R2 not preferred or no R2 key, use Firebase
  if (!finalConfig.preferR2 || !r2Key) {
    console.log('🔥 Using Firebase URL (R2 not preferred or no R2 key)');
    return fallbackResult;
  }
  
  // Generate R2 URL
  const r2Url = generateR2Url(r2Key);
  if (!r2Url) {
    console.log('🔥 Using Firebase URL (R2 URL generation failed)');
    return fallbackResult;
  }
  
  // Test R2 URL availability
  try {
    console.log('💾 Testing R2 URL availability...');
    const isR2Working = await Promise.race([
      checkUrlAvailability(r2Url, finalConfig.cacheResults),
      new Promise<boolean>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), finalConfig.fallbackTimeout)
      )
    ]);
    
    if (isR2Working) {
      console.log('✅ Using R2 URL (faster and cheaper!)');
      return { url: r2Url, source: 'r2', tested: true };
    } else {
      console.log('🔥 Using Firebase URL (R2 not available)');
      return fallbackResult;
    }
    
  } catch (error) {
    console.log('🔥 Using Firebase URL (R2 test timeout/failed)');
    return { url: firebaseUrl, source: 'firebase', tested: false };
  }
};

// Preload URLs for better UX (background testing)
export const preloadOptimalUrls = async (
  mediaItems: Array<{ firebaseUrl: string; r2Key?: string }>
): Promise<Map<string, { url: string; source: 'r2' | 'firebase' }>> => {
  console.log('🚀 Preloading optimal URLs for', mediaItems.length, 'items...');
  
  const results = new Map<string, { url: string; source: 'r2' | 'firebase' }>();
  
  // Process in batches to avoid overwhelming the browser
  const batchSize = 5;
  for (let i = 0; i < mediaItems.length; i += batchSize) {
    const batch = mediaItems.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (item) => {
      try {
        const result = await getOptimalMediaUrl(item.firebaseUrl, item.r2Key, {
          fallbackTimeout: 2000 // Shorter timeout for preloading
        });
        return { firebaseUrl: item.firebaseUrl, result };
      } catch (error) {
        // Fallback to Firebase on any error
        return { 
          firebaseUrl: item.firebaseUrl, 
          result: { url: item.firebaseUrl, source: 'firebase' as const, tested: false }
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(({ firebaseUrl, result }) => {
      results.set(firebaseUrl, { url: result.url, source: result.source });
    });
    
    // Small delay between batches
    if (i + batchSize < mediaItems.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log('✅ Preloading completed:', results.size, 'URLs processed');
  return results;
};

// Clear URL cache (for testing or manual refresh)
export const clearUrlCache = (): void => {
  urlCache.clear();
  console.log('🗑️ URL cache cleared');
};

// Get cache statistics
export const getCacheStats = (): { size: number; r2Working: number; r2Failed: number } => {
  let r2Working = 0;
  let r2Failed = 0;
  
  urlCache.forEach((entry) => {
    if (entry.url.includes('.r2.dev') || entry.url.includes('r2.')) {
      if (entry.isWorking) {
        r2Working++;
      } else {
        r2Failed++;
      }
    }
  });
  
  return {
    size: urlCache.size,
    r2Working,
    r2Failed
  };
};
