// offlineQueue.js — IndexedDB-backed write queue + read cache for offline mode.
//
// API:
//   await enqueue({ table, op, payload, tenantId })
//   const n = await pendingCount()
//   await flush()                     // drains queue when online
//   await cacheRead(table, data)
//   const cached = await getCachedRead(table)
//
// Storage layout (DB: stationly-offline-v1):
//   - pendingWrites  : { id (autoIncrement), table, op, payload, attempts, createdAt, tenantId, clientId }
//   - cachedReads    : keyPath = key  ->  { key, table, tenantId, data, fetchedAt }
//
// Conflict policy: last-write-wins (server timestamps are authoritative on flush).
// Inserts use client-generated UUIDs in payload.id so the row keeps a stable id
// when it eventually syncs.

import { supabase } from './supabaseClient.js';

const DB_NAME = 'stationly-offline-v1';
const DB_VERSION = 1;
const STORE_PENDING = 'pendingWrites';
const STORE_CACHE = 'cachedReads';
const MAX_ATTEMPTS = 5;

let _dbPromise = null;
let _flushing = false;

// ---------------------------------------------------------------------------
// Client ID — stable per-browser uuid (NOT a schema column; used in payload metadata only)
// ---------------------------------------------------------------------------
const CLIENT_ID_KEY = 'stationly:clientId';
function getClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}
export const clientId = getClientId();

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function enqueue({ table, op, payload, tenantId }) {
  const store = await tx(STORE_PENDING, 'readwrite');
  const record = {
    table,
    op,                 // 'insert' | 'update' | 'delete' | 'rpc'
    payload,            // op-specific shape (see flush)
    attempts: 0,
    createdAt: Date.now(),
    tenantId: tenantId || null,
    clientId,
  };
  const id = await reqAsPromise(store.add(record));
  document.dispatchEvent(new CustomEvent('offline:enqueued', { detail: { id, table, op } }));
  return id;
}

export async function pendingCount() {
  try {
    const store = await tx(STORE_PENDING);
    return await reqAsPromise(store.count());
  } catch {
    return 0;
  }
}

export async function listPending() {
  const store = await tx(STORE_PENDING);
  return reqAsPromise(store.getAll());
}

export async function clearPending() {
  const store = await tx(STORE_PENDING, 'readwrite');
  await reqAsPromise(store.clear());
}

async function deletePending(id) {
  const store = await tx(STORE_PENDING, 'readwrite');
  return reqAsPromise(store.delete(id));
}

async function updatePending(record) {
  const store = await tx(STORE_PENDING, 'readwrite');
  return reqAsPromise(store.put(record));
}

export async function cacheRead(table, data, tenantId = null) {
  try {
    const store = await tx(STORE_CACHE, 'readwrite');
    const tid = tenantId || (window.__RESTOPS_CTX__?.tenantId) || 'anon';
    const key = `${tid}:${table}`;
    await reqAsPromise(store.put({ key, table, tenantId: tid, data, fetchedAt: Date.now() }));
  } catch (err) {
    console.warn('[offlineQueue.cacheRead] failed:', err);
  }
}

export async function getCachedRead(table, tenantId = null) {
  try {
    const store = await tx(STORE_CACHE);
    const tid = tenantId || (window.__RESTOPS_CTX__?.tenantId) || 'anon';
    const key = `${tid}:${table}`;
    const rec = await reqAsPromise(store.get(key));
    return rec ? rec.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Flush — drain queued writes to Supabase. No-op if already flushing.
// ---------------------------------------------------------------------------
export async function flush({ onProgress } = {}) {
  if (_flushing) return { synced: 0, failed: 0, skipped: true };
  _flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = await listPending();
    items.sort((a, b) => a.id - b.id);
    for (const item of items) {
      try {
        await applyOne(item);
        await deletePending(item.id);
        synced += 1;
        if (onProgress) onProgress({ done: synced, total: items.length });
        document.dispatchEvent(new CustomEvent('offline:synced', { detail: { id: item.id } }));
      } catch (err) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = (err && err.message) || String(err);
        if (item.attempts >= MAX_ATTEMPTS) {
          // Give up: drop it but log loudly so the user can be notified.
          console.error('[offlineQueue] dropping after max attempts:', item, err);
          await deletePending(item.id);
        } else {
          await updatePending(item);
        }
        failed += 1;
      }
    }
  } finally {
    _flushing = false;
    document.dispatchEvent(new CustomEvent('offline:flush:done', { detail: { synced, failed } }));
  }
  return { synced, failed };
}

async function applyOne(item) {
  const { table, op, payload } = item;
  if (op === 'insert') {
    const { error } = await supabase.from(table).insert(payload);
    if (error) throw error;
    return;
  }
  if (op === 'update') {
    // payload: { match: {col: val}, patch: {...} }
    const { match, patch } = payload || {};
    if (!match || !patch) throw new Error('update requires match+patch');
    let q = supabase.from(table).update(patch);
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    const { error } = await q;
    if (error) throw error;
    return;
  }
  if (op === 'delete') {
    // payload: { match: {col: val} }
    const { match } = payload || {};
    if (!match) throw new Error('delete requires match');
    let q = supabase.from(table).delete();
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    const { error } = await q;
    if (error) throw error;
    return;
  }
  if (op === 'rpc') {
    // payload: { fn: 'name', args: {...} }
    const { fn, args } = payload || {};
    const { error } = await supabase.rpc(fn, args || {});
    if (error) throw error;
    return;
  }
  throw new Error(`Unknown op: ${op}`);
}

// ---------------------------------------------------------------------------
// withOffline — wraps a write call. If `fn` throws a network error, enqueue and
// return the optimisticValue. The caller is expected to have already applied
// the optimistic mutation locally.
// ---------------------------------------------------------------------------
export async function withOffline(fn, { table, op, payload, tenantId, optimisticValue } = {}) {
  try {
    return await fn();
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue({ table, op, payload, tenantId });
      try {
        document.dispatchEvent(new CustomEvent('offline:queued', { detail: { table, op } }));
      } catch {}
      return optimisticValue;
    }
    throw err;
  }
}

export function isNetworkError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    err.name === 'TypeError' && /fetch/i.test(msg)
  ) || /failed to fetch/i.test(msg)
    || /network ?error/i.test(msg)
    || /load failed/i.test(msg)
    || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

// Generate stable UUIDs for offline-safe inserts.
export function newId() {
  try { return crypto.randomUUID(); } catch { return `c-${Date.now()}-${Math.random().toString(36).slice(2,10)}`; }
}
