# Stationly Staff PWA

Installable employee app at **`stationly.ai/staff/`**, sharing the same Supabase backend as the manager app.

---

## What this is

A separate, self-contained mobile PWA for hourly employees. It lets them:

- Sign in by email/password **or** 4-digit PIN
- See their current shift + this week's hours
- Clock in with **GPS + selfie + device fingerprint** (anti-buddy-punch)
- Clock out, even offline (queued and synced when back online)
- Respond to **shift-overage** events (manager-approved extensions, no silent auto-clock-outs)
- See assigned tasks
- Request time off
- Install to home screen (Android prompt + iOS Add-to-Home-Screen)
- Receive web push notifications (manager → employee)

---

## Architecture

```
stationly.ai/             ← Marketing site + manager app (existing)
stationly.ai/app.html     ← Manager dashboard
stationly.ai/staff/       ← Employee PWA (this directory)
```

One Supabase project. Same RLS. Two surfaces.

---

## File layout

```
staff/
├── index.html              ← PWA entry (registers SW, mounts staffApp.js)
├── staffApp.js             ← Route state machine + auth gate
├── components.js           ← Shared top-bar / bottom-tabs / offline banner
├── styles.css              ← Mobile-first, matches stationly.ai cream + amber
├── manifest.webmanifest    ← scope: /staff/
├── sw.js                   ← App shell cache + push + Background Sync
├── icons/                  ← Same brand mark as the rest of the site
├── services/
│   ├── supabaseClient.js   ← createClient with storageKey 'stationly-staff-auth'
│   ├── nativeBridge.js     ← Web impls with WEB_IMPL markers for Capacitor swap
│   └── staffService.js     ← Auth, shifts, clock, extensions, time-off, offline queue
└── screens/
    ├── login.js            ← Email + password
    ├── pin.js              ← 4-digit pad
    ├── today.js            ← Shift card + tasks summary + weekly hours
    ├── clock.js            ← Selfie + GPS + big clock button
    ├── tasks.js            ← Open + done sections
    ├── overage.js          ← +15/+30/+60 buttons, manager approval flow
    ├── messages.js         ← Placeholder until Phase 3.5 lands
    └── profile.js          ← Weekly hours, PIN setup, time off, sign out
```

---

## Backend changes (in same PR)

### Migration
`supabase/migrations/20260524040000_employee_pwa.sql`

Adds:
- `employee_pins` (bcrypt + lockout)
- `shift_extensions` + `extension_status` enum
- `time_off_requests` + 2 enums
- `staff.user_id` column (link to auth.users)
- `time_entries` extensions: `clock_in_lat`, `clock_in_lng`, `clock_in_accuracy_m`, `clock_in_photo_path`, `clock_in_device_id`, `clock_in_distance_m`, `flagged_buddy_punch`, `scheduled_end_at`
- RPCs: `staff_clock_in()` (Haversine geofence), `staff_clock_out()`, `apply_extension_decision()`, `_haversine_m()`
- View: `v_my_open_shift`
- Storage bucket: `clock-selfies` (5 MB, RLS per tenant)
- RLS on all three new tables

Venue location is read from `tenants.settings`:
```sql
update tenants
set settings = settings
  || jsonb_build_object('venue_lat', 28.2470, 'venue_lng', -81.2820, 'geofence_meters', 300)
where id = '<tenant-id>';
```

Default geofence is **300 meters**. Outside → `flagged_buddy_punch = true` (manager reviews; no hard block).

### Edge functions
- `supabase/functions/pin-login` — bcrypt verify, 5 attempts → 15-minute lockout, returns a magic-link OTP the client passes to `verifyOtp`
- `supabase/functions/extension-request` — staff request flow, writes to `shift_extensions`, best-effort alert dispatch

---

## Enrollment flow (manager-side, one-time per employee)

1. Manager creates a staff row with the employee's email.
2. Manager invites the employee through the existing invites flow → employee accepts → an `auth.users` row is created.
3. Manager (or a trigger) sets `staff.user_id = auth.users.id` so the staff PWA can authenticate.
4. Employee opens `stationly.ai/staff/`, signs in with email/password, optionally sets up a 4-digit PIN under Profile.

> **Note on the existing `staff.pin` column:** the legacy 4-digit-PIN-on-tablet flow (`clockRepo.js`) still works untouched. The new PWA uses `employee_pins` (bcrypt) and an edge function, which is a stronger separate system. Both can coexist while you migrate locations off the tablet.

---

## Offline behavior

- Clock events that fail when offline are stored in `localStorage` under `stationly_clock_queue`.
- The service worker registers a **Background Sync** tag `clock-events-queue`. When the device reconnects, the SW posts a message to the app, which calls `flushClockQueue()` and replays each event in order.
- The "You're offline" banner sits above the top bar whenever `navigator.onLine === false`.

---

## Capacitor wrap (later)

All native APIs go through `services/nativeBridge.js` with `WEB_IMPL` blocks:

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android \
      @capacitor/camera @capacitor/geolocation @capacitor/haptics @capacitor/push-notifications
npx cap init "Stationly Staff" ai.stationly.staff
npx cap add ios
npx cap add android
```

Then swap each `WEB_IMPL` block for the matching `@capacitor/*` plugin. Screens don't change.

---

## Deploy

`stationly.ai` is on **GitHub Pages**. Merging this PR to `main` redeploys the site automatically (~60 seconds). No file uploads anywhere.

After merge, run the migration + deploy the edge functions:

```bash
supabase db push
supabase functions deploy pin-login
supabase functions deploy extension-request
```

Then for each location, set the venue lat/lng in `tenants.settings` (see migration section above).

---

## Smoke test on stationly.ai/staff/

1. Visit the URL on a phone — "Add to home screen" prompt appears (Android) or instruction (iOS).
2. Sign in with an `auth.users` account that has a matching `staff` row (`user_id` set).
3. Tap **Set up PIN** under Profile → enter 4 digits twice.
4. Sign out → return to the login screen → "Use PIN instead" appears.
5. Enter PIN → lands on Today.
6. Tap **Clock me in** → take selfie, allow GPS, confirm.
7. Verify a row in `time_entries` with the lat/lng + distance + selfie path.
8. Set the open shift's `scheduled_end_at` to a past time → reload → Today shows "Past scheduled end" + Resolve overage button.
9. Tap **+30 min** → reason → Send → a `shift_extensions` row appears with `status='pending'`.
10. As manager, call `apply_extension_decision(<id>, 'approved')` → employee's `scheduled_end_at` is pushed +30 min.

---

## Known limits / next up

- **Messages screen is a placeholder.** Phase 3.5 messaging isn't merged into this repo yet — when it is, swap `screens/messages.js` for a Realtime-bound thread list.
- **Push notifications** require a VAPID public key. Set `window.VITE_VAPID_PUBLIC_KEY` (or refactor to read from a config) before registration will succeed. Until then, the PWA still works fully; you just won't get pushes.
- **Tasks** read from `task_assignments`. If that table doesn't exist yet (Phase 2 not merged), the Tasks screen shows an empty state.
