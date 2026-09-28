// ==============================================================================
// ACCESS GATE — shared/access-gate.js
// ==============================================================================
// Decides whether the signed-in visitor may read the whole devotional, and
// shows a clean purchase path when they may not.
//
// Rules of the house:
//   * Day 1 is a free preview for everyone, including signed-out visitors.
//   * Days 2+ require a purchase, or the "grandfathered" flag that every
//     existing user received when payments launched.
//   * Access data is read from /users/{uid}/entitlements/sections, which only
//     the Stripe webhook Cloud Function can write.
//
// Usage (from a section page such as /genesis/index.html):
//   <script type="module">
//     import { initAccessGate } from '../shared/access-gate.js';
//     initAccessGate('genesis');
//   </script>
//
// Honest limitation: the devotional text itself ships inside the page's HTML,
// so this gate stops honest misuse and drives the purchase flow — it is not a
// hard boundary against someone who reads the source. Serving days 2-10 from
// Firestore behind the same entitlement would make it enforceable.
// ==============================================================================

import {
    checkSectionAccess,
    getAuthToken,
    loginWithGoogle,
    onAuthStateChange,
    clearEntitlementCache
} from './firebase-config.js';
import { startCheckout } from './stripe-checkout.js';

/** Section display metadata. Add a section here as it launches. */
const SECTION_META = {
    genesis: {
        title: 'Genesis',
        subtitle: 'A 10-day Catholic devotional through Genesis for men',
        price: '$20',
        freePreviewDays: 1
    },
    exodus: {
        title: 'Exodus',
        subtitle: 'A devotional through Exodus (coming soon)',
        price: '$20',
        freePreviewDays: 1
    }
};

const CURRENT_DAY_KEY = 'mb_current_day';
const CONTENT_ID = 'devotional-display';
const BAR_ID = 'altar-gate-bar';
const MODAL_ID = 'altar-gate-modal';

// Per-page state. A page shows one section at a time.
let gate = {
    slug: null,
    meta: null,
    state: 'checking',     // checking | sign-in | purchase | granted
    originalSelectDay: null,
    locked: false
};

/**
 * Initialize the access gate for a section.
 * @param {string} sectionSlug — e.g. "genesis"
 */
export function initAccessGate(sectionSlug) {
    const meta = SECTION_META[sectionSlug] ||
        { title: sectionSlug, subtitle: '', price: '$20', freePreviewDays: 1 };

    gate.slug = sectionSlug;
    gate.meta = meta;
    gate.originalSelectDay = window.selectDay || null;

    // The app resumes on the day stored in localStorage. If that is a paid day,
    // hide the reading now — before the auth round-trip finishes — so a locked
    // day never flashes on screen. It is un-hidden again the moment we know.
    if (storedDay() > meta.freePreviewDays) {
        setContentVisible(false);
    }

    // A payment returning from Stripe needs a moment for the webhook to land.
    const params = new URLSearchParams(window.location.search);
    const returningFromPayment = params.get('payment') === 'success';

    onAuthStateChange(async (user) => {
        clearPaywall();

        if (!user) {
            gate.state = 'sign-in';
            lockPaidDays();
            // Signed-out visitors get Day 1 only; send everyone else to Day 1.
            goToDay(1);
            setContentVisible(true);
            showBar('Sign in to unlock all 10 days.', 'Sign In with Google', () =>
                loginWithGoogle().catch((err) => console.error('Sign-in failed:', err))
            );
            return;
        }

        clearEntitlementCache(user.uid);

        let result = await checkSectionAccess(user.uid, sectionSlug);

        // Just back from Stripe and the webhook has not written yet: wait for it
        // rather than showing a "buy" button to someone who already paid.
        if (!result.hasAccess && returningFromPayment) {
            result = await waitForEntitlement(user.uid, sectionSlug);
        }

        if (result.hasAccess) {
            gate.state = 'granted';
            unlockAllDays();
            setContentVisible(true);
            clearPaywall();
            handlePaymentReturn(params, result);
            return;
        }

        gate.state = 'purchase';
        lockPaidDays();
        goToDay(1);
        setContentVisible(true);
        showBar(
            `Day 1 is free. Unlock all 10 days of ${meta.title} for ${meta.price}.`,
            `Unlock ${meta.title} — ${meta.price}`,
            () => beginCheckout()
        );
    });
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
async function beginCheckout() {
    const meta = gate.meta;
    try {
        const token = await getAuthToken();
        await startCheckout(gate.slug, token);
    } catch (err) {
        console.error('Checkout failed:', err);
        showModal(
            `${meta.title} — ${meta.price}`,
            'Payment could not be started. Please check your connection and try again.',
            null
        );
    }
}

/**
 * Poll for the entitlement for up to ~15 seconds after a payment redirect.
 * Stripe's webhook is usually faster than the browser redirect, but not always.
 */
async function waitForEntitlement(uid, sectionSlug, attempts = 10, delayMs = 1500) {
    for (let i = 0; i < attempts; i++) {
        await new Promise((r) => setTimeout(r, delayMs));
        clearEntitlementCache(uid);
        const result = await checkSectionAccess(uid, sectionSlug);
        if (result.hasAccess) return result;
    }
    // Not granted (yet). Keep the visitor on Day 1 with an explanation instead
    // of a dead "buy" button; the next page load picks up the entitlement.
    showBar(
        'Your payment is being confirmed. This usually takes a few seconds — reload in a moment.',
        'Reload',
        () => window.location.reload()
    );
    return { hasAccess: false, reason: 'pending' };
}

function handlePaymentReturn(params, result) {
    if (params.get('payment') !== 'success') return;
    showToast(
        result.reason === 'grandfathered'
            ? 'You already have full access. Enjoy the reading.'
            : 'Payment confirmed — all 10 days are unlocked.',
        '🔓'
    );
    // Strip ?payment=... so a refresh cannot ask Stripe twice.
    params.delete('payment');
    const clean =
        window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, '', clean);
}

// ---------------------------------------------------------------------------
// Day locking
// ---------------------------------------------------------------------------
function storedDay() {
    return Number(localStorage.getItem(CURRENT_DAY_KEY)) || 1;
}

/**
 * Wrap the app's own selectDay() so a locked day cannot be opened from
 * anywhere — day buttons, the next/previous arrows, or a resumed session.
 */
function lockPaidDays() {
    if (gate.locked || !gate.originalSelectDay) return;

    const original = gate.originalSelectDay;
    const freeDays = gate.meta.freePreviewDays;

    window.selectDay = function (dayNum) {
        if (dayNum > freeDays) {
            showModal(
                `${gate.meta.title} — ${gate.meta.price}`,
                `Day ${dayNum} is part of the full devotional. Unlock all 10 days to keep reading.`,
                gate.state === 'sign-in'
                    ? { label: 'Sign In with Google', action: () => loginWithGoogle() }
                    : { label: `Unlock — ${gate.meta.price}`, action: () => beginCheckout() }
            );
            return;
        }
        original(dayNum);
    };

    window.selectDay.__altarGated = true;
    gate.locked = true;
}

function unlockAllDays() {
    if (!gate.locked) return;
    if (gate.originalSelectDay) {
        window.selectDay = gate.originalSelectDay;
    }
    gate.locked = false;
}

/** Move the reader to a day without tripping the lock. */
function goToDay(dayNum) {
    if (storedDay() === dayNum) return;
    const mover = gate.originalSelectDay || window.selectDay;
    try {
        mover(dayNum);
    } catch (err) {
        // The app is not ready yet; the next interaction will land on Day 1
        // anyway because the lock refuses anything else.
        console.debug('goToDay deferred:', err.message);
    }
}

// ---------------------------------------------------------------------------
// UI pieces
// ---------------------------------------------------------------------------
function setContentVisible(visible) {
    const el = document.getElementById(CONTENT_ID);
    if (el) el.style.visibility = visible ? '' : 'hidden';
}

/** Compact, always-visible bar under the header: the standing offer. */
function showBar(message, buttonLabel, action) {
    let bar = document.getElementById(BAR_ID);
    if (!bar) {
        bar = document.createElement('div');
        bar.id = BAR_ID;
        // top-16 clears the app's sticky 4rem header.
        bar.className =
            'fixed left-0 right-0 top-16 z-40 flex items-center justify-center gap-3 ' +
            'px-3 py-2 bg-stone-900/95 backdrop-blur border-b border-amber-800/60 ' +
            'text-stone-200 text-[11px] sm:text-xs shadow-lg';
        bar.innerHTML =
            '<span></span>' +
            '<button type="button" class="shrink-0 px-3 py-1 bg-amber-800 hover:bg-amber-700 ' +
            'text-white font-bold rounded transition-all"></button>' +
            '<a href="/" class="shrink-0 text-stone-400 hover:text-stone-200 underline hidden sm:inline">' +
            'All sections</a>';
        document.body.appendChild(bar);
    }
    bar.querySelector('span').textContent = message;
    const button = bar.querySelector('button');
    button.textContent = buttonLabel;
    button.onclick = action;
}

/** Modal for a locked day or a checkout problem. */
function showModal(title, message, cta) {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className =
            'fixed inset-0 z-[60] bg-stone-950/90 backdrop-blur-sm flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-stone-900 border border-amber-700/80 rounded-xl shadow-2xl max-w-md w-full p-8 text-center space-y-5">
                <div class="text-4xl">✝</div>
                <h2 class="font-cinzel font-bold text-xl text-amber-400" data-gate-title></h2>
                <p class="text-stone-300 text-sm leading-relaxed" data-gate-message></p>
                <button type="button" data-gate-cta
                    class="w-full py-3 bg-amber-800 hover:bg-amber-700 text-white font-bold text-sm rounded-lg transition-all shadow-lg"></button>
                <button type="button" data-gate-close
                    class="block w-full text-xs text-stone-400 hover:text-stone-200 transition-colors">
                    ← Keep reading Day 1
                </button>
                <a href="/" class="block text-xs text-stone-500 hover:text-stone-300 transition-colors">All sections</a>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('[data-gate-close]').onclick = () => {
            modal.remove();
        };
    }
    modal.querySelector('[data-gate-title]').textContent = title;
    modal.querySelector('[data-gate-message]').textContent = message;

    const ctaButton = modal.querySelector('[data-gate-cta]');
    if (cta) {
        ctaButton.classList.remove('hidden');
        ctaButton.textContent = cta.label;
        ctaButton.onclick = () => {
            modal.remove();
            cta.action();
        };
    } else {
        ctaButton.classList.add('hidden');
    }
}

function clearPaywall() {
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
}

/** Use the app's own toast if it has one; otherwise say nothing. */
function showToast(message, icon) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, icon);
    }
}

// Expose a manual refresh for the page (e.g. after a group switch) and for
// debugging from the console.
window.AccessGate = {
    refresh: (uid) => {
        clearEntitlementCache(uid);
        return checkSectionAccess(uid || (window.currentUser && window.currentUser.uid), gate.slug);
    },
    state: () => gate.state
};
