// alertsView.js — alerts inbox + bell + subscription settings.
// Initialized from app.js bootApp(): import('./alertsView.js').then(m => m.initAlerts(ctx))

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

const ICONS = {
  daily_briefing: '📊',
  sales_pacing: '📉',
  labor_threshold: '👥',
  invoice_variance: '🧾',
  inspection_due: '📋',
  callout: '🚨',
  shift_reminder: '⏰',
  default: '🔔',
};

const RULE_LABELS = {
  daily_briefing: 'Morning operator briefing',
  sales_pacing: 'Sales pacing alerts (low day)',
  labor_threshold: 'Labor cost threshold',
  invoice_variance: 'Invoice price spike',
  inspection_due: 'Upcoming inspection',
  callout: 'Staff callout',
  shift_reminder: 'Shift starting soon',
};

const RULE_DESCRIPTIONS = {
  daily_briefing: 'Every morning at 6am: yesterday\'s sales, labor, callouts, due invoices.',
  sales_pacing: 'Evening alert if today\'s sales are pacing 20%+ below same weekday.',
  labor_threshold: 'Real-time alert when labor exceeds your target % of revenue.',
  invoice_variance: 'When an invoice line is 15%+ above its trailing 4-week average.',
  inspection_due: '14 days before any health/license inspection.',
  callout: 'When a staff member is marked called-out from the schedule.',
  shift_reminder: '2 hours before each shift starts (for staff).',
};

export function initAlerts(ctx) {
  const tenantId = ctx?.tenantId || ctx?.tenant_id;
  const userId = ctx?.user?.id;
  if (!tenantId || !userId) {
    console.warn('[alerts] missing tenant/user ctx, skipping init');
    return;
  }

  // Bell click → navigate to alerts view
  const bell = document.getElementById('alerts-bell');
  if (bell) {
    bell.addEventListener('click', () => {
      const navBtn = document.querySelector('.nav-item[data-view="alerts"]');
      if (navBtn) navBtn.click();
    });
  }

  // Tab switching
  const tabs = document.querySelectorAll('.alerts-tab');
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const filter = t.dataset.alertsFilter;
      const list = document.getElementById('alerts-list');
      const settings = document.getElementById('alerts-settings');
      if (filter === 'settings') {
        if (list) list.hidden = true;
        if (settings) settings.hidden = false;
        renderSettings(tenantId, userId);
      } else {
        if (list) list.hidden = false;
        if (settings) settings.hidden = true;
        renderAlerts(tenantId, filter);
      }
    });
  });

  // Mark all as read
  const markAllBtn = document.getElementById('alerts-mark-all-read');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      const { error } = await supabase
        .from('alert_events')
        .update({ read_at: new Date().toISOString(), read_by: userId })
        .eq('tenant_id', tenantId)
        .is('read_at', null);
      if (!error) {
        renderAlerts(tenantId, 'unread');
        refreshBellCount(tenantId);
      }
    });
  }

  // Send test briefing
  const testBtn = document.getElementById('alerts-test-briefing');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      const orig = testBtn.textContent;
      testBtn.textContent = 'Sending...';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/daily-briefing`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ tenant_id: tenantId }),
        });
        const out = await resp.json();
        if (out.ok) {
          testBtn.textContent = '✓ Sent';
          setTimeout(() => { renderAlerts(tenantId, 'unread'); refreshBellCount(tenantId); }, 500);
        } else {
          testBtn.textContent = '✗ Failed';
          console.error('[alerts] briefing failed', out);
        }
      } catch (e) {
        testBtn.textContent = '✗ Error';
        console.error(e);
      }
      setTimeout(() => { testBtn.textContent = orig; testBtn.disabled = false; }, 2000);
    });
  }

  // Save phone number
  const savePhoneBtn = document.getElementById('alerts-save-phone');
  if (savePhoneBtn) {
    savePhoneBtn.addEventListener('click', async () => {
      const phone = document.getElementById('alerts-phone').value.trim();
      if (!phone) return;
      // Update phone on all this user's subscriptions
      await supabase
        .from('alert_subscriptions')
        .update({ phone })
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);
      savePhoneBtn.textContent = '✓ Saved';
      setTimeout(() => { savePhoneBtn.textContent = 'Save'; }, 1500);
    });
  }

  // Initial render + bell count
  renderAlerts(tenantId, 'unread');
  refreshBellCount(tenantId);

  // Poll bell every 60s
  setInterval(() => refreshBellCount(tenantId), 60000);

  // Re-render when alerts view becomes visible
  document.addEventListener('viewchange', (e) => {
    if (e.detail?.view === 'alerts') {
      renderAlerts(tenantId, 'unread');
      refreshBellCount(tenantId);
    }
  });
}

async function renderAlerts(tenantId, filter) {
  const list = document.getElementById('alerts-list');
  if (!list) return;
  list.innerHTML = '<div class="alerts-loading">Loading...</div>';

  let query = supabase.from('alert_events').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50);
  if (filter === 'unread') query = query.is('read_at', null);

  const { data, error } = await query;
  if (error) {
    list.innerHTML = `<div class="empty-state">Couldn't load alerts: ${error.message}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✨</div>
      <h3>${filter === 'unread' ? "You're all caught up" : 'No alerts yet'}</h3>
      <p class="muted">${filter === 'unread' ? 'New alerts will appear here as they fire.' : "We haven't sent any alerts for this location yet."}</p>
    </div>`;
    return;
  }

  list.innerHTML = data.map(renderAlertItem).join('');

  // Click to mark read
  list.querySelectorAll('[data-alert-id]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.alertId;
      if (el.classList.contains('read')) return;
      await supabase.rpc('mark_alert_read', { p_alert_id: id });
      el.classList.add('read');
      refreshBellCount(tenantId);
    });
  });

  // Update tab counter
  const unreadCount = data.filter((a) => !a.read_at).length;
  const counter = document.getElementById('alerts-tab-unread-count');
  if (counter) counter.textContent = unreadCount;
}

function renderAlertItem(a) {
  const isRead = !!a.read_at;
  const icon = ICONS[a.rule_key] || ICONS.default;
  const sev = a.severity || 'info';
  const when = formatRelative(a.created_at);
  const channels = (a.channels_succeeded || []).map((c) => `<span class="alert-chip">${c}</span>`).join('');
  return `
    <div class="alert-item ${isRead ? 'read' : ''} sev-${sev}" data-alert-id="${a.id}">
      <div class="alert-icon">${icon}</div>
      <div class="alert-body">
        <div class="alert-title">${escapeHtml(a.title)}</div>
        <div class="alert-text">${escapeHtml(a.body).replace(/\n/g, '<br>')}</div>
        <div class="alert-meta">
          <span class="alert-when">${when}</span>
          ${channels}
          ${a.recipient_count > 0 ? `<span class="alert-chip">${a.sms_count}/${a.recipient_count} SMS</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function renderSettings(tenantId, userId) {
  const container = document.getElementById('alerts-rules-list');
  if (!container) return;

  // Fetch rules + this user's subscriptions
  const [rulesRes, subsRes] = await Promise.all([
    supabase.from('alert_rules').select('rule_key, is_enabled, config').eq('tenant_id', tenantId),
    supabase.from('alert_subscriptions').select('rule_key, channels, phone, is_active').eq('tenant_id', tenantId).eq('user_id', userId),
  ]);
  const rules = rulesRes.data || [];
  const subs = subsRes.data || [];
  const subByKey = Object.fromEntries(subs.map((s) => [s.rule_key, s]));

  // Pre-fill phone if any
  const phoneInput = document.getElementById('alerts-phone');
  if (phoneInput && !phoneInput.value) {
    const anyPhone = subs.find((s) => s.phone)?.phone;
    if (anyPhone) phoneInput.value = anyPhone;
  }

  container.innerHTML = rules.map((r) => {
    const sub = subByKey[r.rule_key] || { channels: ['inapp'], is_active: false };
    const inapp = sub.channels?.includes('inapp');
    const sms = sub.channels?.includes('sms');
    const subscribed = sub.is_active;
    return `
      <div class="alerts-rule-row" data-rule-key="${r.rule_key}">
        <div class="alerts-rule-meta">
          <div class="alerts-rule-name">${ICONS[r.rule_key] || '🔔'} ${RULE_LABELS[r.rule_key] || r.rule_key}</div>
          <div class="alerts-rule-desc">${RULE_DESCRIPTIONS[r.rule_key] || ''}</div>
        </div>
        <div class="alerts-rule-toggles">
          <label class="alerts-toggle"><input type="checkbox" data-channel="inapp" ${inapp ? 'checked' : ''}> In-app</label>
          <label class="alerts-toggle"><input type="checkbox" data-channel="sms" ${sms ? 'checked' : ''}> SMS</label>
          <label class="alerts-toggle alerts-toggle-active"><input type="checkbox" data-active ${subscribed ? 'checked' : ''}> ${subscribed ? 'On' : 'Off'}</label>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.alerts-rule-row').forEach((row) => {
    const ruleKey = row.dataset.ruleKey;
    row.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const channels = [];
        if (row.querySelector('[data-channel="inapp"]').checked) channels.push('inapp');
        if (row.querySelector('[data-channel="sms"]').checked) channels.push('sms');
        const isActive = row.querySelector('[data-active]').checked;
        const phone = document.getElementById('alerts-phone')?.value?.trim() || null;
        await supabase.from('alert_subscriptions').upsert({
          tenant_id: tenantId, user_id: userId, rule_key: ruleKey,
          channels: channels.length ? channels : ['inapp'],
          phone, is_active: isActive,
        }, { onConflict: 'tenant_id,user_id,rule_key' });
        const lbl = row.querySelector('.alerts-toggle-active');
        if (lbl) lbl.lastChild.textContent = isActive ? ' On' : ' Off';
      });
    });
  });
}

async function refreshBellCount(tenantId) {
  const bell = document.getElementById('alerts-bell-count');
  if (!bell) return;
  const { count } = await supabase
    .from('alert_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('read_at', null);
  if (count && count > 0) {
    bell.hidden = false;
    bell.textContent = count > 99 ? '99+' : String(count);
  } else {
    bell.hidden = true;
  }
}

function formatRelative(iso) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
