# Troubleshooting Guide - Event Creation Failure

## Issue: "Failed to create event"

### Root Cause

The event creation failure occurs because **Firebase environment variables are not configured**. The app requires Firebase Firestore to store event data, but without proper configuration, Firebase initialization fails silently.

### Symptoms

- Error message: "Failed to create event. Please try again."
- Browser console shows Firebase initialization errors
- App appears to load normally but fails when creating events

### Solution

#### For Netlify Deployment (Production)

1. **Go to Netlify Dashboard**
   - Navigate to your site
   - Click **Site settings** → **Environment variables**

2. **Add Required Firebase Variables**
   
   You need to add these environment variables from your Firebase project:
   
   ```
   REACT_APP_FIREBASE_API_KEY=your_firebase_api_key
   REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   REACT_APP_FIREBASE_PROJECT_ID=your-project-id
   REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   REACT_APP_FIREBASE_APP_ID=your_firebase_app_id
   REACT_APP_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
   ```

3. **Get Firebase Values**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select your project
   - Click the gear icon ⚙️ → **Project settings**
   - Scroll down to "Your apps" section
   - Find your web app or create one
   - Copy the config values

4. **Redeploy Your Site**
   - After adding environment variables, trigger a new deployment
   - Either push a new commit or use "Trigger deploy" in Netlify

#### For Local Development

1. **Create `.env` file in project root**
   ```bash
   cp .env.example .env
   ```

2. **Fill in Firebase configuration**
   Edit `.env` and add your Firebase values (same as above)

3. **Restart development server**
   ```bash
   npm start
   ```

### Verification Steps

After configuring environment variables:

1. **Check browser console** - You should see:
   ```
   ✅ Firebase initialized successfully with project: your-project-id
   ```

2. **Try creating an event** - The error should be resolved

3. **If still failing**, check:
   - All required variables are set (no typos)
   - Variables don't have extra quotes or spaces
   - Firebase project has Firestore enabled
   - Firestore security rules allow writes

### Additional Checks

#### Verify Firestore is Enabled

1. Go to Firebase Console
2. Navigate to **Firestore Database**
3. If you see "Create database", click it and set up Firestore
4. Choose "Start in test mode" for easier initial setup

#### Check Firestore Security Rules

Your Firestore rules should allow event creation. Basic rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /events/{eventId} {
      allow read: if true;
      allow create: if true;  // Allow event creation
    }
  }
}
```

#### Check Browser Console

Open browser developer tools (F12) and look for:
- Firebase initialization errors
- Network errors
- Permission denied errors
- CORS errors

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Firebase configuration error" | Environment variables not set | Add Firebase environment variables |
| "permission-denied" | Firestore rules too restrictive | Update Firestore security rules |
| "network error" | Internet connectivity issue | Check internet connection |
| "invalid-api-key" | Wrong API key | Verify API key from Firebase Console |
| "project-not-found" | Wrong project ID | Verify project ID from Firebase Console |

### Still Not Working?

1. **Clear browser cache** and reload
2. **Check Netlify function logs** for backend errors
3. **Verify Firebase project** is not suspended or over quota
4. **Test in incognito/private mode** to rule out extensions
5. **Check Firebase Console** → Usage tab for any quota issues

### Prevention

To prevent this issue in the future:

1. **Use `.env.example`** as a template for all deployments
2. **Document required environment variables** in your deployment guide
3. **Add health check endpoint** to verify configuration
4. **Set up monitoring** to detect configuration issues early

### Related Files

- `src/firebase.ts` - Firebase initialization with validation
- `src/services/photoService.ts` - Event creation logic
- `.env.example` - Template for environment variables
- `SETUP.md` - Complete setup guide

### Need More Help?

If you're still experiencing issues after following this guide:

1. Check browser console for specific error messages
2. Review Netlify deployment logs
3. Verify Firebase project is active and properly configured
4. Ensure billing is set up if using Firebase beyond free tier
