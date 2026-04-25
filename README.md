# Stationly

Restaurant back-office SaaS for independent restaurant owners. Originally RestOps AI, rebranded to Stationly.

**Live site**: https://stationly.ai (GitHub Pages from `master` via CNAME)
**Mirror**: https://swagcitizen.github.io/restopsai-demo/
**Redirect**: stationly.net → stationly.ai (301 via Namecheap URL forward)
**Backend**: Supabase project `vmnhizmibdtlizigbzks` (https://vmnhizmibdtlizigbzks.supabase.co)

## Structure

```
.
├── index.html              # Marketing landing page
├── login.html, signup.html # Auth screens
├── onboarding.html         # New-tenant onboarding flow
├── app.html + app.js       # Main authenticated app (dashboard, schedule, inventory, etc.)
├── platform.html + platform.js   # Platform-owner admin UI (tenant list + impersonate)
├── pnlImport.js            # P&L / bank statement import wizard
├── phase2.js               # Dashboard/charts logic
├── styles.css, auth.css    # Design system: amber #e8a33d, ink #1c1a15, cream #faf5ea
├── brand/                  # Stationly logo + favicons
├── legal/                  # Privacy, terms
├── *Repo.js                # Data access layer per entity (tasks, clock, invites, etc.)
├── supabaseClient.js       # Singleton client init
├── tenantContext.js        # Active-tenant state (sidebar switcher)
├── demoMode.js             # Bella Vita seed data for signed-out / demo flows
└── supabase/               # Backend snapshot — see supabase/README.md
    ├── migrations/         # 16 SQL migrations
    └── functions/          # 6 Edge Functions (Deno)
```

## Design system

- **Palette**: amber `#e8a33d`, ink `#1c1a15`, cream `#faf5ea`, tomato `#c9302c`, basil `#3b6e3b`
- **Type**: Fraunces (display), Inter (body)

## Rollback

Any commit on `master` can be reverted with `git revert`. Frontend redeploys automatically via
GitHub Pages (~45s). For backend rollback see `supabase/README.md`.
