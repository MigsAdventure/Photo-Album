/**
 * What an upgrade costs, and where the customer goes to pay for it.
 *
 * Why this is server-side
 * -----------------------
 * The price used to live in the browser. `UpgradeModal.tsx` rendered "$29", put
 * `amount=29` into the checkout query string, and told the CRM
 * `paymentAmount: 29` — three client-side copies of a number that decides how
 * much money changes hands. Whether or not the GoHighLevel order form actually
 * honoured that parameter, an application should never propose its own price
 * from code the customer controls, and it should certainly not report the
 * amount it *expects* to the system of record.
 *
 * Now: the server decides, the client renders what the server returns, and the
 * amount written to the event document comes from the payment webhook — that is,
 * from what was actually charged.
 *
 * Changing the price
 * ------------------
 * Set `UPGRADE_PRICE_CENTS` and update the GoHighLevel order form to match. They
 * are two systems and nothing keeps them in step automatically; the value here
 * is what the customer is *shown*, and the order form is what actually charges.
 * If they disagree, the customer sees one number and is billed another, so treat
 * them as a pair.
 *
 * Refs: AUDIT_2026-08.md §06 (pricing shape), GHL-2
 */

const DEFAULT_PRICE_CENTS = 2900;

/** Where the GoHighLevel order form lives. */
function checkoutBaseUrl() {
  const url = process.env.CHECKOUT_URL;

  if (!url) {
    throw new Error(
      'CHECKOUT_URL is not configured. Set it to the GoHighLevel order form URL ' +
        'for the event upgrade.'
    );
  }

  return url;
}

/**
 * The upgrade offer, as the customer should see it.
 *
 * Returned to the client so the modal renders the same number the checkout will
 * charge, rather than a hardcoded string that drifts from it.
 */
function upgradeOffer() {
  const cents = Number(process.env.UPGRADE_PRICE_CENTS || DEFAULT_PRICE_CENTS);

  const priceCents = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : DEFAULT_PRICE_CENTS;

  return {
    priceCents,
    currency: process.env.UPGRADE_CURRENCY || 'USD',
    // Formatted here so every surface shows it identically. A modal that says
    // "$29" and an email that says "$29.00" read as two different products.
    display: formatPrice(priceCents, process.env.UPGRADE_CURRENCY || 'USD'),
  };
}

/** `2900` → `"$29"`. Whole amounts drop the decimals; 2950 → "$29.50". */
function formatPrice(cents, currency = 'USD') {
  const amount = cents / 100;
  const hasFraction = cents % 100 !== 0;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0,
    }).format(amount);
  } catch {
    // An unknown currency code should not take down checkout.
    return `${amount.toFixed(hasFraction ? 2 : 0)} ${currency}`;
  }
}

module.exports = {
  DEFAULT_PRICE_CENTS,
  checkoutBaseUrl,
  upgradeOffer,
  formatPrice,
};
