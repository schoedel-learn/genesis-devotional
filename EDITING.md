# Editing The Patriarchs' Altar

The site is now a small **platform**: a catalog page at the front door, and one
folder per Bible section behind it. Each section is one big HTML file you edit
by hand — no CMS, no build step.

| URL | File | What it is |
|---|---|---|
| `/` | `index.html` | the catalog: cards for each section, sign-in, prices |
| `/genesis/` | `genesis/index.html` | the 10-day Genesis devotional itself |
| — | `shared/firebase-config.js` | sign-in, cloud sync, access checks |
| — | `shared/access-gate.js` | the paywall: Day 1 free, Days 2–10 paid |
| — | `shared/stripe-checkout.js` | sends the buyer to Stripe |

## The two commands

    ./preview.sh          # see the site at http://localhost:8099   (Ctrl+C stops it)
    ./deploy.sh           # publish pages, rules and functions to patriarchs.catholic.work
    ./deploy.sh hosting   # publish only the pages (skips the payment functions)
    ./deploy.sh functions # publish only the payment functions

After deploying, hard-refresh your browser with **Ctrl+Shift+R** — otherwise you
may keep seeing the old page from cache.

### Seeing the phone layout while you edit

- **On this computer** (easiest): with the preview running, press **F12** then
  **Ctrl+Shift+M** in Chrome. That gives you a phone-shaped viewport with a device
  picker.
- **On your actual phone**: `./preview.sh --lan` and open the address it prints on
  your phone, same Wi-Fi. Layout only — offline mode needs `https`, so test that
  on the live site.

## Editing the Genesis readings

Open `genesis/index.html` and search (`Ctrl+F`) for what you want to change.

| I want to change… | Search for |
|---|---|
| Browser-tab text and Google result title | `<title>` |
| The preview card when the link is pasted into WhatsApp/email | `og:title` |
| Site title, top-left | `THE PATRIARCHS' ALTAR` |
| Big heading + intro paragraph | `Catholic Men as Intercessors` |
| The 10-day Ignatian tooltip | `The 10-Day Ignatian Novena Rule` |
| The four summary cards | `10 Days` |
| Heading above the day buttons | `Curriculum Day Selection` |
| Chart-section heading | `Patriarchal Intercession & Theological Structure` |
| Chart axis words (radar) | `labels: ['Selfless Humility'` |
| Progress-chart legend | `labels: ['Scriptures Read'` |
| Notes heading and its two fields | `Patriarchal Intercessory Notes` |
| **Any specific day's wording** | `dayData` |
| The concluding prayers | `mandatoryPrayersHTML` |
| Small label above each day's work of mercy | `Demanding Practical Discipline` |
| Message when the 15-minute timer ends | `15-Minute Silent Kneeling Prayer Completed` |

Every one of those has a comment sitting right above it starting with
`===== EDIT:`. Search for `===== EDIT:` to tour everything editable in order.

### The 10 days

`dayData` holds all ten days, one block per day:

| Field | Appears as |
|---|---|
| `title` | the day's heading |
| `patriarch` | which filter button it belongs to (Abraham / Isaac / Jacob / Lot / Servant) |
| `passageRef` | scripture citation under the heading |
| `theme` | one-word tag |
| `radarScores` | four numbers 1–10, plotted on the radar chart |
| `scripture` | the quoted passage (Douay-Rheims) |
| `context` | "Biblical & Historical Context" paragraph |
| `furtherReading` | "Relevant Passages for Further Reading" |
| `theology` | "Moral and Spiritual" paragraph |
| `reflection` | "A Man's Reflection" paragraph |
| `prayer` | "Patriarchal Intercessory Prayer" |
| `charityTitle` / `charityDesc` | the work-of-mercy card |
| `disciplineDesc` | the concluding 15-minute kneeling prayer |

## The catalog page

`index.html` has one card per section. To launch Exodus, copy the Genesis card,
then change `data-section="genesis"` → `data-section="exodus"`, the heading, the
description and the price text. Nothing else is needed for the card to appear;
the paywall for that section is configured in `shared/access-gate.js` (see below).

## Payments and the paywall

- **Day 1 is free** for everyone, signed in or not. Days 2–10 need a $20
  one-time purchase.
- The price lives in **Stripe**, not in this code. Price ID
  `price_1UHxUqHTX26wVPOcfX816oKA` ($20, one-time) is stored in `functions/.env`
  as `STRIPE_PRICE_GENESIS`.
- After Stripe confirms payment, a Cloud Function writes
  `/users/{uid}/entitlements/sections` — a document the browser can read but
  **never write**. That is what keeps users from unlocking the site from the
  browser console.
- **To change the free preview length or the displayed price**, edit
  `freePreviewDays` / `price` in `SECTION_META` in `shared/access-gate.js`.
  (Displayed price and the real Stripe price are separate — change both.)
- **Existing users keep access forever**: their entitlement document carries
  `grandfathered: true`. Nothing in the payment path can revoke it.

To add a new purchasable section: create `functions/.env` entry
`STRIPE_PRICE_<SECTION>`, and add the section to the `SECTIONS` map at the top of
`functions/index.js`. Unknown sections are refused by the Cloud Function.

## Voice and tone (please keep to this)

The devotional is meant to be challenging, not brutal, and it must never read as
if a man earns his salvation by effort. That is the difference between a serious
Catholic devotional and something a bishop would have to write a letter about —
and between Catholic doctrine on grace and Pelagianism (the old heresy that we
save ourselves by willpower).

- **Grace before effort.** Discipline is a response to grace, never a payment
  for it. Say "by God's grace", "grace is given for this", "a response to grace",
  "not because your own strength can save him" — not "you must earn", "you owe",
  "this is required to merit".
- **Name the responsibility, drop the threat.** "A real responsibility" instead
  of "a non-negotiable moral demand"; "a neglect worth naming honestly" instead
  of "a grave moral failure".
- **No violence in the metaphors.** Words to avoid, with what to use instead:
  ruthlessly → steadily; grueling → unglamorous/demanding; violently → gently;
  relentlessly → faithfully/persistently; brutal, severe, stern, crushing →
  firm, serious, demanding.
- **No contempt for the reader.** Never "cowards", "the mob mentality",
  "degenerate culture", "toxic stoicism". Describe the temptation plainly
  ("the temptation is to withdraw") rather than labelling the man.
- **Works of mercy stay demanding** — kneeling, fasting, hidden service, hard
  conversations — but "as demanding as you can offer cheerfully", never
  "repulsing", "grueling", or "to the point of severe budget impact".
- **Keep the Catholic specifics**: penance, fasting, confession, the Eucharist,
  the common priesthood of fathers, the ordained priesthood, intercession. These
  are orthodox and they are the antidote to self-earned religion, so do not strip
  them out while softening the tone.
- **Scripture is never edited.** The `scripture` and `furtherReading` fields are
  Douay-Rheims and citations — leave them exactly as they are.

If you change any of this wording, bump `CACHE_VERSION` in `sw.js` so installed
phones pick up the new text.

## The app side (it installs and works offline)

- **Add to home screen** — each section has its own manifest, so installing from
  `/genesis/` gives a Genesis app; installing from `/` gives the catalog.
- **Works with no signal** — `sw.js` caches both pages plus the shared modules.
  Checkout and access-check calls (`/api/...`) are never cached.
- **Remembers where you were** — reopening returns you to the last day you read.
  Unpaid visitors are always returned to Day 1.

**If you change the readings and want installed copies to refresh:** open `sw.js`
and bump `const CACHE_VERSION = 'v7';` to `'v8'`. You do not need this for
ordinary edits to the catalog page.

## Five rules so you don't break the page

1. **Keep the quotes and backticks.** Day text is wrapped in backticks, labels in
   single quotes. Delete one and the page goes blank.
2. **Never rename the field names.** Change the text *after* the colon.
3. Apostrophes and quotation marks are safe inside day text.
4. **Preview with `./preview.sh` before you `./deploy.sh`.**
5. The `===== EDIT:` comments are invisible to visitors. Leave them in place.

## Files in this folder

| File | Purpose |
|---|---|
| `index.html` | the catalog / front door |
| `genesis/index.html` | the Genesis devotional (the big one you edit) |
| `shared/firebase-config.js` | sign-in, Firestore sync, `checkSectionAccess` |
| `shared/access-gate.js` | paywall behaviour + section metadata (price, preview days) |
| `shared/stripe-checkout.js` | starts a Stripe Checkout session |
| `functions/index.js` | Cloud Functions: create checkout + Stripe webhook |
| `functions/.env` | Stripe keys and price IDs — **gitignored, never commit** |
| `scripts/ensure_functions_public.py` | keeps the payment endpoints publicly reachable (run by deploy.sh) |
| `scripts/cleanup-verification-data.py` | removes the test users/data from the payment verification |
| `firebase.json` | deploy settings: headers, `/api/*` rewrites, redirects |
| `firestore.rules` | who may read/write progress and entitlements |
| `manifest.webmanifest`, `genesis/manifest.webmanifest` | installable-app metadata |
| `sw.js` | the offline service worker |
| `icon-*.png`, `favicon.png`, `apple-touch-icon.png`, `og-card.png` | icons and link preview |
| `preview.sh`, `deploy.sh` | preview and publish |
| `SETUP_GUIDE.md` | how the platform is wired: Firebase, Stripe, domains |
