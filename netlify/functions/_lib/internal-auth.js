/**
 * Shared-secret authentication for endpoints called by our own backend services
 * rather than by browsers.
 *
 * The EC2 processor, the Cloudflare Worker and the launcher Lambda all call back
 * into Netlify functions. Those endpoints were reachable by anyone, which turned
 * one of them into a working phishing relay (finding SEC-8): direct-email
 * accepted an arbitrary recipient and an arbitrary link, then delivered a
 * SharedMoments-branded "your photos are ready" message from our authenticated
 * Mailgun domain. Beyond the harm to whoever received it, that burns the sending
 * domain's reputation and takes legitimate delivery down with it.
 *
 * Environment
 * -----------
 *   INTERNAL_SERVICE_SECRET   required. Generate with `openssl rand -hex 32`.
 *
 * Must be set identically in Netlify, in the EC2 processor's systemd
 * environment, and in the Cloudflare Worker's secrets. Callers send it as:
 *
 *   x-sharedmoments-internal: <secret>
 */

const crypto = require('crypto');

const HEADER = 'x-sharedmoments-internal';

function safeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === target);
  return key ? headers[key] : undefined;
}

/**
 * Returns null when the caller is authorised, or a ready-to-return HTTP response
 * when it is not. Fails closed: an unset secret rejects everything rather than
 * accepting everything.
 */
function requireInternalCaller(event, corsHeaders = {}) {
  const expected = process.env.INTERNAL_SERVICE_SECRET;

  if (!expected) {
    console.error('INTERNAL_SERVICE_SECRET is not set; refusing all requests');
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Service unavailable' }),
    };
  }

  const presented = readHeader(event.headers, HEADER);

  if (!presented || !safeEquals(presented, expected)) {
    console.warn('Rejected unauthenticated internal request');
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  return null;
}

/**
 * Is this URL somewhere we are willing to point a customer?
 *
 * Even an authenticated caller should not be able to put an arbitrary link into
 * an email we send. Archives live in R2, so the host must match R2_PUBLIC_URL.
 */
function isAllowedDownloadUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const allowedHosts = [process.env.R2_PUBLIC_URL, process.env.DOWNLOAD_URL_ALLOWED_HOST]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value.startsWith('http') ? value : `https://${value}`).host;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (allowedHosts.length === 0) {
    console.error('R2_PUBLIC_URL is not set; cannot validate download links');
    return false;
  }

  return allowedHosts.includes(parsed.host);
}

module.exports = { requireInternalCaller, isAllowedDownloadUrl, HEADER };
