# Payment System & GoHighLevel Integration Documentation

## Overview

This wedding photo app uses a **freemium business model** with GoHighLevel (GHL) integration for payment processing and customer relationship management. This document provides comprehensive information about how the payment system works, pricing structure, and technical implementation.

---

## 1. Freemium Model Overview

### Free Plan
- **Photo Limit**: 20 photos per event (Note: UI currently shows 2 photos - needs verification)
- **Features**: Basic photo gallery, QR code sharing, email downloads
- **Target**: Small gatherings, testing, low-budget events

### Premium Plan
- **Price**: $29 one-time payment per event
- **Features**: 
  - Unlimited photos and videos
  - Custom branding (logo, colors)
  - Priority support
  - Enhanced gallery features

---

## 2. Pricing Structure

### Current Pricing
```
Free Plan: $0
- 20 photos limit
- Basic features
- Standard support

Premium Plan: $29 (one-time per event)
- Unlimited photos & videos
- Custom branding
- Priority support
- Advanced gallery features
```

### Photo Limits Implementation
- **Free Events**: `photoLimit: 20` (stored in Firebase)
- **Premium Events**: `photoLimit: -1` (unlimited)
- **Current Count**: Tracked in `photoCount` field

---

## 3. GoHighLevel Integration

### Business Integration
- **Company**: Social Boost AI (socialboostai.com)
- **Payment Page**: https://socialboostai.com/premium-upgrade-page
- **Webhook URL**: https://services.leadconnectorhq.com/hooks/OD0oJMJ7R9OatD9liLM0/webhook-trigger/30e7e31b-9e78-4f69-8ecc-4678bd24b45f

### GHL Workflow
1. **Contact Creation**: User creates event → Contact added to GHL with custom fields
2. **Order Creation**: User clicks upgrade → Order created in GHL system
3. **Payment Processing**: User redirected to Social Boost AI payment page
4. **Webhook Notification**: GHL sends webhook on payment completion
5. **Event Upgrade**: Firebase event updated to premium status

---

## 4. Payment Flow (User Experience)

### Step-by-Step Process

1. **Hit Photo Limit**
   - User tries to upload when at limit (20 photos)
   - `UpgradeModal` component displays
   - Shows current usage: "You've uploaded X/20 photos"

2. **Choose Upgrade**
   - User sees premium features list
   - $29 pricing displayed prominently
   - "Upgrade Now - $29" button

3. **Payment Redirect**
   - Constructs payment URL with event data:
     ```
     https://socialboostai.com/premium-upgrade-page?
     event_id=<eventId>&
     event_title=<title>&
     organizer_email=<email>&
     organizer_name=<name>&
     amount=29
     ```
   - Opens in new tab

4. **Payment Completion**
   - User completes payment on Social Boost AI site
   - GHL processes payment
   - Webhook sent to app

5. **Instant Upgrade**
   - Event upgraded to premium in Firebase
   - User can immediately upload unlimited photos
   - Premium features activated

---

## 5. Technical Implementation

### Key Files & Components

#### Frontend Components
- **`src/components/UpgradeModal.tsx`**: Premium upgrade modal
- **`src/components/BottomNavbar.tsx`**: Contains freemium check before upload
- **`src/components/PhotoUpload.tsx`**: Legacy upload component with limits

#### Services
- **`src/services/ghlService.ts`**: GoHighLevel API integration
- **`src/services/photoService.ts`**: Event management and limit checking

#### Backend Functions
- **`netlify/functions/ghl-webhook.js`**: Processes payment webhooks
- **`netlify/functions/upload.js`**: Handles file uploads with limit checks

#### Type Definitions
- **`src/types.ts`**: Event, GHL, and upgrade-related interfaces

### Core Functions

#### Freemium Checking
```typescript
// Check if user can upload more photos
export const canUploadPhoto = async (eventId: string): Promise<boolean> => {
  const event = await getEvent(eventId);
  if (!event) return false;
  
  if (event.planType === 'premium') return true;
  
  return event.photoCount < event.photoLimit;
};
```

#### Upgrade Process
```typescript
// Trigger upgrade modal when limit reached
const checkUploadAllowed = async (): Promise<boolean> => {
  const canUpload = await canUploadPhoto(eventId);
  if (!canUpload) {
    setShowUpgradeModal(true);
    return false;
  }
  return true;
};
```

---

## 6. Webhook Processing

### GHL Webhook Handler
**File**: `netlify/functions/ghl-webhook.js`

### Webhook Flow
1. **Payment Completion**: GHL sends `order.completed` webhook
2. **Data Extraction**: Extract `eventId`, `orderId`, payment details
3. **Event Upgrade**: Update Firebase event:
   ```javascript
   await eventRef.update({
     planType: 'premium',
     paymentId: orderId,
     photoLimit: -1, // Unlimited
     upgradedAt: admin.firestore.FieldValue.serverTimestamp(),
     paymentAmount: amount || 29
   });
   ```
4. **Response**: Return success confirmation

### Webhook Security
- Validates webhook format
- Checks for required fields
- Error handling and logging
- CORS headers for cross-origin requests

---

## 7. Environment Configuration

### Required Environment Variables

#### Firebase (Production)
```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
```

#### GoHighLevel (Optional - for direct API usage)
```
REACT_APP_GHL_API_KEY=your-ghl-api-key
REACT_APP_GHL_LOCATION_ID=your-ghl-location-id
```

#### Cloudflare R2 (File Storage)
```
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=your-bucket-name
```

---

## 8. Testing & Demo Mode

### Current Demo Implementation
The app includes a **demo payment system** for testing:

```typescript
// Simulate payment after 3 seconds (demo mode)
setTimeout(async () => {
  await sendUpgradeToGHL({
    eventId,
    eventTitle: event.title,
    organizerEmail: event.organizerEmail,
    organizerName: event.organizerEmail.split('@')[0],
    planType: 'premium',
    paymentAmount: 29,
    paymentId: `demo_${Date.now()}`,
    paymentMethod: 'demo'
  });
  
  onUpgradeSuccess();
  onClose();
}, 3000);
```

### Testing Webhooks
Use `test-ghl-webhook.js` to simulate webhook calls:
```bash
node test-ghl-webhook.js
```

---

## 9. Business Model Benefits

### Revenue Optimization
- **Low Entry Barrier**: Free plan attracts users
- **Clear Value Proposition**: $29 for unlimited uploads
- **Event-Based Pricing**: Perfect for one-time events
- **Immediate Upgrade**: No subscription complexity

### Customer Journey
1. **Discovery**: User creates free event
2. **Engagement**: Uploads photos, shares with guests
3. **Limitation**: Hits 20-photo limit during active event
4. **Conversion**: High motivation to upgrade during event
5. **Satisfaction**: Unlimited uploads for remainder of event

---

## 10. Future Expansion Opportunities

### Pricing Tiers
```
Basic: $9 - 50 photos
Standard: $19 - 100 photos  
Premium: $29 - Unlimited photos
Enterprise: $49 - Custom branding + analytics
```

### Subscription Model
- **Monthly**: $9/month for unlimited events
- **Annual**: $89/year (save $19)
- **Business**: $29/month for multiple organizers

### Premium Features to Add
- **Analytics**: View counts, download stats
- **Advanced Branding**: Custom domains, removal of watermarks
- **Video Processing**: Higher quality, longer durations
- **Guest Management**: RSVPs, contact collection
- **Social Sharing**: Direct posting to social media
- **AI Features**: Auto-tagging, duplicate detection

---

## 11. Troubleshooting Common Issues

### Upload Failures After Payment
1. Check webhook processing in Netlify functions logs
2. Verify Firebase event status: `planType` should be 'premium'
3. Ensure `photoLimit` is set to -1

### Payment Not Processing
1. Verify Social Boost AI payment page is accessible
2. Check GHL webhook URL is responding
3. Review webhook payload format

### Demo Mode Not Working
1. Ensure `sendUpgradeToGHL` function is accessible
2. Check console for demo payment simulation
3. Verify 3-second timeout is completing

---

## 12. Key Metrics to Monitor

### Conversion Metrics
- **Free-to-Premium Conversion Rate**: % of free users who upgrade
- **Revenue Per Event**: Average payment amount
- **Upgrade Timing**: When during event lifecycle users upgrade

### Technical Metrics
- **Webhook Success Rate**: % of successful payment notifications
- **Upload Success Rate**: After payment completion
- **Payment Page Load Time**: User experience optimization

---

## 13. Integration Points

### Current Integrations
- **Firebase**: Event storage and real-time updates
- **Cloudflare R2**: Photo/video file storage
- **GoHighLevel**: Payment processing and CRM
- **Netlify**: Serverless functions and hosting

### Potential Future Integrations
- **Stripe**: Alternative payment processor
- **Zapier**: Automation workflows
- **Mailchimp**: Email marketing
- **Google Analytics**: Enhanced tracking
- **Twilio**: SMS notifications

---

This documentation serves as the definitive guide for understanding how payments, pricing, and GoHighLevel integration work in the wedding photo app. Keep this updated as the system evolves.
