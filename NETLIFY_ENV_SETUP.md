# Netlify Environment Variable Setup for Firebase Admin SDK

## Prerequisites

Make sure there's a `package.json` in the `netlify/functions` directory with firebase-admin dependency:

```json
{
  "name": "netlify-functions",
  "version": "1.0.0",
  "description": "Netlify Functions for Wedding Photo App",
  "dependencies": {
    "firebase-admin": "^13.4.0"
  }
}
```

This ensures Netlify installs the required dependencies for your functions.

## Steps to Configure FIREBASE_SERVICE_ACCOUNT_KEY

### 1. Prepare the JSON Value

The service account JSON needs to be stored as a single-line string in Netlify's environment variables.

You have two options:

#### Option A: Use the Netlify CLI (Recommended)
```bash
# Install Netlify CLI if you haven't already
npm install -g netlify-cli

# Login to Netlify
netlify login

# Set the environment variable
netlify env:set FIREBASE_SERVICE_ACCOUNT_KEY "$(cat wedding-photo-240c9-firebase-adminsdk-fbsvc-a11f1c3b6e.json)"
```

#### Option B: Manual Setup via Netlify Dashboard

1. Open your service account JSON file (`wedding-photo-240c9-firebase-adminsdk-fbsvc-a11f1c3b6e.json`)
2. Copy the ENTIRE contents
3. Go to [Netlify Dashboard](https://app.netlify.com)
4. Navigate to your site
5. Go to **Site Configuration** → **Environment variables**
6. Click **Add a variable**
7. Set:
   - **Key**: `FIREBASE_SERVICE_ACCOUNT_KEY`
   - **Values**: Paste the entire JSON content
   - **Scopes**: Select all deploy contexts (Production, Preview, Branch deploys)
8. Click **Create variable**

### 2. Deploy Your Site

After setting the environment variable, you need to trigger a new deployment for the changes to take effect:

```bash
# If using Git
git add .
git commit -m "Add Firebase Admin SDK download functionality"
git push

# Or manually trigger a deploy in Netlify Dashboard
```

### 3. Test the Download Feature

Once deployed:
1. Open your app
2. Navigate to the photo gallery
3. Click on a photo/video to open it
4. Click the download button
5. The file should download with the correct filename

## Troubleshooting

### If downloads aren't working:

1. **Check Netlify Function logs**:
   - Go to Netlify Dashboard → Functions tab
   - Look for `media-download` function
   - Check the logs for any errors

2. **Common Issues**:
   - Environment variable not set correctly
   - JSON format issues (must be valid JSON)
   - Service account permissions (needs Storage Admin role)

3. **Verify Environment Variable**:
   - In Netlify Dashboard, go to Environment variables
   - Make sure `FIREBASE_SERVICE_ACCOUNT_KEY` exists
   - Check that it contains the full JSON content

## Security Notes

- ✅ The service account key is stored securely in Netlify's environment
- ✅ It's never exposed to the client-side code
- ✅ The `.gitignore` file prevents accidental commits
- ✅ Signed URLs expire after 1 hour for security

## Benefits of This Approach

1. **Works with any file size** - No Netlify function timeout issues
2. **Forces download** - Files download instead of opening in browser
3. **Preserves filename** - Downloads use the original filename
4. **Secure** - Uses Firebase's signed URL mechanism
5. **No bandwidth costs** - Files are served directly from Firebase

## Next Steps

After successful setup:
1. Test with both small and large files
2. Verify videos download properly
3. Check that filenames are preserved
4. Monitor function logs for any issues
