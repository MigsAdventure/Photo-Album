# 🚀 Cloudflare Worker Deployment Guide
**SharedMoments Photo Processing & Email Download System**

This guide will walk you through deploying your Cloudflare Worker that handles photo compression and email delivery using your existing GHL/Mailgun SMTP setup.

## 📋 Prerequisites

✅ **Your Configuration (Already Set):**
- **R2 Bucket:** `sharedmoments-photos-production`
- **R2 Public URL:** `https://sharedmomentsphotos.socialboostai.com`
- **Email Domain:** `sharedmoments.socialboostai.com`
- **SMTP Email:** `noreply@sharedmoments.socialboostai.com`
- **SMTP Password:** `$codeLife12` (from your .env)
- **SMTP Host:** `smtp.mailgun.org`

## 🔧 Step-by-Step Deployment

### Step 1: Install Wrangler CLI
```bash
npm install -g wrangler
```

### Step 2: Authenticate with Cloudflare
```bash
wrangler login
```
*This will open your browser to log into your Cloudflare account.*

### Step 3: Navigate to Worker Directory
```bash
cd cloudflare-worker
```

### Step 4: Install Dependencies
```bash
npm install
```

### Step 5: Set Environment Variables (Secrets)
Run these commands one by one. When prompted, enter the values shown:

```bash
# Set SMTP email user
wrangler secret put EMAIL_USER
# Enter: noreply@sharedmoments.socialboostai.com

# Set SMTP password
wrangler secret put EMAIL_PASSWORD
# Enter: $codeLife12

# Set SMTP host
wrangler secret put EMAIL_HOST
# Enter: smtp.mailgun.org

# Set R2 public URL
wrangler secret put R2_PUBLIC_URL
# Enter: https://sharedmomentsphotos.socialboostai.com
```

### Step 6: Deploy the Worker
```bash
npm run deploy
```

### Step 7: Get Worker URL
After deployment, you'll see output like:
```
✅ Successfully published your Worker
🌍 Available at: https://sharedmoments-photo-processor.your-subdomain.workers.dev
```

**Copy this URL - you'll need it for Netlify!**

## 🔗 Netlify Integration

### Step 8: Update Netlify Environment Variables
Go to your Netlify dashboard → Site settings → Environment variables and add:

```
CLOUDFLARE_WORKER_URL = https://sharedmoments-photo-processor.your-subdomain.workers.dev
```

### Step 9: Update Photo Deletion Function
Now you need to update your photo deletion functionality to use the new Cloudflare Worker.

## 🧪 Testing the Worker

### Test the Worker Directly
```bash
# Test if worker is running
curl https://your-worker-url.workers.dev

# Test with sample data (replace with your worker URL)
curl -X POST "https://your-worker-url.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "test",
    "eventId": "test-event"
  }'
```

## 📧 Email System Details

**How the Email System Works:**
1. Uses your existing GHL/Mailgun SMTP credentials
2. Same setup as your current Netlify functions
3. Professional HTML email templates
4. Compression statistics included in emails
5. Mobile-friendly download instructions

**Email Configuration:**
- **From:** `SharedMoments <noreply@sharedmoments.socialboostai.com>`
- **SMTP:** `smtp.mailgun.org:587` (TLS)
- **Auth:** Your existing GHL credentials

## 🔍 Monitoring & Debugging

### View Worker Logs
```bash
wrangler tail
```

### Check Worker Status
```bash
wrangler dev
```

### Update Worker Code
After making changes:
```bash
npm run deploy
```

## 🛡️ Security Features

✅ **Built-in Security:**
- All sensitive data stored as Wrangler secrets
- R2 bucket binding (no exposed credentials)
- Rate limiting and request validation
- Secure SMTP connection (TLS)
- Request ID tracking for audit trails

## 📊 Worker Capabilities

**What This Worker Does:**
1. **Photo Processing:** Compresses images using Sharp
2. **ZIP Creation:** Bundles photos into downloadable ZIP files
3. **Email Delivery:** Sends professional download links via SMTP
4. **Error Handling:** Graceful failure with user notifications
5. **Performance:** 30-second timeout for large collections
6. **Storage:** Direct R2 integration (same bucket as photos)

## 🚨 Troubleshooting

### Common Issues:

**❌ "Worker failed to deploy"**
```bash
# Check your wrangler.toml configuration
wrangler whoami
wrangler dev --local
```

**❌ "Email not sending"**
```bash
# Verify your secrets are set
wrangler secret list
# Re-set email credentials if needed
wrangler secret put EMAIL_PASSWORD
```

**❌ "R2 bucket access denied"**
- Ensure your Cloudflare account has R2 enabled
- Verify bucket name in wrangler.toml matches exactly

**❌ "Worker timeout"**
- Large photo collections may take longer
- Worker has 30-second timeout configured
- Consider processing in batches for huge collections

## 📈 Next Steps

1. ✅ Deploy the worker using this guide
2. ✅ Update Netlify environment variables  
3. ✅ Test with a small photo collection
4. ✅ Monitor worker logs during testing
5. ✅ Update your photo deletion functionality to use the worker

## 💡 Benefits of This Setup

**🚀 Performance:** Cloudflare's global edge network
**💰 Cost-Effective:** Pay-per-request pricing
**🔧 Reliability:** Built-in redundancy and error handling
**📧 Professional:** Branded email templates with compression stats
**🔒 Secure:** Enterprise-grade security and encryption
**📱 Mobile-Friendly:** Optimized for all devices

---

**Need Help?** 
- Check worker logs: `wrangler tail`
- Test locally: `wrangler dev`
- Redeploy: `npm run deploy`

**Your worker will be available at:**
`https://sharedmoments-photo-processor.{your-subdomain}.workers.dev`

*This URL will process photo compression requests and send professional download emails using your existing email infrastructure.*
