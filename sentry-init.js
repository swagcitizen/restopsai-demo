// Sentry error monitoring for Stationly SPA
// Loaded after the Sentry CDN bundle (defer order preserved).
(function () {
  if (typeof window === 'undefined' || !window.Sentry) {
    console.warn('[sentry-init] Sentry SDK not loaded; skipping init.');
    return;
  }

  var hostname = (window.location && window.location.hostname) || '';
  var environment = 'development';
  if (hostname === 'stationly.ai' || hostname === 'www.stationly.ai') {
    environment = 'production';
  } else if (hostname.indexOf('stationly') !== -1 || hostname.indexOf('pplx') !== -1) {
    environment = 'staging';
  }

  // DSN is injected at deploy time. Leave as empty string to disable Sentry.
  var DSN = 'https://42945b0d78bfa224b1cd50e9f2f50952@o4511355444002816.ingest.de.sentry.io/4511355581694032';

  if (!DSN || DSN === '__SENTRY_DSN__') {
    // No DSN configured yet — skip init, but expose a no-op shim so app code
    // calling Sentry.setUser/setTag/captureException doesn't throw.
    var noop = function () {};
    window.Sentry = window.Sentry || {};
    ['setUser', 'setTag', 'setContext', 'captureException', 'captureMessage', 'addBreadcrumb'].forEach(function (k) {
      if (typeof window.Sentry[k] !== 'function') window.Sentry[k] = noop;
    });
    return;
  }

  try {
    var integrations = [];
    if (typeof window.Sentry.browserTracingIntegration === 'function') {
      integrations.push(window.Sentry.browserTracingIntegration());
    }

    window.Sentry.init({
      dsn: DSN,
      environment: environment,
      release: 'stationly@' + (window.__BUILD_ID__ || 'dev'),
      tracesSampleRate: environment === 'production' ? 0.1 : 0.0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      integrations: integrations,
      // Filter known noise that doesn't represent real bugs.
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Network request failed',
        'Failed to fetch',
        'Load failed',
        'NetworkError when attempting to fetch resource',
        'AbortError',
        'cancelled',
        // Browser extensions
        /extension\//i,
        /^chrome:\/\//i,
        /^moz-extension:\/\//i,
      ],
      denyUrls: [
        /chrome-extension:\/\//i,
        /moz-extension:\/\//i,
        /safari-extension:\/\//i,
      ],
      beforeSend: function (event, hint) {
        // Drop events without an exception or message (rare null events).
        if (!event.exception && !event.message) return null;
        return event;
      },
    });

    window.Sentry.setTag('app', 'stationly-spa');
    window.Sentry.setTag('page', (window.location.pathname || '/').split('?')[0]);

    // Helper for app.js to set user/tenant context after auth resolves.
    window.__setSentryUser = function (user, tenantId) {
      if (!window.Sentry || !user) return;
      try {
        window.Sentry.setUser({ id: user.id, email: user.email });
        if (tenantId) window.Sentry.setTag('tenant_id', tenantId);
      } catch (e) { /* noop */ }
    };

    window.__clearSentryUser = function () {
      if (!window.Sentry) return;
      try { window.Sentry.setUser(null); } catch (e) { /* noop */ }
    };
  } catch (err) {
    console.warn('[sentry-init] init failed:', err);
  }
})();
