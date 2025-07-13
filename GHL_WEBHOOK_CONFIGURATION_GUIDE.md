# GoHighLevel Webhook Configuration Guide

## Problem
Your payment system works (payments go through, emails are sent), but GoHighLevel is not configured to notify your app when payments are completed, so events don't get upgraded to premium automatically.

## Solution
Configure GoHighLevel to send webhooks to your Netlify function when orders are completed.

## Step 1: Access GoHighLevel Settings

1. Log into your GoHighLevel account
2. Go to **Settings** → **Integrations** → **Webhooks**
3. Click **"Add Webhook"** or **"Create New Webhook"**

## Step 2: Configure the Webhook

Set up the webhook with these details:

**Webhook URL:**
```
https://develop--sharedmoments.netlify.app/.netlify/functions/ghl-webhook
```

**Events to Subscribe To:**
- ✅ `order.completed` (or `payment.completed`)
- ✅ `order.successful` 
- ✅ Any payment-related events

**Method:** `POST`

**Content-Type:** `application/json`

## Step 3: Test the Configuration

### Option A: Use GoHighLevel's Test Feature
1. In the webhook configuration, look for a "Test" button
2. Send a test webhook to verify it reaches your function
3. Check the Netlify function logs for the webhook data

### Option B: Make a Real Test Payment
1. Create a new test event in your app
2. Try to upgrade it to premium
3. Complete the payment process
4. Check if the event gets upgraded automatically

## Step 4: Check Webhook Logs

### In GoHighLevel:
1. Go to your webhook settings
2. Look for delivery logs or webhook history
3. Check if webhooks are being sent successfully

### In Netlify:
1. Go to your Netlify dashboard
2. Navigate to **Functions** → **ghl-webhook**
3. Check the function logs for incoming webhook data

## Step 5: Debug if Needed

If webhooks still aren't working, check:

1. **Webhook URL is correct:** `https://develop--sharedmoments.netlify.app/.netlify/functions/ghl-webhook`
2. **Event types are correct:** Make sure you're subscribed to payment completion events
3. **Function is deployed:** Verify the latest version is deployed
4. **Logs for errors:** Check both GHL and Netlify logs

## Expected Webhook Data Format

Your function expects data in this format:
```json
{
  "type": "order.completed",
  "data": {
    "orderId": "order_123",
    "contactId": "contact_456", 
    "amount": 29,
    "customFields": {
      "event_id": "2025-07-13_my-event_abc123",
      "event_title": "My Event",
      "organizer_email": "user@example.com"
    }
  }
}
```

## Troubleshooting

### If events aren't being upgraded:
1. Check Netlify function logs for incoming webhooks
2. Verify the `event_id` in the webhook matches your Firebase event ID
3. Ensure your Firebase API key is set in Netlify environment variables

### If no webhooks are received:
1. Double-check the webhook URL in GoHighLevel
2. Verify you're subscribed to the correct events
3. Test with a real payment to see if webhooks trigger

### If webhooks are received but fail:
1. Check the detailed logs we added to the function
2. Verify the webhook data format matches expectations
3. Ensure Firebase credentials are properly configured

## Next Steps

1. Configure the webhook in GoHighLevel settings
2. Test with a new event and payment
3. Check logs to see the actual webhook data format
4. If needed, we can adjust the function to match GHL's actual data format

## Need Help?

If you're still having issues:
1. Share the GoHighLevel webhook logs
2. Share the Netlify function logs 
3. Let me know what you see when testing the payment flow

The enhanced logging we added will show us exactly what data GoHighLevel is sending, so we can fix any format mismatches.
