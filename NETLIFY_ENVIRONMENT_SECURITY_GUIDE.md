# 🔒 Netlify Environment Variables Security Guide

## 📋 Complete Environment Variables Setup

Based on your cleaned up `.env` file, here's exactly what to add to Netlify and which ones need security protection.

## 🔧 Netlify Dashboard Setup

Go to: **Netlify Dashboard → Your Site → Site Settings → Environment Variables**

### ✅ **FIREBASE CONFIGURATION** (All Safe - Leave Unchecked)
```bash
REACT_APP_FIREBASE_API_KEY=AIzaSyAyNVqZHZaRXvwGKIi--h1UAuiOAW9lrJ4
REACT_APP_FIREBASE_AUTH_DOMAIN=wedding-photo-240c9.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=wedding-photo-240c9
REACT_APP_FIREBASE_STORAGE_BUCKET=wedding-photo-240c9.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=767610841427
REACT_APP_FIREBASE_APP_ID=1:767610841427:web:e78675ba1d30c4fe4e19a6
REACT_APP_FIREBASE_MEASUREMENT_ID=G-HRXH4LVZBS
```
**Security Level**: ⭕ **Safe** - These are public frontend variables

---

### ⚠️ **CLOUDFLARE R2 STORAGE** (Mixed Security)
```bash
R2_ACCOUNT_ID=98a9cce92e578cafdb9025fa24a6ee7e                           # ⭕ Safe
R2_ACCESS_KEY_ID=06da59a3b3aa1315ed2c9a38efa7579e                        # ⭕ Safe
R2_SECRET_ACCESS_KEY=e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8... # 🔒 SECRET
R2_BUCKET_NAME=sharedmoments-photos-production                           # ⭕ Safe
R2_ENDPOINT=https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com # ⭕ Safe
R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com              # ⭕ Safe
```

**🔒 CRITICAL**: `R2_SECRET_ACCESS_KEY` **MUST** be marked as "Contains secret value"

---

### 🔒 **EMAIL SYSTEM** (Mixed Security)
```bash
EMAIL_USER=noreply@sharedmoments.socialboostai.com    # ⭕ Safe
EMAIL_PASSWORD=your_highlevel_smtp_password_here      # 🔒 SECRET
EMAIL_HOST=smtp.mailgun.org                          # ⭕ Safe
EMAIL_PORT=587                                        # ⭕ Safe
EMAIL_FROM_NAME=SharedMoments                         # ⭕ Safe
```

**🔒 CRITICAL**: `EMAIL_PASSWORD` **MUST** be marked as "Contains secret value"

---

## 🔒 **SECRET VARIABLES SUMMARY**

### ✅ **CHECK "Contains secret value" for these 2 variables:**

1. **`R2_SECRET_ACCESS_KEY`** 
   - Value: `e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27`
   - ✅ **CHECK "Contains secret value"**

2. **`EMAIL_PASSWORD`**
   - Value: `your_highlevel_smtp_password_here` (replace with actual password)
   - ✅ **CHECK "Contains secret value"**

### ⭕ **LEAVE UNCHECKED for all other variables:**
- All `REACT_APP_*` variables (public frontend)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL`
- `EMAIL_USER`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_FROM_NAME`

---

## 🚨 **What "Contains secret value" Does**

When you check this box:
- ✅ **Encrypts the value** in Netlify's database
- ✅ **Hides from logs** and build output
- ✅ **Masks in UI** (shows ••••••••)
- ✅ **Prevents accidental exposure** in screenshots/sharing
- ✅ **Meets security best practices**

When you DON'T check it:
- ⚠️ Value is stored in plain text
- ⚠️ Visible in logs and UI
- ⚠️ Could be accidentally exposed

---

## 📝 **Step-by-Step Netlify Setup**

### 1. **Add Safe Variables First** (Unchecked)
```
REACT_APP_FIREBASE_API_KEY → AIzaSyAyNVqZHZaRXvwGKIi--h1UAuiOAW9lrJ4
REACT_APP_FIREBASE_AUTH_DOMAIN → wedding-photo-240c9.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID → wedding-photo-240c9
REACT_APP_FIREBASE_STORAGE_BUCKET → wedding-photo-240c9.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID → 767610841427
REACT_APP_FIREBASE_APP_ID → 1:767610841427:web:e78675ba1d30c4fe4e19a6
REACT_APP_FIREBASE_MEASUREMENT_ID → G-HRXH4LVZBS
R2_ACCOUNT_ID → 98a9cce92e578cafdb9025fa24a6ee7e
R2_ACCESS_KEY_ID → 06da59a3b3aa1315ed2c9a38efa7579e
R2_BUCKET_NAME → sharedmoments-photos-production
R2_ENDPOINT → https://98a9cce92e578cafdb9025fa24a6ee7e.r2.cloudflarestorage.com
R2_PUBLIC_URL → https://sharedmomentsphotos.socialboostai.com
EMAIL_USER → noreply@sharedmoments.socialboostai.com
EMAIL_HOST → smtp.mailgun.org
EMAIL_PORT → 587
EMAIL_FROM_NAME → SharedMoments
```

### 2. **Add Secret Variables** (With "Contains secret value" checked)
```
R2_SECRET_ACCESS_KEY → e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27
✅ CHECK "Contains secret value"

EMAIL_PASSWORD → your_actual_highlevel_smtp_password
✅ CHECK "Contains secret value"
```

---

## ✅ **Verification Checklist**

After adding all variables:

- [ ] **18 total environment variables** added to Netlify
- [ ] **2 variables marked as secret**: `R2_SECRET_ACCESS_KEY` and `EMAIL_PASSWORD`
- [ ] **16 variables left unchecked** (safe/public values)
- [ ] **Deploy triggered** after adding variables
- [ ] **Test email system** works with new professional setup

---

## 🔍 **Security Best Practices**

### ✅ **Do This:**
- Mark passwords, secret keys, and API secrets as "Contains secret value"
- Use strong, unique passwords for email accounts
- Rotate secrets periodically
- Monitor for unauthorized access

### ❌ **Never Do This:**
- Put secrets in frontend code (REACT_APP_ variables)
- Share secret values in Slack/email/screenshots
- Commit secrets to Git repositories
- Use the same password across multiple services

---

## 🎯 **Why This Matters**

**Security Benefits:**
- Prevents credential theft from logs
- Meets enterprise security standards
- Protects your HighLevel/Mailgun accounts
- Prevents unauthorized R2 storage access

**Compliance Benefits:**
- Follows OWASP security guidelines
- Meets client security expectations
- Professional development practices
- Reduces liability risks

---

## 🚀 **Final Deployment**

Once all environment variables are set correctly:

1. **Deploy your site** (automatic if GitHub connected)
2. **Test the professional email system**
3. **Verify secret variables are masked** in Netlify UI
4. **Confirm mobile uploads work** (Firebase)
5. **Test download emails** (professional Mailgun delivery)

Your SharedMoments app will now have enterprise-grade security with professional email delivery!
