/**
 * Email Service Module for Cloudflare Workers
 * Calls existing Netlify email function to send emails
 */

/**
 * Send success email with download link and compression statistics
 * @param {Object} data - Email data object
 * @param {Object} env - Environment variables
 */
export async function sendEmail(data, env) {
  const {
    eventId,
    email,
    requestId,
    fileCount,
    originalSizeMB,
    finalSizeMB,
    downloadUrl,
    compressionStats,
    processingTimeSeconds,
    failedFiles,
    processingMethod,
    largeFilesDeferred,
    totalOriginalFiles
  } = data;

  console.log(`📧 Sending success email [${requestId}] to: ${email}`);
  
  // Log failed files if any
  if (failedFiles && failedFiles.length > 0) {
    console.log(`⚠️ Email includes ${failedFiles.length} failed files [${requestId}]:`, 
      failedFiles.map(f => `${f.fileName} (${f.reason})`).join(', '));
  }

  try {
    // Call your existing Netlify email function
    const netlifyEmailUrl = env.NETLIFY_EMAIL_FUNCTION_URL || 'https://main--sharedmoments.netlify.app/.netlify/functions/email-download';
    
    const emailPayload = {
      eventId,
      email,
      requestId,
      fileCount,
      originalSizeMB,
      finalSizeMB: finalSizeMB,
      downloadUrl,
      compressionStats,
      processingTimeSeconds,
      failedFiles: failedFiles || [],
      processingMethod: processingMethod || 'worker-streaming',
      largeFilesDeferred: largeFilesDeferred || [],
      totalOriginalFiles: totalOriginalFiles || fileCount,
      source: 'cloudflare-worker'
    };

    // The email endpoint only accepts callers holding the internal secret, since
    // it renders a caller-supplied link into a message sent from our own domain
    // (finding SEC-8). Set with: wrangler secret put INTERNAL_SERVICE_SECRET
    if (!env.INTERNAL_SERVICE_SECRET) {
      throw new Error('INTERNAL_SERVICE_SECRET is not configured on the Worker');
    }

    const response = await fetch(netlifyEmailUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sharedmoments-internal': env.INTERNAL_SERVICE_SECRET,
      },
      body: JSON.stringify(emailPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Netlify email function error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ Success email sent [${requestId}] via Netlify function`);
    return result;

  } catch (error) {
    console.error(`❌ Failed to send email [${requestId}]:`, error);
    throw new Error(`Email sending failed: ${error.message}`);
  }
}

/**
 * Send error notification email
 * @param {string} eventId - Event ID
 * @param {string} email - Recipient email
 * @param {string} requestId - Request ID for tracking
 * @param {string} errorMessage - Error details
 * @param {Object} env - Environment variables
 */
export async function sendErrorEmail(eventId, email, requestId, errorMessage, env) {
  console.log(`📧 Sending error email [${requestId}] to: ${email}`);

  try {
    // Call your existing Netlify email function with error data
    const netlifyEmailUrl = env.NETLIFY_EMAIL_FUNCTION_URL || 'https://main--sharedmoments.netlify.app/.netlify/functions/email-download';
    
    const errorPayload = {
      eventId,
      email,
      requestId,
      errorMessage,
      isError: true,
      source: 'cloudflare-worker'
    };

    // The email endpoint only accepts callers holding the internal secret, since
    // it renders a caller-supplied link into a message sent from our own domain
    // (finding SEC-8). Set with: wrangler secret put INTERNAL_SERVICE_SECRET
    if (!env.INTERNAL_SERVICE_SECRET) {
      throw new Error('INTERNAL_SERVICE_SECRET is not configured on the Worker');
    }

    const response = await fetch(netlifyEmailUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sharedmoments-internal': env.INTERNAL_SERVICE_SECRET,
      },
      body: JSON.stringify(errorPayload)
    });

    if (!response.ok) {
      throw new Error(`Netlify email function error: ${response.status}`);
    }

    console.log(`✅ Error email sent [${requestId}] via Netlify function`);

  } catch (error) {
    console.error(`❌ Failed to send error email [${requestId}]:`, error);
  }
}
