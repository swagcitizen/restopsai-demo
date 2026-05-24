// staffApp.js — entry point for the Stationly Staff PWA.
// Owns: auth gate, route state machine, global offline-banner, push registration.

import { supabase, getSession } from './services/supabaseClient.js';
import * as svc from './services/staffService.js';
import { onNetworkChange, registerPush } from './services/nativeBridge.js';
import { updateOfflineBanner } from './components.js';

import * as Login    from './screens/login.js';
import * as Pin      from './screens/pin.js';
import * as PinSetup from './screens/pinSetup.js';
import * as Grid     from './screens/staffGrid.js';
import * as Today    from './screens/today.js';
import * as Clock    from './screens/clock.js';
import * as Tasks    from './screens/tasks.js';
import * as Overage  from './screens/overage.js';
import * as Msgs     from './screens/messages.js';
import * as Profile  from './screens/profile.js';

const SCREENS = {
  login: Login, pin: Pin, 'pin-setup': PinSetup, grid: Grid,
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
  onSignOut: () => {
    state.staff = null;
    // After sign-out on a shared device, drop back to the staff grid so
    // the next person can tap their name. Personal devices go to PIN if
    // the email is still remembered, otherwise login.
    const mode = svc.getCachedDeviceMode();
    if (mode === 'shared' && svc.getLastEmail()) navigate('grid');
    else if (svc.getLastEmail()) navigate('pin');
    else navigate('login');
  },
  get staff() { return state.staff; },
};

function navigate(route) {
  // If route requires auth and we have none, push them to a pre-auth screen.
  const preAuthRoutes = new Set(['login', 'pin', 'grid']);
  if (!preAuthRoutes.has(route) && route !== 'pin-setup' && !state.staff) {
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
    // Signed in via auth but not enrolled as staff. Most common cause: they
    // never accepted a staff invite, so accept_invite never linked them.
    alert(
      "You're signed in, but no staff record is linked to your account.\n\n" +
      "If you got an invite email or link from your manager, open it now " +
      "to finish setup. If not, ask your manager to send you a staff invite."
    );
    await svc.signOut();
    navigate('login');
    return;
  }
  // Try to flush any offline clock events
  svc.flushClockQueue().catch(() => {});
  // Try to register for push (silent fail)
  const vapid = window.VITE_VAPID_PUBLIC_KEY || ''; // wire env later
  registerPush(vapid).catch(() => {});

  // If login.js flagged force-PIN-setup, take them there before anything else.
  if (sessionStorage.getItem('stationly_force_pin_setup') === '1') {
    navigate('pin-setup');
    return;
  }

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
      // Mirror the explicit onSignOut behavior.
      const mode = svc.getCachedDeviceMode();
      if (mode === 'shared' && svc.getLastEmail()) navigate('grid');
      else if (svc.getLastEmail()) navigate('pin');
      else navigate('login');
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
    // No session: decide between grid (shared) / pin (personal) / login.
    const lastEmail = svc.getLastEmail();
    if (!lastEmail) {
      navigate('login');
    } else {
      // Probe (cached-first) device mode for this tenant.
      let mode = svc.getCachedDeviceMode();
      if (!mode) {
        try { mode = await svc.fetchDeviceMode(lastEmail); } catch { mode = 'personal'; }
      }
      navigate(mode === 'shared' ? 'grid' : 'pin');
    }
  }
})();
