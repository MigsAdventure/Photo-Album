/**
 * Shared Cloudflare R2 client for Netlify functions.
 *
 * R2 speaks the S3 API, so this is an S3Client pointed at the account endpoint.
 * Previously each function constructed its own copy with its own spelling of the
 * config, which is how the two archive key schemes in finding ZIP-6 drifted
 * apart.
 *
 * Environment variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME, R2_PUBLIC_URL.
 */

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

let client;

function assertConfigured() {
  const missing = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ].filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`R2 is not configured — missing ${missing.join(', ')}`);
  }
}

function getClient() {
  if (client) return client;

  assertConfigured();

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  return client;
}

function getBucketName() {
  return process.env.R2_BUCKET_NAME;
}

/**
 * Delete an object, treating "already gone" as success. Deletion is called from
 * cleanup paths where a missing object means the work is done, not that
 * something failed.
 */
async function deleteObject(key) {
  if (!key) return { deleted: false, reason: 'no key' };

  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return { deleted: true };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
      return { deleted: false, reason: 'not found' };
    }
    throw error;
  }
}

/** True when R2 credentials are present, without throwing. */
function isConfigured() {
  try {
    assertConfigured();
    return true;
  } catch {
    return false;
  }
}

module.exports = { getClient, getBucketName, deleteObject, isConfigured };
