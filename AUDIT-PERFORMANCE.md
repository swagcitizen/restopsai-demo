# Stationly — Frontend Performance Audit

**Date:** 2026-05-08  
**Auditor:** automated (Lighthouse CLI + Playwright + static analysis)  
**Target:** `https://stationly.ai/app.html` (and `login.html` — the unauthenticated landing)  
**Goal:** Lighthouse Performance ≥ 90 on mobile

---

## 1. Lighthouse Scores (Baseline)

> **Note:** Lighthouse navigates to `app.html` but the auth guard in `tenantContext.js`
> immediately redirects unauthenticated visitors to `login.html`. All scores below
> reflect the **unauthenticated flow** (app.html → redirect → login.html). The redirect
> itself is the single largest performance penalty.

| Metric              | Mobile       | Desktop       |
|---------------------|-------------|---------------|
| **Performance score** | **67 / 100** | **56 / 100** |
| First Contentful Paint | 4.6 s    | 1.6 s        |
| Largest Contentful Paint | 6.1 s  | 1.9 s        |
| Total Blocking Time | 0 ms         | 1,030 ms     |
| Cumulative Layout Shift | 0.001  | 0.026        |
| Time to Interactive | 6.1 s        | 2.7 s        |
| Speed Index         | 4.6 s        | 1.6 s        |

**LCP element (both):** `<p class="auth-sub">` — "Welcome back. Every restaurant, one system." — the subtitle on `login.html`.

### Top Lighthouse Opportunities

| Priority | Opportunity | Mobile savings | Desktop savings |
|----------|-------------|---------------|-----------------|
| 1 | Avoid multiple page redirects (app→login) | −4,300 ms | −1,470 ms |
| 2 | Reduce unused JavaScript | −620 ms | −70 ms |
| 3 | Minify CSS | −150 ms | −80 ms |
| 4 | Eliminate render-blocking resources | — | — |
| 5 | Serve static assets with efficient cache policy | 45 resources @ 600 s TTL | same |

---

## 2. Bundle Breakdown — `app.js` (5,600 lines / 250 KB raw)

### Function count
```
grep -c "^function|^const.*=.*function|^async function" app.js
→ 166 top-level functions
```

### Section map (by line range)

| Section | Lines | Size | Split candidate? |
|---------|-------|------|-----------------|
| HEADER / IMPORTS | 1–40 | 39 | — |
| SAMPLE DATA | 40–157 | 117 | Yes — move to a lazy-loaded fixture |
| STATE | 157–353 | 196 | — (core) |
| COMPUTATIONS | 353–506 | 153 | — (core) |
| RENDER (main views) | 506–815 | 309 | — (core shell) |
| Prep Labels | 815–1046 | 231 | Medium priority |
| **CHARTS** | **1046–1243** | **197** | **Yes — defer until tab visited** |
| ROLE-BASED ACCESS | 1243–1266 | 23 | — |
| WEEKLY BRIEFING | 1266–1386 | 120 | Yes |
| **RECIPE COSTING** | **1386–1491** | **105** | **Yes** |
| **SHIFT SCHEDULER** | **1491–1587** | **96** | **Yes** |
| DBPR INSPECTION PREP | 1587–1708 | 121 | Yes |
| ACTIVATION CHECKLIST | 1708–1859 | 151 | — |
| MOBILE NAV DRAWER | 1859–1921 | 62 | — |
| **EVENTS** | **1921–2676** | **755** | Partial — heavy tabs |
| **INVOICES & AP** | **2676–2912** | **236** | **Yes** |
| Upload flow | 2912–3135 | 223 | Yes |
| TASK ASSIGNMENTS | 3135–3294 | 159 | Yes |
| LOCATIONS + COMMISSARY | 3294–3624 | 330 | Yes |
| INIT | 3624–3871 | 247 | — |
| TEAM & INVITES VIEW | 3871–4078 | 207 | Yes |
| TIME CLOCK | 4078–4278 | 200 | Yes |
| PUBLISH SCHEDULE (SMS) | 4278–4428 | 150 | Yes |
| **VARIANCE** | **4428–4856** | **428** | **Yes** |
| Bar Inventory | 4856–4934 | 78 | Merge with Inventory |
| **Bill Pay** | **4934–5098** | **164** | **Yes** |
| **Payroll** | **5098–5347** | **249** | **Yes** |
| Wire Events (Triple) | 5347–5600 | 253 | Partial |

**Heaviest split candidates (bold, ~2,100 lines total):**
EVENTS (755 lines), VARIANCE (428 lines), INVOICES+Upload (459 lines), Payroll (249 lines), LOCATIONS+COMMISSARY (330 lines).

### Also-significant separate JS files

| File | Raw size | Gzipped | Notes |
|------|----------|---------|-------|
| `app.js` | 250.7 KB | 63.9 KB | Main monolith |
| `dataRepo.js` | 49.5 KB | ~12 KB | Loaded eagerly — large |
| `phase2.js` | 30.4 KB | ~9.5 KB | DBPR/recipe/scheduler data |
| `pnlImport.js` | 18.4 KB | ~6 KB | Loaded in auth inline script |
| `qboExport.js` | 14.2 KB | ~5.5 KB | Loaded in auth inline script |

---

## 3. Network Waterfall Summary (375 × 812 px, Fast 3G simulation)

**Throttle conditions:** 1.5 Mbps down / 750 Kbps up / 150 ms RTT  
**Playwright measurement:** navigated to `https://stationly.ai/app.html`, settled at `login.html`

| Metric | Value |
|--------|-------|
| Total requests | 69 |
| Total transfer (uncompressed) | ~1,599 KB |
| Total transfer (gzipped, as served) | ~469 KB |
| Navigation time to networkidle | 3,744 ms |
| FCP (login page) | ~376 ms |
| LCP (login page) | ~376 ms |

### Top 15 resources by raw size (Playwright)

| Size (raw) | Type | Resource |
|-----------|------|----------|
| 250.8 KB | script | `/app.js` |
| 200.6 KB | script | `cdn.jsdelivr.net/…chart.umd.min.js` |
| 108.8 KB | stylesheet | `/styles.css` *(loaded twice — duplicate)* |
| 98.2 KB | document | `/app.html` |
| 95.6 KB | script | `esm.sh/@supabase/auth-js` *(loaded twice)* |
| 49.5 KB | script | `/dataRepo.js` |
| 47.1 KB | font | `fonts.gstatic.com/inter…woff2` |
| 30.4 KB | script | `/phase2.js` |
| 30.2 KB | script | `esm.sh/@supabase/realtime-js` *(twice)* |
| 28.2 KB | script | `esm.sh/node/buffer.mjs` *(twice)* |
| 24.6 KB | script | `esm.sh/@supabase/phoenix` |
| 18.4 KB | script | `/pnlImport.js` |
| 14.2 KB | script | `/qboExport.js` |
| 12.1 KB | script | `pwa.js` |
| 11.8 KB | script | `/tasksRepo.js` |

> Several resources appear twice because the redirect re-issues requests for already-cached items; the second fetch typically serves from service worker cache.

### gzip savings (GitHub Pages CDN serves gzip when Accept-Encoding is sent)

| File | Raw | Gzipped | Wire savings |
|------|-----|---------|-------------|
| `app.js` | 250.7 KB | 63.9 KB | −74% |
| `styles.css` | 108.8 KB | 20.8 KB | −81% |
| `app.html` | 98.1 KB | 19.9 KB | −80% |
| `chart.umd.min.js` | 200.6 KB | 69.1 KB | −66% |

### Critical path at login page (render-blocking chain)

```
login.html (2.6 KB gzip)
  ├── styles.css  → 22.3 KB gzipped  ← RENDER-BLOCKING (should be dropped)
  ├── auth.css    → 2.0 KB gzipped   ← render-blocking but tiny
  └── supabaseClient.js → esm.sh (deep waterfall, 6 levels, 34 requests, ~100KB)
```

The esm.sh Supabase module waterfall is **6 levels deep** with 34 separate requests.
This chain drives the 4+ second TTI on mobile. All 34 esm.sh modules are cached after
first visit (1-day TTL from CDN), so repeat visits are fast.

---

## 4. Service Worker Review (`sw.js`)

**Cache version:** `stationly-v9`  
**Strategy overview:**

| Scope | Strategy | TTL |
|-------|----------|-----|
| App shell (HTML, CSS, JS, icons) | **Cache-first with background revalidate** | Indefinite (bumped on deploy) |
| Supabase REST GETs (`/rest/*`) | **Stale-while-revalidate** | 24 hours |
| Supabase REST writes (POST/PATCH/DELETE) | **Pass-through** (offline-queued by `offlineQueue.js`) | — |
| Edge functions (`/functions/v1/`) | **Pass-through** (no cache) | — |
| Cross-origin (CDN, fonts, etc.) | **Cache-first** | Indefinite |
| Navigation (HTML) | **Network-first**, fallback to shell | — |

### Pre-cached app shell (24 URLs)
```
/, /app.html, /index.html, /styles.css, /manifest.webmanifest,
/app.js, /dataRepo.js, /tasksRepo.js, /clockRepo.js, /invitesRepo.js,
/offlineQueue.js, /connectionStatus.js, /tenantContext.js, /supabaseClient.js,
/locationsRepo.js, /transfersRepo.js, /countsRepo.js, /varianceRepo.js,
/payrollRepo.js, /tipPoolRepo.js, /vendorsRepo.js, /billsRepo.js,
/barPoursRepo.js, /icons/icon-{192,512}.png, /icons/apple-touch-icon.png
```

### SW Issues & Recommendations

1. **`/login.html` is not pre-cached.** If the user visits while offline, the auth pages fail. Add `login.html`, `auth.css`, `signup.html`, `forgot-password.html` to `PRECACHE_URLS`.

2. **`pnlImport.js`, `qboExport.js`, `phase2.js` are not pre-cached** despite being loaded at startup in the app's inline auth script. Add them.

3. **Cache-first for cross-origin CDN is correct** but relies on the CDN being reachable on first load. For Chart.js: consider self-hosting with a content-hash filename (gives long TTL + offline-first).

4. **CACHE_VERSION must be bumped manually on each deploy.** Consider automating this in a CI step.

5. **`passThroughOrQueue` for REST writes is correct** — do not cache writes.

---

## 5. Prioritized Recommendations

### Rec 1 — Drop `styles.css` from all auth pages  
**Files:** `login.html`, `signup.html`, `forgot-password.html`, `reset-password.html`, `verify.html`  
**Effort:** S  
**Expected gain:** −~20 KB on wire (from 22 KB → 2 KB per auth page), −~700 ms mobile FCP, **+10–14 Lighthouse pts mobile**

`auth.css` is fully self-contained (has CSS variable fallbacks, all necessary layout rules).
All five auth pages load both `styles.css` (22 KB gzipped) and `auth.css` (2 KB gzipped).
`styles.css` provides no useful styles to the auth shell — its only contribution is the
`:root` CSS variables, which `auth.css` already covers with hardcoded fallbacks.

Add a Google Fonts link to each auth page so fonts render correctly:

```html
<!-- Remove this from all auth pages: -->
<link rel="stylesheet" href="styles.css">

<!-- Add this (fonts needed for Fraunces/Inter): -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
```

**Files to change:**
- `login.html` — remove `<link rel="stylesheet" href="styles.css">`, add fonts `<link>`
- `signup.html` — same
- `forgot-password.html` — same
- `reset-password.html` — same
- `verify.html` — same

---

### Rec 2 — Defer Chart.js & add missing preconnects  
**Files:** `app.html`  
**Effort:** S  
**Expected gain:** ~70 KB parsing unblocked, unblocks HTML parsing on `app.html`, +4–6 Lighthouse pts for authenticated flow

Currently `chart.umd.min.js` is loaded **synchronously** at line 24 of `app.html`.
Because it has no `defer` or `async`, the browser must download and execute
200 KB (70 KB gzipped) before continuing HTML parsing.

However, `app.js` accesses `Chart.defaults.*` at **module parse time** (line 514),
so Chart.js must be available before `app.js` executes. The fix is to move
`Chart.defaults` configuration into `renderCharts()` (which is called lazily),
then add `defer` to the Chart.js CDN tag.

```html
<!-- Before (line 24 in app.html): -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>

<!-- After: -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" defer></script>
```

In `app.js`, move lines 514–517 (Chart.defaults setup) from module-level into
`renderCharts()` or into a `setupChartDefaults()` guard:

```js
// app.js — move from top-level (line 514) into renderCharts():
function renderCharts() {
  if (typeof Chart === 'undefined') return; // Chart.js not yet loaded
  // Set defaults once
  if (!renderCharts._defaultsSet) {
    Chart.defaults.color = CHART_DEFAULTS.color;
    Chart.defaults.borderColor = CHART_DEFAULTS.borderColor;
    Chart.defaults.font.family = CHART_DEFAULTS.font.family;
    Chart.defaults.font.size = CHART_DEFAULTS.font.size;
    renderCharts._defaultsSet = true;
  }
  // ... rest of renderCharts
}
```

Also add missing preconnect hints to `app.html`:

```html
<!-- Add after existing preconnects in app.html <head>: -->
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="preconnect" href="https://esm.sh" crossorigin />
<link rel="preconnect" href="https://vmnhizmibdtlizigbzks.supabase.co" crossorigin />
```

**Files to change:**
- `app.html` — add `defer` to Chart.js `<script>`, add 3 preconnects
- `app.js` — move `Chart.defaults` init into `renderCharts()`

---

### Rec 3 — Minify `app.js` and `styles.css`  
**Files:** `app.js`, `styles.css` (build step)  
**Effort:** S (one-time setup)  
**Expected gain:** app.js 250→176 KB raw (−30%), 64→47 KB gzipped (−28%); styles.css 109→87 KB raw, 21→16 KB gzipped; +4–6 Lighthouse pts

Add a one-step build script (no bundler needed — just terser + csso):

```json
// package.json (create at repo root):
{
  "scripts": {
    "build": "terser app.js --compress --mangle -o app.js && npx csso styles.css -o styles.css",
    "build:js": "terser app.js --compress --mangle -o app.js",
    "build:css": "npx csso styles.css -o styles.css"
  },
  "devDependencies": {
    "terser": "^5.47.1",
    "csso-cli": "^4.0.2"
  }
}
```

Or as a one-liner in a GitHub Actions workflow:

```yaml
# .github/workflows/deploy.yml
- run: |
    npx terser app.js --compress --mangle -o app.js
    npx csso styles.css -o styles.css
```

> **Measured sizes (terser 5.47.1):**  
> `app.js`: 256,797 → 176,396 bytes raw; 65,452 → 47,264 bytes gzipped (saves **18 KB on wire**)  
> `styles.css`: 111,450 → 87,446 bytes raw; 21,377 → 16,376 bytes gzipped (saves **5 KB on wire**)

**Files to change:**
- `package.json` (create)
- `app.js` — minified in place (or `dist/app.js`)
- `styles.css` — minified in place

---

### Rec 4 — Code-split `app.js` into per-tab lazy modules  
**Files:** `app.js` (major refactor)  
**Effort:** L  
**Expected gain:** Initial parse payload cut by ~40–50%, TTI on first load −1–2 s, +8–12 Lighthouse pts

The app is a single 250 KB monolith. Tabs that are never visited on a given
session (Payroll, Variance, Scheduler, Invoices, Bill Pay) still have their
code parsed and compiled on startup.

**Proposed split:**

| Module | Est. lines | Est. size | Load trigger |
|--------|-----------|-----------|-------------|
| `modules/charts.js` | ~197 | ~12 KB | Overview tab |
| `modules/variance.js` | ~428 | ~26 KB | Variance tab click |
| `modules/invoices.js` | ~459 | ~28 KB | Invoices tab click |
| `modules/payroll.js` | ~249 | ~15 KB | Payroll tab click |
| `modules/scheduler.js` | ~96 | ~6 KB | Scheduler tab click |
| `modules/locations.js` | ~330 | ~20 KB | Locations tab click |
| `modules/team.js` | ~207 | ~13 KB | Team tab click |
| `modules/timeclock.js` | ~200 | ~12 KB | Time Clock tab click |
| `modules/tasks.js` | ~159 | ~10 KB | Tasks tab click |
| `modules/briefing.js` | ~120 | ~8 KB | Briefing tab click |

**Pattern for lazy loading:**

```js
// In the tab-click event handler (EVENTS section):
document.querySelector('[data-view="payroll"]').addEventListener('click', async () => {
  if (!window.__payrollModule) {
    window.__payrollModule = await import('./modules/payroll.js');
  }
  window.__payrollModule.renderPayroll(state);
});
```

This requires extracting render functions + their event wiring from the EVENTS
section into module files. The EVENTS section (755 lines) wires handlers for
all tabs — split it so each module registers its own handlers on import.

---

### Rec 5 — Bundle Supabase client locally (replace esm.sh waterfall)  
**Files:** `supabaseClient.js`, build step  
**Effort:** M  
**Expected gain:** 34 requests → 1 request, saves ~400–800 ms on first load for unauthenticated users, reduces dependency on third-party CDN

Currently `supabaseClient.js` imports from `https://esm.sh/@supabase/supabase-js@2`,
which creates a 6-level-deep dynamic import waterfall (34 separate network requests,
~100 KB gzipped total). After the first visit these are cached, but the first
unauthenticated load pays this cost.

**Fix:** Bundle Supabase once, commit it:

```bash
npm install @supabase/supabase-js
npx esbuild node_modules/@supabase/supabase-js/dist/module/index.js \
  --bundle --format=esm --minify --outfile=supabase/supabase-bundle.js
```

Then update `supabaseClient.js`:
```js
// Before:
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// After:
import { createClient } from './supabase/supabase-bundle.js';
```

Expected bundle size: ~85 KB raw / ~25 KB gzipped (vs. 34 requests / ~100 KB gzipped in waterfall).

---

## 6. "Do These Now" — Safe to Ship in One Commit

These three changes are low-risk, require no build tooling, and address the biggest
Lighthouse wins for the unauthenticated flow (the state LH measures):

### Commit checklist

**1. `login.html`, `signup.html`, `forgot-password.html`, `reset-password.html`, `verify.html`**

Remove `<link rel="stylesheet" href="styles.css">` and add Google Fonts + preconnects:

```html
<!-- Remove: -->
<link rel="stylesheet" href="styles.css">

<!-- Add (before existing auth.css link): -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
```

**Expected:** −20 KB per auth page load, −700 ms mobile FCP, **+10–14 pts mobile LH**

---

**2. `app.html` — defer Chart.js + add preconnects**

```html
<!-- Change line 24 (add defer): -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" defer></script>

<!-- Add after existing preconnects: -->
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="preconnect" href="https://esm.sh" crossorigin />
<link rel="preconnect" href="https://vmnhizmibdtlizigbzks.supabase.co" crossorigin />
```

**Also required in `app.js`** — move `Chart.defaults.*` from module scope (lines 514–517) into `renderCharts()`:

```js
// Lines 514–517 in app.js — delete from module top-level:
// Chart.defaults.color = CHART_DEFAULTS.color;
// Chart.defaults.borderColor = CHART_DEFAULTS.borderColor;
// Chart.defaults.font.family = CHART_DEFAULTS.font.family;
// Chart.defaults.font.size = CHART_DEFAULTS.font.size;

// Add to top of renderCharts() function (line 1049):
function renderCharts() {
  if (typeof Chart === 'undefined') return;
  if (!renderCharts._init) {
    Chart.defaults.color = CHART_DEFAULTS.color;
    Chart.defaults.borderColor = CHART_DEFAULTS.borderColor;
    Chart.defaults.font.family = CHART_DEFAULTS.font.family;
    Chart.defaults.font.size = CHART_DEFAULTS.font.size;
    renderCharts._init = true;
  }
  // ... rest unchanged
```

**Expected:** Unblocks 70 KB from parse chain on `app.html`, +4–6 pts authenticated LH

---

**3. `login.html` + all auth pages — add preconnects for Supabase/esm.sh**

```html
<!-- Add to <head> of login.html, signup.html, forgot-password.html, reset-password.html, verify.html: -->
<link rel="preconnect" href="https://esm.sh" crossorigin />
<link rel="preconnect" href="https://vmnhizmibdtlizigbzks.supabase.co" crossorigin />
```

**Expected:** −150–300 ms for Supabase auth check on mobile

---

### Summary of "do now" files

| File | Change |
|------|--------|
| `login.html` | Remove `styles.css` link; add Google Fonts + preconnects |
| `signup.html` | Same |
| `forgot-password.html` | Same |
| `reset-password.html` | Same |
| `verify.html` | Same |
| `app.html` | Add `defer` to Chart.js; add 3 preconnects |
| `app.js` | Move `Chart.defaults` init from module scope → `renderCharts()` |

**Estimated Lighthouse improvement after "do now":**  
Mobile: 67 → **80–85** | Desktop: 56 → **68–74**

---

## 7. Path to 90+ on Mobile

To cross 90+ on mobile Lighthouse, the following must all be done:

| Step | Effort | Cumulative est. score |
|------|--------|----------------------|
| Baseline | — | Mobile 67, Desktop 56 |
| Rec 1: Drop styles.css from auth pages | S | ~80 |
| Rec 2: Defer Chart.js + preconnects | S | ~83 |
| Rec 3: Minify app.js + styles.css | S | ~86 |
| Rec 5: Bundle Supabase (kill esm.sh waterfall) | M | ~89 |
| Rec 4: Code-split app.js (lazy tabs) | L | **90+** |

> Score estimates assume the redirect from `app.html→login.html` remains.
> If Lighthouse were run against an authenticated session, the baseline
> would be higher and 90+ would require only Recs 1–3 + minification.

---

## 8. Appendix — Raw Numbers

### Terser minification (measured)
- `app.js`: 256,797 → 176,396 bytes raw (−31%); 65,452 → 47,264 bytes gzipped (−28%)
- `styles.css`: 111,450 → 87,446 bytes raw (−22%); 21,377 → 16,376 bytes gzipped (−23%)

### Cache TTL
- GitHub Pages sets `cache-control: max-age=600` (10 min) on all assets — this is hardcoded and cannot be overridden without moving to a different host or CDN layer.
- jsDelivr (Chart.js CDN): `max-age=31536000, immutable` ✓

### Service worker cache version
- Current: `stationly-v9`
- SW pre-caches 24 URLs; missing: `login.html`, `auth.css`, `signup.html`, `forgot-password.html`, `phase2.js`, `pnlImport.js`, `qboExport.js`

### SSR / landing page note
- `index.html` (marketing page) is a separate static page — not the same as `app.html`
- No SSR is in place for either; the marketing page has no server-rendered content
- SSR for the app itself would require a backend (not currently in scope for GitHub Pages)
