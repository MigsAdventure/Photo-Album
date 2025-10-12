#!/bin/bash
set -e

# Log all output for troubleshooting
exec 1>/var/log/user-data.log 2>&1

echo "Starting EC2 instance setup (modern streaming, ASCII-safe) at $(date)"

# Update base packages first to avoid repo/key issues
yum update -y

# Install Node.js (prefer Node 20; fallback to Node 18)
echo "Installing Node.js runtime and base tools..."
if ! curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -; then
  echo "NodeSource setup_20.x failed; trying Node 18"
  curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
fi
yum install -y nodejs git htop amazon-cloudwatch-agent

echo "Node version: $(node -v || true)"
echo "NPM version: $(npm -v || true)"

# App directory
mkdir -p /app/logs
cd /app

# Fetch processor script from GitHub (keeps user-data small)
echo "Downloading streaming processor script..."
curl -fSL -o /app/wedding-photo-processor-streaming.js https://raw.githubusercontent.com/MigsAdventure/Photo-Album/main/aws-ec2-spot/wedding-photo-processor-streaming.js

# Apply ASCII-safe in-place patches using Perl (no Node dependency)
# - Add HeadObjectCommand import
# - Remove node-fetch require (use global fetch from Node 18+)
# - Pass eventId into createStreamingZip
# - Update function signature to include eventId
# - Add ContentDisposition + friendly filename on upload
# - Capture uploadPromise and await it in archive end handler with HeadObject verify
# - Strip any non-ASCII that might be present
cat > /tmp/patch.pl <<'PERL'
use strict;
use warnings;
local $/ = undef;
my $file = "/app/wedding-photo-processor-streaming.js";
open my $fh, "<", $file or die $!;
my $s = <$fh>;
close $fh;

$s =~ s/const \{ S3Client \} = require\('@aws-sdk\/client-s3'\);/const { S3Client, HeadObjectCommand } = require('@aws-sdk\/client-s3');/;
$s =~ s/const fetch = require\('node-fetch'\);\s*//;
$s =~ s/const \{ finalSizeMB \} = await createStreamingZip\(\s*photos\s*,\s*zipKey\s*\);/const { finalSizeMB, failedCount } = await createStreamingZip(photos, zipKey, eventId);/;
$s =~ s/async function createStreamingZip\(\s*photos\s*,\s*zipKey\s*\)\s*\{/async function createStreamingZip(photos, zipKey, eventId) {/;
$s =~ s/const upload = new Upload\(\{\s*client:\s*s3Client,\s*params:\s*\{\s*Bucket:\s*config\.r2\.bucketName,\s*Key:\s*zipKey,\s*Body:\s*zipStream,\s*ContentType:\s*'application\/zip'\s*\}\s*\}\);\s*/const fileName = `photos-${eventId || 'download'}.zip`;\n      const upload = new Upload({\n        client: s3Client,\n        params: {\n          Bucket: config.r2.bucketName,\n          Key: zipKey,\n          Body: zipStream,\n          ContentType: 'application/zip',\n          ContentDisposition: `attachment; filename="${fileName}"`\n        }\n      });\n/s;
$s =~ s/upload\.done\(\)\.catch\(reject\);/const uploadPromise = upload.done();/;
$s =~ s/archive\.on\('end',\s*\(\)\s*=>\s*\{\s*const finalSizeMB = archive\.pointer\(\) \/ \(1024 \* 1024\);\s*console\.log\([^\)]*\);\s*resolve\(\{ finalSizeMB \}\);\s*\}\);/archive.on('end', async () => {\n        const finalSizeMB = archive.pointer() \/ (1024 * 1024);\n        try {\n          await uploadPromise;\n          try {\n            const head = await s3Client.send(new HeadObjectCommand({ Bucket: config.r2.bucketName, Key: zipKey }));\n            const sizeMB = (Number(head.ContentLength || 0) \/ (1024 * 1024)).toFixed(2);\n            console.log('R2 object verified. Content-Length MB:', sizeMB);\n          } catch (e) { console.warn('HeadObject verification failed:', e && e.message ? e.message : e); }\n          resolve({ finalSizeMB, failedCount });\n        } catch (err) {\n          console.error('Upload completion error:', err && err.message ? err.message : err);\n          reject(err);\n        }\n      });/s;

$s =~ s/[^\x00-\x7F]//g;

open my $out, ">", $file or die $!;
print $out $s;
close $out;
print "Patched processor file.\n";
PERL

perl /tmp/patch.pl

# Install production deps
echo "Installing npm packages..."
npm init -y
npm install --omit=dev @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/lib-storage express archiver

# Systemd service
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

# CloudWatch agent config
mkdir -p /opt/aws/amazon-cloudwatch-agent/etc
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CW_CONFIG'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/app/logs/processor.log", "log_group_name": "/wedding-photo-processor/application", "log_stream_name": "{instance_id}" },
          { "file_path": "/app/logs/processor-error.log", "log_group_name": "/wedding-photo-processor/error", "log_stream_name": "{instance_id}" },
          { "file_path": "/var/log/user-data.log", "log_group_name": "/wedding-photo-processor/bootstrap", "log_stream_name": "{instance_id}" }
        ]
      }
    }
  }
}
CW_CONFIG

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

# Enable and start service
systemctl daemon-reload
systemctl enable wedding-streaming-processor
systemctl start wedding-streaming-processor

echo "Setup complete at $(date)"
systemctl status wedding-streaming-processor --no-pager || true

# Keep logs visible
tail -f /app/logs/processor.log /app/logs/processor-error.log
