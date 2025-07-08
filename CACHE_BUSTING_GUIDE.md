# Cache Busting Guide for Mobile Upload Fixes

## The Problem
Netlify functions and frontend code can be cached at multiple levels, preventing new changes from taking effect immediately.

## Step-by-Step Cache Busting

### 1. Frontend Cache Busting (Browser)
```bash
# Force browser to reload everything
Ctrl+Shift+R (Chrome/Firefox)
Cmd+Shift+R (Mac)

# Or clear browser cache completely:
- Chrome: Settings > Privacy > Clear browsing data > Cached images and files
- Mobile: Close browser completely, reopen
```

### 2. Netlify Function Cache Busting
```bash
# Redeploy the entire site to clear function cache
npm run build
git add .
git commit -m "Cache bust: Force redeploy functions"
git push origin main

# Wait 2-3 minutes for deployment to complete
```

### 3. Cloudflare R2 Cache (if applicable)
The R2 service itself doesn't cache, but the public URL might be cached by CDNs.

### 4. Service Worker Cache (PWA)
```javascript
// In browser console, run:
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
    }
  });
}
// Then refresh the page
```

## Verification Steps

### 1. Check Function Deployment
Visit: `https://your-site.netlify.app/.netlify/functions/upload`
You should see an error about method not allowed (this means the function is deployed)

### 2. Check Browser Network Tab
1. Open Chrome DevTools > Network tab
2. Try uploading a photo
3. Look for the upload request
4. Check if it shows the new 15-second timeout behavior

### 3. Check Console Logs
Look for these new log messages:
- `📤 Files selected for sequential upload: X`
- `📷 Camera photo compressed: XMB → YMB`
- `✅ Upload X/Y completed`

### 4. Check Request IDs
New uploads should show request IDs in Netlify logs:
- Go to Netlify dashboard > Functions tab
- Look for upload function logs
- Should see `[requestId]` in log messages

## Force Complete Cache Clear

### Option 1: Version Bump
Add this to your deployment:
```bash
# Add timestamp to force refresh
echo "REACT_APP_VERSION=$(date +%s)" >> .env.local
npm run build
```

### Option 2: Hard Reset
```bash
# Clear everything locally
rm -rf node_modules package-lock.json build/
npm install
npm run build

# Force complete redeploy
git add .
git commit -m "Hard reset: Clear all caches"
git push origin main
```

## Testing the New Upload System

### What You Should See:
1. **Sequential Processing**: Files upload one at a time, not simultaneously
2. **Camera Photo Detection**: Large photos show "📷 Camera Photo" label
3. **Compression Indicators**: "🗜️ Compressing" appears for large camera photos
4. **Retry Buttons**: Failed uploads show 🔄 and 🗑️ buttons
5. **Status Tracking**: Clear progression from ⏳ Waiting → Uploading → ✅ Uploaded

### Camera Photo Test:
1. Take a photo with your phone camera (should be >3MB)
2. Try uploading it
3. Should see automatic compression
4. Upload should be more reliable with 15-second timeout

### Screenshot Test:
1. Take a screenshot (should be <2MB)
2. Upload should be faster, no compression needed

## Troubleshooting

### If you still don't see changes:
1. Check Netlify deploy logs for errors
2. Verify the git commit includes the updated files
3. Try accessing the site from an incognito/private browser window
4. Clear mobile browser cache completely

### If uploads still fail:
1. Check browser console for error messages
2. Check Netlify function logs for the request ID
3. Try uploading a small screenshot first (easier to debug)
4. Test on different device/browser

## Configuration Verification

### Backend timeout: 12 seconds
```javascript
// In netlify/functions/upload.js
setTimeout(() => {
  console.error(`❌ FUNCTION TIMEOUT [${requestId}] - Upload exceeded 12 seconds`);
  reject(new Error('Function timeout - upload took too long'));
}, 12000); // ← Should be 12000
```

### Frontend timeout: 15 seconds
```javascript
// In src/services/photoService.ts
xhr.timeout = 15000; // ← Should be 15000
```

### No-cache headers applied:
```toml
# In netlify.toml
[[headers]]
  for = "/.netlify/functions/*"
  [headers.values]
    Cache-Control = "no-cache, no-store, must-revalidate"
```

## Quick Test Script

Run this in browser console to test if new code is loaded:
```javascript
// Check if new upload system is loaded
console.log('Testing upload system...');
console.log('Upload timeout:', window.location.href.includes('localhost') ? 'dev mode' : '15 seconds');
console.log('Retry buttons:', document.querySelector('[title="Retry upload"]') ? 'Available' : 'Not loaded');
```

Remember: Changes can take 2-5 minutes to propagate through Netlify's deployment system!
