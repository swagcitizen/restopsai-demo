// connectionStatus.js — online/offline awareness + UI pill in header.
//
// Public API:
//   isOnline()                   -> bool
//   initConnectionStatus()       -> mounts the pill and starts watchers (idempotent)
//   syncNow()                    -> manually flushes the queue
//
// Events on document:
//   connection:change  detail={ online }
//   connection:flushed detail={ synced, failed }

import { pendingCount, flush } from './offlineQueue.js';
import { supabase } from './supabaseClient.js';

let _online = typeof navigator !== 'undefined' ? navigator.onLine : true;
let _initialized = false;
let _pollTimer = null;
let _pillEl = null;
let _toastRoot = null;

const SUPABASE_URL = (() => {
  try {
    // Reuse the same URL the supabase client uses without exporting it.
    const u = new URL((supabase?.rest?.url) || (supabase?.realtime?.endPoint) || '');
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
})();

export function isOnline() { return _online; }

export async function syncNow() {
  if (!_online) return { synced: 0, failed: 0, offline: true };
  const before = await pendingCount();
  if (before === 0) {
    await refreshPill();
    return { synced: 0, failed: 0 };
  }
  const result = await flush();
  await refreshPill();
  if (result.synced > 0) {
    showToast(`✓ Synced ${result.synced} change${result.synced === 1 ? '' : 's'}`, 'success');
  }
  if (result.failed > 0 && (await pendingCount()) > 0) {
    showToast(`${result.failed} change${result.failed === 1 ? '' : 's'} still queued`, 'warn');
  }
  document.dispatchEvent(new CustomEvent('connection:flushed', { detail: result }));
  return result;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initConnectionStatus() {
  if (_initialized) return;
  _initialized = true;

  ensurePill();
  ensureToastRoot();
  refreshPill();

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // Poll every 30s to detect captive portals (browser may say online but we can't reach Supabase)
  _pollTimer = setInterval(verifyReachable, 30_000);

  // Listen for queue events to refresh badge.
  document.addEventListener('offline:enqueued', refreshPill);
  document.addEventListener('offline:queued', refreshPill);
  document.addEventListener('offline:synced', refreshPill);
  document.addEventListener('offline:flush:done', refreshPill);
}

function onOnline() {
  setOnline(true, 'browser-event');
  // Try to flush right away.
  syncNow();
}
function onOffline() {
  setOnline(false, 'browser-event');
}

async function verifyReachable() {
  if (!SUPABASE_URL) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setOnline(false, 'navigator');
    return;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'HEAD', signal: ctrl.signal, mode: 'cors' });
    clearTimeout(t);
    // Any response (even 401/404) means we have network reach.
    setOnline(!!res, 'poll');
  } catch {
    setOnline(false, 'poll');
  }
}

function setOnline(next, source) {
  if (_online === next) return;
  _online = next;
  document.dispatchEvent(new CustomEvent('connection:change', { detail: { online: next, source } }));
  refreshPill();
  if (next) {
    showToast('Back online — syncing…', 'success');
    syncNow();
  } else {
    showToast('You\'re offline. Changes will save and sync later.', 'warn');
  }
}

// ---------------------------------------------------------------------------
// UI: status pill in #app-header / .topbar-actions
// ---------------------------------------------------------------------------
function ensurePill() {
  if (_pillEl && document.body.contains(_pillEl)) return _pillEl;
  const host = document.querySelector('.topbar-actions') || document.querySelector('#app-header') || document.body;
  if (!host) return null;

  const pill = document.createElement('button');
  pill.id = 'connection-pill';
  pill.className = 'connection-pill connection-online';
  pill.type = 'button';
  pill.title = 'Connection status';
  pill.innerHTML = `
    <span class="connection-dot"></span>
    <span class="connection-text">Online</span>
    <span class="connection-badge" hidden>0</span>
  `;
  pill.addEventListener('click', () => syncNow());
  // Place before alerts bell if present, else append.
  const bell = host.querySelector('#alerts-bell');
  if (bell) host.insertBefore(pill, bell); else host.appendChild(pill);
  _pillEl = pill;
  return pill;
}

async function refreshPill() {
  const pill = ensurePill();
  if (!pill) return;
  const count = await pendingCount();
  const dot = pill.querySelector('.connection-dot');
  const text = pill.querySelector('.connection-text');
  const badge = pill.querySelector('.connection-badge');

  pill.classList.remove('connection-online', 'connection-offline', 'connection-syncing');
  if (_online) {
    if (count > 0) {
      pill.classList.add('connection-syncing');
      text.textContent = `Syncing ${count}`;
    } else {
      pill.classList.add('connection-online');
      text.textContent = 'Online';
    }
  } else {
    pill.classList.add('connection-offline');
    text.textContent = count > 0 ? `Offline · ${count} pending` : 'Offline';
  }
  if (count > 0) {
    badge.textContent = String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
function ensureToastRoot() {
  if (_toastRoot && document.body.contains(_toastRoot)) return _toastRoot;
  const root = document.createElement('div');
  root.id = 'toast-root';
  root.className = 'toast-root';
  document.body.appendChild(root);
  _toastRoot = root;
  return root;
}

export function showToast(message, kind = 'info', { ttl = 4000 } = {}) {
  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  root.appendChild(el);
  // Animate in
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 250);
  }, ttl);
}

// Expose for debugging.
if (typeof window !== 'undefined') {
  window.__STATIONLY_CONN__ = { isOnline, syncNow, refreshPill };
}
