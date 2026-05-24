// Tasks screen — open + done sections, with optional QR/photo badges.

import * as svc from '../services/staffService.js';
import { renderShell, escapeHtml } from '../components.js';

export const route = 'tasks';
export const tabId = 'tasks';

export async function render(host, ctx) {
  renderShell(host, { title: 'Today\u2019s tasks', activeTab: 'tasks', ctx });
  const main = host.querySelector('#screen-main');

  main.innerHTML = `<div class="card"><div class="text-muted">Loading tasks…</div></div>`;
  const all = await svc.getTodayTasks().catch(() => []);

  if (!all.length) {
    main.innerHTML = `
      <div class="card text-center" style="padding:40px 16px;">
        <div class="staff-logo" style="margin: 0 auto 12px; background: var(--accent-3);">✓</div>
        <h2>All clear</h2>
        <p class="text-muted mt-1">No tasks assigned to you today.</p>
      </div>
    `;
    return;
  }

  const open = all.filter(t => !t.completed_at);
  const done = all.filter(t =>  t.completed_at);

  main.innerHTML = `
    <div class="between mb-2">
      <h2>${done.length}/${all.length} done</h2>
      ${done.length === all.length ? '<span class="pill pill-success">Complete</span>' : ''}
    </div>
    ${open.length ? `
      <div class="section-title">Open</div>
      <div class="card"><div class="list">
        ${open.map(taskRow).join('')}
      </div></div>
    ` : ''}
    ${done.length ? `
      <div class="section-title">Done</div>
      <div class="card"><div class="list">
        ${done.map(taskRow).join('')}
      </div></div>
    ` : ''}
  `;
}

function taskRow(t) {
  const title = t.tasks?.name || 'Task';
  const sub = t.tasks?.description || '';
  const badge = t.tasks?.badge;
  return `
    <div class="list-row">
      <div class="row">
        <input type="checkbox" ${t.completed_at ? 'checked disabled' : ''} style="width:18px;height:18px;" />
        <div class="list-row-main">
          <div class="list-row-title" style="${t.completed_at ? 'text-decoration:line-through; color: var(--text-muted);' : ''}">${escapeHtml(title)}</div>
          ${sub ? `<div class="list-row-sub">${escapeHtml(sub)}</div>` : ''}
        </div>
      </div>
      ${badge ? `<span class="pill">${escapeHtml(badge)}</span>` : ''}
    </div>
  `;
}
