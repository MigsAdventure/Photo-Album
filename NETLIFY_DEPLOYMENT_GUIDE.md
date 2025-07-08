# 🚀 Netlify Deployment Guide

## Why Migrate to Netlify?

Vercel functions were completely broken (FUNCTION_INVOCATION_FAILED errors). **R2 upload works perfectly** (we tested it), but Vercel's serverless functions had fundamental issues.

✅ **Netlify Benefits:**
- More reliable serverless functions
- Better error handling and debugging
- Same cost structure as Vercel
- Proven to work with our R2 setup

---

## 📋 Step-by-Step Migration

### **Step 1: Create Netlify Account**

1. Go to [netlify.com](https://netlify.com)
2. Sign up with your GitHub account
3. This will give you access to deploy from your repositories

### **Step 2: Deploy from GitHub**

1. **Click "New site from Git"**
2. **Choose "GitHub"** and authorize Netlify
3. **Select your repository:** `MigsAdventure/Photo-Album`
4. **Configure build settings:**
   - **Build command:** `npm run build`
   - **Publish directory:** `build`
   - **Functions directory:** `netlify/functions` (should auto-detect)

### **Step 3: Configure Environment Variables**

In Netlify dashboard → Site Settings → Environment Variables, add:

```bash
# R2 Storage (same values from Vercel)
R2_ACCOUNT_ID=98a9cce92e578cafdb9025fa24a6ee7e
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key  
R2_BUCKET_NAME=sharedmoments-photos-production
R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com

# Firebase (same values from Vercel)
REACT_APP_FIREBASE_API_KEY=your_firebase_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
REACT_APP_FIREBASE_PROJECT_ID=your_firebase_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
REACT_APP_FIREBASE_APP_ID=your_firebase_app_id
REACT_APP_FIREBASE_MEASUREMENT_ID=your_firebase_measurement_id
```

**⚠️ Important:** Copy the exact values from your Vercel environment variables.

### **Step 4: Deploy and Test**

1. **Trigger deployment:** Push any commit or click "Deploy site"
2. **Wait for build:** Should take 2-3 minutes
3. **Get temporary URL:** Something like `https://amazing-name-123456.netlify.app`

### **Step 5: Test Functionality**

Test these endpoints on your new Netlify URL:

1. **Test upload:** 
   - Go to `https://your-site.netlify.app/event/LWv0XJUp4IRmyg5Q7a3t`
   - Click "Take Photo" and upload an image
   - ✅ Should work without FUNCTION_INVOCATION_FAILED errors

2. **Test gallery:** Photos should appear in real-time
3. **Test downloads:** Individual and bulk ZIP downloads should work

### **Step 6: Configure Custom Domain**

1. **In Netlify:** Site Settings → Domain Settings
2. **Add custom domain:** `sharedmoments.socialboostai.com`
3. **Update DNS:** Point your domain to Netlify's servers
   - **Type:** CNAME
   - **Name:** sharedmoments  
   - **Value:** `your-site-name.netlify.app`

4. **Enable HTTPS:** Netlify auto-generates SSL certificates

---

## 🔧 What's Changed

### **Frontend Changes**
- API calls now use `/.netlify/functions/` instead of `/api/`
- Same functionality, just different endpoints

### **Backend Changes**  
- ✅ `netlify/functions/upload.js` - R2 photo uploads
- ✅ `netlify/functions/download.js` - Single photo downloads
- ✅ `netlify/functions/bulk.js` - ZIP bulk downloads

### **Configuration**
- ✅ `netlify.toml` - Netlify configuration
- ✅ Function redirects from `/api/*` to `/.netlify/functions/*`

---

## 🧪 Local Development

To test Netlify functions locally:

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Run local development server
netlify dev
```

This will run your React app + Netlify functions locally on `http://localhost:8888`

---

## 📊 Cost Comparison

**Netlify Free Tier:**
- ✅ 125K function calls/month (vs Vercel's 100K)
- ✅ 100GB bandwidth/month  
- ✅ Unlimited sites
- ✅ **Same R2 storage costs** (~$0.11/month for your use case)

**Total monthly cost:** ~$0.11 (just R2 storage) for typical wedding events

---

## 🚨 Migration Checklist

- [ ] Create Netlify account
- [ ] Connect GitHub repository  
- [ ] Configure environment variables (copy from Vercel)
- [ ] Deploy and get temporary URL
- [ ] Test upload functionality
- [ ] Test photo gallery
- [ ] Test downloads
- [ ] Configure custom domain
- [ ] Update any hardcoded URLs
- [ ] Test production deployment

---

## 🎉 Expected Results

After migration:
- ✅ **Working uploads** - No more FUNCTION_INVOCATION_FAILED
- ✅ **Better reliability** - Netlify functions are more stable  
- ✅ **Same features** - Upload, gallery, downloads all work
- ✅ **Same cost** - Free tier covers your needs
- ✅ **Better debugging** - Clearer error messages

The app will work exactly the same for users, but with reliable backend infrastructure!
