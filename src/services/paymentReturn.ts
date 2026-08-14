// Working out which event a customer is coming back to, after checkout.
//
// There are three return pages — success, cancelled, failed — and all three had
// their own copy of this logic, all three reading `pendingUpgrade` out of
// localStorage, and all three getting it wrong in the same way: the value is
// written just before the redirect, so paying on a different device from the one
// that opened the gallery loses it. Scanning a QR code on a phone and paying on a
// laptop is not an edge case here, it is the normal path.
//
// One resolver, no localStorage. The signed `ref` in the URL is authoritative;
// a bare `event_id` is honoured for links issued before checkout-start existed.
//
// Refs: AUDIT_2026-08.md GHL-2, UX-7

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCheckoutStatus } from './checkoutService';
import { getEvent } from './photoService';

export interface CheckoutEvent {
  eventId: string | null;
  eventTitle: string | null;
  /** True once we know the upgrade landed. Only the success page acts on it. */
  upgraded: boolean;
  loading: boolean;
}

/**
 * Resolve the event behind a checkout return.
 *
 * Deliberately has no error state. These pages are reached by someone who has
 * just interacted with a payment form, and "we could not load your event" is
 * both alarming and useless to them — the old pages printed raw exception text
 * and localStorage diagnostics at exactly that moment. A missing event now means
 * the page renders its generic copy without a gallery link, which is the honest
 * outcome and reads as nothing having gone wrong.
 */
export function useCheckoutEvent(): CheckoutEvent {
  const [searchParams] = useSearchParams();

  const ref = searchParams.get('ref');
  const legacyEventId = (() => {
    const value = searchParams.get('event_id');
    // GoHighLevel sends the literal placeholder when a workflow field is
    // misconfigured. Treat it as absent rather than looking up "{event_id}".
    return value && value !== '{event_id}' ? value : null;
  })();

  const [state, setState] = useState<CheckoutEvent>({
    eventId: legacyEventId,
    eventTitle: null,
    upgraded: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      try {
        if (ref) {
          const status = await getCheckoutStatus(ref);
          if (!cancelled && status) {
            setState({
              eventId: status.eventId,
              eventTitle: status.eventTitle,
              upgraded: status.upgraded,
              loading: false,
            });
            return;
          }
        }

        if (legacyEventId) {
          const event = await getEvent(legacyEventId);
          if (!cancelled && event) {
            setState({
              eventId: legacyEventId,
              eventTitle: event.title,
              upgraded: event.planType === 'premium',
              loading: false,
            });
            return;
          }
        }
      } catch {
        // Falls through to the not-found state below.
      }

      if (!cancelled) {
        setState((previous) => ({ ...previous, loading: false }));
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [ref, legacyEventId]);

  return state;
}

/**
 * Turn a payment-failure code into copy we control.
 *
 * The failed page used to render `?reason=` straight onto the screen, inside an
 * alert headed "Payment Error Details" and styled as our own. Anyone could send
 * a link that displayed arbitrary text there under our branding — "your card was
 * declined, call this number" is the obvious abuse, and React escaping the string
 * does nothing about it. Only known codes produce copy now; anything else gets
 * the generic message.
 */
export function describeFailureReason(code: string | null): string {
  switch ((code || '').toLowerCase()) {
    case 'card_declined':
    case 'declined':
      return 'Your card was declined. Your bank can say why — often it is a limit rather than a problem with the card.';
    case 'insufficient_funds':
      return 'There were not enough funds available on that card.';
    case 'expired_card':
      return 'That card has expired.';
    case 'incorrect_cvc':
    case 'invalid_cvc':
      return 'The security code did not match.';
    case 'processing_error':
      return 'The payment processor had a problem. Trying again usually works.';
    default:
      return 'The payment did not go through. Nothing was charged.';
  }
}
