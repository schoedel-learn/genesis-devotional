#!/usr/bin/env zsh
# Publish The Patriarchs' Altar to Firebase.
#
#   ./deploy.sh              -> hosting, then Firestore rules, then Cloud Functions
#   ./deploy.sh hosting      -> only the static site (fast; no functions)
#   ./deploy.sh functions    -> only the Cloud Functions (+ public-access check)
#
# Requires the Firebase CLI logged in as the account that owns the project
# (contact@schoedel.design) and functions/.env present with the Stripe keys.
#
# WHY THE STAGES ARE SEPARATE
# `firebase deploy --only hosting,firestore:rules,functions` releases hosting
# only after every other target succeeds. When the functions build failed, the
# site silently kept serving the previous pages while the command claimed the
# hosting files had been uploaded. Deploying hosting as its own stage means the
# published pages are never held hostage by a function build.
#
# Shell note: this script is zsh, like the workstation's login shell. The
# "${0:a:h}" expansion below is zsh-only (absolute path of this script's
# directory) — it is why the shebang must stay zsh.

set -u
cd "${0:a:h}" || exit 1

PROJECT="genesis-devotional"
DOMAIN="patriarchs.catholic.work"
TARGET="${1:-all}"
FAILURES=()

if ! command -v firebase >/dev/null 2>&1; then
  print -u2 "firebase CLI not found. Install it with: npm install -g firebase-tools"
  exit 1
fi

# --- Preflight -------------------------------------------------------------
# Node syntax-check every JavaScript file we are about to publish. A typo in a
# shared module would take the paywall down silently, so catch it here.
print "==> Syntax-checking JavaScript"
for f in shared/*.js sw.js functions/index.js; do
  if ! node --check "$f"; then
    print -u2 "Syntax error in $f"
    exit 1
  fi
done
print "    ok"

if [[ "$TARGET" == "all" || "$TARGET" == "functions" ]]; then
  if [[ ! -f functions/.env ]]; then
    print -u2 "functions/.env is missing."
    print -u2 "It must define STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_GENESIS."
    exit 1
  fi
  if [[ ! -d functions/node_modules ]]; then
    print "==> Installing Cloud Functions dependencies"
    npm --prefix functions ci --omit=dev || exit 1
  fi
  # Load the functions module the same way the deploy runtime does. This
  # catches API/version mistakes (e.g. a firebase-admin major that dropped a
  # method) in a second, instead of after a five-minute upload.
  print "==> Loading Cloud Functions module"
  if ! ( cd functions && set -a && . ./.env && set +a \
         && node -e 'const m = require("./index.js"); const names = Object.keys(m); if (!names.includes("createCheckoutSession") || !names.includes("stripeWebhook")) { console.error("expected createCheckoutSession and stripeWebhook, got", names); process.exit(1); } console.log("    ok:", names.join(", "));' ); then
    print -u2 "Cloud Functions module failed to load"
    exit 1
  fi
fi

# --- What is about to go live ---------------------------------------------
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain)" ]]; then
    print "==> Uncommitted changes going live:"
    git status --short
  else
    print "==> Working tree clean (publishing the committed version)"
  fi
fi

stage() {
  local label="$1"; shift
  print ""
  print "==> $label"
  if "$@"; then
    print "    ok: $label"
  else
    print -u2 "    FAILED: $label"
    FAILURES+=("$label")
  fi
}

# --- Publish --------------------------------------------------------------
# Hosting first: the pages go live even if a later stage fails.
if [[ "$TARGET" == "all" || "$TARGET" == "hosting" ]]; then
  stage "Publishing hosting" firebase deploy --only hosting --project "$PROJECT"
fi

if [[ "$TARGET" == "all" ]]; then
  stage "Publishing Firestore rules" \
    firebase deploy --only firestore:rules --project "$PROJECT"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "functions" ]]; then
  stage "Publishing Cloud Functions" \
    firebase deploy --only functions --project "$PROJECT"

  # Cloud Run sits in front of every 2nd-gen function and will answer Google
  # 403 pages unless its invoker check is disabled. `firebase deploy` does not
  # do this, and a redeploy can leave it off, so verify it every time.
  stage "Verifying functions are publicly invocable" \
    python3 scripts/ensure_functions_public.py
fi

# --- Summary --------------------------------------------------------------
print ""
if (( ${#FAILURES[@]} > 0 )); then
  print -u2 "==> Deploy finished WITH FAILURES:"
  for f in "${FAILURES[@]}"; do
    print -u2 "      - $f"
  done
  print -u2 ""
  print -u2 "Retry a single stage with:  ./deploy.sh functions"
  print -u2 "                            ./deploy.sh hosting"
  exit 1
fi

print "==> Live at https://$DOMAIN/"
print "    Genesis section: https://$DOMAIN/genesis/"
print "    Hard-refresh your browser (Ctrl+Shift+R) to see the change."
