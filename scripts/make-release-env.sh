#!/bin/bash
#
# Copyright 2026 Jason Figge
#
# This file is part of Hippo Herd.
#
# Hippo Herd is free software: you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free
# Software Foundation, either version 3 of the License, or (at your option)
# any later version.
#
# Hippo Herd is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
# FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
# more details.
#
# You should have received a copy of the GNU General Public License along
# with Hippo Herd. If not, see <https://www.gnu.org/licenses/>.
#
# make-release-env.sh — write release.env, the macOS signing and notarization
# credentials `make dist-mac` reads (release.env.example has the background).
#
#   scripts/make-release-env.sh path/to/DeveloperID.p12 [out-file]
#
# The one thing it cannot do for you is export the certificate: export JUST the
# "Developer ID Application" identity from Keychain Access as a .p12 first (see
# the usage text below). From that file and three answers it:
#
#   1. checks the .p12 opens with its password, holds a Developer ID
#      Application certificate, and has not expired;
#   2. reads the Team ID from the certificate;
#   3. asks for your Apple ID and an app-specific password, and checks them
#      with Apple's notary service (xcrun notarytool history);
#   4. writes CSC_LINK (the .p12, base64), CSC_KEY_PASSWORD, APPLE_ID,
#      APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID to release.env, mode 600.
#
# Nothing secret is echoed. Bash 3.2 (macOS's own) is enough.

set -eu

# LibreSSL, not a Homebrew OpenSSL 3: macOS exports .p12 files with RC2, which
# OpenSSL 3 refuses without -legacy.
OPENSSL=/usr/bin/openssl

usage() {
  cat <<'EOF'
usage: scripts/make-release-env.sh <DeveloperID.p12> [out-file, default ./release.env]

First export the certificate:
  1. Open Keychain Access → login keychain → "My Certificates".
  2. Find "Developer ID Application: <your name> (<TEAMID>)". Expand it to check
     a private key sits under it; without one, this Mac cannot sign.
  3. Right-click the certificate (not the key) → Export… → format
     "Personal Information Exchange (.p12)" → save, e.g. ~/Desktop/DeveloperID.p12.
  4. Choose an export password. That becomes CSC_KEY_PASSWORD. Avoid '$' and
     '#': make reads release.env and treats them specially.

Have an app-specific password ready as well:
  account.apple.com → Sign-In and Security → App-Specific Passwords → "+".
  Apple shows it only once (format xxxx-xxxx-xxxx-xxxx).
EOF
}

die() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

[ $# -ge 1 ] || { usage; exit 2; }
case "$1" in -h|--help) usage; exit 0 ;; esac

P12=$1
OUT=${2:-release.env}
[ -f "$P12" ] || die "No such file: $P12"
if [ -e "$OUT" ]; then
  printf '%s already exists. Overwrite it? [y/N] ' "$OUT"
  read -r answer
  case "$answer" in y|Y|yes) ;; *) die "Left $OUT alone." ;; esac
fi

# ── 1. The certificate ───────────────────────────────────────────────────────
printf 'Export password of %s: ' "$P12"
read -rs CSC_KEY_PASSWORD; echo
export CSC_KEY_PASSWORD
case "$CSC_KEY_PASSWORD" in *'$'*|*'#'*) die "The password contains '\$' or '#', which make mangles. Re-export with another." ;; esac

cert=$($OPENSSL pkcs12 -in "$P12" -clcerts -nokeys -passin env:CSC_KEY_PASSWORD 2>/dev/null) \
  || die "Could not open $P12: wrong password, or not a .p12."
$OPENSSL pkcs12 -in "$P12" -nocerts -nodes -passin env:CSC_KEY_PASSWORD 2>/dev/null | grep -q "PRIVATE KEY" \
  || die "$P12 has no private key. Export the certificate from 'My Certificates', where the key sits under it."

subject=$(printf '%s\n' "$cert" | $OPENSSL x509 -noout -subject)
case "$subject" in
  *"Developer ID Application"*) ;;
  *) die "Not a Developer ID Application certificate: $subject" ;;
esac
printf '%s\n' "$cert" | $OPENSSL x509 -noout -checkend 0 >/dev/null \
  || die "The certificate has expired. Make a new one at developer.apple.com → Certificates."
expires=$(printf '%s\n' "$cert" | $OPENSSL x509 -noout -enddate | cut -d= -f2)
name=$(printf '%s\n' "$subject" | sed -E 's/.*CN ?= ?([^,/]*).*/\1/')
ok "Certificate: $name (expires $expires)"

# ── 2. The Team ID: the ten characters in brackets at the end of the name ────
APPLE_TEAM_ID=$(printf '%s\n' "$name" | sed -nE 's/.*\(([A-Z0-9]{10})\)[[:space:]]*$/\1/p')
[ -n "$APPLE_TEAM_ID" ] || die "Could not read the Team ID from \"$name\"."
ok "Team ID: $APPLE_TEAM_ID"

# ── 3. Notarization ──────────────────────────────────────────────────────────
printf 'Apple ID (the developer account email): '
read -r APPLE_ID
[ -n "$APPLE_ID" ] || die "An Apple ID is needed to notarize."
printf 'App-specific password (xxxx-xxxx-xxxx-xxxx): '
read -rs APPLE_APP_SPECIFIC_PASSWORD; echo
[ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] || die "An app-specific password is needed to notarize."

echo "Checking those with Apple's notary service…"
if xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" \
     --team-id "$APPLE_TEAM_ID" >/dev/null 2>&1; then
  ok "Apple accepted the notarization credentials"
else
  die "Apple refused them. Check the Apple ID, the app-specific password, and that the account is on team $APPLE_TEAM_ID."
fi

# ── 4. release.env ───────────────────────────────────────────────────────────
CSC_LINK=$(base64 -i "$P12" | tr -d '\n')
umask 077
cat > "$OUT" <<EOF
# ViewHippo signing credentials, written by scripts/make-release-env.sh on $(date +%F).
# Git-ignored. Never commit. See release.env.example for what each one does.
# Certificate: $name, expires $expires

CSC_LINK=$CSC_LINK
CSC_KEY_PASSWORD=$CSC_KEY_PASSWORD

APPLE_ID=$APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD=$APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID=$APPLE_TEAM_ID
EOF
chmod 600 "$OUT"
ok "Wrote $OUT (mode 600)"

cat <<EOF

Next:
  make dist-mac          # signed + notarized .dmg files in build/electron/dist/
  make sync-mac          # optional: copy these to the GitHub Actions secrets

You can delete $P12 now: release.env holds a copy of it.
EOF
