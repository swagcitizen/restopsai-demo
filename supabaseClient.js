// Supabase client — single source of truth for all backend calls.
// Loaded as an ES module via <script type="module">.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Helper: get current user or null
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

// Helper: get current session
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// Helper: sign out
export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = './login.html';
}

// Helper: get user's memberships (which tenants they belong to)
export async function getMemberships() {
  const { data, error } = await supabase
    .from('memberships')
    .select('id, role, tenant_id, tenants(id, name, plan, subscription_status, trial_ends_at, restaurant_type)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Helper: get the user's profile row (or null).
// We filter by id explicitly because profiles RLS also exposes tenant-mate
// rows — without the filter, .maybeSingle() can collapse to null when the
// caller shares a tenant with someone else.
export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  return data;
}

// Helper: create a tenant + owner membership + seed defaults in one atomic call
// Client-side version using two RPC calls; Edge Function will eventually replace this.
export async function createTenant({ name, restaurantType, state = 'FL', city = null, timezone = null }) {
  const user = await getUser();
  if (!user) throw new Error('Not signed in');

  // 1. Insert tenant (RLS: only works via service role OR via explicit allow-first-create policy).
  //    For v1 we do this via RPC to avoid opening a public insert policy.
  const { data, error } = await supabase.rpc('create_tenant_and_membership', {
    _name: name,
    _restaurant_type: restaurantType,
    _state: state,
    _city: city,
    _timezone: timezone,
  });
  if (error) throw error;
  return data; // tenant_id
}
