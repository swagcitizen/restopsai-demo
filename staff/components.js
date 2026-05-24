// components.js — shared UI fragments (top bar, bottom tabs, offline banner).

const TABS = [
  { id: 'today',    label: 'Today',    icon: iconHome },
  { id: 'tasks',    label: 'Tasks',    icon: iconCheck },
  { id: 'messages', label: 'Messages', icon: iconChat },
  { id: 'profile',  label: 'Profile',  icon: iconUser },
];

export function renderShell(host, { title, sub, activeTab, ctx }) {
  host.innerHTML = `
    <div id="offline-banner" class="offline-banner ${navigator.onLine === false ? '' : 'hidden'}">
      You're offline — clock events will sync when you reconnect.
    </div>
    <header class="staff-topbar">
      <div class="staff-topbar-left">
        <span class="staff-topbar-title">${escapeHtml(title || '')}</span>
        ${sub ? `<span class="staff-topbar-sub">${escapeHtml(sub)}</span>` : ''}
      </div>
      <div class="staff-topbar-actions"></div>
    </header>
    <main id="screen-main" class="staff-main"></main>
    <nav class="staff-tabs">
      ${TABS.map(t => `
        <button class="staff-tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}" aria-label="${t.label}">
          ${t.icon()}
          <span>${t.label}</span>
        </button>
      `).join('')}
    </nav>
  `;
  host.querySelectorAll('.staff-tab').forEach((b) => {
    b.addEventListener('click', () => ctx.navigate(b.dataset.tab));
  });
}

export function updateOfflineBanner(online) {
  const el = document.querySelector('#offline-banner');
  if (!el) return;
  el.classList.toggle('hidden', online !== false);
}

function iconHome() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`;
}
function iconCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
}
function iconChat() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
}
function iconUser() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
}

export function escapeHtml(s) {
  return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
