# Payment Confirmation Debugging Guide

## **Problem**: Still getting "Event Not Found" after localStorage implementation

Let's debug this step by step to find the exact issue.

## **Step 1: Test localStorage Before Payment**

### **Open your event page and:**
1. **Open browser console** (F12 → Console)
2. **Click "Upgrade Now"** 
3. **Before the redirect happens**, check console for:
   ```
   🔄 UpgradeModal: Storing event data in localStorage before payment redirect
   ✅ UpgradeModal: Event data stored in localStorage: {eventId: "...", ...}
   ```

### **If you DON'T see these logs:**
- The UpgradeModal localStorage code isn't running
- Check if you deployed the updated code
- Try hard refresh (Ctrl+F5)

### **If you DO see these logs:**
- Copy the `eventId` value from the console
- Run in console: `localStorage.getItem('pendingUpgrade')`
- Should show the stored data

## **Step 2: Test localStorage After Redirect**

### **After completing/cancelling payment:**
1. **On the payment confirmation page**, open console
2. **Run the debug script:**
   ```javascript
   // Paste this in console
   const pendingUpgrade = localStorage.getItem('pendingUpgrade');
   console.log('📦 localStorage data:', pendingUpgrade);
   
   if (pendingUpgrade) {
     const data = JSON.parse(pendingUpgrade);
     console.log('✅ Parsed data:', data);
     console.log('🎯 Event ID:', data.eventId);
   } else {
     console.log('❌ No localStorage data found');
   }
   ```

### **If NO localStorage data:**
This means localStorage was cleared or lost during redirect. Possible causes:
- **Cross-domain issue**: GHL payment page is different domain
- **Browser settings**: Incognito mode or storage restrictions
- **GHL redirect**: Some payment processors clear localStorage

### **If localStorage data EXISTS:**
- Copy the event ID
- Test if the event exists in Firebase using our debug function

## **Step 3: Test Event Lookup**

### **Test if your event actually exists:**
```javascript
// In console, replace YOUR_EVENT_ID with actual ID
fetch('/.netlify/functions/test-event-lookup?eventId=YOUR_EVENT_ID')
  .then(r => r.json())
  .then(data => console.log('🧪 Event lookup result:', data));
```

### **Expected Results:**
- **If event found**: `{success: true, event: {...}}`
- **If event not found**: `{error: "Event not found", existingEvents: [...]}`

## **Step 4: Test Create → Upgrade Flow**

### **Create a test event:**
1. **Go to your home page**
2. **Create a new event** with your email
3. **Copy the event ID** from URL (e.g., `/event/evt_abc123`)
4. **In console, store it manually:**
   ```javascript
   localStorage.setItem('pendingUpgrade', JSON.stringify({
     eventId: 'YOUR_ACTUAL_EVENT_ID',
     eventTitle: 'Test Event',
     organizerEmail: 'your@email.com',
     timestamp: Date.now(),
     paymentAmount: 29
   }));
   ```
5. **Go to**: `/payment/success`
6. **Should show** event details

## **Step 5: Check Domain Issues**

### **Check current domains:**
```javascript
console.log('🌐 Current domain:', window.location.hostname);
console.log('🌐 Full URL:', window.location.href);
```

### **If domains are different:**
- **Main app**: `sharedmoments.socialboostai.com`
- **Payment page**: `socialboostai.com`
- **localStorage won't work** across different domains

## **Step 6: Alternative Solutions**

### **If localStorage fails due to cross-domain:**

#### **Option A: URL Parameters (Force GHL)**
Try updating GHL redirect URLs to:
```
https://sharedmoments.socialboostai.com/payment/success?event_id={{event_id}}&debug=true
```

#### **Option B: Session Storage + URL Fallback**
Instead of localStorage, use sessionStorage which might persist better.

#### **Option C: Database Lookup**
Store "pending upgrades" in Firebase with a temporary key.

## **Debug Commands Summary**

### **Run these in console to debug:**

```javascript
// 1. Check localStorage
console.log('📦 localStorage:', localStorage.getItem('pendingUpgrade'));

// 2. Check URL parameters
console.log('🔗 URL params:', window.location.search);
console.log('🔗 event_id param:', new URLSearchParams(window.location.search).get('event_id'));

// 3. Check domain
console.log('🌐 Domain:', window.location.hostname);

// 4. Test event lookup (replace with real ID)
fetch('/.netlify/functions/test-event-lookup?eventId=REPLACE_WITH_REAL_EVENT_ID')
  .then(r => r.json())
  .then(data => console.log('🧪 Lookup result:', data));

// 5. Create test localStorage
localStorage.setItem('pendingUpgrade', JSON.stringify({
  eventId: 'REPLACE_WITH_REAL_EVENT_ID',
  eventTitle: 'Test Event',
  organizerEmail: 'test@email.com',
  timestamp: Date.now(),
  paymentAmount: 29
}));
```

## **Expected Outcomes**

### **Working Flow Should Show:**
1. ✅ localStorage stored before redirect
2. ✅ localStorage present after redirect
3. ✅ Event found in Firebase
4. ✅ Payment confirmation page loads with event details

### **Common Issues:**
1. **Cross-domain localStorage** → Use URL parameters instead
2. **Event doesn't exist** → Check Firebase, verify event creation
3. **Code not deployed** → Hard refresh, redeploy
4. **Browser restrictions** → Try different browser/incognito mode

## **Next Steps**

Run through these debug steps and share the console output. This will help identify the exact issue:

1. **Is localStorage working?**
2. **Is the event in Firebase?**
3. **Are domains causing issues?**
4. **Is the code properly deployed?**

Share the results and we'll fix the specific issue!
