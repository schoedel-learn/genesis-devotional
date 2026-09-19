#!/usr/bin/env zsh
# Publish The Patriarchs' Altar to Firebase Hosting.
#   ./deploy.sh     -> uploads index.html + assets to https://genesis.catholic.work
# Requires the Firebase CLI logged in as the account that owns the project.

cd "${0:a:h}" || exit 1

if ! command -v firebase >/dev/null 2>&1; then
  print -u2 "firebase CLI not found. Install it with: npm install -g firebase-tools"
  exit 1
fi

# Show what is about to go live, so nothing is published by surprise.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain)" ]]; then
    print "==> Uncommitted changes going live:"
    git status --short
  else
    print "==> Working tree clean (publishing the committed version)"
  fi
fi

print ""
print "==> Publishing to Firebase Hosting (project genesis-devotional)"
if ! firebase deploy --only hosting --project genesis-devotional; then
  print -u2 ""
  print -u2 "Deploy failed. If it is a login error, run:"
  print -u2 "  firebase login:add contact@schoedel.design"
  exit 1
fi

print ""
print "==> Live at https://genesis.catholic.work/"
print "    Hard-refresh your browser (Ctrl+Shift+R) to see the change."
