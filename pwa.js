// pwa.js — service worker registration + smart install prompt.
//
// Behaviors:
//   1. Registers /sw.js on every page load
//   2. On Chrome/Edge/Android: captures the `beforeinstallprompt` event and
//      shows our own toast after the user has visited 2+ times AND dismissed
//      the system prompt isn't reasonable to expect
//   3. On iOS Safari: shows a one-time "Add to Home Screen" hint with the
//      Share-icon instructions, since iOS doesn't fire beforeinstallprompt
//   4. Listens for new service worker versions and shows an "Update available"
//      banner that reloads the page when clicked
//
// Skipped automatically when the app is already installed (display-mode: standalone)

(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  // ── Inject PWA CSS once (so the toast is styled even on pages that don't load styles.css) ──
  if (!document.getElementById('pwa-styles')) {
    const style = document.createElement('style');
    style.id = 'pwa-styles';
    style.textContent = `
#pwa-install-toast{position:fixed;z-index:9999;left:50%;bottom:16px;transform:translateX(-50%);width:calc(100% - 24px);max-width:360px;display:flex;gap:12px;padding:14px 14px 14px 16px;background:#1c1a15;color:#faf5ea;border:1px solid rgba(232,163,61,.35);border-radius:16px;box-shadow:0 18px 40px -12px rgba(0,0,0,.55),0 4px 12px rgba(0,0,0,.35);font-family:'Inter',system-ui,-apple-system,sans-serif;animation:pwaToastIn 320ms cubic-bezier(.2,.9,.3,1)}
@media(min-width:720px){#pwa-install-toast{left:auto;right:24px;bottom:24px;transform:none}}
@keyframes pwaToastIn{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}
.pwa-toast-icon{flex:0 0 auto;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;font-size:22px;line-height:1;background:rgba(232,163,61,.12)}
.pwa-toast-icon svg{display:block}
.pwa-toast-body{flex:1 1 auto;min-width:0}
.pwa-toast-title{font-weight:600;font-size:15px;letter-spacing:-.01em;margin-bottom:2px;color:#faf5ea}
.pwa-toast-text{font-size:13px;line-height:1.4;color:rgba(250,245,234,.74)}
.pwa-toast-actions{display:flex;gap:8px;margin-top:10px}
.pwa-toast-primary{background:#e8a33d;color:#1c1a15;border:0;border-radius:999px;padding:7px 14px;font-weight:600;font-size:13px;cursor:pointer;transition:background 160ms ease,transform 160ms ease;font-family:inherit}
.pwa-toast-primary:hover{background:#f1b257}
.pwa-toast-primary:active{transform:translateY(1px)}
.pwa-toast-dismiss{background:transparent;color:rgba(250,245,234,.7);border:0;padding:7px 10px;font-size:13px;font-weight:500;cursor:pointer;border-radius:999px;font-family:inherit}
.pwa-toast-dismiss:hover{color:#faf5ea;background:rgba(255,255,255,.06)}
.pwa-toast-close{position:absolute;top:6px;right:6px;background:transparent;border:0;color:rgba(250,245,234,.5);width:28px;height:28px;border-radius:999px;font-size:18px;line-height:1;cursor:pointer}
.pwa-toast-close:hover{color:#faf5ea;background:rgba(255,255,255,.08)}
#pwa-update-banner{position:fixed;z-index:9999;top:0;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 16px;background:#e8a33d;color:#1c1a15;font-family:'Inter',system-ui,-apple-system,sans-serif;font-weight:500;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.18);animation:pwaBannerIn 260ms ease}
@keyframes pwaBannerIn{from{transform:translateY(-100%)}to{transform:translateY(0)}}
#pwa-update-btn{background:#1c1a15;color:#faf5ea;border:0;border-radius:999px;padding:6px 14px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit}
#pwa-update-btn:hover{background:#2c2920}
@media(prefers-reduced-motion:reduce){#pwa-install-toast,#pwa-update-banner{animation:none}}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  const VISIT_KEY        = 'stationly_pwa_visit_count';
  const DISMISS_KEY      = 'stationly_pwa_dismissed_until';
  const IOS_HINT_KEY     = 'stationly_ios_hint_shown';
  const MIN_VISITS       = 2;
  const DISMISS_DAYS     = 14;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://');

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

  // ── 1. Track visit count ─────────────────────────────────────────────────
  try {
    const visits = parseInt(localStorage.getItem(VISIT_KEY) || '0', 10) + 1;
    localStorage.setItem(VISIT_KEY, String(visits));
  } catch (_) { /* private mode, ignore */ }

  // ── 2. Register service worker ───────────────────────────────────────────
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Watch for waiting worker (new version available)
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(reg);
            }
          });
        });
      })
      .catch((err) => console.warn('[PWA] SW registration failed', err));
  });

  // Reload once the new SW takes control
  let _refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_refreshing) return;
    _refreshing = true;
    window.location.reload();
  });

  // ── 3. Capture beforeinstallprompt (Chrome/Edge) ─────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    maybeShowInstallToast();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallToast();
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 365 * 86400000)); } catch (_) {}
  });

  // ── 4. iOS hint (Safari can't trigger install programmatically) ──────────
  if (isStandalone) return;

  if (isIOS && isSafari) {
    setTimeout(maybeShowIOSHint, 3000);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function isDismissedRecently() {
    try {
      const until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      return Date.now() < until;
    } catch (_) { return false; }
  }

  function getVisits() {
    try { return parseInt(localStorage.getItem(VISIT_KEY) || '0', 10); }
    catch (_) { return 0; }
  }

  function maybeShowInstallToast() {
    if (isStandalone || isDismissedRecently()) return;
    if (getVisits() < MIN_VISITS) return;
    if (!deferredPrompt) return;

    const toast = buildToast({
      title: 'Install Stationly',
      body: 'Add it to your home screen for one-tap access and a fullscreen, app-like experience.',
      primaryLabel: 'Install',
      onPrimary: async () => {
        if (!deferredPrompt) return;
        const promptEvent = deferredPrompt;
        deferredPrompt = null;
        hideInstallToast();
        try {
          await promptEvent.prompt();
          await promptEvent.userChoice;
        } catch (_) { /* user cancelled */ }
      },
      onDismiss: () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000)); } catch (_) {}
        hideInstallToast();
      },
    });
    document.body.appendChild(toast);
  }

  function maybeShowIOSHint() {
    if (isStandalone) return;
    if (isDismissedRecently()) return;
    if (getVisits() < MIN_VISITS) return;
    try {
      if (localStorage.getItem(IOS_HINT_KEY) === '1') return;
    } catch (_) {}

    const toast = buildToast({
      title: 'Install Stationly on iPhone',
      body: 'Tap the Share icon below, then "Add to Home Screen" for one-tap access.',
      primaryLabel: 'Got it',
      onPrimary: () => {
        try { localStorage.setItem(IOS_HINT_KEY, '1'); } catch (_) {}
        hideInstallToast();
      },
      onDismiss: () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000)); } catch (_) {}
        hideInstallToast();
      },
      icon: '⬆️',
    });
    document.body.appendChild(toast);
  }

  function buildToast({ title, body, primaryLabel, onPrimary, onDismiss, icon }) {
    const wrap = document.createElement('div');
    wrap.id = 'pwa-install-toast';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');
    wrap.innerHTML = `
      <div class="pwa-toast-icon" aria-hidden="true">${icon || logoSvg()}</div>
      <div class="pwa-toast-body">
        <div class="pwa-toast-title">${escapeHtml(title)}</div>
        <div class="pwa-toast-text">${escapeHtml(body)}</div>
        <div class="pwa-toast-actions">
          <button class="pwa-toast-primary" type="button">${escapeHtml(primaryLabel)}</button>
          <button class="pwa-toast-dismiss" type="button" aria-label="Dismiss">Not now</button>
        </div>
      </div>
      <button class="pwa-toast-close" type="button" aria-label="Close">&times;</button>
    `;
    wrap.querySelector('.pwa-toast-primary').addEventListener('click', onPrimary);
    wrap.querySelector('.pwa-toast-dismiss').addEventListener('click', onDismiss);
    wrap.querySelector('.pwa-toast-close').addEventListener('click', onDismiss);
    return wrap;
  }

  function hideInstallToast() {
    const t = document.getElementById('pwa-install-toast');
    if (t) t.remove();
  }

  function logoSvg() {
    return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#e8a33d"/>
      <path d="M20 22 Q20 14 32 14 Q44 14 44 22 L44 24 Q44 28 36 28 L28 28 Q20 28 20 34 Q20 40 28 40 L36 40 Q44 40 44 44 L44 46 Q44 54 32 54 Q20 54 20 46"
            stroke="#1c1a15" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ── Update banner ────────────────────────────────────────────────────────
  function showUpdateBanner(reg) {
    if (document.getElementById('pwa-update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'pwa-update-banner';
    bar.innerHTML = `
      <span>A new version of Stationly is available.</span>
      <button type="button" id="pwa-update-btn">Reload</button>
    `;
    document.body.appendChild(bar);
    document.getElementById('pwa-update-btn').addEventListener('click', () => {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  }
})();
