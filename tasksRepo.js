// tasksRepo.js — Supabase-backed tasks module.
// Adapts the DB schema (tasks + task_completions) to the shape the existing
// app.js renderTasks() UI expects:
//   - A `TASK_LIBRARY`-like array with { id (library_id or uuid), title, detail,
//     freq, category, sev, est, vendor }
//   - A `recs` map keyed by the same id with { lastDone, overdue, assignee, history }
//
// RLS takes care of tenant isolation — we only have to query.

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

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
    await offline.withOffline(
      async () => {
        const { error } = await supabase
          .from('task_completions')
          .delete()
          .eq('task_id', dbTaskId)
          .gte('completed_at', startOfDay)
          .lte('completed_at', endOfDay);
        if (error) throw error;
      },
      // Best-effort offline encode (range queries collapse to task_id eq)
      { table: 'task_completions', op: 'delete', payload: { match: { task_id: dbTaskId } }, optimisticValue: null }
    );
    rec.lastDone = null;
    rec.overdue = true;
  } else {
    const ctx = window.__RESTOPS_CTX__;
    if (!ctx) throw new Error('Tenant context not loaded');
    const id = offline.newId();
    const row = { id, tenant_id: ctx.tenantId, task_id: dbTaskId, completed_by: ctx.user.id };
    await offline.withOffline(
      async () => {
        const { error } = await supabase.from('task_completions').insert(row);
        if (error) throw error;
      },
      { table: 'task_completions', op: 'insert', payload: row, tenantId: ctx.tenantId, optimisticValue: row }
    );
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

  const tenantId = window.__RESTOPS_CTX__?.tenantId || null;
  await offline.withOffline(
    async () => {
      const { error } = await supabase.from('tasks').update({ assigned_staff_id: staffId }).eq('id', task._uuid);
      if (error) throw error;
    },
    { table: 'tasks', op: 'update', payload: { match: { id: task._uuid }, patch: { assigned_staff_id: staffId } }, tenantId, optimisticValue: null }
  );

  rec.assignee = next;
  return rec;
}

// ---------------------------------------------------------------------------
// Custom prep tasks CRUD (library_id IS NULL)
// ---------------------------------------------------------------------------
export async function addCustomTask({ title, detail = '', frequency = 'daily', category = 'Operations', severity = 'routine', estimatedMinutes = 0, assignedStaffId = null } = {}) {
  const ctx = window.__RESTOPS_CTX__;
  if (!ctx) throw new Error('Tenant context not loaded');
  const id = offline.newId();
  const row = {
    id,
    tenant_id: ctx.tenantId,
    library_id: null,
    title,
    detail,
    frequency,
    category,
    severity,
    estimated_minutes: estimatedMinutes || 0,
    is_vendor: false,
    assigned_staff_id: assignedStaffId,
    active: true,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('tasks').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'tasks', op: 'insert', payload: row, tenantId: ctx.tenantId, optimisticValue: row }
  );
}

export async function deleteCustomTask(id) {
  // Safety: this should only be invoked for custom tasks (library_id IS NULL).
  // We enforce that by including the filter on the request.
  const tenantId = window.__RESTOPS_CTX__?.tenantId || null;
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('tasks').delete().eq('id', id).is('library_id', null);
      if (error) throw error;
    },
    { table: 'tasks', op: 'delete', payload: { match: { id } }, tenantId, optimisticValue: { id, queued: true } }
  );
}

export async function updateCustomTask(id, patch) {
  const dbPatch = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.detail !== undefined) dbPatch.detail = patch.detail;
  if (patch.frequency !== undefined) dbPatch.frequency = patch.frequency;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.severity !== undefined) dbPatch.severity = patch.severity;
  if (patch.estimatedMinutes !== undefined) dbPatch.estimated_minutes = patch.estimatedMinutes;
  if (patch.assignedStaffId !== undefined) dbPatch.assigned_staff_id = patch.assignedStaffId;
  if (patch.active !== undefined) dbPatch.active = patch.active;
  if (Object.keys(dbPatch).length === 0) return;
  const tenantId = window.__RESTOPS_CTX__?.tenantId || null;
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('tasks').update(dbPatch).eq('id', id);
      if (error) throw error;
    },
    { table: 'tasks', op: 'update', payload: { match: { id }, patch: dbPatch }, tenantId, optimisticValue: { id, queued: true } }
  );
}

// Toggle a task's `active` flag (used for library tasks the tenant wants to mute).
export async function setTaskActive(id, active) {
  const tenantId = window.__RESTOPS_CTX__?.tenantId || null;
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('tasks').update({ active }).eq('id', id);
      if (error) throw error;
    },
    { table: 'tasks', op: 'update', payload: { match: { id }, patch: { active } }, tenantId, optimisticValue: { id, queued: true } }
  );
}
