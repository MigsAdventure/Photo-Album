# 📧 Testing Email Download in Localhost

## ✅ Correct Command
```bash
npx netlify dev
```
(Not just `netlify dev` - you need `npx` since it's not globally installed)

## 🚀 What Happens When You Run `npx netlify dev`

1. **Netlify CLI starts** (currently installing...)
2. **Functions become available** at `/.netlify/functions/*`
3. **Your app runs** on `http://localhost:8888` (not 3000!)
4. **Email download works** just like in production

## 🧪 How to Test Email Download

### Step 1: Start the Local Server
```bash
npx netlify dev
```
Wait for: `Server now ready on http://localhost:8888`

### Step 2: Access Your App
- **URL:** http://localhost:8888 
- **NOT:** http://localhost:3000 (that's regular React dev server)

### Step 3: Test Email Download
1. Go to any event with photos
2. Click "Download All Photos" 
3. Enter your email address
4. Click "Send Download Link"

### Step 4: Check Results
- ✅ **Success:** You'll see "Download link sent successfully!"
- 📧 **Email:** Check your email for the download link
- 🎯 **Real Download:** The link will work and download actual photos

## 🔍 Troubleshooting

### If Email Download Still Fails:
```bash
# Test if functions are available
curl http://localhost:8888/.netlify/functions/email-download
```

### If Port 8888 is Busy:
```bash
# Netlify will automatically find another port
# Check the terminal output for the actual URL
```

### Environment Variables:
- Your `.env` file should work automatically
- Netlify CLI loads environment variables from `.env`

## 📊 Expected vs Actual Behavior

| Environment | Command | Port | Email Download |
|-------------|---------|------|----------------|
| Regular Dev | `npm start` | 3000 | ❌ Fails |
| Netlify Dev | `npx netlify dev` | 8888 | ✅ Works |
| Production | Deployed | 443 | ✅ Works |

## 🎯 Key Point
The email download feature **requires Netlify functions** to work. Regular `npm start` only runs React, but `npx netlify dev` runs the full Netlify environment locally.

## 📧 What Email You'll Receive
- **Subject:** "Your SharedMoments photos are ready for download"
- **Content:** Download link valid for 48 hours
- **File:** ZIP with all event photos
- **Size:** Depends on number and size of photos

## 🚀 Ready to Test!
Once you see "Server now ready on http://localhost:8888", you can test the full email download functionality locally!
