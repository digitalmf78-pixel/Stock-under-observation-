# Security Summary

## Scope & Reviewed Files
- Backend entry & routing: `server.ts`, `server/adminAuth.ts`, `server/nsePipeline.ts`, `server/deliveryClassifier.ts`, `server/funnelClassifier.ts`, `server/liveFetcher.ts`, `server/catalystFetcher.ts`, `server/swingBotEngine.ts`, `server/t1T2ReportStore.ts`
- Frontend workspace & API clients: `src/App.tsx`, `src/utils/authClient.ts`, `src/components/AdminAuthModal.tsx`, `src/utils/paperTradeClient.ts`, `src/components/OverviewView.tsx`, `src/components/ScreenerView.tsx`, `src/components/FundamentalAuditTable.tsx`, `src/components/StockDetailView.tsx`, `src/components/QuarterlyEpsValuationPanel.tsx`, `src/components/IpoSentimentView.tsx`, `src/components/CatalystGateView.tsx`, `src/components/TradeJournalPanel.tsx`
- Configuration & storage hygiene: `.gitignore`, `.env.example`, `data/`

## Issues Resolved

| Severity | Finding | Remediation | Status |
| --- | --- | --- | --- |
| High | Live NSE session cookies (`data/nse_cookies_http2.json`) were stored directly inside the tracked workspace `data/` folder. | Deleted `data/nse_cookies_http2.json`, re-routed `NseIndia` `cookieDir` in `server/catalystFetcher.ts` to `path.join(os.tmpdir(), 'nse-bse-api-cache')`, and added cookie/auth ignore patterns to `.gitignore`. **Operator Action**: Rotate/invalidate any previously exposed NSE session cookies externally if this repository was shared. | Fixed & Verified |
| High | All state-changing HTTP endpoints (Bhavcopy sync, scanner reload, thresholds, fundamental cache collection/eviction, catalyst sync, watchlist edits, trade journal CRUD, paper trading mutations) lacked authentication/authorization. | Added `server/adminAuth.ts` (`ADMIN_PASSCODE` env override + first-run `scryptSync` claim fallback in `data/research/.admin_auth.json` + 24h HMAC-SHA256 Bearer tokens with revocation) and attached `adminAuth.requireAdminAuth` across all mutating API routes in `server.ts` while leaving ECMS (`POST /api/ecms/gemini-research`) untouched. Frontend keeps Bearer tokens strictly in JS memory (`src/utils/authClient.ts`), never `localStorage`/`sessionStorage`. | Fixed & Verified |
| Medium | Direct per-symbol Fundamental Deep Audit endpoints and `analyzeStockWithV3Bot` could execute deep fundamental collection on non-tiered (`NONE`) NSE stocks, violating Tier 1–3 audit scope. | Enforced `nsePipeline.isSymbolEligibleForFundamentalAudit(symbol)` (Tier 1, Tier 2, Tier 3 allowlist) across `/api/fundamentals/save-to-cache`, `/api/refresh/fundamentals`, `/api/fundamentals/collect-all`, `/api/fundamentals/verified/:symbol`, `/api/stock/:symbol/uturn*`, `server/liveFetcher.ts`, `server/swingBotEngine.ts`, and frontend audit triggers. | Fixed & Verified |

## Safeguards Verified

| Control | Implementation & Verification |
| --- | --- |
| Secret & Token Handling | `ADMIN_PASSCODE` documented in `.env.example`; `scryptSync` + `crypto.timingSafeEqual` for passcode checks; `crypto.randomBytes(32)` in-memory signing fallback (overridden by `SESSION_SECRET`); client token stored only in JS closure memory (`src/utils/authClient.ts`). |
| Injection & XSS Audit | Grep across `src/` and `server/` confirmed zero `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `document.write`, or `eval(` sinks; all SQL/FS operations use safe JSON/CSV atomic writes (`filePersistence.ts`) and React JSX auto-escaping. |
| Dependency Audit (`bun audit`) | Audited lockfile: 9 transitive advisories exist (`adm-zip@0.5.18` via `nse-bse-api`, `zod@4.4.3` via `@ethosagent/tools-india-news`) with no safe non-breaking upstream patch available without fork/major upgrade; no NSE Bhavcopy zip/untrusted archive writes touch user uploads. |

---

## PoC Verification

### 1. Exposed Cookie File Removal & Isolation
1. **Verified file absence**: Checked `/app/applet/data` — `data/nse_cookies_http2.json` is absent (`server/securityAuth.test.ts`).
2. **Verified `cookieDir` target**: Inspected `server/catalystFetcher.ts:35` — `new NseIndia({ cookieDir: path.join(os.tmpdir(), 'nse-bse-api-cache') })`.
3. **Runtime check**: Restarted dev server and verified `data/nse_cookies_http2.json` is not recreated in `/app/applet/data/`.

### 2. Protected Write Endpoints & In-Memory Auth Flow
1. **Unauthenticated mutation test**: Sent `POST /api/watchlist/toggle` and `POST /api/fundamentals/thresholds` without `Authorization` header — server returned `HTTP 401` (`AUTH_REQUIRED` / `ADMIN_SETUP_REQUIRED`).
2. **Claim / Login & Bearer authorization**: Verified in `server/securityAuth.test.ts` that one-time `claimFirstPasscode` hashes with `scryptSync`, rejects subsequent setup attempts with `HTTP 409`, verifies passcodes via `timingSafeEqual`, signs an HMAC-SHA256 Bearer token accepted by `requireAdminAuth`, and rejects revoked tokens with `HTTP 401` after `logout`.

### 3. Fundamental Deep Audit Tier 1–3 Boundary Enforcement
1. **API enforcement**: Sent `GET /api/fundamentals/verified/<NONE_TIER_SYMBOL>` — server returned `HTTP 403` explaining Fundamental Deep Audit runs strictly on Tier 1, Tier 2, or Tier 3 stocks.
2. **Unit & pipeline audit**: Verified in `server/fundamentalAudit.test.ts` that `saveSymbolFundamentalsToCache` and `refreshFundamentalsBatch` block `swingTier === 'NONE'` symbols and `queryFundamentalAudit` contains 100% Tier 1–3 symbols and 0 `NONE` symbols.
