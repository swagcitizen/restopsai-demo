// Today screen — current shift status + quick links to clock / tasks / messages.

import * as svc from '../services/staffService.js';
import { renderShell } from '../components.js';

export const route = 'today';
export const tabId = 'today';

export async function render(host, ctx) {
  renderShell(host, {
    title: 'Today',
    sub: greeting() + ', ' + (ctx.staff?.name?.split(' ')[0] || ''),
    activeTab: 'today',
    ctx,
  });
  const main = host.querySelector('#screen-main');
  main.innerHTML = `<div class="card"><div class="text-muted">Loading your shift…</div></div>`;

  const [open, tasks, weekly] = await Promise.all([
    svc.getOpenShift().catch(() => null),
    svc.getTodayTasks().catch(() => []),
    svc.getWeeklyHours().catch(() => ({ worked: 0, scheduled: 0 })),
  ]);

  const tasksDone = (tasks || []).filter(t => t.completed_at).length;
  const tasksTotal = (tasks || []).length;

  main.innerHTML = `
    ${shiftCard(open)}
    ${tasksTotal ? `
      <div class="card mt-3" id="card-tasks" role="button" style="cursor:pointer;">
        <div class="between">
          <div>
            <div class="eyebrow">Tasks</div>
            <h2 class="mt-1">${tasksDone}/${tasksTotal} done</h2>
            <div class="text-muted mt-1">${tasksTotal - tasksDone} remaining</div>
          </div>
          <div class="text-muted">›</div>
        </div>
      </div>
    ` : ''}
    <div class="stats-grid mt-3">
      <div class="stat">
        <div class="stat-label">This week</div>
        <div class="stat-value">${weekly.worked}h</div>
        <div class="stat-sub">worked</div>
      </div>
      <div class="stat">
        <div class="stat-label">Pay rate</div>
        <div class="stat-value">$${Number(ctx.staff?.hourly_rate || 0).toFixed(2)}</div>
        <div class="stat-sub">per hour</div>
      </div>
    </div>
  `;

  if (open) {
    host.querySelector('#shift-action')?.addEventListener('click', () => {
      const isOver = open.scheduled_end_at && new Date(open.scheduled_end_at) < new Date();
      ctx.navigate(isOver ? 'overage' : 'clock');
    });
  } else {
    host.querySelector('#shift-action')?.addEventListener('click', () => ctx.navigate('clock'));
  }
  host.querySelector('#card-tasks')?.addEventListener('click', () => ctx.navigate('tasks'));
}

function shiftCard(open) {
  if (!open) {
    return `
      <div class="card">
        <div class="eyebrow">On the clock</div>
        <h2 class="mt-2">Not clocked in</h2>
        <div class="text-muted mt-1">Tap below when you arrive at the venue.</div>
        <button class="btn btn-primary mt-3" id="shift-action">Clock me in</button>
      </div>
    `;
  }
  const startMs = new Date(open.clock_in_at).getTime();
  const mins = Math.max(0, Math.floor((Date.now() - startMs) / 60000));
  const hrs = Math.floor(mins / 60);
  const remMin = mins - hrs * 60;
  const isOver = open.scheduled_end_at && new Date(open.scheduled_end_at) < new Date();
  return `
    <div class="card">
      <div class="between">
        <div>
          <div class="eyebrow">On the clock</div>
          <h2 class="mt-1">${hrs}h ${remMin}m on shift</h2>
          ${isOver
            ? '<div class="pill pill-error mt-2">Past scheduled end</div>'
            : `<div class="text-muted mt-1">${open.staff_role || 'On duty'}</div>`}
        </div>
        ${open.flagged_buddy_punch
          ? '<div class="pill pill-warn">Flagged</div>'
          : '<div class="pill pill-success">Active</div>'}
      </div>
      <button class="btn ${isOver ? 'btn-danger' : 'btn-primary'} mt-3" id="shift-action">
        ${isOver ? 'Resolve overage' : 'Clock out'}
      </button>
    </div>
  `;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
