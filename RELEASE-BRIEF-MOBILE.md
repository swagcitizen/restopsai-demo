# Release Brief — Mobile & Tablet Polish

## Goal
Make Stationly genuinely usable for kitchen-line operators on iPhone (375px) and iPad
(768–820px). Today the app collapses to a single column on small screens but the **horizontal
nav is unusable** (only 2 of 22 tabs visible), tables overflow, modals are desktop-sized, and
tap targets on the most important kitchen actions (clock, temp, prep) are too small.

## Audit findings (from screenshots in `/home/user/workspace/mobile-audit/`)

### Mobile (375px) — `mobile-01-dashboard.png`, `mobile-dash-top.png`
1. **Top nav (.sidebar at <1100px) is a horizontal scroller** with 22 buttons. Only "Overview"
   and "Weekly Briefing" are visible. There's no scroll affordance — looks broken.
2. **OPERATIONS section label** + the 4 other section labels (People/Compliance/Account) waste
   width because they're inline in the row.
3. **Topbar** — `7D / 30D / 90D` segmented control + "Healthy" pill + bell crowd off-screen.
4. **KPI cards** — full-width single column at 640px is fine but cards are 80px tall with mostly
   empty space; can be denser.
5. **PWA install toast** sits at `bottom: 16px` but overlaps Recent Activity panel on first load
   because the toast appears immediately and the page is short.
6. **Empty cards** (Cost Breakdown, Top Selling Items) render giant blank boxes with no skeleton.
7. **Side-footer** (View as / Reset / TZ) is currently flexed into the nav row at <1100px,
   pushing nav further off-screen.

### Tablet (768px) — `tablet-01-dashboard.png`, `tablet-dash-top.png`
1. Top nav shows ~6 tabs of 22; better than mobile but still cuts off most of the app.
2. KPI grid drops to 2 columns — looks good.
3. Charts and tables work but feel cramped.
4. Same PWA install issue.

### Other concerns (inferred from code, not direct screenshots — flag if unconfirmed)
1. **Tables** — `.invoice-review-table-wrap`, `.ssch-table-wrap`, `.rp-table-wrap` all use
   `overflow-x: auto`. Horizontal scroll on phone for a wide bills table is bad UX. Should
   convert to **card layout below 720px** for: bills, invoices, payroll lines, variance counts,
   inventory items, team list.
5. **Modals** — desktop-centered modals on mobile are typically too tall, get clipped, and have
   tiny tap targets. Should be **full-screen below 720px** with a fixed top bar (title + close)
   and bottom action bar.
6. **Numeric inputs** — `<input type="number">` is used throughout but kitchen inputs (temp,
   count, oz, lb, $) need `inputmode="decimal"` so iOS shows the numeric pad.
7. **Tap targets** — 44px is the iOS HIG minimum. Many `.btn-primary`, `.chip`, `.nav-item`
   buttons are 32–36px on mobile.

## What to ship

### 1. Replace horizontal-scroll nav with a hamburger drawer (BIGGEST WIN)
At `<= 1100px`:
- Hide the long `.nav` list. Add a fixed top bar with: hamburger button (44×44), brand logo,
  active tab name, alerts bell. Keep it sticky (`position: sticky; top: 0`).
- On hamburger tap, slide in a full-height drawer from the left (or bottom-sheet on phone) that
  shows ALL nav items grouped by section (Operations / People / Compliance / Account), with
  full-width tap targets ≥48px each.
- Drawer dismisses on item click, on backdrop tap, or on swipe.
- Use existing `.nav-section` headers as section dividers in the drawer.
- Persist drawer open/close state in `sessionStorage` so it doesn't flash on every load.

Implementation hint:
```html
<header class="mobile-topbar"> <!-- shown only <=1100px via existing media query -->
  <button class="mobile-menu-btn" aria-label="Menu" aria-controls="mobile-nav-drawer" aria-expanded="false">☰</button>
  <span class="mobile-topbar-title">Overview</span>
  <button class="mobile-alerts-btn" data-view="alerts" aria-label="Alerts"><svg>…</svg></button>
</header>
<aside id="mobile-nav-drawer" class="mobile-nav-drawer" aria-hidden="true">…</aside>
```
- Reuse the existing `.nav-item[data-view]` elements — simply move them into the drawer or
  duplicate them with the same `data-view` so the existing JS click handler in `app.js` (line
  1863) still works.
- When the user clicks a `.nav-item` inside the drawer, update `.mobile-topbar-title` to that
  tab's text, then close the drawer.
- Add a CSS-only backdrop, ESC key handler, and focus trap for accessibility.
- Don't render the drawer at >1100px — let the existing sidebar take over.

### 2. Convert wide tables to cards on mobile
Targets (these are confirmed in `styles.css`):
- `.invoice-review-table-wrap` (Invoices)
- `.ssch-table-wrap` (Shift Scheduler)
- `.rp-table-wrap` (Role Permissions)
- Bill Pay table (find selector in `billsView.js`)
- Variance counts table
- Inventory list

Approach: In a new media query `@media (max-width: 720px)`, set
`table { display: block; } thead { display: none; } tr { display: flex; flex-direction: column;
gap: 4px; padding: 12px; border-bottom: 1px solid var(--line); } td { display: flex;
justify-content: space-between; padding: 4px 0; } td::before { content: attr(data-label);
color: var(--text-muted); font-size: 11px; }`. This requires adding `data-label="Vendor"` etc.
to each `<td>` in the renderers — do that in JS where rows are built.

Limit scope to the 6 tables above for this release. Other less-used tables can keep horizontal
scroll for now.

### 3. Mobile-friendly modals
Add a `.modal--mobile-fullscreen` modifier class and apply it via CSS:
```css
@media (max-width: 720px) {
  .modal-backdrop > .modal,
  .dialog,
  [role="dialog"] {
    inset: 0; max-width: none; max-height: none; width: 100%; height: 100%;
    border-radius: 0; margin: 0;
    display: flex; flex-direction: column;
  }
  .modal-header { position: sticky; top: 0; background: var(--surface); padding: 14px 16px;
    border-bottom: 1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
  .modal-body { flex: 1; overflow-y: auto; padding: 16px; }
  .modal-footer { position: sticky; bottom: 0; padding: 12px 16px;
    border-top: 1px solid var(--line); background: var(--surface); }
}
```
Find existing modal selectors via `grep -rn "modal\|dialog" *.js *.html` and add
`.modal-header / .modal-body / .modal-footer` classes to the renderers.

### 4. Touch-optimized inputs
Add `inputmode` attribute everywhere these patterns exist. Use bash to do a sweep:
- Temperatures (Food Safety): `<input type="number" inputmode="decimal" pattern="[0-9.]*">`
- Counts (Inventory, Variance): `inputmode="numeric"`
- Money (Bills, Payroll): `inputmode="decimal"`
- Phone/PIN (Time Clock): `inputmode="numeric"`

Also: ensure `font-size: 16px` on focused inputs (iOS auto-zooms in if font-size < 16px). Check
the existing `input[type="number"]` rule.

### 5. Tap target hardening
Audit kitchen-critical actions and bump to ≥44px:
- **Time Clock** (`clockView.js`) — In/Out/Break buttons must be ≥56px tall and full-width on
  mobile. Pin number entry should use a 3×4 numeric keypad UI on mobile (skip native input).
- **Food Safety** (`foodSafetyView.js`) — "Log Temp" button, "Mark prep done" checkbox.
- **Prep / Task Assignments** — Mark complete button.
- **Bar Pours** — Add pour button.

Add a CSS utility:
```css
@media (hover: none) and (pointer: coarse) {
  .btn, .btn-primary, .chip, .seg-btn, .nav-item { min-height: 44px; padding-block: 12px; }
}
```

### 6. PWA install prompt — fix placement
The `#pwa-install-toast` is `bottom: 16px` which overlaps content on short pages. Fixes:
- Reduce to `bottom: 8px`, `padding: 10px`, max-width 320px.
- Add a `body { padding-bottom: 80px; }` only when the toast is visible (toggle a body class
  in `pwa.js` when the toast mounts/unmounts) so content can scroll past it.
- Increase MIN_VISITS so it doesn't show on first session (already gated by `getVisits()`).
- Make the close (×) tap target 44×44.

### 7. Default view on tablet → Time Clock
The "Time Clock Tablet" badge implies it's the kitchen tablet view. On a fresh load at
`window.matchMedia('(max-width: 1024px) and (pointer: coarse)')`, OR if the user's role is
`staff`, default to `data-view="clock"` instead of overview. Wire in `app.js` near the existing
default tab logic. Skip this if the URL has a hash or `?view=` param.

### 8. Make the Overview KPI grid more useful at 375px
At <640px, the KPI grid is 1-column. Tighten the cards: reduce padding from 16px → 12px,
reduce kpi-value font-size from 26px → 22px, set `kpi-foot` and `kpi-delta` inline on a 2nd
row to compress vertical height. Or — better — a 2-column grid at 375px (already get this for
free if we set `grid-template-columns: repeat(2, 1fr)` at `<=640px` instead of `1fr`).

### 9. Charts: enforce a min-height on mobile
`.chart-wrap { height: 280px }` is currently fixed — fine on mobile. But empty charts (when no
data) render giant blank boxes. Add an empty state: if Chart.js has no datasets, replace with
a centered "No data yet — add an invoice to see costs" message. Already in scope from the
previous onboarding polish? Verify with `grep "No data yet"` — if not present, add for
`Cost Breakdown`, `Top Selling Items`, `Revenue vs. Prime Cost`.

### 10. Bump SW cache to v9
After all CSS/JS changes, update `sw.js` `CACHE_VERSION` from `v8` → `v9` so users get the new
assets without manual refresh.

## Files likely to change
- `styles.css` — add mobile drawer, responsive table-to-card, fullscreen modals, tap targets
- `app.html` — add `<header class="mobile-topbar">` + `<aside id="mobile-nav-drawer">`
- `app.js` — drawer open/close logic, sync active tab title, default to clock on tablet
- `pwa.js` — toast styling tweak, body class on mount
- `clockView.js` — bigger tap targets, on-screen keypad option
- `foodSafetyView.js` — `inputmode` on temp inputs, bigger Log button
- `inventoryView.js`, `varianceView.js`, `billsView.js`, `payrollView.js` — `data-label` on td
- `sw.js` — bump to v9

## Test plan
1. Playwright at 375×812 (iPhone) and 820×1180 (iPad). Sign up fresh user → sample data
   loads → screenshot every major tab via `button[data-view="X"]` clicks (Overview, Time Clock,
   Food Safety, Inventory, Variance, Bill Pay, Payroll, Recipe Costing, Tasks).
2. Verify: no horizontal scroll on body, all primary buttons ≥44px, drawer opens/closes,
   tables render as cards, modals fullscreen, PWA toast doesn't overlap content.
3. Existing 48 Playwright tests still pass at desktop.
4. Add a new spec file `tests/mobile.spec.js` with 5 tests:
   - Drawer toggle works
   - Table → card on a known wide table (e.g. bills)
   - Modal is fullscreen at 375px (open one of the existing modals)
   - Time Clock buttons are ≥44px tall
   - Default view at 820px is Time Clock when role is staff (or skip this if hard to set)

## Don't change
- Desktop layout above 1100px must look identical.
- Existing sidebar styling at >1100px stays.
- Don't break the existing `.nav-item[data-view]` JS handler — drawer items must use the same
  attribute.
- Don't change role-based hiding (`body.role-staff .nav-item:not([data-view="clock"])` etc.).

## Acceptance criteria
- [ ] At 375px, top nav shows hamburger + active tab name + alerts bell only. All 22 tabs are
      reachable via the drawer. Drawer closes on item tap.
- [ ] At 375px, the 6 listed wide tables render as cards with `data-label` keys.
- [ ] At 375px, modals occupy the full screen with sticky header/footer.
- [ ] All numeric inputs in Food Safety, Inventory, Variance, Bills, Payroll, Time Clock have
      `inputmode` set.
- [ ] All primary action buttons in Time Clock, Food Safety, Tasks are ≥44px tall on mobile.
- [ ] PWA install toast doesn't cover Recent Activity at first load on a 375×812 device.
- [ ] At 820×1180 with `role=staff`, default tab is Time Clock.
- [ ] SW cache bumped to v9.
- [ ] All existing Playwright tests pass; 5 new mobile tests pass.

## Commit + ship
- Single commit with message: `feat(mobile): hamburger nav, card tables, fullscreen modals, tap targets`
- Push to `master`. Auto-deploys via the existing GitHub Pages action.
- Update `stationly-feature-list.md` Section 21 (or add a new section) noting mobile polish.
