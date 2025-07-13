# 🚀 GoHighLevel Freemium Integration Deployment Guide

This guide will help you set up the complete freemium model with GoHighLevel payment integration for your wedding photo app.

## 📋 What's Been Implemented

### ✅ Freemium Foundation
- **Free Plan**: 20 photos per event, email required
- **Premium Plan**: Unlimited photos, custom branding, $29 one-time payment
- Photo count tracking and limit enforcement
- Upgrade prompts when limits are reached

### ✅ GoHighLevel Integration
- Contact creation and management
- Order processing for premium upgrades
- Payment link generation
- Webhook processing for automatic upgrades
- Real-time event status updates

### ✅ UI Components
- Upgrade modal with pricing and features
- Photo limit indicators in upload interface
- Premium badges for upgraded events
- Freemium alerts and progress tracking

## 🔧 Setup Instructions

### Step 1: GoHighLevel API Setup

1. **Get your API credentials from GoHighLevel:**
   - Log into your GHL account
   - Go to Settings → API
   - Generate a new API Key
   - Note your Location ID

2. **Set up custom fields in GHL (recommended):**
   - Go to Settings → Custom Fields
   - Add these fields for Contacts:
     - `event_id` (Text)
     - `event_title` (Text)  
     - `plan_type` (Text)
     - `payment_id` (Text)
     - `upgraded_at` (DateTime)

### Step 2: Environment Variables

Add these to your Netlify environment variables:

```bash
# GoHighLevel API Configuration
REACT_APP_GHL_API_KEY=your_ghl_api_key_here
REACT_APP_GHL_LOCATION_ID=your_ghl_location_id_here

# Existing Firebase variables (already configured)
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
FIREBASE_PRIVATE_KEY=your_firebase_private_key
```

### Step 3: GoHighLevel Webhook Configuration

1. **Set up the webhook in GoHighLevel:**
   - Go to Settings → Webhooks
   - Click "Add Webhook"
   - URL: `https://your-netlify-domain.netlify.app/.netlify/functions/ghl-webhook`
   - Events: Select `order.completed`
   - Method: POST

2. **Test the webhook:**
   ```bash
   # Test webhook endpoint
   curl -X POST https://your-domain.netlify.app/.netlify/functions/ghl-webhook \
     -H "Content-Type: application/json" \
     -d '{
       "type": "order.completed",
       "data": {
         "orderId": "test_order_123",
         "contactId": "test_contact_123",
         "amount": 29,
         "customFields": {
           "event_id": "test_event_id"
         }
       }
     }'
   ```

### Step 4: Update GoHighLevel Funnel (Optional)

If you want to create a dedicated payment funnel:

1. **Create a new funnel in GHL:**
   - Product: "Premium Event Upgrade"
   - Price: $29 (or your preferred amount)
   - Description: "Unlimited photo uploads + custom branding"

2. **Customize the payment page:**
   - Add event details via URL parameters
   - Style to match your app's branding
   - Set up order bump for additional services

## 🧪 Testing the Integration

### Test Freemium Limits
1. Create a new event with an email address
2. Upload 20 photos (you'll see the counter)
3. Try to upload more - should show upgrade modal
4. Verify free events are limited properly

### Test Premium Upgrade Flow
1. Click "Upgrade to Premium" button
2. Should open GoHighLevel payment page
3. Complete test payment (use GHL test mode)
4. Webhook should automatically upgrade the event
5. Verify unlimited uploads now work

### Test Premium Features
1. Upload more than 20 photos to premium event
2. Check that premium badge appears
3. Verify unlimited upload messaging
4. Test custom branding (if implemented)

## 📊 Business Model Overview

### Free Plan
- ✅ 20 photos per event
- ✅ Basic email notifications  
- ✅ Standard QR code sharing
- ✅ Basic gallery features

### Premium Plan ($29/event)
- ✅ **Unlimited photos & videos**
- ✅ **Custom branding & logos**
- ✅ Priority support
- ✅ Advanced download options
- 🔄 Analytics dashboard (future)
- 🔄 Monthly subscription option (future)

## 🔐 Security Considerations

### API Key Protection
- GoHighLevel API keys are stored as environment variables
- Never expose API keys in client-side code
- Use Netlify Functions for all GHL API calls

### Webhook Verification
- Basic validation is implemented
- Consider adding webhook signature verification for production
- Monitor webhook logs for suspicious activity

### Payment Security
- All payment processing handled by GoHighLevel
- No sensitive payment data stored in your app
- PCI compliance handled by GHL

## 📈 Monitoring & Analytics

### Track Key Metrics
- Free vs Premium conversion rate
- Average photos per event (free vs premium)
- Revenue per event
- Customer lifetime value

### Monitoring Tools
- Netlify function logs for webhook processing
- Firebase analytics for user behavior
- GoHighLevel CRM for customer management

## 🚀 Deployment Checklist

### Before Deploying:
- [ ] GHL API key and Location ID configured
- [ ] Environment variables set in Netlify
- [ ] Webhook URL configured in GoHighLevel
- [ ] Test the upgrade flow end-to-end
- [ ] Verify freemium limits work correctly
- [ ] Test webhook processing

### After Deploying:
- [ ] Monitor webhook logs for first 24 hours
- [ ] Test with real payment (small amount)
- [ ] Verify email notifications work
- [ ] Check premium feature unlocking
- [ ] Monitor conversion rates

## 🛠️ Troubleshooting

### Common Issues:

**Upgrade button doesn't work:**
- Check console for API errors
- Verify GHL credentials in environment variables
- Ensure Location ID is correct

**Webhook not processing:**
- Check Netlify function logs
- Verify webhook URL in GoHighLevel
- Test webhook endpoint manually

**Photo limits not enforcing:**
- Check event data in Firebase
- Verify photoCount is incrementing
- Check freemium logic in PhotoUpload component

**Premium features not unlocking:**
- Check webhook processing logs
- Verify event planType updated in Firebase
- Check upgrade success callback

## 💰 Revenue Optimization Tips

### Increase Conversion:
1. **Show value early** - Display photo limit counter prominently
2. **Strategic timing** - Show upgrade modal at 15-18 photos
3. **Social proof** - Add testimonials to upgrade modal
4. **Urgency** - "Upgrade now to save all your memories"

### Pricing Strategy:
- **$29/event**: Good balance of affordability and revenue
- **Volume discounts**: Future multi-event packages
- **Seasonal pricing**: Wedding season premium rates

### Future Enhancements:
- Monthly subscription for unlimited events
- Custom branding packages
- Advanced analytics and insights
- White-label solutions for photographers

## 📞 Support & Next Steps

### If you need help:
1. Check the troubleshooting section above
2. Review Netlify function logs
3. Test individual components (API, webhook, UI)
4. Verify GoHighLevel configuration

### Future Development:
- Enhanced custom branding options
- Advanced analytics dashboard
- Multi-tier pricing plans
- White-label photographer packages
- Mobile app with push notifications

---

## 🎉 You're Ready!

Your wedding photo app now has a complete freemium model with GoHighLevel integration! 

**Key Benefits:**
- ✅ Automated payment processing
- ✅ Seamless upgrade experience  
- ✅ Real-time feature unlocking
- ✅ Professional CRM integration
- ✅ Scalable business model

Start testing with real events and watch your conversion rates! 📈
