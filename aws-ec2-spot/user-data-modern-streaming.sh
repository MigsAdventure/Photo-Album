#!/bin/bash
set -e

# Enhanced logging to a file for troubleshooting bootstrap issues
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "Starting EC2 instance setup (modern streaming, compact) at $(date)"

# Update and install dependencies
echo "Installing dependencies and Node.js 20 (NodeSource preferred; with fallbacks)..."
yum update -y
# Prefer Node.js 20 via NodeSource on Amazon Linux 2; fallback to amazon-linux-extras nodejs20, then Node 18 as last resort
if ! curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -; then
  echo "NodeSource setup_20.x failed, attempting amazon-linux-extras nodejs20..."
  amazon-linux-extras enable nodejs20 || true
  yum clean metadata || true
fi
if ! yum install -y nodejs git htop amazon-cloudwatch-agent; then
  echo "Primary Node.js install failed, trying Node.js 18 via NodeSource..."
  curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - || true
  yum install -y nodejs git htop amazon-cloudwatch-agent
fi
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# Create app directory
mkdir -p /app/logs
cd /app

# Download the upstream streaming processor script (keeps user-data small)
echo "Downloading streaming processor script (upstream)..."
curl -fSL -o /app/wedding-photo-processor-streaming.js https://raw.githubusercontent.com/MigsAdventure/Photo-Album/main/aws-ec2-spot/wedding-photo-processor-streaming.js

# Apply minimal runtime patches to ensure upload completion is awaited and add ContentDisposition
# (Keeps user-data under 16KB by patching instead of embedding full script)
echo "Patching streaming processor for robust upload completion and headers..."
node - <<'PATCH_EOF'
const fs = require('fs');
const path = '/app/wedding-photo-processor-streaming.js';
let s = fs.readFileSync(path, 'utf8');

// 1) Import HeadObjectCommand for verification
s = s.replace(
  "const { S3Client } = require('@aws-sdk/client-s3');",
  "const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');"
);

// 2) Remove node-fetch require (Node 22 has global fetch)
s = s.replace(/const fetch = require\('node-fetch'\);\n?/, '');

// 3) Remove unused fs import in streaming file if present
s = s.replace(/const fs = require\('fs'\);\n?/, '');

// 4) Pass eventId to createStreamingZip
s = s.replace(
  /const \{ finalSizeMB \} = await createStreamingZip\(photos,\s*zipKey\);/,
  "const { finalSizeMB } = await createStreamingZip(photos, zipKey, eventId);"
);

// 5) Update function signature
s = s.replace(
  "async function createStreamingZip(photos, zipKey) {",
  "async function createStreamingZip(photos, zipKey, eventId) {"
);

// 6) Add ContentDisposition header and friendly filename
s = s.replace(
/const upload = new Upload\(\{\s*client: s3Client,\s*params: \{\s*Bucket: config\.r2\.bucketName,\s*Key: zipKey,\s*Body: zipStream,\s*ContentType: 'application\/zip'\s*\}\s*\}\);/m,
"const fileName = `photos-${eventId || 'download'}.zip`;\n      const upload = new Upload({\n        client: s3Client,\n        params: {\n          Bucket: config.r2.bucketName,\n          Key: zipKey,\n          Body: zipStream,\n          ContentType: 'application/zip',\n          ContentDisposition: `attachment; filename=\"${fileName}\"`\n        }\n      });"
);

// 7) Capture upload promise instead of fire-and-forget
s = s.replace(/upload\.done\(\)\.catch\(reject\);/, 'const uploadPromise = upload.done();');

// 8) Ensure we await upload completion before resolving and verify with HeadObject
s = s.replace(
/archive\.on\('end',\s*\(\)\s*=>\s*\{\s*const finalSizeMB = archive\.pointer\(\) \/ \(1024 \* 1024\);\s*console\.log\(`🌊 Streaming ZIP completed: \$\{finalSizeMB\.toFixed\(2\)\} MB`\);\s*resolve\(\{ finalSizeMB \}\);\s*\}\);/m,
"archive.on('end', async () => {\n        const finalSizeMB = archive.pointer() / (1024 * 1024);\n        console.log(`🌊 Streaming ZIP completed: ${finalSizeMB.toFixed(2)} MB`);\n        try {\n          await uploadPromise;\n          console.log('✅ Upload to R2 completed');\n          try {\n            const head = await s3Client.send(new HeadObjectCommand({ Bucket: config.r2.bucketName, Key: zipKey }));\n            const sizeMB = (Number(head.ContentLength || 0) / (1024 * 1024)).toFixed(2);\n            console.log(`🔎 R2 object verified. Content-Length: ${sizeMB} MB`);\n          } catch (headErr) {\n            console.warn('⚠️ HeadObject verification failed:', headErr);\n          }\n          resolve({ finalSizeMB });\n        } catch (err) {\n          console.error('❌ Upload completion error:', err);\n          reject(err);\n        }\n      });"
);

fs.writeFileSync(path, s, 'utf8');
console.log('Streaming processor patched successfully');
PATCH_EOF

# Strip any non-ASCII characters from the processor script to avoid cloud-init encoding issues
perl -CSD -pe 's/[^[:ascii:]]//g' -i /app/wedding-photo-processor-streaming.js

# Initialize npm and install only required production dependencies
echo "Installing npm packages..."
npm init -y
npm install --omit=dev @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/lib-storage express archiver node-fetch@2

# Create systemd service with logging (uses global fetch from Node 18+)
cat > /etc/systemd/system/wedding-streaming-processor.service << 'SERVICE_EOF'
[Unit]
Description=Wedding Photo Streaming Processor (Node 18+ LTS)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/app
ExecStart=/usr/bin/node /app/wedding-photo-processor-streaming.js
Restart=on-failure
RestartSec=10
StandardOutput=append:/app/logs/processor.log
StandardError=append:/app/logs/processor-error.log
Environment="NODE_ENV=production"
Environment="R2_ACCOUNT_ID=98a9cce92e578cafdb9025fa24a6ee7e"
Environment="R2_ACCESS_KEY_ID=06da59a3b3aa1315ed2c9a38efa7579e"
Environment="R2_SECRET_ACCESS_KEY=e14eb0a73cac515e1e9fd400268449411e67e0ce78433ac8b9289cab5a9f6e27"
Environment="R2_BUCKET_NAME=sharedmoments-photos-production"
Environment="R2_PUBLIC_URL=https://sharedmomentsphotos.socialboostai.com"
Environment="AWS_SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/782720046962/wedding-photo-processing-queue"
Environment="AWS_REGION=us-east-1"
Environment="NETLIFY_EMAIL_ENDPOINT=https://sharedmoments.socialboostai.com/.netlify/functions/direct-email"

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Configure CloudWatch Logs to collect processor and bootstrap logs
echo "Setting up CloudWatch logs..."
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CW_CONFIG'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/app/logs/processor.log",
            "log_group_name": "/wedding-photo-processor/application",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/app/logs/processor-error.log",
            "log_group_name": "/wedding-photo-processor/error",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/wedding-photo-processor/bootstrap",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
CW_CONFIG

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
    -s

# Enable and start the streaming service
systemctl daemon-reload
systemctl enable wedding-streaming-processor
systemctl start wedding-streaming-processor

echo "Setup complete at $(date)"
echo "Service status:"
systemctl status wedding-streaming-processor --no-pager

# Keep logs visible for initial bootstrap
tail -f /app/logs/processor.log /app/logs/processor-error.log
