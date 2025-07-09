const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

exports.handler = async (event, context) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  
  console.log(`=== EVENT CREATION EMAIL [${requestId}] === (v1.0)`);
  
  // Set timeout handling
  context.callbackWaitsForEmptyEventLoop = false;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'X-Request-ID': requestId,
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed', requestId }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { eventId, eventTitle, eventDate, email, eventUrl } = body;

    console.log(`📧 Processing event creation email [${requestId}]:`, { 
      eventId, 
      eventTitle, 
      eventDate, 
      email: email?.replace(/(.{3}).*(@.*)/, '$1***$2') // Mask email for logs
    });

    if (!eventId || !eventTitle || !eventDate || !email || !eventUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'eventId, eventTitle, eventDate, email, and eventUrl are required',
          requestId 
        }),
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid email format',
          requestId 
        }),
      };
    }

    // Generate QR code as base64 data URL
    console.log(`🔗 Generating QR code [${requestId}] for:`, eventUrl);
    
    const qrCodeDataUrl = await QRCode.toDataURL(eventUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    console.log(`✅ QR code generated [${requestId}]`);

    // Format event date for display
    const formattedDate = new Date(eventDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Send email using professional Mailgun SMTP
    console.log(`📧 Sending event creation email [${requestId}] to:`, email);
    
    const transporter = nodemailer.createTransporter({
      host: 'smtp.mailgun.org',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com',
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: `SharedMoments <${process.env.EMAIL_USER || 'noreply@sharedmoments.socialboostai.com'}>`,
      to: email,
      subject: `Your "${eventTitle}" Gallery is Ready! 🎉`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #d81b60 0%, #8e24aa 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 1px;">
              📸 SharedMoments
            </h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
              Your event gallery is ready for guests
            </p>
          </div>
          
          <!-- Main Content -->
          <div style="padding: 40px 30px; background: white;">
            <h2 style="color: #d81b60; margin-top: 0; text-align: center; font-size: 24px; font-weight: 400;">
              🎉 Event Successfully Created!
            </h2>
            
            <p style="font-size: 18px; line-height: 1.6; color: #333; text-align: center; margin-bottom: 30px;">
              Congratulations! Your <strong>"${eventTitle}"</strong> photo gallery is now live and ready for guests to share their favorite moments.
            </p>
            
            <!-- Event Details Card -->
            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 25px; border-radius: 12px; margin: 30px 0; border-left: 4px solid #d81b60;">
              <h3 style="margin-top: 0; color: #495057; font-size: 18px;">📅 Event Details</h3>
              <div style="display: grid; gap: 12px;">
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1);">
                  <span style="color: #6c757d; font-weight: 500;">Event Title:</span>
                  <span style="color: #495057; font-weight: 600;">${eventTitle}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1);">
                  <span style="color: #6c757d; font-weight: 500;">Event Date:</span>
                  <span style="color: #495057; font-weight: 600;">${formattedDate}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                  <span style="color: #6c757d; font-weight: 500;">Gallery Status:</span>
                  <span style="color: #28a745; font-weight: 600;">✅ Live & Ready</span>
                </div>
              </div>
            </div>
            
            <!-- QR Code Section -->
            <div style="text-align: center; margin: 40px 0;">
              <h3 style="color: #d81b60; margin-bottom: 20px; font-size: 20px;">📱 Share with Guests</h3>
              <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #e9ecef; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                <img src="${qrCodeDataUrl}" alt="Event QR Code" style="width: 200px; height: 200px; display: block; margin: 0 auto;" />
                <p style="margin: 15px 0 5px 0; color: #6c757d; font-size: 14px; font-weight: 500;">
                  Guests can scan this QR code to access the gallery
                </p>
              </div>
            </div>
            
            <!-- Access URL -->
            <div style="text-align: center; margin: 30px 0;">
              <h4 style="color: #495057; margin-bottom: 10px;">🔗 Direct Gallery Link</h4>
              <div style="background: #f8f9fa; border: 1px solid #e9ecef; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <a href="${eventUrl}" style="color: #d81b60; text-decoration: none; font-weight: 500; word-break: break-all; font-family: monospace;">
                  ${eventUrl}
                </a>
              </div>
              <a href="${eventUrl}" 
                 style="display: inline-block; background: linear-gradient(135deg, #d81b60 0%, #8e24aa 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(216, 27, 96, 0.4); margin-top: 15px;">
                🎊 View Your Gallery
              </a>
            </div>
            
            <!-- Sharing Instructions -->
            <div style="background: #e8f5e8; border: 1px solid #4caf50; padding: 25px; border-radius: 12px; margin: 30px 0;">
              <h4 style="margin: 0 0 15px 0; color: #2e7d32; font-size: 18px; display: flex; align-items: center;">
                <span style="font-size: 24px; margin-right: 10px;">🎯</span>
                How to Share with Guests
              </h4>
              <div style="color: #388e3c; line-height: 1.6;">
                <p style="margin: 8px 0;"><strong>1. Print the QR Code:</strong> Click "Print QR Code" in your gallery for a professional printout</p>
                <p style="margin: 8px 0;"><strong>2. Share the Link:</strong> Send the gallery URL via text, email, or social media</p>
                <p style="margin: 8px 0;"><strong>3. Display at Event:</strong> Put the QR code on tables, programs, or signage</p>
                <p style="margin: 8px 0;"><strong>4. Encourage Uploads:</strong> Ask guests to take photos and upload them during the event</p>
              </div>
            </div>
            
            <!-- Guest Instructions -->
            <div style="background: #fff3e0; border: 1px solid #ffcc02; padding: 25px; border-radius: 12px; margin: 30px 0;">
              <h4 style="margin: 0 0 15px 0; color: #f57c00; font-size: 18px; display: flex; align-items: center;">
                <span style="font-size: 24px; margin-right: 10px;">📝</span>
                Instructions for Your Guests
              </h4>
              <div style="color: #ef6c00; line-height: 1.6;">
                <p style="margin: 8px 0;"><strong>📱 Scan QR Code:</strong> Use phone camera app to scan the QR code</p>
                <p style="margin: 8px 0;"><strong>📸 Take Photos:</strong> Use the camera button to take new photos instantly</p>
                <p style="margin: 8px 0;"><strong>📂 Upload Existing:</strong> Select photos from their phone's gallery</p>
                <p style="margin: 8px 0;"><strong>👀 View All:</strong> See everyone's photos in real-time as they're uploaded</p>
                <p style="margin: 8px 0;"><strong>💾 Download:</strong> Get all event photos emailed as a ZIP file</p>
              </div>
            </div>
            
            <!-- Pro Tips -->
            <div style="background: #f3e5f5; border: 1px solid #8e24aa; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <h4 style="margin: 0 0 12px 0; color: #8e24aa; font-size: 16px;">💡 Pro Tips for Event Organizers</h4>
              <ul style="margin: 0; padding-left: 20px; color: #7b1fa2; line-height: 1.5; font-size: 14px;">
                <li style="margin-bottom: 6px;">Bookmark this email - it contains your permanent gallery link</li>
                <li style="margin-bottom: 6px;">The gallery works on all devices - phones, tablets, computers</li>
                <li style="margin-bottom: 6px;">Photos are uploaded instantly and visible to everyone</li>
                <li style="margin-bottom: 6px;">You can download all photos as a ZIP file anytime</li>
                <li style="margin-bottom: 6px;">The gallery stays active indefinitely - no expiration</li>
              </ul>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f8f9fa; padding: 30px; text-align: center; border-radius: 0 0 12px 12px; border-top: 1px solid #e9ecef;">
            <div style="margin-bottom: 20px;">
              <h3 style="margin: 0 0 5px 0; color: #495057; font-size: 18px; font-weight: 300;">SharedMoments</h3>
              <p style="margin: 0; color: #6c757d; font-size: 14px;">Professional Photo Sharing Platform</p>
            </div>
            
            <div style="margin-bottom: 20px;">
              <a href="${eventUrl}" style="color: #d81b60; text-decoration: none; font-weight: 500; margin: 0 15px;">
                📸 View Gallery
              </a>
              <span style="color: #dee2e6;">|</span>
              <a href="https://sharedmoments.socialboostai.com" style="color: #d81b60; text-decoration: none; font-weight: 500; margin: 0 15px;">
                🌐 Create New Event
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #dee2e6; margin: 20px 0;">
            
            <p style="color: #adb5bd; font-size: 12px; margin: 10px 0 0 0; line-height: 1.4;">
              Powered by <a href="https://socialboostai.com" style="color: #d81b60; text-decoration: none; font-weight: 500;">Social Boost AI</a><br>
              Wedding Marketing & Technology Solutions<br><br>
              Request ID: ${requestId} | Generated: ${new Date().toLocaleString()}
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Event creation email sent successfully [${requestId}]`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Event details sent to ${email}`,
        requestId,
        eventUrl: eventUrl // For frontend confirmation
      }),
    };

  } catch (error) {
    console.error(`❌ Event creation email failed [${requestId}]:`, error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send event creation notification',
        details: error.message,
        requestId
      }),
    };
  }
};
