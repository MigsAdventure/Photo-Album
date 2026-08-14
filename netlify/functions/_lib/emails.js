/**
 * Outgoing email templates.
 *
 * There were four near-identical copies of the "your photos are ready" template
 * across email-download.js and direct-email.js — roughly 400 lines of duplicated
 * inline HTML that had already drifted apart (one promised a year of access, one
 * did not; one showed compression stats, one crashed if they were absent). One
 * copy now, one place to change the wording.
 *
 * The download link is validated by the caller against the R2 host allowlist in
 * internal-auth.js before it reaches here (finding SEC-8) — do not render a URL
 * that has not been through that check.
 */

const nodemailer = require('nodemailer');

const FROM_ADDRESS = process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com';

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.EMAIL_PASSWORD) {
    throw new Error('EMAIL_PASSWORD is not configured; cannot send mail');
  }

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.mailgun.org',
    port: Number(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: { user: FROM_ADDRESS, pass: process.env.EMAIL_PASSWORD },
  });

  return transporter;
}

/** Escape anything that came from user input before it goes into HTML. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout({ heading, intro, bodyHtml, requestId }) {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 1px;">SharedMoments</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">${escapeHtml(heading)}</p>
  </div>

  <div style="padding: 40px 30px; background: white;">
    <p style="font-size: 18px; line-height: 1.6; color: #333; margin-top: 0;">${intro}</p>
    ${bodyHtml}
  </div>

  <div style="background: #f8f9fa; padding: 30px; text-align: center; border-radius: 0 0 12px 12px; border-top: 1px solid #e9ecef;">
    <p style="margin: 0 0 6px 0; color: #495057; font-size: 16px;">SharedMoments</p>
    <a href="https://sharedmoments.socialboostai.com" style="color: #667eea; text-decoration: none; font-size: 14px;">sharedmoments.socialboostai.com</a>
    <p style="color: #adb5bd; font-size: 12px; margin: 18px 0 0 0; line-height: 1.5;">
      Powered by <a href="https://socialboostai.com" style="color: #667eea; text-decoration: none;">Social Boost AI</a><br>
      Reference: ${escapeHtml(requestId || 'n/a')}
    </p>
  </div>
</div>`;
}

/**
 * "Your archive is ready" — sent once a job has produced a verified R2 object.
 *
 * @param {object}  args
 * @param {string}  args.email        recipient
 * @param {string}  args.downloadUrl  already validated against the R2 allowlist
 * @param {number}  args.fileCount    files actually included, not requested
 * @param {number}  args.finalSizeMB  size of the archive
 * @param {number} [args.failedCount] files that could not be included
 * @param {string} [args.requestId]
 */
async function sendArchiveReadyEmail({
  email,
  downloadUrl,
  fileCount,
  finalSizeMB,
  failedCount = 0,
  requestId,
}) {
  const sizeText = Number.isFinite(Number(finalSizeMB))
    ? `${Number(finalSizeMB).toFixed(1)} MB`
    : 'ready';

  // Say so when files are missing. Previously failedCount was passed around but
  // never reached a template, so a customer could receive an archive quietly
  // short of a few files and only find out months later (finding ZIP-7).
  const missingNotice =
    failedCount > 0
      ? `<div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 18px; border-radius: 12px; margin: 24px 0;">
           <p style="margin: 0; color: #ef6c00; line-height: 1.5; font-size: 14px;">
             ${failedCount} file${failedCount === 1 ? '' : 's'} could not be included — usually because the original upload was interrupted.
             Everything else is in the archive. Reply to this email and we'll look into it.
           </p>
         </div>`
      : '';

  const bodyHtml = `
    <div style="background: #f8f9fa; padding: 22px; border-radius: 12px; margin: 28px 0; border-left: 4px solid #667eea;">
      <div style="display: flex; justify-content: space-between; padding: 6px 0;">
        <span style="color: #6c757d;">Files included</span>
        <span style="color: #495057; font-weight: 600;">${escapeHtml(fileCount ?? 'all of them')}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 6px 0;">
        <span style="color: #6c757d;">Archive size</span>
        <span style="color: #495057; font-weight: 600;">${escapeHtml(sizeText)}</span>
      </div>
    </div>

    ${missingNotice}

    <div style="text-align: center; margin: 36px 0;">
      <a href="${downloadUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 600;">
        Download your photos
      </a>
    </div>

    <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 18px; border-radius: 12px; margin: 28px 0;">
      <h4 style="margin: 0 0 6px 0; color: #f57c00; font-size: 15px;">On a phone?</h4>
      <p style="margin: 0; color: #ef6c00; line-height: 1.5; font-size: 14px;">
        Tap Download and look for the ZIP in your Downloads folder. You may need a file manager app to open it.
        Downloading on a laptop is usually easier for a large archive.
      </p>
    </div>

    <p style="color: #6c757d; font-size: 13px; line-height: 1.5;">
      This link stays active for 30 days. Your photos remain in the gallery, and you can request a fresh
      download any time from the event page.
    </p>`;

  await getTransporter().sendMail({
    from: `SharedMoments <${FROM_ADDRESS}>`,
    to: email,
    subject: 'Your SharedMoments photos are ready',
    html: layout({
      heading: 'Your event photos are ready',
      intro: `We've packaged your event media into a single download.`,
      bodyHtml,
      requestId,
    }),
  });

  console.log(`Sent archive email to ${email} [${requestId}]`);
}

/** Sent when a job fails outright, so the customer isn't left waiting silently. */
async function sendArchiveFailedEmail({ email, requestId }) {
  const bodyHtml = `
    <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 18px; border-radius: 12px; margin: 24px 0;">
      <p style="margin: 0; color: #ef6c00; line-height: 1.5; font-size: 14px;">
        Nothing has been lost — every photo is still in your gallery. Please request the download again
        from the event page. If it fails a second time, reply to this email and we'll sort it out.
      </p>
    </div>`;

  await getTransporter().sendMail({
    from: `SharedMoments <${FROM_ADDRESS}>`,
    to: email,
    subject: 'We hit a problem preparing your download',
    html: layout({
      heading: 'Download update',
      intro: `We ran into a problem while packaging your photos.`,
      bodyHtml,
      requestId,
    }),
  });
}

module.exports = { sendArchiveReadyEmail, sendArchiveFailedEmail, escapeHtml };
