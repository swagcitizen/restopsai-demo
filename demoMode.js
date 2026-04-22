// demoMode.js — auto-sign-in as the public demo user.
// This lets anyone visit the deployed site and see the app without having
// to type credentials. It's intentionally enabled by default on this
// public GitHub Pages build — remove this file (and its imports) to disable.

import { supabase, getSession } from './supabaseClient.js';

const DEMO_EMAIL = 'demo@bellavita.app';
const DEMO_PASSWORD = 'DemoPass2026!';

// If the URL has ?nodemo=1 or the user has previously signed out with "stay logged out",
// we respect that and do NOT auto-sign-in.
function demoDisabled() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('nodemo') === '1') return true;
  try {
    if (window.sessionStorage.getItem('restopsai_nodemo') === '1') return true;
  } catch (_) {}
  return false;
}

export async function ensureDemoSession() {
  if (demoDisabled()) return null;
  const existing = await getSession();
  if (existing) return existing;

  // Retry up to 3 times in case of transient network failures (cold esm.sh cache, etc).
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });
      if (error) throw error;
      // Confirm session is actually established before returning.
      const confirmed = await getSession();
      if (confirmed) return confirmed;
      return data.session;
    } catch (err) {
      lastError = err;
      console.warn(`[demoMode] auto-signin attempt ${attempt} failed:`, err.message || err);
      // exponential backoff: 300ms, 900ms
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 300));
    }
  }
  console.error('[demoMode] auto-signin gave up after 3 attempts:', lastError);
  return null;
}

// Call this from a "Sign out" button to stay signed out in demo mode.
export function disableDemoForSession() {
  try { window.sessionStorage.setItem('restopsai_nodemo', '1'); } catch (_) {}
}
