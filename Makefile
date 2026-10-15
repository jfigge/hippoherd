# ─────────────────────────────────────────────────────────────────────────────
#  hippoherd.com, and ViewHippo — the desktop app that hosts the herd's viewers
#
#  The site needs none of this: it is plain Node with no dependencies (see the
#  README), and its workflow never runs make. This Makefile is the desktop
#  app's, which packages the viewers already published under website/ —
#  JsonHippo, YamlHippo and MarkHippo — inside an Electron shell (electron/).
# ─────────────────────────────────────────────────────────────────────────────
#
# Recipes stick to POSIX sh and to what GNU make 3.81 (the one macOS ships)
# understands, so every target runs unchanged on macOS and Linux — and, for the
# desktop targets, on Windows under MSYS2, which is how the Release workflow
# runs them there. JsonHippo's Makefile, which this one follows.

WORKSPACE := $(realpath $(dir $(realpath $(firstword $(MAKEFILE_LIST)))))
WEB_DIR   := $(WORKSPACE)/website
BUILD_DIR := $(WORKSPACE)/build

# electron/ holds the shell and its own package.json, so Electron and
# electron-builder (~400 MB once Electron has fetched its binary) are installed
# only by these targets, never by the site. A build is staged in
# build/electron/ — the shell, plus the viewers as web/<id>/ — and packaged
# from there; installers land in build/electron/dist/.
ELECTRON_DIR := $(WORKSPACE)/electron
DESKTOP_DIR  := $(BUILD_DIR)/electron

# The one version number is electron/package.json's. The Release workflow
# publishes v<it> the first time main is pushed with it.
VERSION := $(shell cd "$(ELECTRON_DIR)" && node -p "require('./package.json').version" 2>/dev/null)

# ── Release signing environment ───────────────────────────────────────────────
# The same variables, read the same way, as Rest Hippo's and JsonHippo's
# Makefiles: credentials for SIGNED installers, all optional — with none set,
# electron-builder emits unsigned artifacts and skips notarization. Locally they
# come from release.env (git-ignored; see release.env.example). The
# certificates are the herd's, so the file a sibling already has works:
#
#     make dist-mac RELEASE_ENV=../resthippo/release.env
#
# In CI the same names come from repository secrets (.github/workflows/release.yml).
#
# Each is exported only when set AND non-empty, and unexported otherwise: an
# EMPTY CSC_LINK reads to electron-builder as "a certificate was given", and
# fails the build with "… not a file". `$(value …)` keeps the secret itself out
# of make's expansion.
RELEASE_ENV ?= $(WORKSPACE)/release.env
RELEASE_ENV_VARS := CSC_LINK CSC_KEY_PASSWORD CSC_IDENTITY_AUTO_DISCOVERY \
                    APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID \
                    APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER \
                    WIN_CSC_LINK WIN_CSC_KEY_PASSWORD
-include $(RELEASE_ENV)
$(foreach v,$(RELEASE_ENV_VARS),$(if $(strip $(value $(v))),$(eval export $(v)),$(eval unexport $(v))))

# Strip every credential from one electron-builder call and turn off keychain
# discovery, so the result is unsigned whatever release.env or the keychain
# holds. Paired with -c.mac.notarize=false where it is used.
UNSIGNED_ENV := env $(foreach v,$(filter-out CSC_IDENTITY_AUTO_DISCOVERY,$(RELEASE_ENV_VARS)),-u $(v)) CSC_IDENTITY_AUTO_DISCOVERY=false

# ── Mac App Store ─────────────────────────────────────────────────────────────
# Rest Hippo's MAS setup, for Rest Hippo's reasons (its Makefile has the long
# version). In short: MAS builds sign with the Apple Distribution / Mac
# Installer Distribution identities, never the Developer ID .p12 that
# release.env's CSC_LINK names — so locally CSC_LINK is stripped and keychain
# discovery picks the MAS certificates, pinned to the team by MAS_CSC_NAME. In
# CI the store-mas job supplies the MAS certificates as CSC_LINK /
# CSC_INSTALLER_LINK and sets MAS_PROVISIONING_PROFILE_BASE64; that marker
# keeps them.
ifeq ($(strip $(MAS_PROVISIONING_PROFILE_BASE64)),)
MAS_SIGN_ENV := env -u CSC_LINK -u CSC_KEY_PASSWORD CSC_IDENTITY_AUTO_DISCOVERY=true
else
MAS_SIGN_ENV :=
endif
MAS_CSC_NAME ?= Jason Figge (2C564TQ2FY)

# The provisioning profiles are per-developer FILES, never committed: drop them
# here (git-ignored). Without one, its target skips rather than fails.
MAS_PROFILE     := $(ELECTRON_DIR)/packaging/embedded.provisionprofile
MAS_DEV_PROFILE := $(ELECTRON_DIR)/packaging/development.provisionprofile

# app-builder-lib passes a custom entitlements path to codesign unresolved, and
# codesign runs from another directory (Rest Hippo's Makefile again), so the
# MAS targets give it absolute paths.
MAS_ENTITLEMENTS         := $(DESKTOP_DIR)/packaging/entitlements.mas.plist
MAS_ENTITLEMENTS_INHERIT := $(DESKTOP_DIR)/packaging/entitlements.mas.inherit.plist

.DEFAULT_GOAL := help

.PHONY: help test desktop debug desktop-setup desktop-pack dist-mac dist-linux dist-win \
        dist-mas mas-dev icons sync-mac clean

help:
	@echo ""
	@echo "  Hippo Herd — the site, and ViewHippo, the desktop app hosting the herd's viewers"
	@echo ""
	@echo "  The site needs no make: see the README (node scripts/build-site.mjs, …)."
	@echo ""
	@echo "  Desktop (Electron):"
	@echo "    test          Unit tests for the shell's routing and policy (node --test)"
	@echo "    desktop       Run the shell on website/ in place (no packaging)"
	@echo "    debug         desktop, with DevTools, the main-process inspector on"
	@echo "                  INSPECT (9229), and hot reload of viewers and the shell"
	@echo "    desktop-pack  Unsigned app for this machine, no installer (smoke test)"
	@echo "    dist-mac      macOS .dmg, arm64 + x64 — signed and notarized when the"
	@echo "                  credentials are set (RELEASE_ENV=…, default ./release.env)"
	@echo "    dist-win      Windows installers, x64 + arm64 (CI builds them on Windows)"
	@echo "    dist-linux    Linux AppImages, x64 + arm64 (CI builds them on Linux)"
	@echo "    dist-mas      Mac App Store .pkg, universal (skips without"
	@echo "                  electron/packaging/embedded.provisionprofile)"
	@echo "    mas-dev       Sandboxed MAS development build to run locally (skips"
	@echo "                  without electron/packaging/development.provisionprofile)"
	@echo "    icons         Re-render the app icons from website/favicon.svg"
	@echo "    sync-mac      Push the macOS signing credentials from RELEASE_ENV to"
	@echo "                  this repo's GitHub Actions secrets (needs gh)"
	@echo "    clean         Remove build/"
	@echo ""
	@echo "  Viewers in this checkout:"
	@for v in jsonhippo yamlhippo markhippo; do \
		if [ -f "$(WEB_DIR)/$$v/index.html" ]; then echo "    ✓ $$v"; else echo "    – $$v (not published here yet)"; fi; \
	done
	@echo ""

test:
	node --test test/*.test.mjs

clean:
	rm -rf "$(BUILD_DIR)"

# ── Desktop (Electron) ───────────────────────────────────────────────────────

# npm ci only re-runs when the lockfile changes; the touch stops make from
# re-running it because node_modules/ is older than package-lock.json.
electron/node_modules: electron/package.json electron/package-lock.json
	cd "$(ELECTRON_DIR)" && npm ci --no-audit --no-fund
	@touch "$(ELECTRON_DIR)/node_modules"

# Run the shell straight from electron/ against website/, so a viewer's
# `make site` shows up on View → Reload Viewer (⌘R) without restarting, and
# the document stays. DevTools and Reload are in the View menu in this mode
# only. Files named after `ARGS=` open at launch.
desktop: electron/node_modules
	cd "$(ELECTRON_DIR)" && VIEWHIPPO_WEB_DIR="$(WEB_DIR)" npx electron . $(ARGS)

# `desktop` for debugging (electron/debug.js has the details):
#   * DevTools open in every window, docked per DEVTOOLS (right, bottom,
#     undocked, detach, or none), and each viewer's console echoed here;
#   * the main process's inspector on INSPECT, for VS Code's "Attach" or
#     chrome://inspect;
#   * hot reload: a change under website/<id>/ (a viewer's `make site`)
#     reloads that viewer's windows with their documents, and an edit to
#     electron/*.js restarts the shell, which reopens the documents, unsaved
#     edits included.
# The loop is the restart: the shell exits with 75 to be run again (debug.js
# RESTART_EXIT_CODE), and any other exit, ⌘Q or Ctrl-C included, ends it.
INSPECT  ?= 9229
DEVTOOLS ?= right
debug: electron/node_modules
	@cd "$(ELECTRON_DIR)" && while :; do \
		VIEWHIPPO_WEB_DIR="$(WEB_DIR)" VIEWHIPPO_DEBUG=1 VIEWHIPPO_DEVTOOLS="$(DEVTOOLS)" \
			npx electron --inspect=$(INSPECT) . $(ARGS); \
		rc=$$?; \
		[ $$rc -eq 75 ] || exit $$rc; \
	done

# Stage a packageable copy in build/electron/: the shell, its dependencies, and
# the viewers (scripts/stage-desktop.mjs). Rebuilt from scratch every time.
desktop-setup:
	@test -n "$(VERSION)" || { echo "Could not read the version from electron/package.json."; exit 1; }
	rm -rf "$(DESKTOP_DIR)"
	mkdir -p "$(DESKTOP_DIR)"
	rsync -a --exclude node_modules --exclude dist --exclude .DS_Store "$(ELECTRON_DIR)/" "$(DESKTOP_DIR)/"
	node scripts/stage-desktop.mjs "$(DESKTOP_DIR)"
	cd "$(DESKTOP_DIR)" && npm ci --no-audit --no-fund

# A fast, unsigned `--dir` package for this machine: the whole electron-builder
# pack (asar, file list, icons) without an installer or any signing.
desktop-pack: desktop-setup
	cd "$(DESKTOP_DIR)" && $(UNSIGNED_ENV) npx electron-builder --dir --publish never -c.mac.notarize=false
	@echo "  → $(DESKTOP_DIR)/dist/"

# The release installers, one recipe per platform — the entry points the
# Release workflow runs, each on its own platform's runner.
#
# Signing follows the environment and is never forced off here: with
# CSC_LINK/CSC_KEY_PASSWORD set, the macOS app is signed with that Developer ID
# certificate, and with Apple's notarization credentials as well it is
# notarized and stapled. Without CSC_LINK, electron-builder signs with a
# Developer ID identity from the login keychain if it finds one, and builds
# unsigned if not; CSC_IDENTITY_AUTO_DISCOVERY=false forces unsigned.
dist-mac: desktop-setup
	cd "$(DESKTOP_DIR)" && npx electron-builder --mac --publish never
	@echo "  → $(DESKTOP_DIR)/dist/"

dist-linux: desktop-setup
	cd "$(DESKTOP_DIR)" && npx electron-builder --linux --publish never
	@echo "  → $(DESKTOP_DIR)/dist/"

# Windows signing happens in CI, out of band (SignPath, see release.yml), not
# here — unless WIN_CSC_LINK names a code-signing certificate.
dist-win: desktop-setup
	cd "$(DESKTOP_DIR)" && npx electron-builder --win --publish never
	@echo "  → $(DESKTOP_DIR)/dist/"

# The Mac App Store package. Gate BEFORE the build so a credential-less run
# skips instantly; the gate and the build are ONE shell line so that `exit 0`
# ends the whole target. The .pkg is uploaded by hand (Transporter) or by the
# store-mas job; it is never attached to the public GitHub Release.
dist-mas:
	@if [ ! -f "$(MAS_PROFILE)" ]; then \
		echo "No MAS provisioning profile ($(MAS_PROFILE)) — skipping Mac App Store build."; \
		exit 0; \
	fi; \
	$(MAKE) desktop-setup && \
	( cd "$(DESKTOP_DIR)" && $(MAS_SIGN_ENV) CSC_NAME="$(MAS_CSC_NAME)" npx electron-builder --mac mas --universal --publish never \
		-c.mac.notarize=false -c.mas.entitlements="$(MAS_ENTITLEMENTS)" -c.mas.entitlementsInherit="$(MAS_ENTITLEMENTS_INHERIT)" ) && \
	echo "  → $(DESKTOP_DIR)/dist/  (upload the .pkg via Transporter)"

# A sandboxed build that runs on this Mac (registered in the development
# profile): the way to check Open, Save and Finder's "Open With" under the App
# Sandbox before submitting. Never submitted.
mas-dev:
	@if [ ! -f "$(MAS_DEV_PROFILE)" ]; then \
		echo "No MAS development profile ($(MAS_DEV_PROFILE)) — skipping MAS dev build."; \
		exit 0; \
	fi; \
	$(MAKE) desktop-setup && \
	( cd "$(DESKTOP_DIR)" && $(MAS_SIGN_ENV) npx electron-builder --mac mas-dev --publish never \
		-c.mac.notarize=false -c.masDev.entitlements="$(MAS_ENTITLEMENTS)" -c.masDev.entitlementsInherit="$(MAS_ENTITLEMENTS_INHERIT)" ) && \
	echo "  → $(DESKTOP_DIR)/dist/"

# Re-render electron/icons/ from website/favicon.svg and the macOS variant,
# electron/icons/hippoherd-mac-icon.svg. Runs under Electron (see the script).
icons: electron/node_modules
	cd "$(ELECTRON_DIR)" && npx electron ../scripts/make-icons.mjs

# Copy the macOS signing credentials from RELEASE_ENV into this repository's
# Actions secrets, where the Release workflow reads them — JsonHippo's and Rest
# Hippo's sync-mac. Each value is piped to `gh secret set`, never echoed; an
# empty one is skipped rather than stored, because an empty CSC_LINK breaks the
# build. The MAS certificates and profile (MAS_*) are set by hand; see the
# header of release.yml.
sync-mac:
	@test -f "$(RELEASE_ENV)" || { echo "No $(RELEASE_ENV) — copy release.env.example, or set RELEASE_ENV=…"; exit 1; }
	@echo "Pushing the macOS signing secrets from $(RELEASE_ENV) to GitHub…"
	@for k in CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do \
		v=$$(grep "^$$k=" "$(RELEASE_ENV)" | head -1 | cut -d= -f2-); \
		if [ -z "$$v" ]; then echo "  ! $$k is missing or empty — skipped"; continue; fi; \
		printf '%s' "$$v" | gh secret set "$$k" --repo jfigge/hippoherd && echo "  ✓ $$k"; \
	done
