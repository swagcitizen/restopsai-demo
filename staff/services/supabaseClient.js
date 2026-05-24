// Staff PWA Supabase client — same project as the manager app.
// Kept separate so the staff bundle can load independently when /staff/ is
// installed as a standalone PWA (cached app shell, no shared module state).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'stationly-staff-auth',
  },
});

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function signOut() {
  await supabase.auth.signOut();
}
