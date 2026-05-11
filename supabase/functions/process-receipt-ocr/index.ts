// supabase/functions/process-receipt-ocr/index.ts
//
// Calls Google Document AI (Expense Parser) on a receipt file stored in the
// `receipts` storage bucket, then writes structured fields back to the
// `receipts` and `receipt_line_items` tables.
//
// Required secrets (set via Supabase dashboard or `supabase secrets set`):
//   - DOCAI_SERVICE_ACCOUNT  full JSON of a GCP service account key with
//                            role "Document AI API User" on the loopmenu project
//   - DOCAI_PROCESSOR_ID     the bare processor id, e.g. "abcdef1234567890"
//   - DOCAI_LOCATION         optional, defaults to "us"
//   - DOCAI_PROJECT_ID       optional, defaults to the project_id field on
//                            the service account JSON (loopmenu)
//
// Invoked from the client via supabase.functions.invoke('process-receipt-ocr',
// { body: { receipt_id } }) immediately after the file finishes uploading.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

interface DocAiEntity {
  type: string;
  mentionText?: string;
  confidence?: number;
  normalizedValue?: {
    text?: string;
    moneyValue?: { currencyCode?: string; units?: string; nanos?: number };
    dateValue?: { year?: number; month?: number; day?: number };
  };
  properties?: DocAiEntity[];
}

// ─── Auth: service-account JWT → OAuth2 access token ──────────────────────────

function b64urlFromBytes(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claim))}`;

  const keyDer = pemToDer(sa.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyDer.buffer.slice(keyDer.byteOffset, keyDer.byteOffset + keyDer.byteLength),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64urlFromBytes(new Uint8Array(sigBuf))}`;

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.access_token as string;
}

// ─── Document AI entity helpers ───────────────────────────────────────────────

function moneyToNumber(e: DocAiEntity | undefined): number | null {
  if (!e) return null;
  const m = e.normalizedValue?.moneyValue;
  if (m && (m.units !== undefined || m.nanos !== undefined)) {
    const units = parseFloat(m.units || "0");
    const nanos = (m.nanos || 0) / 1e9;
    return units + nanos;
  }
  const raw = (e.normalizedValue?.text ?? e.mentionText ?? "").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function dateToISO(e: DocAiEntity | undefined): string | null {
  if (!e) return null;
  const d = e.normalizedValue?.dateValue;
  if (d?.year && d?.month && d?.day) {
    const mm = String(d.month).padStart(2, "0");
    const dd = String(d.day).padStart(2, "0");
    return `${d.year}-${mm}-${dd}`;
  }
  const txt = e.normalizedValue?.text ?? e.mentionText ?? "";
  const m = txt.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function textOf(e: DocAiEntity | undefined): string | null {
  if (!e) return null;
  return (e.normalizedValue?.text ?? e.mentionText ?? "").trim() || null;
}

function firstByType(entities: DocAiEntity[], ...types: string[]): DocAiEntity | undefined {
  for (const t of types) {
    const hit = entities.find((e) => e.type === t);
    if (hit) return hit;
  }
  return undefined;
}

function lineItemsOf(entities: DocAiEntity[]): DocAiEntity[] {
  return entities.filter((e) => e.type === "line_item");
}

function parseLineItem(li: DocAiEntity, position: number) {
  const props = li.properties || [];
  const desc = firstByType(props, "line_item/description");
  const qty = firstByType(props, "line_item/quantity");
  const unit = firstByType(props, "line_item/unit_price");
  const total = firstByType(props, "line_item/amount");
  const sku = firstByType(props, "line_item/product_code");
  return {
    position,
    description: textOf(desc),
    quantity: qty ? parseFloat((textOf(qty) || "").replace(/[^0-9.\-]/g, "")) || null : null,
    unit_price: moneyToNumber(unit),
    total_price: moneyToNumber(total),
    sku: textOf(sku),
    ocr_confidence: li.confidence ?? null,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function setReceiptStatus(
  receiptId: string,
  fields: Record<string, unknown>,
) {
  await fetch(`${SUPABASE_URL}/rest/v1/receipts?id=eq.${receiptId}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ...fields, ocr_processed_at: new Date().toISOString() }),
  });
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let receiptId = "";
  try {
    const body = await req.json().catch(() => ({}));
    receiptId = body.receipt_id;
    if (!receiptId) {
      return new Response(JSON.stringify({ error: "missing receipt_id" }), { status: 400, headers: cors });
    }

    // 1. Load the receipt row
    const rRes = await fetch(
      `${SUPABASE_URL}/rest/v1/receipts?id=eq.${receiptId}&select=id,tenant_id,storage_path,mime_type`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const rows = await rRes.json();
    const receipt = Array.isArray(rows) ? rows[0] : null;
    if (!receipt) {
      return new Response(JSON.stringify({ error: "receipt not found" }), { status: 404, headers: cors });
    }

    // 2. Read secrets
    const saJson = Deno.env.get("DOCAI_SERVICE_ACCOUNT");
    const processorId = Deno.env.get("DOCAI_PROCESSOR_ID");
    const location = Deno.env.get("DOCAI_LOCATION") || "us";
    if (!saJson || !processorId) {
      await setReceiptStatus(receiptId, {
        ocr_status: "skipped",
        ocr_error: "OCR not configured — DOCAI_SERVICE_ACCOUNT or DOCAI_PROCESSOR_ID missing",
      });
      return new Response(JSON.stringify({ ok: true, status: "skipped" }), { headers: cors });
    }
    const sa: ServiceAccount = JSON.parse(saJson);
    const projectId = Deno.env.get("DOCAI_PROJECT_ID") || sa.project_id;

    // Mark in-progress
    await setReceiptStatus(receiptId, { ocr_status: "processing", ocr_error: null });

    // 3. Download the file from storage
    const dlRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/receipts/${receipt.storage_path}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (!dlRes.ok) throw new Error(`storage download failed ${dlRes.status}`);
    const fileBuf = new Uint8Array(await dlRes.arrayBuffer());
    let b64 = "";
    const chunk = 0x8000;
    for (let i = 0; i < fileBuf.length; i += chunk) {
      b64 += String.fromCharCode(...fileBuf.subarray(i, i + chunk));
    }
    const contentB64 = btoa(b64);

    // 4. Get Google access token
    const token = await getAccessToken(sa);

    // 5. Call Document AI :process
    const url = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;
    const docRes = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        rawDocument: {
          content: contentB64,
          mimeType: receipt.mime_type || "image/jpeg",
        },
        skipHumanReview: true,
      }),
    });
    if (!docRes.ok) {
      const errText = await docRes.text();
      throw new Error(`Document AI ${docRes.status}: ${errText.slice(0, 500)}`);
    }
    const docJson = await docRes.json();
    const entities: DocAiEntity[] = docJson.document?.entities || [];

    // 6. Parse entities → receipt fields
    const supplier   = firstByType(entities, "supplier_name");
    const supplierAd = firstByType(entities, "supplier_address");
    const supplierPh = firstByType(entities, "supplier_phone");
    const totalEnt   = firstByType(entities, "total_amount", "net_amount");
    const subtotal   = firstByType(entities, "net_amount");
    const taxEnt     = firstByType(entities, "total_tax_amount", "tax_amount");
    const tipEnt     = firstByType(entities, "tip_amount");
    const dateEnt    = firstByType(entities, "receipt_date", "purchase_date", "invoice_date");
    const currency   = firstByType(entities, "currency");
    const payType    = firstByType(entities, "payment_type");
    const last4      = firstByType(entities, "credit_card_last_four_digits");

    const avgConf =
      entities.length > 0
        ? entities.reduce((a, e) => a + (e.confidence || 0), 0) / entities.length
        : null;

    const update: Record<string, unknown> = {
      vendor_name:    textOf(supplier),
      vendor_address: textOf(supplierAd),
      vendor_phone:   textOf(supplierPh),
      receipt_date:   dateToISO(dateEnt),
      total_amount:   moneyToNumber(totalEnt),
      subtotal_amount: moneyToNumber(subtotal),
      tax_amount:     moneyToNumber(taxEnt),
      tip_amount:     moneyToNumber(tipEnt),
      payment_method: textOf(payType),
      payment_last4:  textOf(last4),
      currency:       textOf(currency) || "USD",
      ocr_status:     "done",
      ocr_error:      null,
      ocr_confidence: avgConf,
      ocr_raw_json:   docJson.document?.entities ? { entities: docJson.document.entities } : null,
    };

    await fetch(`${SUPABASE_URL}/rest/v1/receipts?id=eq.${receiptId}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ...update, ocr_processed_at: new Date().toISOString() }),
    });

    // 7. Replace line items
    await fetch(`${SUPABASE_URL}/rest/v1/receipt_line_items?receipt_id=eq.${receiptId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const lineItems = lineItemsOf(entities).map((li, i) => ({
      ...parseLineItem(li, i),
      receipt_id: receiptId,
      tenant_id: receipt.tenant_id,
    }));
    if (lineItems.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/receipt_line_items`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(lineItems),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, status: "done", line_items: lineItems.length, vendor: update.vendor_name }),
      { headers: cors },
    );
  } catch (err) {
    console.error("OCR error:", err);
    if (receiptId) {
      await setReceiptStatus(receiptId, {
        ocr_status: "failed",
        ocr_error: String(err?.message || err).slice(0, 500),
      });
    }
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
