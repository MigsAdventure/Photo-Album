// GoHighLevel integration — server-side only.
//
// This file used to hold a full GoHighLevel API client that ran in the browser
// and read its key from REACT_APP_GHL_API_KEY (finding GHL-1). Anything prefixed
// REACT_APP_ is compiled into the JavaScript bundle and readable by every
// visitor, so populating that variable would have handed the entire GoHighLevel
// location — contacts, orders, payment links — to anyone who opened devtools.
//
// It also targeted the v1 REST API, which is superseded by the OAuth-based v2
// API where the current endpoints live.
//
// Everything privileged now runs in Netlify functions with a server-only token:
//
//   netlify/functions/ghl-webhook.js   receives upgrades, verifies the signature,
//                                      confirms the payment, writes plan state
//
// If you need more GoHighLevel calls — contact creation on upload, lifecycle
// automations, the reseller sync described in AUDIT_2026-08.md §06 — add them as
// functions there. Do not reintroduce a browser-side client, and do not add a
// REACT_APP_GHL_* variable.

// Send upgrade notification to GHL webhook (simplified approach)
export const sendUpgradeToGHL = async (upgradeData: {
  eventId: string;
  eventTitle: string;
  organizerEmail: string;
  organizerName: string;
  planType: string;
  paymentAmount: number;
  paymentId: string;
  paymentMethod: string;
}): Promise<boolean> => {
  // This trigger URL is a capability: anyone holding it can post events into the
  // workflow. It was hardcoded, and this file ships to the browser, so it was
  // public regardless — but it should not be baked into the source as well.
  // Configure it as REACT_APP_GHL_UPGRADE_WEBHOOK.
  //
  // It is a notification only, carrying no authority to change plan state, so a
  // public URL is tolerable. If it ever gains authority, it must move server-side.
  const GHL_WEBHOOK_URL = process.env.REACT_APP_GHL_UPGRADE_WEBHOOK;

  if (!GHL_WEBHOOK_URL) {
    console.warn('⚠️ REACT_APP_GHL_UPGRADE_WEBHOOK is not set; skipping CRM notification');
    return false;
  }

  try {
    console.log('📨 Sending upgrade notification to GHL webhook...');
    
    const webhookPayload = {
      event_id: upgradeData.eventId,
      event_title: upgradeData.eventTitle,
      organizer_email: upgradeData.organizerEmail,
      organizer_name: upgradeData.organizerName,
      plan_type: upgradeData.planType,
      payment_amount: upgradeData.paymentAmount,
      payment_id: upgradeData.paymentId,
      payment_method: upgradeData.paymentMethod,
      upgrade_timestamp: new Date().toISOString(),
      app_version: "1.0.0",
      source: "wedding_photo_app"
    };

    const response = await fetch(GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WeddingPhotoApp/1.0.0'
      },
      body: JSON.stringify(webhookPayload)
    });

    if (response.ok) {
      console.log('✅ GHL webhook notification sent successfully');
      return true;
    } else {
      console.error('❌ Failed to send GHL webhook:', response.status, response.statusText);
      return false;
    }

  } catch (error) {
    console.error('❌ Error sending GHL webhook:', error);
    return false;
  }
};

// initiatePremiumUpgrade and processPaymentWebhook were here. Both drove the
// browser-side client that has been removed, and nothing called either of them.
//
// The upgrade flow is: the customer pays through a GoHighLevel order form, and
// GoHighLevel calls netlify/functions/ghl-webhook.js, which verifies the
// signature, confirms the payment, and writes the plan state with the Admin SDK.
// A browser is never in the trust path for granting premium.
