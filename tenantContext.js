// tenantContext.js — loads and caches the current user's tenant + role.
// Used by app.js and any future module that needs to know "which restaurant am I in?"
// RLS does the actual data isolation; this is just for UI-level decisions
// (role visibility, badge display, tenant name in header, etc).

import { supabase, getSession, getMemberships, getProfile } from './supabaseClient.js';
import { ensureDemoSession } from './demoMode.js';

let _cache = null;

export async function loadTenantContext() {
  if (_cache) return _cache;

  // Public demo build: auto-sign-in as the demo user if nobody is signed in.
  // This is a no-op on non-demo URLs or if the visitor explicitly opted out.
  await ensureDemoSession();

  const session = await getSession();
  if (!session) {
    window.location.href = './login.html';
    throw new Error('No session');
  }

  const memberships = await getMemberships();
  if (!memberships.length) {
    window.location.href = './onboarding.html';
    throw new Error('No tenant');
  }

  // v1: single tenant per user — use the first one. Multi-tenant switcher comes later.
  const m = memberships[0];
  const profile = await getProfile();

  _cache = {
    session,
    user: session.user,
    profile,
    tenantId: m.tenant_id,
    tenant: m.tenants,
    role: m.role, // 'owner' | 'manager' | 'staff'
    memberships,
  };

  // Apply role class to body for CSS gating
  document.body.classList.remove('role-owner', 'role-manager', 'role-staff');
  document.body.classList.add(`role-${m.role}`);

  return _cache;
}

export function getTenantContext() {
  if (!_cache) throw new Error('Tenant context not loaded — call loadTenantContext first');
  return _cache;
}

export async function handleSignOut() {
  _cache = null;
  await supabase.auth.signOut();
  window.location.href = './login.html';
}

// Listen for auth state changes (e.g. session expiry, logout in another tab)
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    _cache = null;
    if (!window.location.pathname.match(/login|signup/)) {
      window.location.href = './login.html';
    }
  }
});
