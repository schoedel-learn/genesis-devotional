#!/usr/bin/env python3
"""Remove the verification data left behind by the 2026-09-21 access/payment tests.

What it deletes
---------------
1. Three throwaway Firebase Auth users created to exercise the paywall.
2. Their Firestore documents (profile, purchases, entitlements) and their
   entries in the shared cohort.
3. The temporary IAM binding that let this workstation mint test sessions:
   roles/iam.serviceAccountTokenCreator for user:contact@schoedel.design on the
   default compute service account.

What it must NEVER delete
-------------------------
The entitlement of the real pre-existing user (lCfeWLEgJ1QCwFrBDEDMAdBat8G3).
That document carries grandfathered: true and is what keeps their access. The
script refuses to run if that uid ever appears in the delete list.

Credentials: the Firebase CLI session for this project (firebase login --reauth
if it has expired). No secret values are printed.

Usage:
    python3 scripts/cleanup-verification-data.py --dry-run     # default
    python3 scripts/cleanup-verification-data.py --apply
"""
from __future__ import annotations

import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ensure_functions_public import access_token  # noqa: E402  (same directory)

PROJECT = "genesis-devotional"
PROJECT_NUMBER = "680090594132"

# Firebase Auth users created only for verification.
TEST_UIDS = [
    "verify-altar-1648c9a8",        # purchased via a signed webhook replay
    "verify-altar-gate-baa146",     # paywall gate tests (purchased + grandfathered variants)
]
TEST_UID_PREFIXES = ["verify-altar-unpaid-"]   # minted but never signed in
PROTECTED_UIDS = ["lCfeWLEgJ1QCwFrBDEDMAdBat8G3"]  # the real grandfathered user

GROUP_IDS = ["open-brotherhood"]
TEMP_SA = f"{PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
TEMP_MEMBER = "user:contact@schoedel.design"
TEMP_ROLE = "roles/iam.serviceAccountTokenCreator"


def call(url: str, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


def main() -> int:
    apply_changes = "--apply" in sys.argv
    token = access_token()
    if not token:
        print("No usable Firebase CLI credential. Run: firebase login --reauth")
        return 1

    # Safety: never touch the real user.
    clash = set(TEST_UIDS) & set(PROTECTED_UIDS)
    if clash:
        print(f"REFUSING TO RUN: protected uid in the delete list: {clash}")
        return 1

    # --- 1. which auth users actually exist ---------------------------------
    st, res = call(f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:query",
                   method="POST", body={}, token=token)
    known = []
    if st == 200:
        for u in res.get("userInfo", []):
            known.append(u.get("localId"))
    else:
        print(f"  could not list auth users ({st}); continuing with the recorded uids")

    targets = list(TEST_UIDS)
    if known:
        for uid in known:
            if any(uid.startswith(p) for p in TEST_UID_PREFIXES) and uid not in targets:
                targets.append(uid)
    targets = [u for u in targets if u not in PROTECTED_UIDS]
    print("Auth users to delete:")
    for uid in targets:
        print(f"   {uid}  (present in project: {uid in known if known else 'unknown'})")

    print("\nFirestore documents to delete:")
    for uid in targets:
        for path in [f"users/{uid}",
                     f"users/{uid}/entitlements/sections",
                     *[f"users/{uid}/purchases/{s}" for s in ["cs_live_a1INHBspi5eoMQDuR2VLHXm6hZotZ1cAroYQL9MYf0YUIB3bwq0mL1yZN5"]],
                     *[f"groups/{g}/members/{uid}" for g in GROUP_IDS]]:
            print(f"   {path}")

    print(f"\nIAM binding to remove:\n   {TEMP_ROLE} -> {TEMP_MEMBER} on {TEMP_SA}")

    if not apply_changes:
        print("\nDry run only. Re-run with --apply to make these changes.")
        return 0

    # --- 2. delete auth users ----------------------------------------------
    if targets:
        st, res = call(f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:delete",
                       method="POST", body={"localIds": targets}, token=token)
        print(f"\ndelete auth users -> {st} {str(res)[:120]}")
        if st != 200:
            return 1

    # --- 3. delete firestore documents -------------------------------------
    deleted, failed = 0, []
    for uid in targets:
        paths = [f"users/{uid}/entitlements/sections"] + \
                [f"users/{uid}/purchases/{s}" for s in
                 ["cs_live_a1INHBspi5eoMQDuR2VLHXm6hZotZ1cAroYQL9MYf0YUIB3bwq0mL1yZN5"]] + \
                [f"groups/{g}/members/{uid}" for g in GROUP_IDS] + \
                [f"users/{uid}"]
        for path in paths:
            st, body = call(f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
                            f"/databases/(default)/documents/{path}", method="DELETE", token=token)
            if st in (200, 404):
                deleted += 1
            else:
                failed.append((path, st, body))
    print(f"firestore deletes: {deleted} ok, {len(failed)} failed")
    for path, st, body in failed:
        print(f"   {path} -> {st} {str(body)[:100]}")

    # --- 4. remove the temporary IAM binding -------------------------------
    sa_url = f"https://iam.googleapis.com/v1/projects/{PROJECT}/serviceAccounts/{TEMP_SA}"
    st, policy = call(sa_url + ":getIamPolicy", method="POST", body={}, token=token)
    if st != 200:
        print(f"  could not read the service-account policy ({st}) - remove the binding by hand")
        return 1
    bindings = policy.get("bindings", [])
    kept, removed = [], False
    for b in bindings:
        if b.get("role") == TEMP_ROLE and TEMP_MEMBER in b.get("members", []):
            b["members"] = [m for m in b["members"] if m != TEMP_MEMBER]
            removed = True
            if not b["members"]:
                continue
        kept.append(b)
    if not removed:
        print("  binding was already absent")
    else:
        st, res = call(sa_url + ":setIamPolicy", method="POST",
                       body={"policy": {"bindings": kept, "etag": policy.get("etag")}}, token=token)
        print(f"  remove token-creator binding -> {st}")
        st, check = call(sa_url + ":getIamPolicy", method="POST", body={}, token=token)
        still_there = any(b.get("role") == TEMP_ROLE and TEMP_MEMBER in b.get("members", [])
                          for b in check.get("bindings", [])) if st == 200 else "unknown"
        print(f"  binding still present: {still_there}")

    print("\nDone. Verify with:")
    print(f"  - project access check: python3 scripts/ensure-functions-public.py --check")
    print(f"  - the real user keeps access: their entitlement doc is untouched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
