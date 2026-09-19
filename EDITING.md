# Editing The Patriarchs' Altar

The entire site is **one file**: `index.html`. No CMS, no build step, no database
of pages. Open it in any text editor and search (`Ctrl+F`) for the thing you want
to change.

## The two commands

    ./preview.sh      # see your edits at http://localhost:8099   (Ctrl+C stops it)
    ./deploy.sh       # publish to https://genesis.catholic.work

After deploying, hard-refresh your browser with **Ctrl+Shift+R** — otherwise you
may keep seeing the old page from cache.

## What to change, and what to search for

| I want to change… | Search for |
|---|---|
| Browser-tab text and Google result title | `<title>` |
| The preview card when the link is pasted into WhatsApp/email | `og:title` and `og:description` |
| Site title, top-left | `THE PATRIARCHS' ALTAR` |
| The small line under it | `Catholic Practices to Strengthen Patriarchs` |
| Big heading + intro paragraph | `Catholic Men as Intercessors Through Genesis` |
| The novena explainer box | `The 10-Day Ignatian Novena Rule` |
| The four summary cards | `10 Days` |
| Heading above the day buttons | `Curriculum Day Selection` |
| Chart-section heading | `Patriarchal Intercession & Theological Structure` |
| Chart axis words (radar) | `labels: ['Selfless Humility'` |
| Progress-chart legend | `labels: ['Scriptures Read'` |
| Journal heading and its two fields | `Patriarchal Intercessory Journal` |
| Footer lines | `A Theological & Scriptural Framework` |
| **Any specific day's wording** | `dayData` |
| The concluding prayers | `mandatoryPrayersHTML` |
| Small label above each day's work of mercy | `Demanding Practical Discipline` |
| Message when the 15-minute timer ends | `15-Minute Silent Kneeling Prayer Completed` |

Every one of those has a comment sitting right above it that starts with
`===== EDIT:`. Search for `===== EDIT:` to jump through them all in order — that
is the fastest tour of everything editable.

## The 10 days

`dayData` holds all ten days, one block per day. Each block looks like this, and
the field names tell you what each piece of text becomes:

| Field | Appears as |
|---|---|
| `title` | the day's heading |
| `patriarch` | which filter button it belongs to (Abraham / Isaac / Jacob / Lot / Servant) |
| `passageRef` | scripture citation under the heading |
| `theme` | one-word tag |
| `radarScores` | four numbers 1–10, plotted on the radar chart |
| `scripture` | the quoted passage (Douay-Rheims) |
| `context` | "Biblical & Historical Context" paragraph |
| `theology` | "Theological Significance & Typology" paragraph |
| `reflection` | "A Man's Reflection" paragraph |
| `prayer` | "Prescribed Intercessory Prayer" |
| `charityTitle` / `charityDesc` | the work-of-mercy card |
| `disciplineDesc` | the concluding 15-minute kneeling prayer |

## The app side (it installs and works offline)

The site is a real installable app now:

- **Add to home screen** — visitors on a phone see a small "Add to your home screen" bar. They tap Install once and it opens full-screen with no browser chrome, like a native app. The bar hides itself once installed, and the ✕ dismisses it for good.
- **Works with no signal** — a service worker (`sw.js`) saves the whole app the first time it is opened. After that, readings, the prayers, the 15-minute timer, the day buttons and the journal all work offline. Your progress is stored on the device either way.
- **Remembers where you were** — reopening the app returns you to the last day you were reading.
- **Bottom bar on phones** — Prev / Next and a "Day 3 of 10 · 1 of 3 done" readout sit fixed at the bottom, so you can move between days without scrolling back up.

**If you change the readings and want the offline copy refreshed:** open `sw.js` and change

    const CACHE_VERSION = 'v2';

to `'v3'` (or any new value). That tells every installed copy to download the
new version instead of serving the old one. You do **not** need to do this for
ordinary edits — only when you want phones that already installed the app to
pick up the change.

## Five rules so you don't break the page

1. **Keep the quotes and backticks.** Day text is wrapped in backticks and labels
   in single quotes. Delete one and the page goes blank.
2. **Never rename the field names.** The code looks for `title:`, `charityDesc:`,
   `scripture:` and so on. Change the text *after* the colon, not the name.
3. Apostrophes and quotation marks are safe inside day text.
4. **Preview with `./preview.sh` before you `./deploy.sh`.**
5. The `===== EDIT:` comments are invisible to visitors. Leave them in place for
   next time.

## Files in this folder

| File | Purpose |
|---|---|
| `index.html` | the entire site — the one you edit |
| `firebase.json` | deploy settings: ignore list, no-cache header, old-URL redirect |
| `firestore.rules` | who may read/write each user's saved progress |
| `manifest.webmanifest` | makes the app installable: its name, colours, icons |
| `sw.js` | the offline service worker (see "The app side" above) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | home-screen app icons |
| `favicon.png`, `apple-touch-icon.png` | tab and iPhone home-screen icon |
| `og-card.png` | the image shown in link previews |
| `preview.sh`, `deploy.sh` | preview and publish |
| `SETUP_GUIDE.md` | original Firebase setup notes (historical reference) |
