-- 20260513210000_printer_and_kiosk_settings.sql
-- Printer preferences (label size, driver, native printing) +
-- Kiosk mode preferences (kiosk-only tablet flag, manager override PIN).
-- One row per tenant — keyed by tenant_id.

-- =============================================================================
-- tenant_printer_settings
-- =============================================================================
create table if not exists tenant_printer_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,

  -- Label preset (drives @page size + content scale). One of:
  -- 'dymo_30252' (1-1/8" x 3-1/2" / 28x89mm — default)
  -- 'dymo_30336' (1" x 2-1/8" / 25x54mm)
  -- 'brother_dk1201' (29x90mm continuous)
  -- 'zebra_2x1'  (2" x 1" / 50x25mm)
  -- 'avery_5160' (2-5/8" x 1" / 67x25mm)
  -- 'shipping_4x6' (4" x 6" / 102x152mm)
  -- 'custom'
  label_preset text not null default 'dymo_30252',

  -- Custom dimensions in millimeters (used when label_preset = 'custom')
  paper_width_mm  numeric(6,2) default 89.0,
  paper_height_mm numeric(6,2) default 28.0,

  -- 'landscape' (wider than tall, default for thermal) or 'portrait'
  orientation text not null default 'landscape',

  -- Display name for the OS-side printer queue (free text, shown to users)
  printer_name text default '',

  -- Native driver. 'browser' = native print dialog (default & always works).
  --                'brother_usb' = WebUSB raster to Brother QL series
  --                'star_bt'     = WebBluetooth ESC/POS to Star TSP series
  native_driver text not null default 'browser',

  -- Margin in mm (uniform, set to 0 for thermal label printers)
  margin_mm numeric(4,2) default 0.0,

  -- Toggles
  print_day_dot boolean not null default true,
  print_allergens boolean not null default true,
  auto_open_dialog boolean not null default true,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table tenant_printer_settings enable row level security;

-- Read access: anyone in the tenant
drop policy if exists "printer_settings_read" on tenant_printer_settings;
create policy "printer_settings_read"
  on tenant_printer_settings for select
  using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));

-- Write access: owners and managers
drop policy if exists "printer_settings_write" on tenant_printer_settings;
create policy "printer_settings_write"
  on tenant_printer_settings for all
  using (
    tenant_id in (
      select tenant_id from memberships
      where user_id = auth.uid() and role::text in ('owner','manager')
    )
  )
  with check (
    tenant_id in (
      select tenant_id from memberships
      where user_id = auth.uid() and role::text in ('owner','manager')
    )
  );

create index if not exists tenant_printer_settings_updated_at_idx
  on tenant_printer_settings(updated_at desc);

-- =============================================================================
-- tenant_kiosk_settings
-- =============================================================================
create table if not exists tenant_kiosk_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,

  -- Always run the clock view in kiosk lockdown when this tenant loads on /app.html?kiosk=1
  enabled boolean not null default false,

  -- 4-digit PIN required to exit kiosk mode (shared by owners/managers).
  -- Stored in plaintext for now (low-stakes secret on a wall tablet — matches
  -- the staff PIN model already in use).
  manager_pin text default '9999',

  -- How many minutes BEFORE the scheduled shift start can an employee clock in?
  clock_in_grace_minutes integer not null default 15,

  -- How many minutes AFTER scheduled end before we nudge them to clock out?
  clock_out_nudge_minutes integer not null default 15,

  -- Show the "Don't forget to clock out" banner on the PIN screen
  show_clockout_reminder boolean not null default true,

  -- Show the "scheduled to clock in" hint on the PIN screen
  show_clockin_reminder boolean not null default true,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table tenant_kiosk_settings enable row level security;

drop policy if exists "kiosk_settings_read" on tenant_kiosk_settings;
create policy "kiosk_settings_read"
  on tenant_kiosk_settings for select
  using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));

drop policy if exists "kiosk_settings_write" on tenant_kiosk_settings;
create policy "kiosk_settings_write"
  on tenant_kiosk_settings for all
  using (
    tenant_id in (
      select tenant_id from memberships
      where user_id = auth.uid() and role::text in ('owner','manager')
    )
  )
  with check (
    tenant_id in (
      select tenant_id from memberships
      where user_id = auth.uid() and role::text in ('owner','manager')
    )
  );
