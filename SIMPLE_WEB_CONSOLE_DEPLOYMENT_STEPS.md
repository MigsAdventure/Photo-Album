# 🚀 **SIMPLE GOOGLE CLOUD DEPLOYMENT - WEB CONSOLE**

## 📋 **STEP-BY-STEP INSTRUCTIONS**

### **Step 1: Open Google Cloud Console**
1. Go to: https://console.cloud.google.com/functions
2. Make sure **wedding-photo-240c9** project is selected (top left)
3. Make sure **us-west1** region is selected

### **Step 2: Find Your Function**
1. Look for **processWeddingPhotos** in the list
2. Click on the function name to open it

### **Step 3: Edit the Function**
1. Click the **EDIT** button at the top
2. You'll see a screen with tabs: **Configuration** and **Code**

### **Step 4: Update Configuration**
1. Make sure these settings are correct:
   - **Runtime**: Node.js 20
   - **Memory**: 8 GB
   - **Timeout**: 900 seconds (15 minutes)
   - **Allow unauthenticated invocations**: ✅ checked

### **Step 5: Update the Code**
1. Click the **Code** tab
2. You'll see two files: **package.json** and **index.js**

#### **5a. Update package.json**
Click on **package.json** and replace ALL content with:
```json
{
  "name": "wedding-photo-processor",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@google-cloud/functions-framework": "^3.0.0",
    "@google-cloud/storage": "^7.0.0",
    "archiver": "^5.3.1",
    "sharp": "^0.32.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

#### **5b. Update index.js**
1. Click on **index.js**
2. **DELETE ALL** the current code
3. Copy the **ENTIRE** contents from the file: `google-cloud-function/index.js`
4. Paste it into the editor (replace everything)

### **Step 6: Set Environment Variables**
1. Click the **Variables** tab (near the code tabs)
2. Add this environment variable:
   - **Name**: `NETLIFY_EMAIL_FUNCTION_URL`
   - **Value**: `https://main--sharedmoments.netlify.app/.netlify/functions/email-download`

### **Step 7: Deploy**
1. Click the **DEPLOY** button at the bottom
2. Wait 2-3 minutes for deployment to complete
3. You'll see "✅ Function deployed successfully"

---

## 🧪 **TEST THE DEPLOYMENT**

After deployment completes, run this test:

```bash
node test-google-cloud-fix.js
```

**Expected output:**
```
🎉 SUCCESS! Google Cloud Function is working!
📧 Processing initiated for 3 files
⏳ Estimated processing time: 5-15 minutes
```

---

## 📧 **VERIFY EMAIL WORKS**

1. Run the test above
2. Wait 5-15 minutes
3. Check the email address you used in the test
4. You should receive a professional email with download links

---

## 🔍 **MONITOR THE FUNCTION**

To watch it work in real-time:
1. In Google Cloud Console, go to your function
2. Click the **LOGS** tab
3. You'll see live processing logs
4. Look for ✅ success messages instead of ❌ errors

---

## 🚨 **IF YOU NEED HELP**

1. **Can't find the function?** 
   - Make sure project **wedding-photo-240c9** is selected
   - Make sure region **us-west1** is selected

2. **Deploy button greyed out?**
   - Make sure you saved the code changes
   - Check that Node.js 20 runtime is selected

3. **Still getting errors?**
   - Check the LOGS tab for specific error messages
   - Run `node test-google-cloud-fix.js` again

---

## ✅ **SUCCESS CHECKLIST**

- [ ] Function shows **Node.js 20** runtime
- [ ] Function has **8GB** memory 
- [ ] Function has **900 seconds** timeout
- [ ] Environment variable **NETLIFY_EMAIL_FUNCTION_URL** is set
- [ ] Code is updated with fixed version
- [ ] Test shows "🎉 SUCCESS!" message
- [ ] Emails are delivered within 15 minutes

**Once complete, your 500MB+ video processing will work perfectly! 🎉**
