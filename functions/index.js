/**
 * Cloud Functions for The Patriarchs' Altar.
 *
 *   createCheckoutSession  POST /api/create-checkout   (hosting rewrite)
 *   stripeWebhook          POST /api/stripe-webhook    (Stripe -> here)
 *
 * Money path, end to end:
 *   1. The browser asks /api/create-checkout with a Firebase ID token.
 *   2. This function verifies the token, refuses if the section is already
 *      owned, and returns a Stripe Checkout URL.
 *   3. Stripe collects payment and calls /api/stripe-webhook.
 *   4. The webhook verifies the Stripe signature, then writes the entitlement
 *      that the access gate reads.
 *
 * Secrets (functions/.env, gitignored, injected at deploy time):
 *   STRIPE_SECRET_KEY        sk_live_... / sk_test_...
 *   STRIPE_WEBHOOK_SECRET    whsec_... (from the Stripe webhook endpoint)
 *   STRIPE_PRICE_GENESIS     price_... (the $20 one-time Genesis price)
 *
 * Access data lives in /users/{uid}/entitlements/sections and is writable
 * ONLY from here (see firestore.rules). The browser can read it and nothing
 * else is trusted.
 */

// firebase-admin 14 is modular-only: the old `admin.firestore()` namespace
// (present through v12) was removed, so every API is imported from its own
// subpath.
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const Stripe = require("stripe");

initializeApp();
const db = getFirestore();

// Keeps a runaway loop (or a bot) from running up the bill; one instance per
// 80 concurrent visitors is plenty for this app.
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Pin the Stripe API version so a dashboard-side default change cannot alter
// behaviour under us. This is the version stripe-node 22.6.2 is built against
// (node_modules/stripe/cjs/apiVersion.js); bump it deliberately, together with
// the npm dependency.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-08-26.dahlia",
  appInfo: { name: "The Patriarchs' Altar", version: "2.0.0" },
});

/** Catalogue of purchasable sections. Add a new book here as it launches. */
const SECTIONS = {
  genesis: {
    title: "Genesis — The Patriarchs' Altar",
    description: "10-day Catholic devotional through Genesis for men.",
    priceEnv: "STRIPE_PRICE_GENESIS",
  },
};

/** Where the entitlement ledger lives, relative to the user document. */
const ENTITLEMENT_DOC = ["entitlements", "sections"];

/**
 * Read a user's entitlements. Returns { sections: [], grandfathered: bool }.
 */
async function getEntitlements(uid) {
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection(ENTITLEMENT_DOC[0])
    .doc(ENTITLEMENT_DOC[1])
    .get();
  if (!snap.exists) return { sections: [], grandfathered: false };
  const data = snap.data() || {};
  return {
    sections: Array.isArray(data.sections) ? data.sections : [],
    grandfathered: data.grandfathered === true,
  };
}

/** True when this user may use this section without paying again. */
async function hasAccess(uid, sectionSlug) {
  const ent = await getEntitlements(uid);
  return ent.grandfathered || ent.sections.includes(sectionSlug);
}

// ---------------------------------------------------------------------------
// 1. Create a Stripe Checkout Session
// ---------------------------------------------------------------------------
exports.createCheckoutSession = onRequest(
  // Same-origin only: the browser calls this through the hosting rewrite at
  // /api/create-checkout, so no CORS headers are needed. Leaving CORS off
  // means a random website cannot drive our checkout from a victim's browser.
  { cors: false, timeoutSeconds: 30, memory: "256MiB" },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
      // --- Who is asking? ------------------------------------------------
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing Bearer token" });
      }

      let decoded;
      try {
        // checkRevoked: a token from a signed-out or disabled account is
        // rejected even if it has not expired yet.
        decoded = await getAuth().verifyIdToken(authHeader.slice(7), true);
      } catch (err) {
        console.warn("createCheckoutSession: bad ID token:", err.message);
        return res.status(401).json({ error: "Invalid token" });
      }

      const uid = decoded.uid;

      // --- What is being bought? ----------------------------------------
      const { sectionSlug, successUrl, cancelUrl } = req.body || {};
      const section = SECTIONS[sectionSlug];
      if (!section) {
        return res.status(400).json({ error: "Unknown section" });
      }
      const priceId = process.env[section.priceEnv];
      if (!priceId) {
        console.error(`Missing ${section.priceEnv} in the function environment`);
        return res.status(500).json({ error: "Payment is not configured" });
      }
      // Only ever send the visitor back to this site. Without this, a crafted
      // request could bounce a paying customer to an attacker's page after
      // checkout.
      const isOwnUrl = (u) => {
        try {
          const parsed = new URL(u);
          const host = parsed.hostname;
          const https = parsed.protocol === "https:";
          const ours =
            host === "patriarchs.catholic.work" ||
            host === "genesis.catholic.work" ||
            /\.(web\.app|firebaseapp\.com)$/.test(host);
          const local = host === "localhost" || host === "127.0.0.1";
          return local || (https && ours);
        } catch {
          return false;
        }
      };
      if (!isOwnUrl(successUrl) || !isOwnUrl(cancelUrl)) {
        return res.status(400).json({ error: "Invalid return URL" });
      }

      // --- Already owned? ------------------------------------------------
      if (await hasAccess(uid, sectionSlug)) {
        return res.status(200).json({ alreadyPurchased: true });
      }

      // --- Ask Stripe for a checkout page -------------------------------
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: uid,
        customer_email: decoded.email || undefined,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { firebaseUid: uid, sectionSlug },
        // Also stamp the payment intent, so the receipt in the Stripe
        // dashboard can be traced back to a Firebase user.
        payment_intent_data: {
          metadata: { firebaseUid: uid, sectionSlug },
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      console.log(`Checkout created for ${uid} / ${sectionSlug}: ${session.id}`);
      return res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (error) {
      console.error("createCheckoutSession failed:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// ---------------------------------------------------------------------------
// 2. Stripe webhook — the only writer of entitlements
// ---------------------------------------------------------------------------
exports.stripeWebhook = onRequest(
  { cors: false, timeoutSeconds: 60, memory: "256MiB" },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
      // req.rawBody is the byte-exact body; Stripe signs those bytes, so the
      // parsed JSON must never be used for verification.
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          await recordPurchase(event.data.object);
          break;
        default:
          console.log(`Unhandled event type ${event.type}`);
      }
    } catch (err) {
      // Returning 500 tells Stripe to retry — which is what we want if the
      // Firestore write failed. A 200 here would silently lose a purchase.
      console.error("Webhook handler failed:", err);
      return res.status(500).send("Handler failed");
    }

    return res.status(200).send("Handled");
  }
);

/**
 * Write the receipt and grant the entitlement for a completed checkout.
 * Safe to run twice for the same session (Stripe retries): both writes are
 * idempotent — the receipt is keyed by session id and sections use arrayUnion.
 */
async function recordPurchase(session) {
  const uid = session.metadata && session.metadata.firebaseUid;
  const sectionSlug = session.metadata && session.metadata.sectionSlug;

  if (!uid || !sectionSlug) {
    console.warn("Session missing metadata:", session.id, session.metadata);
    return;
  }
  if (!SECTIONS[sectionSlug]) {
    console.warn("Session references an unknown section:", sectionSlug);
    return;
  }
  if (session.payment_status && session.payment_status !== "paid") {
    console.log(`Session ${session.id} is ${session.payment_status}; not granting yet`);
    return;
  }

  const userRef = db.collection("users").doc(uid);

  // 1. Receipt — /users/{uid}/purchases/{stripeSessionId}
  await userRef
    .collection("purchases")
    .doc(session.id)
    .set(
      {
        section: sectionSlug,
        amount: session.amount_total,
        currency: session.currency,
        stripeSessionId: session.id,
        stripePaymentIntentId: session.payment_intent || null,
        customerEmail:
          (session.customer_details && session.customer_details.email) ||
          session.customer_email ||
          null,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  // 2. Entitlement — the document the access gate trusts. Written only here,
  //    so a browser cannot grant itself access.
  await userRef
    .collection(ENTITLEMENT_DOC[0])
    .doc(ENTITLEMENT_DOC[1])
    .set(
      {
        sections: FieldValue.arrayUnion(sectionSlug),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  // 3. Convenience mirror on the profile, for support questions in the
  //    Stripe dashboard ("has this father paid?"). Never used for access.
  await userRef.set(
    {
      purchasedSections: FieldValue.arrayUnion(sectionSlug),
    },
    { merge: true }
  );

  console.log(`Granted ${sectionSlug} to ${uid} (session ${session.id})`);
}
