// staffApp.js — entry point for the Stationly Staff PWA.
// Owns: auth gate, route state machine, global offline-banner, push registration.

import { supabase, getSession } from './services/supabaseClient.js';
import * as svc from './services/staffService.js';
import { onNetworkChange, registerPush } from './services/nativeBridge.js';
import { updateOfflineBanner } from './components.js';

import * as Login   from './screens/login.js';
import * as Pin     from './screens/pin.js';
import * as Today   from './screens/today.js';
import * as Clock   from './screens/clock.js';
import * as Tasks   from './screens/tasks.js';
import * as Overage from './screens/overage.js';
import * as Msgs    from './screens/messages.js';
import * as Profile from './screens/profile.js';

const SCREENS = {
  login: Login, pin: Pin,
  today: Today, clock: Clock, tasks: Tasks,
  overage: Overage, messages: Msgs, profile: Profile,
};

const host = document.querySelector('#app');

const state = {
  route: 'today',
  staff: null,
};

const ctx = {
  navigate,
  onAuth: bootAfterAuth,
  onSignOut: () => { state.staff = null; navigate('login'); },
  get staff() { return state.staff; },
};

function navigate(route) {
  // If route requires auth and we have none, push them to login.
  if (route !== 'login' && route !== 'pin' && !state.staff) {
    state.route = 'login';
  } else {
    state.route = route;
  }
  // Update URL hash for shareable deep links (and PWA shortcut targets)
  try {
    const url = new URL(location.href);
    url.searchParams.set('view', state.route);
    history.replaceState(null, '', url.toString());
  } catch {}

  const scr = SCREENS[state.route] || SCREENS.today;
  // Clear non-shell modals before navigating
  document.querySelectorAll('.sheet-backdrop').forEach(n => n.remove());
  // Pass ctx + host
  Promise.resolve().then(() => scr.render(host, ctx));
}

async function bootAfterAuth() {
  state.staff = await svc.getMyStaffRow();
  if (!state.staff) {
    // Signed in via auth but not enrolled as staff (e.g. manager account)
    alert("You're signed in, but you're not enrolled as staff. Ask your manager to add you.");
    await svc.signOut();
    navigate('login');
    return;
  }
  // Try to flush any offline clock events
  svc.flushClockQueue().catch(() => {});
  // Try to register for push (silent fail)
  const vapid = window.VITE_VAPID_PUBLIC_KEY || ''; // wire env later
  registerPush(vapid).catch(() => {});
  // Honor ?view= deep links
  const initial = new URLSearchParams(location.search).get('view') || 'today';
  navigate(SCREENS[initial] ? initial : 'today');
}

// ---- Boot --------------------------------------------------------------------
(async function boot() {
  // Listen for auth state changes (sign in / sign out / token refresh)
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      state.staff = null;
      navigate('login');
    } else if (event === 'SIGNED_IN' && !state.staff) {
      bootAfterAuth();
    }
  });

  // Offline banner
  onNetworkChange((online) => {
    updateOfflineBanner(online);
    if (online) svc.flushClockQueue().catch(() => {});
  });

  // SW → app messages
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'flush-clock-queue') svc.flushClockQueue().catch(() => {});
      if (e.data?.type === 'navigate' && e.data?.url) {
        const m = e.data.url.match(/view=([\w-]+)/);
        if (m) navigate(m[1]);
      }
    });
  }

  const sess = await getSession();
  if (sess?.user) {
    await bootAfterAuth();
  } else {
    navigate(svc.getLastEmail() ? 'pin' : 'login');
  }
})();
