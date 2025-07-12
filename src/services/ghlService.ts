import { GHLOrder, GHLPaymentData } from '../types';

// GoHighLevel API configuration
const GHL_API_BASE = 'https://rest.gohighlevel.com/v1';

// Initialize GHL service with API key (will be set from environment)
class GoHighLevelService {
  private apiKey: string = '';
  private locationId: string = '';

  constructor() {
    // These will be set when the user provides their GHL credentials
    this.apiKey = process.env.REACT_APP_GHL_API_KEY || '';
    this.locationId = process.env.REACT_APP_GHL_LOCATION_ID || '';
  }

  // Create a contact in GoHighLevel
  async createContact(email: string, eventTitle: string, eventId: string): Promise<string> {
    try {
      const response = await fetch(`${GHL_API_BASE}/contacts/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          firstName: email.split('@')[0], // Use email prefix as first name
          lastName: 'Event Organizer',
          locationId: this.locationId,
          customFields: {
            event_id: eventId,
            event_title: eventTitle,
            plan_type: 'free'
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`GHL API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ GHL contact created:', data.contact.id);
      return data.contact.id;
    } catch (error) {
      console.error('❌ Failed to create GHL contact:', error);
      throw error;
    }
  }

  // Create an order for premium upgrade
  async createOrder(orderData: GHLOrder): Promise<string> {
    try {
      const response = await fetch(`${GHL_API_BASE}/orders/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactId: orderData.contactId,
          locationId: this.locationId,
          amount: orderData.amount,
          currency: orderData.currency || 'USD',
          products: [{
            name: `Premium Event Upgrade - ${orderData.eventTitle}`,
            description: `Unlimited photo uploads for event: ${orderData.eventTitle}`,
            amount: orderData.amount,
            quantity: 1
          }],
          customFields: {
            event_id: orderData.eventId,
            event_title: orderData.eventTitle,
            organizer_email: orderData.organizerEmail
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`GHL Order API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ GHL order created:', data.order.id);
      return data.order.id;
    } catch (error) {
      console.error('❌ Failed to create GHL order:', error);
      throw error;
    }
  }

  // Get payment link for an order
  async getPaymentLink(orderId: string): Promise<string> {
    try {
      const response = await fetch(`${GHL_API_BASE}/orders/${orderId}/payment-link`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`GHL Payment Link API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ GHL payment link generated');
      return data.paymentLink;
    } catch (error) {
      console.error('❌ Failed to get GHL payment link:', error);
      throw error;
    }
  }

  // Update contact when payment is completed
  async updateContactToPremium(contactId: string, paymentId: string): Promise<void> {
    try {
      await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customFields: {
            plan_type: 'premium',
            payment_id: paymentId,
            upgraded_at: new Date().toISOString()
          }
        }),
      });

      console.log('✅ GHL contact updated to premium');
    } catch (error) {
      console.error('❌ Failed to update GHL contact:', error);
      throw error;
    }
  }

  // Check if API credentials are configured
  isConfigured(): boolean {
    return !!(this.apiKey && this.locationId);
  }

  // Set API credentials (for when user provides them)
  setCredentials(apiKey: string, locationId: string): void {
    this.apiKey = apiKey;
    this.locationId = locationId;
  }
}

// Export singleton instance
export const ghlService = new GoHighLevelService();

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
  const GHL_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/OD0oJMJ7R9OatD9liLM0/webhook-trigger/30e7e31b-9e78-4f69-8ecc-4678bd24b45f';
  
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

// Helper function to initiate premium upgrade flow
export const initiatePremiumUpgrade = async (
  eventId: string,
  eventTitle: string,
  organizerEmail: string,
  amount: number = 29 // Default price
): Promise<string> => {
  try {
    console.log('🚀 Initiating premium upgrade flow for:', eventId);

    // Create or find contact in GHL
    const contactId = await ghlService.createContact(organizerEmail, eventTitle, eventId);

    // Create order in GHL
    const orderData: GHLOrder = {
      contactId,
      locationId: '', // Will be filled by service
      amount,
      currency: 'USD',
      eventId,
      eventTitle,
      organizerEmail
    };

    const orderId = await ghlService.createOrder(orderData);

    // Get payment link
    const paymentLink = await ghlService.getPaymentLink(orderId);

    console.log('✅ Premium upgrade flow initiated');
    return paymentLink;

  } catch (error) {
    console.error('❌ Premium upgrade initiation failed:', error);
    throw error;
  }
};

// Process webhook from GoHighLevel when payment is completed
export const processPaymentWebhook = async (webhookData: any): Promise<void> => {
  try {
    console.log('📨 Processing GHL payment webhook:', webhookData);

    if (webhookData.type === 'order.completed') {
      const { orderId, contactId, customFields } = webhookData.data;
      const eventId = customFields?.event_id;

      if (eventId) {
        // Import photoService functions here to avoid circular dependency
        const { upgradeEventToPremium } = await import('./photoService');

        // Upgrade the event to premium
        await upgradeEventToPremium(eventId, orderId);

        // Update contact in GHL
        await ghlService.updateContactToPremium(contactId, orderId);

        console.log('✅ Payment webhook processed successfully');
      }
    }
  } catch (error) {
    console.error('❌ Payment webhook processing failed:', error);
    throw error;
  }
};
