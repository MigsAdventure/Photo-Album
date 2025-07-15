# GoHighLevel Template Variable Fix Guide

## 🎯 The Problem
GoHighLevel is sending **template variables** instead of actual values:
```json
{
  "eventId": "{{inboundWebhookRequest.event_id}}"  // ❌ Template, not real value
}
```

## 🔧 Solution Options

### Option 1: Fix Template Variables (Recommended)

**The issue**: `{{inboundWebhookRequest.event_id}}` suggests GHL is trying to reference data from an "inbound webhook" but can't find it.

**Fix in GoHighLevel**:
1. **Change trigger from "Order Form Submission" to "Inbound Webhook"**
2. **Or use direct contact/form field references**

Update your webhook payload to:
```json
{
  "action": "upgrade_confirmed",
  "eventId": "{{custom_fields.event_id}}",
  "eventTitle": "{{custom_fields.event_title}}",
  "organizerEmail": "{{contact.email}}",
  "organizerName": "{{contact.name}}",
  "planType": "premium",
  "paymentAmount": 29,
  "paymentId": "{{contact.id}}_{{custom_fields.payment_id}}",
  "paymentMethod": "ghl_form",
  "contactId": "{{contact.id}}",
  "upgradeTimestamp": "{{date_time}}"
}
```

### Option 2: Use URL Parameters

Send the event ID as a URL parameter instead of in the payload:

**Webhook URL**: 
```
https://sharedmoments.netlify.app/.netlify/functions/ghl-webhook?event_id={{custom_fields.event_id}}&contact_id={{contact.id}}
```

**Payload**:
```json
{
  "action": "upgrade_confirmed",
  "planType": "premium",
  "paymentAmount": 29,
  "paymentMethod": "ghl_form"
}
```

### Option 3: Hardcode Event ID for Testing

For immediate testing, temporarily hardcode a specific event ID:

```json
{
  "action": "upgrade_confirmed",
  "eventId": "2025-07-15_random_a5skq8xa",
  "organizerEmail": "{{contact.email}}",
  "organizerName": "{{contact.name}}",
  "planType": "premium",
  "paymentAmount": 29,
  "paymentId": "{{contact.id}}_test_payment",
  "paymentMethod": "ghl_form",
  "contactId": "{{contact.id}}"
}
```

## ✅ Our Updated Webhook Handler

The webhook function has been updated to:
- ✅ **Detect template variables** like `{{inboundWebhookRequest.event_id}}`
- ✅ **Look for actual values** in alternative webhook fields
- ✅ **Check URL parameters** for event data
- ✅ **Provide detailed error messages** if no valid event ID found

## 🚀 Quick Test Steps

1. **Update GHL webhook payload** using one of the options above
2. **Test with a real payment** 
3. **Check Netlify Function logs** for detailed debugging info
4. **Verify event gets upgraded** in Firebase

## 🎯 Expected Result

After fixing the template variables, you should see:
- ✅ Real event ID in webhook instead of `{{inboundWebhookRequest.event_id}}`
- ✅ Successful event upgrade to premium
- ✅ Working end-to-end payment flow
