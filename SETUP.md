# Setup Guide - Shared Moments Photo App

This guide will help you set up the Shared Moments photo-sharing application.

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Firebase account
- Netlify account (for deployment)

## Step 1: Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Enable **Firestore Database**:
   - Go to Firestore Database in the sidebar
   - Click "Create Database"
   - Choose production mode or test mode (recommend starting with test mode)
   - Select a location close to your users
4. Enable **Firebase Storage**:
   - Go to Storage in the sidebar
   - Click "Get Started"
   - Accept the default security rules (we'll update them later)
5. Get your Firebase configuration:
   - Go to Project Settings (gear icon)
   - Scroll down to "Your apps"
   - Click the web icon (`</>`) to create a web app
   - Copy the configuration values

## Step 2: Environment Variables Setup

### For Local Development

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your Firebase configuration in `.env`:
   ```env
   REACT_APP_FIREBASE_API_KEY=your_api_key_here
   REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   REACT_APP_FIREBASE_PROJECT_ID=your-project-id
   REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   REACT_APP_FIREBASE_APP_ID=your_app_id
   REACT_APP_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
   ```

### For Netlify Deployment

1. Go to your Netlify site dashboard
2. Navigate to **Site settings** → **Environment variables**
3. Add the following environment variables:

   **Required Firebase Variables:**
   - `REACT_APP_FIREBASE_API_KEY`
   - `REACT_APP_FIREBASE_AUTH_DOMAIN`
   - `REACT_APP_FIREBASE_PROJECT_ID`
   - `REACT_APP_FIREBASE_STORAGE_BUCKET`
   - `REACT_APP_FIREBASE_MESSAGING_SENDER_ID`
   - `REACT_APP_FIREBASE_APP_ID`
   - `REACT_APP_FIREBASE_MEASUREMENT_ID` (optional)

   **Optional Backend Variables:**
   - `R2_ACCOUNT_ID` (for Cloudflare R2 storage)
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET_NAME`
   - `SENDGRID_API_KEY` (for email notifications)
   - `SENDGRID_FROM_EMAIL`

4. After adding variables, **redeploy your site** for changes to take effect

## Step 3: Firestore Security Rules

Update your Firestore security rules to allow read/write access:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Events collection - anyone can read, only system can write
    match /events/{eventId} {
      allow read: if true;
      allow write: if false; // Only backend can create events
    }
    
    // Photos collection - anyone can read, authenticated uploads
    match /photos/{photoId} {
      allow read: if true;
      allow create: if true;
      allow update: if false;
      allow delete: if resource.data.uploadedBy == request.auth.token.sessionId;
    }
  }
}
```

## Step 4: Firebase Storage Rules

Update your Firebase Storage security rules:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /events/{eventId}/photos/{photoId} {
      // Anyone can read
      allow read: if true;
      
      // Allow uploads with sessionId metadata
      allow create: if request.resource.metadata.sessionId != null;
      
      // Allow deletion only by uploader
      allow delete: if resource.metadata.sessionId == request.auth.token.sessionId;
    }
  }
}
```

## Step 5: Install Dependencies

```bash
npm install
```

## Step 6: Run Locally

```bash
npm start
```

The app should open at `http://localhost:3000`

## Step 7: Deploy to Netlify

### Option 1: Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

### Option 2: Git Integration

1. Push your code to GitHub/GitLab/Bitbucket
2. Connect your repository in Netlify dashboard
3. Set build command: `npm run build`
4. Set publish directory: `build`
5. Add environment variables (see Step 2)
6. Deploy!

## Troubleshooting

### "Failed to create event" Error

This error occurs when Firebase environment variables are not configured:

1. **Check your environment variables** are set correctly in Netlify dashboard
2. **Redeploy** after adding/updating variables
3. **Check browser console** for specific Firebase errors
4. **Verify Firebase project** is active and Firestore is enabled

### Firebase Initialization Error

If you see Firebase initialization errors:

1. Verify all `REACT_APP_FIREBASE_*` variables are set
2. Check that values don't have trailing spaces or quotes
3. Ensure your Firebase project has Firestore and Storage enabled
4. Check Firebase console for any quota or billing issues

### Local Development Not Working

1. Make sure `.env` file exists in project root
2. Restart development server after changing `.env`
3. Check that `.env` is not in `.gitignore` for your local copy

## Optional Features

### Email Notifications (SendGrid)

1. Sign up for [SendGrid](https://sendgrid.com/)
2. Create an API key
3. Add to environment variables:
   ```env
   SENDGRID_API_KEY=your_api_key
   SENDGRID_FROM_EMAIL=noreply@yourdomain.com
   ```

### Cloudflare R2 Storage

1. Sign up for [Cloudflare](https://cloudflare.com/)
2. Create an R2 bucket
3. Generate API tokens
4. Add to environment variables (backend only)

## Support

For issues or questions:
1. Check the browser console for error messages
2. Verify all environment variables are set correctly
3. Check Firebase console for service status
4. Review Netlify function logs for backend errors

## Security Notes

- Never commit `.env` file to git
- Use environment variables for all sensitive data
- Regularly rotate API keys and tokens
- Monitor Firebase usage and set up billing alerts
