# Sync Environment Variables to Netlify

## The Problem

Your `.env` file has all the correct Firebase configuration **locally**, but Netlify doesn't have access to it because:
1. `.env` is in `.gitignore` (for security)
2. Netlify requires environment variables to be set in its dashboard
3. Your deployment is failing because Netlify can't read your local `.env` file

## Quick Fix - Two Options

### Option 1: Manual Setup (5 minutes)

1. **Go to your Netlify Dashboard**
   - Log in to [app.netlify.com](https://app.netlify.com)
   - Select your site (Shared Moments app)

2. **Navigate to Environment Variables**
   - Click "Site settings" in the top menu
   - Click "Environment variables" in the left sidebar

3. **Add ALL these Firebase variables** (copy from your `.env` file):
   ```
   REACT_APP_FIREBASE_API_KEY = AIzaSyAyNVqZHZaRXvwGKIi--h1UAuiOAW9lrJ4
   REACT_APP_FIREBASE_AUTH_DOMAIN = wedding-photo-240c9.firebaseapp.com
   REACT_APP_FIREBASE_PROJECT_ID = wedding-photo-240c9
   REACT_APP_FIREBASE_STORAGE_BUCKET = wedding-photo-240c9.firebasestorage.app
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID = 767610841427
   REACT_APP_FIREBASE_APP_ID = 1:767610841427:web:e78675ba1d30c4fe4e19a6
   REACT_APP_FIREBASE_MEASUREMENT_ID = G-HRXH4LVZBS
   ```

4. **Also add these R2 variables** (for frontend display optimization):
   ```
   REACT_APP_R2_PUBLIC_DOMAIN = sharedmomentsphotos.socialboostai.com
   REACT_APP_R2_ACCOUNT_ID = 98a9cce92e578cafdb9025fa24a6ee7e
   ```

5. **Add backend-only variables** (for Netlify Functions):
   ```
   R2_ACCOUNT_ID = 98a9cce92e578cafdb9025fa24a6ee7e
   R2_ACCESS_KEY_ID = 06da59a3b3aa1315ed2c9a38efa7579e
   R2_SECRET_ACCESS_KEY = e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27
   R2_BUCKET_NAME = sharedmoments-photos-production
   R2_ENDPOINT = https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com
   R2_PUBLIC_URL = https://sharedmomentsphotos.socialboostai.com
   
   EMAIL_USER = noreply@sharedmoments.socialboostai.com
   EMAIL_PASSWORD = $codeLife12
   EMAIL_HOST = smtp.mailgun.org
   EMAIL_PORT = 587
   EMAIL_FROM_NAME = SharedMoments
   
   AWS_ACCOUNT_ID = 782720046962
   AWS_REGION = us-east-1
   AWS_SQS_QUEUE_URL = https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue
   ```

6. **Trigger a new deployment**
   - Click "Deploys" in the top menu
   - Click "Trigger deploy" → "Deploy site"

### Option 2: Using Netlify CLI (2 minutes)

If you have Netlify CLI installed and logged in:

```bash
# Install Netlify CLI if not installed
npm install -g netlify-cli

# Log in to Netlify
netlify login

# Link to your site (if not already linked)
netlify link

# Import all environment variables from .env file
netlify env:import .env

# Trigger deployment
netlify deploy --prod
```

## Verification

After adding environment variables and redeploying:

1. **Check deployment logs**
   - Go to Netlify Deploys tab
   - Click on the latest deployment
   - Check for any errors

2. **Test the app**
   - Go to your deployed URL
   - Try creating a new event
   - Should work without errors!

3. **Check browser console**
   - Open developer tools (F12)
   - Should see: `✅ Firebase initialized successfully with project: wedding-photo-240c9`

## Why This Happened

Looking at your git history, there was a recent security commit:
```
3be02a9 Security: Remove exposed credentials and fix upload modal scrolling
```

It's likely that:
1. Credentials were removed from the codebase (good!)
2. But they weren't verified in Netlify dashboard (oops!)
3. Or they were accidentally removed from Netlify too

## Prevention

To avoid this in the future:

1. **Always check Netlify env vars** after security cleanups
2. **Keep `.env.example` updated** as a reference
3. **Test deployments** after credential changes
4. **Use Netlify CLI** to sync env vars automatically

## Still Not Working?

If you still get errors after adding environment variables:

1. **Wait 1-2 minutes** after triggering deployment
2. **Hard refresh** your browser (Ctrl+Shift+R or Cmd+Shift+R)
3. **Check Netlify function logs** for specific errors
4. **Verify environment variables** are actually saved in Netlify dashboard
5. **Check variable names** - no typos, correct prefixes (REACT_APP_)

## Need Help?

The error logs should be much clearer now with the improved error handling. Check:
- Browser console for frontend errors
- Netlify function logs for backend errors
- This should tell you exactly what's missing
