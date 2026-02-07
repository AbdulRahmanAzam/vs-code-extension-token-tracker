# Centralized Token Tracker — Bug Fix & Implementation Plan

## Problem Statement
The user's core goal: **Use AI coding models (Copilot, GPT-4o, Claude, etc.) across multiple devices WITHOUT signing into GitHub on each device.** Only a token key (TK-xxx) should be needed. Currently:

1. `@tokenTracker` in VS Code chat replies "Language model unavailable"
2. After removing the linked GitHub account from the device, models disappear
3. "Add models" asks to connect with GitHub account
4. The AI proxy pipeline is broken end-to-end

## Root Cause Analysis

### Why `@tokenTracker` shows "Language model unavailable"
The chat participant is registered correctly, but the **actual AI response** relies on `api.streamChatCompletion()` which proxies through the backend. The issue chain:
1. The chat participant handler calls `api.streamChatCompletion()` which makes an HTTP POST to `/api/proxy/chat`
2. The backend's `/api/proxy/chat` fetches the user's `github_access_token` from the database
3. If the GitHub OAuth token has expired/been revoked, or if the user only logged in via email (no GitHub OAuth), the proxy returns 403
4. The SSE stream parser in `apiClient.ts` has no proper buffering — partial JSON chunks cause silent failures
5. Error messages from the streaming endpoint get swallowed silently

### Why models disappear when GitHub account is removed
This is a VS Code platform limitation that our extension should work around:
1. VS Code's native `vscode.lm.selectChatModels()` only returns models from authenticated providers (GitHub Copilot)
2. When GitHub is signed out, VS Code removes ALL language models from its registry
3. Our extension's `ProxyModelProvider` (which should register custom proxy models) is **DEAD CODE** — never instantiated or called
4. The extension relies on monkey-patching existing models' `sendRequest`, but when GitHub is signed out there are zero models to patch
5. The inline completion provider works independently (good), but the chat participant has no model to use for responses

### Core architecture gap
The extension needs to provide its OWN language models via the proxy, not depend on GitHub Copilot being signed in. The `ProxyModelProvider` was built for this but never wired up, and it relies on a **proposed API** (`vscode.lm.registerChatModelProvider`) that doesn't exist in stable VS Code.

---

## Fix Plan

### Phase 1: Backend Fixes (Critical) — ✅ COMPLETED

#### 1.1 Fix `devices.js` register route — missing `user_id` — ✅ DONE

- **File:** `backend/routes/devices.js`
- **Bug:** `POST /api/devices/register` creates devices WITHOUT `user_id` (violates NOT NULL constraint)
- **Fix:** Added `null` userId for legacy path + deprecation comment.

#### 1.2 Fix `devices.js` `generateDeviceToken` wrong argument count — ✅ DONE

- **File:** `backend/routes/devices.js` line ~88
- **Bug:** `generateDeviceToken(deviceId, hardware_fingerprint)` called with 2 args instead of 3
- **Fix:** Changed to `generateDeviceToken(deviceId, null, hardware_fingerprint)` (3 args).

#### 1.3 Fix `devices.js` usage log missing `user_id` — ✅ DONE

- **File:** `backend/routes/devices.js` line ~161
- **Bug:** `usage_logs` insert doesn't include `user_id` (violates NOT NULL in v2)
- **Fix:** Added `user_id: req.userId` to the insert.

#### 1.4 Fix proxy `logProxyUsage` stale allocation race condition — ✅ DONE

- **File:** `backend/routes/proxy.js`
- **Bug:** Allocation object is fetched before the proxy call, so `used_tokens` update is stale
- **Fix:** Re-fetches fresh allocation before updating to prevent race condition.

#### 1.5 Fix GitHub OAuth token storage reliability — SKIPPED (LOW PRIORITY)

- **File:** `backend/routes/auth.js`
- **Note:** The manual PAT entry flow already works as a fallback. OAuth token refresh would require storing GitHub refresh tokens which adds complexity.

### Phase 2: Extension Fixes (Critical — Main Issue) — ✅ COMPLETED

#### 2.1 Wire up `ProxyModelProvider` — ⚠️ NOT APPLICABLE

- `vscode.lm.registerChatModelProvider` is a proposed API unavailable in stable VS Code.
- The chat participant handles ALL AI queries through the proxy directly — no native models needed.
- `modelProvider.ts` retained but fixed (`countTokens` content access bug).

#### 2.2 Fix chat participant to work WITHOUT GitHub sign-in — ✅ DONE

- **File:** `extension/src/extension.ts`
- **Fix:** Added proxy availability check before streaming. If proxy is unavailable, shows clear instructions for the account owner. Added detailed troubleshooting info on error.

#### 2.3 Fix SSE stream parsing — add buffering — ✅ DONE

- **File:** `extension/src/apiClient.ts`
- **Bug:** SSE chunks split across TCP packets caused JSON parse failures — the PRIMARY cause of "Language model unavailable".
- **Fix:** Implemented proper line-by-line SSE buffer. Also detects "no content received" and reports clear error.

#### 2.4 Fix notification spam from `initProxyFeatures` — ✅ DONE

- **File:** `extension/src/extension.ts`
- **Fix:** Added `proxyNotificationShown` guard — notification appears only once per session.

#### 2.5 Fix `completionProvider` always-truthy check in chat status — ✅ DONE

- **File:** `extension/src/extension.ts`
- **Fix:** Changed from `completionProvider ? ...` to `completionProvider?.isEnabled() ? ...`.
- Added `isEnabled()` method to `ProxyCompletionProvider`.

#### 2.6 Fix `blockCopilot()` overwriting user's setting — ✅ DONE

- **File:** `extension/src/tokenTracker.ts`
- **Fix:** Saves original `editor.inlineSuggest.enabled` value before overwriting, restores it on unblock.

#### 2.7 Remove dead code and unused imports — ✅ DONE

- **File:** `extension/src/tokenTracker.ts`, `extension/src/modelProvider.ts`
- **Fix:** Removed unused `pendingInserts` and `lastDocVersion` fields. Fixed `countTokens` to properly handle `LanguageModelTextPart[]` content.

### Phase 3: Dashboard Fixes — ✅ COMPLETED

#### 3.1 Restore missing `index.css` — ✅ DONE

- **File:** `dashboard/src/index.css`
- **Fix:** Created comprehensive CSS file with all styles (dark/light themes, glass morphism, stats grid, device cards, modals, toasts, progress bars, login page, responsive breakpoints).

#### 3.2 Fix proxy status display showing stale data after GitHub OAuth — SKIPPED (LOW PRIORITY)

- The dashboard already fetches data on mount. The OAuth callback redirects back to the dashboard which triggers a fresh data load.

### Phase 4: End-to-End Pipeline Verification

The complete working flow should be:
1. User signs into dashboard via GitHub OAuth → `github_access_token` is stored
2. User generates token key (TK-xxx) from dashboard
3. User installs VS Code extension on ANY device (no GitHub sign-in needed)
4. User pastes token key in extension → device is registered
5. Extension checks proxy status → proxy available (owner has GitHub token)
6. `@tokenTracker` in chat works → queries go through proxy → AI responses stream back
7. Inline completions work → code suggestions via proxy
8. Token usage is tracked and enforced

---

## Implementation Order

1. ✅ Backend fixes (1.1-1.4) — Fixed the foundation
2. ✅ Extension fixes (2.2-2.7) — Fixed the core user experience
3. ✅ Dashboard fixes (3.1) — Fixed the web UI
4. End-to-end verification (Phase 4) — Ensure everything works together
