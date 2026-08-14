/**
 * Shared Firebase Admin SDK initialisation for Netlify functions.
 *
 * Every privileged write in this application goes through here. Before finding
 * SEC-2, server functions used the *client* SDK with the public web config, or
 * the Firestore REST API with the public API key — both of which are subject to
 * security rules and therefore could not perform any operation the rules now
 * (correctly) deny. The Admin SDK authenticates as a service account and bypasses
 * rules, which is what makes rules safe to tighten.
 *
 * Directories prefixed with an underscore inside the functions folder are not
 * deployed as functions; this is a shared module, not an endpoint.
 *
 * Required environment variable
 * -----------------------------
 *   FIREBASE_SERVICE_ACCOUNT   The service account JSON, either raw or base64.
 *
 * Generate it at:
 *   Firebase console → Project settings → Service accounts → Generate new
 *   private key
 *
 * Set it in Netlify under Site configuration → Environment variables, scoped to
 * Functions. It is a credential with full project access — never expose it to
 * the browser and never prefix it with REACT_APP_.
 *
 * Refs: AUDIT_2026-08.md SEC-2
 */

const admin = require('firebase-admin');

let app;

/** Parse the service account from the environment, accepting raw or base64 JSON. */
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. Privileged operations cannot run. ' +
        'See netlify/functions/_lib/firebase-admin.js for how to generate it.'
    );
  }

  const text = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT could not be parsed as JSON. Paste the whole ' +
        'service account file, or its base64 encoding, with no surrounding quotes.'
    );
  }

  if (!parsed.project_id || !parsed.private_key || !parsed.client_email) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is missing project_id, private_key or ' +
        'client_email — it does not look like a service account key.'
    );
  }

  return parsed;
}

/**
 * Returns the initialised admin app, creating it on first call. Netlify reuses
 * warm containers across invocations, so this is memoised for the container's
 * lifetime rather than re-initialised per request.
 */
function getApp() {
  if (app) return app;

  if (admin.apps.length > 0) {
    app = admin.apps[0];
    return app;
  }

  const serviceAccount = loadServiceAccount();

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
    storageBucket:
      process.env.REACT_APP_FIREBASE_STORAGE_BUCKET ||
      `${serviceAccount.project_id}.appspot.com`,
  });

  return app;
}

/** Firestore, authenticated as the service account. Bypasses security rules. */
function getDb() {
  return admin.firestore(getApp());
}

/** The default Cloud Storage bucket, authenticated as the service account. */
function getBucket() {
  return admin.storage(getApp()).bucket();
}

/** True when the service account is configured, without throwing. */
function isConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
}

module.exports = {
  admin,
  getApp,
  getDb,
  getBucket,
  isConfigured,
  FieldValue: admin.firestore.FieldValue,
};
