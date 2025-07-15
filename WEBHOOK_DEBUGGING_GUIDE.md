# GoHighLevel Webhook Debugging Guide

## Current Status ✅
- **Webhook URL**: Correctly set to `https://sharedmoments.netlify.app/.netlify/functions/ghl-webhook`
- **Webhook Function**: Working perfectly (tested manually)
- **Payload Structure**: Matches expectations
- **Trigger Configuration**: Set to "Order Form Submission"

## The Problem 🔍
GHL webhook is not firing during real payments, even though configuration looks correct.

## Possible Causes

### 1. **Form vs Payment Mismatch**
- Webhook triggers on "Order Form Submission"
- But payment might be processed through a different form/flow
- **Solution**: Check if the payment form that users actually see matches the "Shared Memories Plans" filter

### 2. **Payment vs Form Submission Timing**
- Form submission might happen BEFORE payment completion
- Webhook fires on submission, not payment success
- **Solution**: Change trigger to "Payment Completed" or "Order Paid" if available

### 3. **Different Payment Processor**
- Payment might be handled by Stripe/PayPal directly, bypassing GHL form submission
- **Solution**: Check if payments are processed through GHL or external processor

## Debugging Steps

### Step 1: Test Form Submission
1. Go through the actual payment flow users see
2. Submit the form (don't complete payment)
3. Check GHL Execution Logs to see if webhook fires on form submission

### Step 2: Check Payment Flow
1. Complete a real payment
2. Check both:
   - GHL Execution Logs (for webhook attempts)
   - Netlify Function Logs (for received webhooks)

### Step 3: Verify Form Identity
1. Check if the payment form has the same name/ID as "Shared Memories Plans"
2. Verify the form is in the correct funnel/website

### Step 4: Alternative Triggers
Consider changing the trigger to:
- "Payment Completed" (if available)
- "Order Status Changed" 
- "Contact Tag Added" (if payment adds a tag)

## Current Webhook Test Commands

```bash
# Test upgrade
curl -X POST https://sharedmoments.netlify.app/.netlify/functions/ghl-webhook \
  -H "Content-Type: application/json" \
  -d '{"action":"upgrade_confirmed","eventId":"2025-07-15_random_a5skq8xa"}'

# Test reset (after deployment)
curl -X POST https://sharedmoments.netlify.app/.netlify/functions/ghl-webhook \
  -H "Content-Type: application/json" \
  -d '{"action":"reset_to_free","eventId":"2025-07-15_random_a5skq8xa"}'
```

## Next Actions
1. Try a real payment and check GHL Execution Logs
2. If webhook doesn't fire, change trigger from "Order Form Submission" to "Payment Completed"
3. If no payment trigger available, consider using contact tags or order status changes
