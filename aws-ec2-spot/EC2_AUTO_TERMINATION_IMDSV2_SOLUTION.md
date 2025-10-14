# EC2 Auto-Termination Solution - IMDSv2 Authentication

## Problem
EC2 instances were NOT auto-terminating after idle timeout, causing 24/7 running costs.

## Root Cause
**IMDSv2 (Instance Metadata Service Version 2) requires session token authentication.**

When calling `getInstanceId()`, we got:
```
❌ Failed to get instance ID: HTTP 401
❌ Could not get IMDSv2 session token
```

Without the instance ID, `terminateInstance()` failed silently, leaving instances running forever.

## Solution - IMDSv2 Two-Step Authentication

### Step 1: Get Session Token
```javascript
async function getImdsSessionToken() {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const options = {
      hostname: '169.254.169.254',
      port: 80,
      path: '/latest/api/token',
      method: 'PUT',  // ⚠️ Must be PUT!
      headers: {
        'X-aws-ec2-metadata-token-ttl-seconds': '21600' // 6 hours
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data.trim());
        } else {
          resolve(null);
        }
      });
    });

    req.on('error', (err) => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}
```

### Step 2: Use Token to Fetch Instance ID
```javascript
async function getInstanceId() {
  return new Promise(async (resolve) => {
    try {
      // Get IMDSv2 session token first
      const token = await getImdsSessionToken();
      if (!token) {
        resolve(null);
        return;
      }

      // Use token to fetch instance ID
      const http = require('http');
      const options = {
        hostname: '169.254.169.254',
        port: 80,
        path: '/latest/meta-data/instance-id',
        method: 'GET',
        headers: {
          'X-aws-ec2-metadata-token': token  // ⚠️ Required header!
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`✅ Got instance ID: ${data.trim()}`);
            resolve(data.trim());
          } else {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    } catch (error) {
      resolve(null);
    }
  });
}
```

## Why This Works

1. **IMDSv2 Security**: AWS requires token-based authentication for metadata
2. **PUT Request**: Session token is obtained via PUT to `/latest/api/token`
3. **Token Header**: All metadata requests must include `X-aws-ec2-metadata-token` header
4. **TTL**: Token is valid for up to 6 hours (21600 seconds)

## Complete Auto-Termination Flow

1. Processor detects 5 minutes idle
2. Calls `getImdsSessionToken()` → Gets session token ✅
3. Calls `getInstanceId()` with token → Gets instance ID ✅
4. Calls `terminateInstance()` with instance ID ✅
5. Exits with `process.exit(0)`
6. Systemd sees exit(0) → Doesn't restart (Restart=on-failure)
7. EC2 termination proceeds → Instance shuts down ✅

## Key Files

- **Processor**: `aws-ec2-spot/wedding-photo-processor-streaming-fixed.js`
- **Lambda**: `aws-ec2-spot/lambda-function.js` (systemd config with Restart=on-failure)

## Result

✅ **Cost-efficient**: ~$0.01-0.02 per job instead of 24/7 running  
✅ **Reliable**: Multiple consecutive emails work without manual intervention  
✅ **Automatic**: Instance terminates after 5 minutes of inactivity
