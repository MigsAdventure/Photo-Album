# Netlify Environment Variable Fix for 4KB Limit Issue

## 🚨 URGENT: Remove Large Environment Variable

The `FIREBASE_SERVICE_ACCOUNT_KEY` environment variable is too large and is causing Netlify deployments to fail with the error:
> "Your environment variables exceed the 4KB limit imposed by AWS Lambda"

## Steps to Fix:

### 1. Remove FIREBASE_SERVICE_ACCOUNT_KEY from Netlify

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Navigate to your site
3. Go to **Site Configuration** → **Environment variables**
4. Find `FIREBASE_SERVICE_ACCOUNT_KEY`
5. Click the **Delete** button (trash icon)
6. Confirm deletion

### 2. Deploy the Updated Code

The new solution doesn't require Firebase Admin SDK and works by:
- Adding download parameters directly to Firebase Storage URLs
- Using Firebase's built-in `response-content-disposition` parameter
- No large environment variables needed

```bash
git add .
git commit -m "Fix environment variable size issue - remove Firebase Admin SDK dependency"
git push
```

## How the New Download Solution Works:

Instead of using Firebase Admin SDK (which required the large service account JSON), we now:

1. **Modify Firebase URLs directly** by adding download parameters
2. **Use Firebase's built-in download support** with `response-content-disposition`
3. **Force downloads** with proper filenames
4. **No environment variables needed** - much simpler!

## Benefits of This Approach:

- ✅ **No 4KB limit issues** - No large environment variables
- ✅ **Simpler deployment** - No Firebase Admin SDK dependency
- ✅ **Still forces downloads** - Files download with correct filenames
- ✅ **Works with any file size** - Videos and large images download properly
- ✅ **Secure** - Uses Firebase's own download mechanism

## Testing After Deployment:

1. Open your wedding photo app
2. Navigate to the photo gallery
3. Click on a photo/video to open it
4. Click the download button
5. File should download with the correct filename

The download functionality will work exactly the same for users, but without the deployment issues!
