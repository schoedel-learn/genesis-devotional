# Setup Guide — how The Patriarchs' Altar is wired

Everything below is already done. Keep this file as the map: if something breaks
or you need to change the money path, this is where the pieces are named.

Live sites:

| URL | What it serves |
|---|---|
| https://patriarchs.catholic.work/ | catalog (front door) |
| https://patriarchs.catholic.work/genesis/ | the Genesis devotional |
| https://genesis.catholic.work/ | the same site (older domain, still attached) |

## Key concepts, defined

- **Firebase Hosting** — Google's CDN that serves the static files. Free SSL.
- **Firebase Authentication** — Google Sign-In. The browser talks to Google
  directly; there is no login server of ours.
- **Cloud Firestore** — the database. `/users/{uid}` holds progress and notes.
- **Cloud Functions (2nd gen)** — the only server code we run. Two endpoints,
  both reached through the hosting domain:
  - `POST /api/create-checkout` → `createCheckoutSession`
  - `POST /api/stripe-webhook` → `stripeWebhook`
- **Stripe Checkout** — Stripe's own hosted payment page. Card data never
  touches our site.
- **Entitlement** — the record saying "this user paid for this section". It
  lives at `/users/{uid}/entitlements/sections` and is written **only** by the
  webhook function.

## Identifiers

| Thing | Value |
|---|---|
| Firebase project | `genesis-devotional` (number `680090594132`) |
| Firebase account | `contact@schoedel.design` |
| Firestore database | `(default)` |
| Stripe account | `acct_1SYzGkHTX26wVPOc` (business name "Catholic.Work") |
| Stripe product | `prod_VIYcs5qzDs4Ryc` — Genesis — The Patriarchs' Altar |
| Stripe price | `price_1UHxUqHTX26wVPOcfX816oKA` — $20 USD, one-time |
| Stripe webhook | `we_1UHxUrHTX26wVPOc5eFWWGor` → `/api/stripe-webhook` |
| DNS | GoDaddy (`ns49/ns50.domaincontrol.com`), zone `catholic.work` |
| Hosting custom domains | `genesis.catholic.work`, `patriarchs.catholic.work` |

Records added for the new domain (mirroring the Genesis one):

    patriarchs  A    199.36.158.100                       (Firebase Hosting)
    patriarchs  TXT  hosting-site=genesis-devotional      (site ownership)

## Secrets

All Stripe keys live in `functions/.env` (gitignored, permissions 600):

    STRIPE_SECRET_KEY=sk_live_...
    STRIPE_WEBHOOK_SECRET=whsec_...      # from the webhook endpoint
    STRIPE_PRICE_GENESIS=price_1UHxUqHTX26wVPOcfX816oKA

The publishable key (`pk_live_...`) is public by design and sits in
`shared/stripe-checkout.js`.

**Rotating a key:** the same account's keys are stored in the vault
(`80 ⚡ System/Secrets.md` → "Stripe (The Patriarchs' Altar)"). Put the new value
in `functions/.env`, then `./deploy.sh` — the functions pick it up at deploy time.

## Deploying

    ./deploy.sh              # hosting, then rules, then functions (+ public-access check)
    ./deploy.sh hosting      # pages only, fast (skips payments)
    ./deploy.sh functions    # functions only (+ public-access check)

The stages are deliberately separate. `firebase deploy --only hosting,rules,functions`
uploads the hosting files but releases them only after every other target
succeeds — so when a function build failed, the site quietly kept serving the
previous pages while the command reported the upload as complete. Hosting now
goes out on its own stage, and the script prints a loud summary and exits
non-zero if any stage failed.

`deploy.sh` syntax-checks every JavaScript file and loads the functions module
with `functions/.env` before uploading, so a bad edit fails in seconds instead of
after a five-minute build.

**If the Firebase CLI session is stale** (`Authentication Error: Your credentials
are no longer valid`), run `firebase login --reauth`. Every stage needs it,
including `scripts/ensure_functions_public.py`.

### The public-invoker check (do not skip it)

A 2nd-gen function is a Cloud Run service, and Cloud Run has its own
authentication gate in front of the code. If the invoker check is enabled, every
anonymous call returns Google's HTML **403** page and our handler never runs —
checkout stops working and Stripe's webhooks get 403, which means customers can
pay and receive nothing.

`allUsers` (the usual fix) is refused on this project by an organization policy:
*"One or more users named in the policy do not belong to a permitted customer."*
The equivalent is Cloud Run's `invokerIamDisabled`, which `scripts/ensure_functions_public.py`
sets via `gcloud run services update <service> --no-invoker-iam-check`. deploy.sh
runs it after every functions deploy and fails the deploy if either service is
not publicly invocable. Check it any time with:

    python3 scripts/ensure_functions_public.py --check

**First-time project prerequisites** (already configured once; recorded here
because a new project would need them). The Cloud Functions build and runtime run
as the default compute service account
`680090594132-compute@developer.gserviceaccount.com`, which needed

    roles/storage.objectViewer      (read the uploaded source)
    roles/artifactregistry.writer   (push the built image)
    roles/logging.logWriter         (write build logs)
    roles/firebaseauth.viewer       (token revocation checks inside verifyIdToken)
    roles/datastore.user            (read/write Firestore from the functions)

the Cloud Build service account `680090594132@cloudbuild.gserviceaccount.com`
needed `roles/cloudbuild.builds.builder`, and the Cloud Run services needed
`invokerIamDisabled` (see above). Without the first four, deploys fail with
"Build failed with status: FAILURE" or the functions return 500s that only show
up in the logs. Container-image cleanup should also be set once:

    firebase functions:artifacts:setpolicy --project genesis-devotional
    # without it, `firebase deploy` exits 1 with a cleanup-policy error even
    # though the functions deployed, and that non-zero exit stops hosting
    # from being released.

## How a purchase works, end to end

1. Visitor signs in with Google, reads Day 1 free, taps **Unlock Genesis — $20**.
2. The browser calls `/api/create-checkout` with a Firebase ID token.
3. `createCheckoutSession` verifies the token, refuses if the section is already
   owned, and returns a Stripe Checkout URL.
4. Stripe takes the payment and calls `POST /api/stripe-webhook`.
5. `stripeWebhook` verifies Stripe's signature, writes the receipt to
   `/users/{uid}/purchases/{sessionId}`, and grants
   `/users/{uid}/entitlements/sections`.
6. The browser returns to `/genesis/?payment=success`; the access gate notices
   the entitlement (waiting up to ~15 s for the webhook if needed) and unlocks
   Days 2–10.

## Existing users (grandfathered)

When payments launched, every user already in `/users` was granted
`grandfathered: true` in their entitlement document, which unlocks every current
and future section. That was a one-time migration over the Firestore REST API;
one user was covered. New users are *not* grandfathered — they see the paywall.

## Firestore security model

| Path | Read | Write |
|---|---|---|
| `/users/{uid}` | any signed-in user | only the owner, and not `purchasedSections` / `grandfathered` / `entitlements` |
| `/users/{uid}/entitlements/{doc}` | owner only | **nobody** (Cloud Functions only, via the Admin SDK) |
| `/users/{uid}/purchases/{id}` | owner only | **nobody** |
| `/groups/{groupId}` and `/members/{userId}` | any signed-in user | owner's own member doc |
| `/stats/{id}` | anyone | any signed-in user |

The client-side paywall is a UI feature, not a security boundary: the devotional
text ships inside `genesis/index.html`, so a determined visitor can read the
source. Making it enforceable means serving Days 2–10 from Firestore behind the
same entitlement. Nothing else in the payment path depends on that change.

## Honest limitations

- **No test-card run in production.** This Stripe account has no test-mode key
  stored, so the live flow was verified by creating a real (unused) Checkout
  session and by replaying a correctly signed `checkout.session.completed` event
  against the deployed webhook. A test-card pass needs test keys from the Stripe
  dashboard (Developers → API keys → Test mode).
- **Stripe Dashboard product images** are unset.
- The webhook subscribes to `checkout.session.completed` only. Refunds are not
  automated: a refund does not currently revoke access. If refunds become a real
  workflow, add `charge.refunded` handling and revoke the entitlement there.

## Housekeeping still open (2026-09-21)

1. **Verification data** created while testing the paywall is still in the
   project: three throwaway Firebase Auth users (`verify-altar-*`) with their
   profiles, receipts and entitlements, one of which holds a replayed purchase
   document. One command removes all of it, together with the temporary IAM
   binding below:

       python3 scripts/cleanup-verification-data.py --dry-run   # what it would do
       python3 scripts/cleanup-verification-data.py --apply

   It refuses to run if the real grandfathered user's uid
   (`lCfeWLEgJ1QCwFrBDEDMAdBat8G3`) ever appears in its delete list.
2. **Temporary IAM binding** — `roles/iam.serviceAccountTokenCreator` for
   `user:contact@schoedel.design` on the default compute service account was
   added so this workstation could mint short-lived test sign-in tokens. The
   cleanup script above removes it. It is not needed for the app to run.
3. **Firebase CLI session for `contact@schoedel.design` was invalidated** on
   2026-09-21 (repeated refresh-token use tripped Google's rotation safety), so
   `firebase login --reauth` is required before the next deploy. Nothing in
   production depends on that session.
4. **Neither the full `./deploy.sh` nor the cleanup script has been run since the
   staged-deploy rewrite and the CLI credential loss**, so both need one
   confirming run after re-authentication. Everything else in this file was
   verified live on 2026-09-21.

## Domain status (verified 2026-09-21)

| URL | Certificate | Notes |
|---|---|---|
| https://patriarchs.catholic.work/ | issued, valid to 2026-12-20 | Google Trust Services; DNS matched; Stripe's webhook URL answers here |
| https://genesis.catholic.work/ | active (pre-existing) | same site, same functions; kept for existing links |

Both domains serve the same Hosting site, so `/api/*` works on either — which is
why the webhook was verifiable on the older domain while the new one's
certificate was still being issued.
