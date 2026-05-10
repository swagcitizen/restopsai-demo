// receiptsRepo.js — Supabase-backed Receipt Repository module.
// Manages receipts + receipt_line_items tables.
// RLS handles all tenant isolation — no manual auth.uid() checks needed.
//
// NOTE: OCR call is intentionally a stub. The edge function
// process-receipt-ocr will be wired once Document AI credentials are provided.

import { supabase } from './supabaseClient.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function wrapError(e, msg) {
  const friendly = new Error(`${msg}: ${e?.message || e}`);
  friendly.original = e;
  return friendly;
}

function sanitizeFilename(name) {
  return (name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 120);
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * List receipts for a tenant from the receipts_with_details view.
 * @param {string} tenantId
 * @param {{ limit?: number, status?: string, vendor?: string, dateFrom?: string, dateTo?: string, search?: string, category?: string }} opts
 * @returns {Promise<Array>}
 */
export async function listReceipts(tenantId, opts = {}) {
  const {
    limit = 50,
    status,
    vendor,
    dateFrom,
    dateTo,
    search,
    category,
  } = opts;

  let q = supabase
    .from('receipts_with_details')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('voided_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(limit);

  if (status)    q = q.eq('ocr_status', status);
  if (vendor)    q = q.ilike('vendor_name', `%${vendor}%`);
  if (dateFrom)  q = q.gte('receipt_date', dateFrom);
  if (dateTo)    q = q.lte('receipt_date', dateTo);
  if (category)  q = q.eq('category', category);
  if (search) {
    q = q.or(
      `vendor_name.ilike.%${search}%,notes.ilike.%${search}%,file_name.ilike.%${search}%`
    );
  }

  const { data, error } = await q;
  if (error) throw wrapError(error, 'Failed to load receipts');
  return data || [];
}

// ─── Get single ───────────────────────────────────────────────────────────────

/**
 * Get a single receipt + its line items.
 * @param {string} id
 * @returns {Promise<{ receipt: object, lineItems: Array }>}
 */
export async function getReceipt(id) {
  const [receiptRes, lineItemsRes] = await Promise.all([
    supabase
      .from('receipts_with_details')
      .select('*')
      .eq('id', id)
      .single(),
    supabase
      .from('receipt_line_items')
      .select('*')
      .eq('receipt_id', id)
      .order('position', { ascending: true }),
  ]);

  if (receiptRes.error) throw wrapError(receiptRes.error, 'Failed to load receipt');
  if (lineItemsRes.error) throw wrapError(lineItemsRes.error, 'Failed to load receipt line items');

  return {
    receipt: receiptRes.data,
    lineItems: lineItemsRes.data || [],
  };
}

// ─── Signed URL ───────────────────────────────────────────────────────────────

/**
 * Generate a signed URL for a file in the receipts bucket.
 * @param {string} storagePath
 * @param {number} expiresInSec
 * @returns {Promise<string>}
 */
export async function getSignedUrl(storagePath, expiresInSec = 3600) {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(storagePath, expiresInSec);
  if (error) throw wrapError(error, 'Failed to create signed URL');
  return data.signedUrl;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a file to the receipts bucket and insert a receipts row.
 * Generates receipt ID client-side so we can reference it in the path before insert.
 * @param {string} tenantId
 * @param {string} userId
 * @param {File|Blob} file
 * @param {string} source  — 'upload' | 'camera' | 'email' | 'import'
 * @returns {Promise<object>}  the created receipt row
 */
export async function uploadReceiptFile(tenantId, userId, file, source = 'upload') {
  const receiptId = crypto.randomUUID();
  const safeName  = sanitizeFilename(file.name || 'receipt');
  const storagePath = `${tenantId}/${receiptId}/${safeName}`;

  // 1. Upload file to storage
  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });

  if (uploadError) throw wrapError(uploadError, 'Failed to upload receipt file');

  // 2. Insert receipts row with the pre-generated ID
  const { data, error: insertError } = await supabase
    .from('receipts')
    .insert({
      id:              receiptId,
      tenant_id:       tenantId,
      uploaded_by:     userId,
      source:          source,
      storage_path:    storagePath,
      file_name:       file.name || safeName,
      file_size_bytes: file.size || null,
      mime_type:       file.type || null,
      ocr_status:      'pending',
    })
    .select()
    .single();

  if (insertError) {
    // Best-effort cleanup of orphan storage object
    await supabase.storage.from('receipts').remove([storagePath]).catch(() => null);
    throw wrapError(insertError, 'Failed to create receipt record');
  }

  return data;
}

// ─── Trigger OCR (stub) ───────────────────────────────────────────────────────

/**
 * Trigger OCR processing for a receipt.
 * STUB — currently marks the receipt as 'skipped' since Document AI is not yet configured.
 * The real edge function (process-receipt-ocr) is deployed as a stub and will be
 * replaced once the Document AI service account is provided.
 * @param {string} receiptId
 * @returns {Promise<void>}
 */
export async function triggerOcr(receiptId) {
  try {
    const { error } = await supabase.functions.invoke('process-receipt-ocr', {
      body: { receipt_id: receiptId },
    });
    if (error) throw error;
  } catch (e) {
    // Fall back to direct update if edge function invocation fails
    await supabase
      .from('receipts')
      .update({
        ocr_status: 'skipped',
        ocr_error:  'OCR not yet configured — pending Document AI setup',
      })
      .eq('id', receiptId)
      .catch(() => null);
  }
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update receipt fields (manual edit of extracted or user-entered data).
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
export async function updateReceipt(id, patch) {
  // Prevent accidental overwrite of OCR-internal fields via this path
  const { id: _id, tenant_id, uploaded_by, created_at, ...safePatch } = patch;

  const { data, error } = await supabase
    .from('receipts')
    .update(safePatch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw wrapError(error, 'Failed to update receipt');
  return data;
}

// ─── Void ─────────────────────────────────────────────────────────────────────

/**
 * Void a receipt.
 * @param {string} id
 * @param {string} reason
 * @returns {Promise<object>}
 */
export async function voidReceipt(id, reason) {
  const { data, error } = await supabase
    .from('receipts')
    .update({
      voided_at:   new Date().toISOString(),
      void_reason: reason || 'Voided',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw wrapError(error, 'Failed to void receipt');
  return data;
}

// ─── Link to bill ─────────────────────────────────────────────────────────────

/**
 * Link a receipt to an existing bill/invoice.
 * @param {string} receiptId
 * @param {string} billId
 * @returns {Promise<object>}
 */
export async function linkToBill(receiptId, billId) {
  const { data, error } = await supabase
    .from('receipts')
    .update({
      bill_id:     billId,
      bill_status: 'linked',
    })
    .eq('id', receiptId)
    .select()
    .single();

  if (error) throw wrapError(error, 'Failed to link receipt to bill');
  return data;
}

// ─── Create draft bill (stub) ─────────────────────────────────────────────────

/**
 * Mark a receipt as the basis for a draft bill.
 * STUB — will be wired to the invoices/bills table once AP integration is confirmed.
 * @param {string} receiptId
 * @returns {Promise<null>}
 */
export async function createDraftBill(receiptId) {
  const { error } = await supabase
    .from('receipts')
    .update({ bill_status: 'draft' })
    .eq('id', receiptId);

  if (error) throw wrapError(error, 'Failed to mark receipt as draft bill');
  return null; // stub — real bill object returned once wired
}
