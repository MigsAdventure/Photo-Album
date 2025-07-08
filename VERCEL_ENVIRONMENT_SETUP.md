# Vercel Environment Variables Setup 🔧

## 🚨 Upload Failing Issue

The upload failure is likely due to **missing R2 environment variables in Vercel production**. The enhanced error handling will show exactly which variables are missing.

## ✅ Required Environment Variables for Vercel

### **Step 1: Go to Vercel Dashboard**
1. Visit: https://vercel.com/dashboard
2. Click on your project: `sharedmemories`
3. Go to **Settings** → **Environment Variables**

### **Step 2: Add ALL These Variables**

**R2 Storage Variables:**
```
R2_ACCOUNT_ID = 98a9cce92e578cafdb9025fa24a6ee7e
R2_ACCESS_KEY_ID = [YOUR_ACTUAL_R2_ACCESS_KEY]
R2_SECRET_ACCESS_KEY = [YOUR_ACTUAL_R2_SECRET_KEY]
R2_BUCKET_NAME = sharedmoments-photos-production
R2_ENDPOINT = https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com
R2_PUBLIC_URL = https://sharedmomentsphotos.socialboostai.com
```

**Firebase Variables:**
```
REACT_APP_FIREBASE_API_KEY = AIzaSyAyNVqZHZaRXvwGKIi--h1UAuiOAW9lrJ4
REACT_APP_FIREBASE_AUTH_DOMAIN = wedding-photo-240c9.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID = wedding-photo-240c9
REACT_APP_FIREBASE_STORAGE_BUCKET = wedding-photo-240c9.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID = 767610841427
REACT_APP_FIREBASE_APP_ID = 1:767610841427:web:e78675ba1d30c4fe4e19a6
REACT_APP_FIREBASE_MEASUREMENT_ID = G-HRXH4LVZBS
```

### **Step 3: Set Environment for All Environments**
- **Production**: ✅ Check
- **Preview**: ✅ Check  
- **Development**: ✅ Check

## 🔍 Get Your Actual R2 Credentials

### **From Cloudflare Dashboard:**
1. Go to: https://dash.cloudflare.com/
2. Click **R2 Object Storage**
3. Go to **Manage R2 API tokens**
4. Find your token or create a new one
5. Copy the **Access Key ID** and **Secret Access Key**

### **Your R2 S3 API Endpoint:**
```
https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com/sharedmoments-photos-production
```

**Important:** In the environment variables, use:
- **Endpoint**: `https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com` (NO bucket name)
- **Bucket Name**: `sharedmoments-photos-production` (separate variable)

## 🚀 After Adding Variables

### **Step 1: Redeploy**
```bash
git add .
git commit -m "Update environment variables setup"
git push origin main
```

### **Step 2: Force New Deployment**
1. Go to Vercel dashboard → Deployments
2. Click the **"..." menu** on latest deployment
3. Click **"Redeploy"** to force a fresh deployment

### **Step 3: Test Upload**
1. Go to your production site
2. Try uploading a photo
3. Check Vercel Function logs if it fails

## 🔧 Debugging Upload Issues

### **Check Function Logs:**
1. Vercel Dashboard → Functions tab
2. Try an upload
3. Click on the `/api/upload` function execution
4. Look for these logs:

**Success Logs:**
```
Upload API called with method: POST
Environment check: { all true }
R2 client initialized successfully
Running multer middleware...
File received: { hasFile: true, ... }
Uploading to R2 with key: events/...
R2 upload successful
Photo uploaded successfully: ...
```

**Error Logs:**
```
Environment check: {
  hasR2AccountId: false,  // ❌ Missing!
  hasR2AccessKey: false,  // ❌ Missing!
  ...
}
Server configuration error - missing R2 credentials
```

## 📋 Troubleshooting Checklist

- [ ] **R2 credentials added to Vercel environment variables**
- [ ] **Firebase variables added to Vercel environment variables**  
- [ ] **All variables applied to Production/Preview/Development**
- [ ] **Forced redeploy after adding variables**
- [ ] **R2 API token has correct permissions (Object Storage:Edit)**
- [ ] **R2 bucket exists and is accessible**

## 🎯 Expected Results

After correctly configuring environment variables:
- ✅ **Uploads work**: Photos upload to R2 successfully
- ✅ **Downloads work**: Both R2 and Firebase Storage photos download
- ✅ **No 500 errors**: All API endpoints work correctly
- ✅ **Clear error messages**: Any issues are clearly logged

The most common issue is simply missing environment variables in Vercel!
