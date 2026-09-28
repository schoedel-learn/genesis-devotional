#!/usr/bin/env python3
"""Make the deployed Cloud Functions reachable from the browser and from Stripe.

Why this exists
---------------
A 2nd-generation Cloud Function is a Cloud Run service underneath. Cloud Run
puts its own authentication gate *in front of* our code, so a function that is
perfectly correct still answers every anonymous request with Google's HTML
"403 Forbidden" page. This project cannot use the usual `allUsers` binding
because an organization policy refuses it ("One or more users named in the
policy do not belong to a permitted customer"), so the equivalent switch is
Cloud Run's `invokerIamDisabled`, set through

    gcloud run services update <service> --no-invoker-iam-check

`firebase deploy` does not set this, and a redeploy can leave it unset, which
silently breaks /api/create-checkout (checkout stops working) and
/api/stripe-webhook (customers pay and get nothing). So deploy.sh runs this
after every functions deploy and treats a failure as a real failure.

Credentials: the same Firebase CLI session that performed the deploy is reused,
so no separate gcloud login is needed. The token is passed to gcloud through the
environment and is never printed.

Usage:
    python3 scripts/ensure-functions-public.py            # enforce
    python3 scripts/ensure-functions-public.py --check     # report only
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

PROJECT = "genesis-devotional"
REGION = "us-central1"
SERVICES = ["createcheckoutsession", "stripewebhook"]   # Cloud Run service names
CONFIG = pathlib.Path.home() / ".config" / "configstore" / "firebase-tools.json"
FIREBASE_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
FIREBASE_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi"
REPO = pathlib.Path(__file__).resolve().parent.parent


def active_email() -> str | None:
    """Which Firebase CLI account is active for this project directory."""
    try:
        cfg = json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        return None
    # The CLI pins an account per directory, e.g.
    # "activeAccounts": {"/path/to/repo": "contact@schoedel.design"}
    for path, email in (cfg.get("activeAccounts") or {}).items():
        try:
            if pathlib.Path(path).resolve() == REPO:
                return email
        except OSError:
            continue
    accounts = cfg.get("additionalAccounts") or []
    if len(accounts) == 1 and accounts[0].get("user", {}).get("email"):
        return accounts[0]["user"]["email"]
    return cfg.get("user", {}).get("email")


def account_tokens(email: str | None) -> dict | None:
    try:
        cfg = json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        return None
    if email and cfg.get("user", {}).get("email") == email:
        return cfg.get("tokens")
    for acct in cfg.get("additionalAccounts") or []:
        if acct.get("user", {}).get("email") == email:
            return acct.get("tokens")
    return cfg.get("tokens")


def access_token() -> str | None:
    """A live access token for the CLI's active account (refresh only if stale)."""
    email = active_email()
    tokens = account_tokens(email)
    if not tokens:
        return None
    fresh = tokens.get("access_token")
    if fresh and tokens.get("expires_at", 0) > time.time() * 1000 + 60_000:
        return fresh
    refresh = tokens.get("refresh_token")
    if not refresh:
        return None
    body = urllib.parse.urlencode({
        "client_id": FIREBASE_CLIENT_ID,
        "client_secret": FIREBASE_CLIENT_SECRET,
        "refresh_token": refresh,
        "grant_type": "refresh_token",
    }).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request("https://oauth2.googleapis.com/token", data=body), timeout=30
        ) as resp:
            return json.load(resp)["access_token"]
    except Exception as err:                      # noqa: BLE001 - report, don't crash the deploy
        print(f"  could not refresh the Firebase CLI token for {email}: {err}")
        print("  run: firebase login --reauth")
        return None


def invoker_state(token: str, service: str) -> bool | None:
    """True when the service is publicly invocable. None if it cannot be read."""
    url = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/{service}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp).get("invokerIamDisabled") is True
    except Exception:                             # noqa: BLE001
        return None


def main() -> int:
    check_only = "--check" in sys.argv
    if shutil.which("gcloud") is None:
        print("  gcloud not found; cannot enforce public invoker access")
        return 1

    token = access_token()
    if not token:
        print("  no usable Firebase CLI credential; run: firebase login --reauth")
        return 1

    failures = []
    for service in SERVICES:
        state = invoker_state(token, service)
        if state is True:
            print(f"  {service}: already publicly invocable")
            continue
        if state is None:
            print(f"  {service}: could not read its state (does it exist yet?)")
            failures.append(service)
            continue
        if check_only:
            print(f"  {service}: NOT publicly invocable (would fix)")
            failures.append(service)
            continue

        env = dict(os.environ, CLOUDSDK_AUTH_ACCESS_TOKEN=token)
        proc = subprocess.run(
            ["gcloud", "run", "services", "update", service,
             f"--region={REGION}", f"--project={PROJECT}",
             "--no-invoker-iam-check", "--quiet"],
            capture_output=True, text=True, env=env, timeout=300,
        )
        ok = proc.returncode == 0 and invoker_state(token, service) is True
        print(f"  {service}: {'now publicly invocable' if ok else 'FAILED'}")
        if not ok:
            failures.append(service)
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()
            for line in tail[-3:]:
                print(f"      {line}")

    if failures:
        print(f"  MISSING PUBLIC ACCESS: {', '.join(failures)}")
        print("  /api/create-checkout and /api/stripe-webhook will answer Google 403 pages")
        print("  until this is fixed. No secret values are involved.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
