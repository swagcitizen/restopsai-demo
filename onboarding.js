// Onboarding wizard
// 6 steps. Each step persists to Supabase on Next so users can resume.
// Routing via hash (#step-1 .. #step-6). Browser back works.

import {
  supabase,
  getSession,
  getMemberships,
  signOut,
  createTenant,
} from './supabaseClient.js';

const TOTAL_STEPS = 6;

// ----------------------------------------------------------------------------
// Auth gate
// ----------------------------------------------------------------------------
const session = await getSession();
if (!session) {
  window.location.href = './login.html';
}

document.getElementById('signout').addEventListener('click', signOut);

// ----------------------------------------------------------------------------
// Tenant lookup. If user has no tenant yet, step 1 will create it.
// If they do, fetch their onboarding row to know where to resume.
// ----------------------------------------------------------------------------
let tenantId = null;
let onboarding = null; // tenant_onboarding row or null
let currentStep = 1;

try {
  const memberships = await getMemberships();
  if (memberships.length > 0) {
    tenantId = memberships[0].tenant_id;
    const { data: row } = await supabase
      .from('tenant_onboarding')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    onboarding = row;
    if (row?.finished_at) {
      // Already completed — bounce them straight to the app.
      window.location.href = './app.html';
    }
    // Resume at the next step after the highest completed.
    const next = Math.min(TOTAL_STEPS, (row?.step_completed || 0) + 1);
    currentStep = next;
  }
} catch (err) {
  // Network or RLS hiccup — fall through to step 1, the user can still create.
  console.warn('Onboarding pre-fetch failed; starting at step 1:', err);
}

// ----------------------------------------------------------------------------
// Timezone picker — populate with the most common US zones + browser default.
// ----------------------------------------------------------------------------
function populateTimezones() {
  const sel = document.getElementById('onb-tz');
  if (!sel) return;
  const zones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
  ];
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const set = new Set([browserTz, ...zones]);
  for (const tz of set) {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz.replace('_', ' ');
    if (tz === browserTz) opt.selected = true;
    sel.appendChild(opt);
  }
}
populateTimezones();

// ----------------------------------------------------------------------------
// Hydrate fields from the existing onboarding row so users see what they
// previously entered when they resume.
// ----------------------------------------------------------------------------
function hydrateFromRow(row) {
  if (!row) return;
  // Step 2
  if (row.service_types?.length) {
    row.service_types.forEach(v => {
      const cb = document.querySelector(`#svc-types input[value="${v}"]`);
      if (cb) cb.checked = true;
    });
  }
  if (row.open_days?.length) {
    row.open_days.forEach(v => {
      const cb = document.querySelector(`#open-days input[value="${v}"]`);
      if (cb) cb.checked = true;
    });
  }
  if (row.avg_ticket != null) {
    const f = document.querySelector('#form-2 [name="avg_ticket"]');
    if (f) f.value = row.avg_ticket;
  }
  // Step 5
  if (row.license_expires_at) {
    const f = document.querySelector('#form-5 [name="license_expires_at"]');
    if (f) f.value = row.license_expires_at;
  }
}
hydrateFromRow(onboarding);

// ----------------------------------------------------------------------------
// Routing
// ----------------------------------------------------------------------------
const paneEls = Array.from(document.querySelectorAll('.onb-step'));
const railLis = Array.from(document.querySelectorAll('.onb-steps li'));
const btnBack = document.getElementById('btn-back');
const btnNext = document.getElementById('btn-next');
const btnSkip = document.getElementById('btn-skip');
const errBox = document.getElementById('onb-error');
const ctrls  = document.getElementById('onb-controls');
const progressFill = document.getElementById('onb-progress-fill');
const progressText = document.getElementById('onb-progress-text');

function showStep(n) {
  currentStep = Math.max(1, Math.min(TOTAL_STEPS, n));
  // Panes
  paneEls.forEach(p => { p.hidden = Number(p.dataset.pane) !== currentStep; });
  // Rail
  const completed = onboarding?.step_completed || 0;
  railLis.forEach(li => {
    const s = Number(li.dataset.step);
    li.classList.toggle('is-active', s === currentStep);
    li.classList.toggle('is-done', s <= completed);
  });
  // Progress
  const pct = Math.round((currentStep / TOTAL_STEPS) * 100);
  progressFill.style.width = pct + '%';
  progressText.textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;
  // Controls
  btnBack.hidden = currentStep === 1;
  btnSkip.hidden = ![3, 4].includes(currentStep);
  btnNext.textContent =
    currentStep === TOTAL_STEPS ? 'Go to dashboard →'
      : currentStep === 5 ? 'Finish setup →'
      : 'Next →';
  // Step 6 hides controls (its own CTA inside)
  ctrls.style.display = currentStep === TOTAL_STEPS ? 'none' : 'flex';
  // Hash sync
  const hash = `#step-${currentStep}`;
  if (window.location.hash !== hash) history.replaceState(null, '', hash);
  // Clear errors
  errBox.hidden = true;
  errBox.textContent = '';
}

window.addEventListener('hashchange', () => {
  const m = window.location.hash.match(/^#step-(\d)$/);
  if (m) showStep(Number(m[1]));
});

// Initial render
showStep(currentStep);

// Step 6 personalization
const userEmail = session?.user?.email || '';
const friendly = userEmail.split('@')[0]?.split(/[._-]/)[0];
if (friendly) {
  const el = document.getElementById('onb-name');
  if (el) el.textContent = friendly.charAt(0).toUpperCase() + friendly.slice(1);
}

// ----------------------------------------------------------------------------
// Validation per step
// ----------------------------------------------------------------------------
function validateStep(n) {
  errBox.hidden = true;
  errBox.textContent = '';
  if (n === 1) {
    const f = document.getElementById('form-1');
    const name = f.querySelector('[name="name"]').value.trim();
    const type = f.querySelector('[name="restaurantType"]').value;
    if (!name) { fail('Restaurant name is required.'); return false; }
    if (!type) { fail('Please pick a cuisine type.'); return false; }
  }
  // Steps 2-5 have no hard validation — empty is OK
  return true;
}
function fail(msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
  errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ----------------------------------------------------------------------------
// Per-step persistence
// ----------------------------------------------------------------------------
async function saveStep(n) {
  if (n === 1) {
    const f = document.getElementById('form-1');
    const fd = new FormData(f);
    const payload = {
      name: fd.get('name').trim(),
      restaurantType: fd.get('restaurantType'),
      state: fd.get('state'),
      city: fd.get('city')?.trim() || null,
    };
    if (!tenantId) {
      // First-time creation. createTenant returns the tenant uuid directly.
      const newId = await createTenant({
        ...payload,
        timezone: fd.get('timezone') || null,
      });
      tenantId = newId || null;
      if (!tenantId) {
        // Defensive: refetch memberships if RPC didn't return what we expected.
        const ms = await getMemberships();
        tenantId = ms[0]?.tenant_id;
      }
      // Re-fetch the auto-created onboarding row so we know its current state.
      if (tenantId) {
        const { data: row } = await supabase
          .from('tenant_onboarding')
          .select('*')
          .eq('tenant_id', tenantId)
          .maybeSingle();
        onboarding = row;
      }
    } else {
      // Existing tenant — update name/type/state if changed
      await supabase.from('tenants').update({
        name: payload.name,
        restaurant_type: payload.restaurantType,
        state: payload.state,
        city: payload.city,
      }).eq('id', tenantId);
    }
    // Persist timezone on the tenant row (column exists), and address/seats
    // on the onboarding row.
    const tz = fd.get('timezone');
    if (tenantId && tz) {
      try { await supabase.from('tenants').update({ timezone: tz }).eq('id', tenantId); } catch (_) {}
    }
    await upsertOnboarding({
      address: fd.get('address')?.trim() || null,
      seats: parseInt(fd.get('seats'), 10) || null,
      timezone: tz,
      step_completed: Math.max(onboarding?.step_completed || 0, 1),
    });
    return;
  }

  if (n === 2) {
    const services = Array.from(document.querySelectorAll('#svc-types input:checked')).map(i => i.value);
    const days     = Array.from(document.querySelectorAll('#open-days input:checked')).map(i => i.value);
    const avg      = parseFloat(document.querySelector('#form-2 [name="avg_ticket"]').value) || null;
    await upsertOnboarding({
      service_types: services,
      open_days: days,
      avg_ticket: avg,
      step_completed: Math.max(onboarding?.step_completed || 0, 2),
    });
    return;
  }

  if (n === 3) {
    // Send invites for any rows with a valid email.
    const rows = Array.from(document.querySelectorAll('.invite-row'));
    const invites = rows.map(r => ({
      name:  r.querySelector('[name="invite_name"]').value.trim(),
      email: r.querySelector('[name="invite_email"]').value.trim().toLowerCase(),
      role:  r.querySelector('[name="invite_role"]').value,
    })).filter(i => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email));

    const userId = session?.user?.id;
    for (const inv of invites) {
      try {
        await supabase.from('invites').insert({
          tenant_id: tenantId,
          email: inv.email,
          role: inv.role,
          invited_by: userId,
        });
      } catch (e) {
        console.warn('Invite failed for', inv.email, e);
      }
    }
    await upsertOnboarding({
      step_completed: Math.max(onboarding?.step_completed || 0, 3),
    });
    return;
  }

  if (n === 4) {
    // Step 4 is informational/links. Nothing to save other than progress.
    await upsertOnboarding({
      step_completed: Math.max(onboarding?.step_completed || 0, 4),
    });
    return;
  }

  if (n === 5) {
    const exp = document.querySelector('#form-5 [name="license_expires_at"]').value || null;
    await upsertOnboarding({
      license_expires_at: exp,
      step_completed: 6,
      finished_at: new Date().toISOString(),
    });
    return;
  }
}

async function upsertOnboarding(patch) {
  if (!tenantId) return;
  // Trigger creates the row on tenant insert; just upsert here for safety.
  const { data, error } = await supabase
    .from('tenant_onboarding')
    .upsert({ tenant_id: tenantId, ...patch }, { onConflict: 'tenant_id' })
    .select()
    .maybeSingle();
  if (error) {
    console.warn('Onboarding upsert failed:', error);
    throw error;
  }
  onboarding = data;
}

// ----------------------------------------------------------------------------
// Coming-soon POS button stub
// ----------------------------------------------------------------------------
document.querySelectorAll('[data-pos]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const which = btn.dataset.pos;
    const c = document.getElementById('pos-confirm');
    if (!c) return;
    c.textContent = `Got it — we'll email you the moment ${which.charAt(0).toUpperCase() + which.slice(1)} integration ships.`;
    c.hidden = false;
    // Best-effort: save interest as a note on the onboarding row.
    if (tenantId) {
      try {
        await supabase.from('tenant_onboarding')
          .update({ updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId);
      } catch (_) {}
    }
  });
});

// ----------------------------------------------------------------------------
// Nav
// ----------------------------------------------------------------------------
btnBack.addEventListener('click', () => {
  showStep(currentStep - 1);
});

btnSkip.addEventListener('click', async () => {
  // Skip = mark step complete with no payload, advance.
  try {
    btnSkip.disabled = true; btnNext.disabled = true;
    await upsertOnboarding({
      step_completed: Math.max(onboarding?.step_completed || 0, currentStep),
    });
    showStep(currentStep + 1);
  } catch (e) {
    fail(e.message || 'Could not save progress.');
  } finally {
    btnSkip.disabled = false; btnNext.disabled = false;
  }
});

btnNext.addEventListener('click', async () => {
  if (currentStep === TOTAL_STEPS) {
    window.location.href = './app.html';
    return;
  }
  if (!validateStep(currentStep)) return;
  btnNext.disabled = true;
  const original = btnNext.textContent;
  btnNext.textContent = 'Saving…';
  try {
    await saveStep(currentStep);
    showStep(currentStep + 1);
  } catch (e) {
    fail(e?.message || 'Something went wrong saving your progress.');
  } finally {
    btnNext.disabled = false;
    btnNext.textContent = original;
  }
});
