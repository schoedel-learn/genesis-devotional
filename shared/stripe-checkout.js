// ==============================================================================
// STRIPE CHECKOUT CLIENT — shared/stripe-checkout.js
// ==============================================================================
// Handles client-side Stripe Checkout flow. Calls the Cloud Function to create
// a Checkout Session, then redirects the user to Stripe's hosted payment page.
//
// Usage:
//   import { startCheckout } from '../shared/stripe-checkout.js';
//   await startCheckout('genesis', idToken);
// ==============================================================================

const STRIPE_PUBLISHABLE_KEY = 'pk_live_51SYzGkHTX26wVPOcIH55iUNnY9CGZ9wWpfrHvWar7c9rQEARK2UP010S8Eq7f4yvDluPQnUVaifcExoOYfSS5TmZ00rcGbf8X9';

/**
 * Initiate a Stripe Checkout session for a given section.
 * Calls the Cloud Function /api/create-checkout, gets back a Stripe URL,
 * and redirects the browser there.
 *
 * @param {string} sectionSlug  — e.g. "genesis"
 * @param {string} idToken      — Firebase Auth ID token for the current user
 * @returns {Promise<void>}
 */
export async function startCheckout(sectionSlug, idToken) {
    if (!idToken) {
        throw new Error('You must be signed in to purchase a section.');
    }

    const successUrl = `${window.location.origin}/${sectionSlug}/?payment=success`;
    const cancelUrl = `${window.location.origin}/${sectionSlug}/?payment=cancelled`;

    const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
            sectionSlug,
            successUrl,
            cancelUrl
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Checkout failed: ${errorText}`);
    }

    const data = await response.json();

    // If user already owns this section, no checkout needed
    if (data.alreadyPurchased) {
        window.location.reload();
        return;
    }

    // Redirect to Stripe's hosted checkout page
    if (data.url) {
        window.location.href = data.url;
    } else {
        throw new Error('No checkout URL returned from server.');
    }
}
