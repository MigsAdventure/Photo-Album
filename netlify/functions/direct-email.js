const nodemailer = require('nodemailer');

exports.handler = async (event, context) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  
  console.log(`=== DIRECT EMAIL REQUEST [${requestId}] ===`);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'X-Request-ID': requestId,
    'Content-Type': 'application/json'
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

  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body || '{}');
  } catch (parseError) {
    console.error(`❌ JSON parse error [${requestId}]:`, parseError);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: 'Invalid JSON in request body',
        requestId 
      }),
    };
  }

  const { email, downloadUrl, fileCount, finalSizeMB } = parsedBody;

  // Early validation
  if (!email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: 'email is required',
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

  try {
    console.log(`📧 Sending direct email [${requestId}] to: ${email}`);
    
    const transporter = nodemailer.createTransport({
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
      subject: `Your SharedMoments Photos are Ready for Download`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 1px;">
              📸 SharedMoments
            </h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
              Your event photos are ready
            </p>
          </div>
          
          <!-- Main Content -->
          <div style="padding: 40px 30px; background: white;">
            <p style="font-size: 18px; line-height: 1.6; color: #333; margin-top: 0;">
              Great news! We've prepared a professional download package with <strong>${fileCount || 'your'} files</strong> from your special event.
            </p>
            
            <!-- Download Button -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="${downloadUrl || 'https://example.com/download'}" 
                 style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); transition: all 0.3s ease;">
                📥 Download Your Photos & Videos
              </a>
            </div>
            
            <!-- Footer -->
            <div style="background: #f8f9fa; padding: 30px; text-align: center; border-radius: 0 0 12px 12px; border-top: 1px solid #e9ecef;">
              <div style="margin-bottom: 20px;">
                <h3 style="margin: 0 0 5px 0; color: #495057; font-size: 18px; font-weight: 300;">SharedMoments</h3>
                <p style="margin: 0; color: #6c757d; font-size: 14px;">Professional Photo Sharing Platform</p>
              </div>
              
              <div style="margin-bottom: 20px;">
                <a href="https://sharedmoments.socialboostai.com" style="color: #667eea; text-decoration: none; font-weight: 500;">
                  sharedmoments.socialboostai.com
                </a>
              </div>
              
              <hr style="border: none; border-top: 1px solid #dee2e6; margin: 20px 0;">
              
              <p style="color: #adb5bd; font-size: 12px; margin: 10px 0 0 0; line-height: 1.4;">
                Powered by <a href="https://socialboostai.com" style="color: #667eea; text-decoration: none; font-weight: 500;">Social Boost AI</a><br>
                Wedding Marketing & Technology Solutions<br><br>
                Request ID: ${requestId} | Generated: ${new Date().toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Direct email sent successfully [${requestId}]`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Email sent to ${email}`,
        requestId
      }),
    };
    
  } catch (error) {
    console.error(`❌ Direct email failed [${requestId}]:`, error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send email',
        details: error.message,
        requestId 
      }),
    };
  }
};