# Supabase backend — source of record

This directory contains the backend code that runs on Supabase project `vmnhizmibdtlizigbzks`.
**These files were pulled from the live project as a snapshot for rollback / versioning.**
They are NOT auto-synced — when you change an edge function or apply a migration via the
dashboard or an agent, re-run the pull script (or ask the agent: "re-pull the Supabase backend to git")
to keep this in sync.

## Structure

```
supabase/
├── migrations/          # One .sql file per applied migration, ordered by timestamp
│                        # These match the rows in supabase_migrations.schema_migrations
└── functions/           # One directory per deployed Edge Function
    └── <slug>/
        ├── index.ts     # The deployed function body
        └── metadata.json  # id, version, verify_jwt flag, timestamps
```

## Rollback workflow

If the live site breaks and you need to restore a prior version:

1. **Frontend**: `git revert <bad-commit>` in this repo, then GitHub Pages redeploys automatically.
2. **Edge function**: copy the prior `index.ts` from git history and redeploy via the Supabase dashboard or
   the agent's `deploy_edge_function` tool.
3. **Database migration**: migrations are additive. To undo a schema change, write a new compensating
   migration — do NOT edit past migration files (they are the historical record).

## Secrets (NOT in this repo)

These are set via Supabase Dashboard → Edge Functions → Secrets:
- `ANTHROPIC_API_KEY` — used by `ocr-invoice`, `pnl-parse`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE` — used by `send-schedule-sms`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — auto-injected by Supabase runtime

## Known state as of last sync

- 16 migrations applied, newest: `20260424202350_fix_platform_list_tenants_email_cast`
- 6 edge functions deployed; `admin-purge-chase` is a disabled stub (returns 410)
