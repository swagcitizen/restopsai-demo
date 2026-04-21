// tasksRepo.js — Supabase-backed tasks module.
// Adapts the DB schema (tasks + task_completions) to the shape the existing
// app.js renderTasks() UI expects:
//   - A `TASK_LIBRARY`-like array with { id (library_id or uuid), title, detail,
//     freq, category, sev, est, vendor }
//   - A `recs` map keyed by the same id with { lastDone, overdue, assignee, history }
//
// RLS takes care of tenant isolation — we only have to query.

import { supabase } from './supabaseClient.js';

// In-memory cache — rebuilt on each refreshTasks() call so we always read fresh
// data after mutations. We keep a module-level copy so renderTasks() stays
// synchronous (it consumes the cache).
let _tasks = [];         // array of task rows (library shape)
let _recs = {};          // map { [task.id]: { lastDone, overdue, assignee, history } }
let _byTaskUuid = {};    // map { [db_uuid]: task object } for completion inserts

function freqDays(f) {
  return { daily: 1, weekly: 7, monthly: 30, quarterly: 90, annual: 365 }[f] || 30;
}

function computeOverdue(frequency, lastDoneISO) {
  if (!lastDoneISO) return true; // never logged = overdue
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(lastDoneISO); last.setHours(0, 0, 0, 0);
  const days = Math.round((today - last) / 86400000);
  return days >= freqDays(frequency);
}

// Fetch all tasks + latest completion per task for the current tenant.
// RLS ensures we only see our tenant's rows.
export async function refreshTasks() {
  // 1. Fetch all active tasks
  const { data: taskRows, error: e1 } = await supabase
    .from('tasks')
    .select('id, library_id, title, detail, frequency, category, severity, estimated_minutes, is_vendor, assigned_staff_id, staff:assigned_staff_id(id, name)')
    .eq('active', true);
  if (e1) throw e1;

  // 2. Fetch latest completion per task
  //    Simpler v1: pull all completions and bucket client-side. For scale we'd use a view.
  const { data: compRows, error: e2 } = await supabase
    .from('task_completions')
    .select('task_id, completed_at, completed_by, notes')
    .order('completed_at', { ascending: false });
  if (e2) throw e2;

  const latestByTaskUuid = new Map();
  for (const c of compRows || []) {
    if (!latestByTaskUuid.has(c.task_id)) {
      latestByTaskUuid.set(c.task_id, c);
    }
  }

  // 3. Shape into the library + recs the UI expects
  _tasks = [];
  _recs = {};
  _byTaskUuid = {};
  for (const row of taskRows || []) {
    const uiId = row.library_id || row.id; // stable key the UI uses
    const latest = latestByTaskUuid.get(row.id);
    const lastDone = latest ? latest.completed_at.slice(0, 10) : null;

    const task = {
      id: uiId,
      _uuid: row.id, // keep the db uuid for writes
      title: row.title,
      detail: row.detail || '',
      freq: row.frequency,
      category: row.category || 'Operations',
      sev: row.severity,
      est: row.estimated_minutes || 0,
      vendor: row.is_vendor,
    };
    _tasks.push(task);
    _byTaskUuid[row.id] = task;

    _recs[uiId] = {
      lastDone,
      overdue: computeOverdue(row.frequency, lastDone),
      assignee: row.staff?.name || (row.is_vendor ? 'Vendor' : 'Unassigned'),
      history: [],
    };
  }

  return { tasks: _tasks, recs: _recs };
}

export function getTasks() { return _tasks; }
export function getRecs() { return _recs; }

// Toggle today's completion for a task. If already done today, delete it.
// Returns the updated rec so the caller can re-render.
export async function toggleTaskCompletion(uiId) {
  // Find the db uuid for this UI id
  const task = _tasks.find((t) => t.id === uiId);
  if (!task) throw new Error(`Unknown task: ${uiId}`);
  const dbTaskId = task._uuid;

  const rec = _recs[uiId];
  const todayISO = new Date().toISOString().slice(0, 10);

  if (rec && rec.lastDone === todayISO) {
    // Uncheck: delete today's completion(s) for this task
    const startOfDay = `${todayISO}T00:00:00Z`;
    const endOfDay = `${todayISO}T23:59:59.999Z`;
    const { error } = await supabase
      .from('task_completions')
      .delete()
      .eq('task_id', dbTaskId)
      .gte('completed_at', startOfDay)
      .lte('completed_at', endOfDay);
    if (error) throw error;
    rec.lastDone = null;
    rec.overdue = true;
  } else {
    // Check: insert a new completion. tenant_id is required (NOT NULL, no default).
    // Get it from the current session's membership (RLS will reject any other tenant_id).
    const ctx = window.__RESTOPS_CTX__;
    if (!ctx) throw new Error('Tenant context not loaded');
    const { error } = await supabase
      .from('task_completions')
      .insert({
        tenant_id: ctx.tenantId,
        task_id: dbTaskId,
        completed_by: ctx.user.id,
      });
    if (error) throw error;
    rec.lastDone = todayISO;
    rec.overdue = false;
  }

  return rec;
}

// Cycle assignee — v1: update the tasks.assigned_staff_id to the next staff in
// the pool, or null for "Unassigned". The pool is passed in by the caller
// (they have the staff list from state.staff).
export async function cycleTaskAssignee(uiId, staffPool) {
  const task = _tasks.find((t) => t.id === uiId);
  if (!task) throw new Error(`Unknown task: ${uiId}`);
  const rec = _recs[uiId];

  // Build the name list; include "Vendor" and "Unassigned" sentinel for UI only
  const currentName = rec?.assignee || 'Unassigned';
  const names = ['Unassigned', ...staffPool.map((s) => s.name)];
  if (task.vendor) names.push('Vendor');
  const idx = names.indexOf(currentName);
  const next = names[(idx + 1) % names.length];

  let staffId = null;
  if (next !== 'Unassigned' && next !== 'Vendor') {
    const match = staffPool.find((s) => s.name === next);
    staffId = match?.id || null;
  }

  const { error } = await supabase
    .from('tasks')
    .update({ assigned_staff_id: staffId })
    .eq('id', task._uuid);
  if (error) throw error;

  rec.assignee = next;
  return rec;
}
