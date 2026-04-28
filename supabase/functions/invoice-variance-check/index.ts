// invoice-variance-check
// POST { invoice_id: uuid, threshold?: number (default 0.15) }
// 1. Calls public.check_invoice_variance(invoice_id, threshold)
// 2. If any rows returned, fires an `invoice_variance` alert via alerts-dispatch
// 3. Returns the flagged lines for the UI to surface

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALERTS_DISPATCH_URL = `${SUPABASE_URL}/functions/v1/alerts-dispatch`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fmtMoney(n: number): string {
  return `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface VarianceRow {
  line_id: string;
  category: string;
  raw_description: string;
  current_unit_price: number;
  baseline_avg_price: number;
  variance_pct: number;
  vendor: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let body: { invoice_id?: string; threshold?: number } = {};
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }

  const invoiceId = body.invoice_id;
  const threshold = typeof body.threshold === "number" ? body.threshold : 0.15;
  if (!invoiceId) return json(400, { ok: false, error: "invoice_id required" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Look up the invoice (need tenant_id + vendor + invoice metadata for the alert body)
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("id, tenant_id, vendor, invoice_number, invoice_date, total")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr) return json(500, { ok: false, error: invErr.message });
  if (!invoice) return json(404, { ok: false, error: "Invoice not found" });

  // Run the variance RPC
  const { data: rows, error: rpcErr } = await admin
    .rpc("check_invoice_variance", { p_invoice_id: invoiceId, p_threshold: threshold });

  if (rpcErr) return json(500, { ok: false, error: rpcErr.message });

  const flagged: VarianceRow[] = (rows || []) as VarianceRow[];

  // No flags → nothing to alert
  if (flagged.length === 0) {
    return json(200, { ok: true, flagged_count: 0, flagged: [] });
  }

  // Build alert title + body
  const top = flagged[0];
  const more = flagged.length > 1 ? ` (+${flagged.length - 1} more)` : "";
  const title = `⚠️ Invoice price hike: ${invoice.vendor || "Unknown"}`;
  const lines = flagged.slice(0, 5).map(f => {
    const desc = (f.raw_description || "").slice(0, 50);
    return `• ${desc}: ${fmtMoney(f.baseline_avg_price)} → ${fmtMoney(f.current_unit_price)} (+${fmtPct(f.variance_pct)})`;
  }).join("\n");
  const bodyText =
    `${invoice.vendor || "Vendor"} invoice ${invoice.invoice_number || ""} — ${flagged.length} line${flagged.length === 1 ? "" : "s"} above 4-week avg by >${(threshold * 100).toFixed(0)}%${more}\n\n${lines}`;

  // Fire the alert (idempotent via dedupe_key on invoice_id)
  try {
    const resp = await fetch(ALERTS_DISPATCH_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: invoice.tenant_id,
        rule_key: "invoice_variance",
        severity: "warn",
        title,
        body: bodyText,
        dedupe_key: `invoice_variance:${invoiceId}`,
        payload: {
          invoice_id: invoiceId,
          vendor: invoice.vendor,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          flagged_count: flagged.length,
          top_variance_pct: top.variance_pct,
          flagged: flagged.slice(0, 10).map(f => ({
            description: f.raw_description,
            category: f.category,
            from: f.baseline_avg_price,
            to: f.current_unit_price,
            variance_pct: f.variance_pct,
          })),
        },
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("[invoice-variance-check] alerts-dispatch failed", resp.status, txt);
    }
  } catch (err) {
    console.error("[invoice-variance-check] alerts-dispatch exception", err);
  }

  return json(200, {
    ok: true,
    flagged_count: flagged.length,
    flagged: flagged.map(f => ({
      line_id: f.line_id,
      category: f.category,
      description: f.raw_description,
      from: f.baseline_avg_price,
      to: f.current_unit_price,
      variance_pct: f.variance_pct,
    })),
  });
});
