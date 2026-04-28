// pos-sync-runner — nightly auto-sync for all active POS connections.
//
// Triggered by pg_cron at 04:00 UTC (midnight ET).
// For each active connection, fetches yesterday's sales/labor data from the
// provider and upserts into daily_sales + pos_transactions.
//
// Manual run: POST { connection_id }  or  { tenant_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

// -- Toast: GET /orders/v2/orders?startDate=&endDate=
async function fetchToastOrders(accessToken: string, restaurantGuid: string, dateStr: string): Promise<any[]> {
  const url = `https://ws-api.toasttab.com/orders/v2/orders?businessDate=${dateStr.replace(/-/g, "")}&pageSize=100`;
  const resp = await fetch(url, {
    headers: { "Authorization": `Bearer ${accessToken}`, "Toast-Restaurant-External-ID": restaurantGuid },
  });
  if (!resp.ok) throw new Error(`Toast orders fetch ${resp.status}`);
  return await resp.json();
}

// -- Square: GET /v2/orders/search
async function fetchSquareOrders(accessToken: string, locationId: string, startIso: string, endIso: string): Promise<any[]> {
  const url = "https://connect.squareup.com/v2/orders/search";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", "Square-Version": "2024-11-20" },
    body: JSON.stringify({
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { closed_at: { start_at: startIso, end_at: endIso } },
          state_filter: { states: ["COMPLETED"] },
        },
      },
      limit: 500,
    }),
  });
  if (!resp.ok) throw new Error(`Square orders fetch ${resp.status}`);
  const data = await resp.json();
  return data.orders || [];
}

interface SyncResult {
  connection_id: string;
  provider: string;
  tenant_id: string;
  status: "success" | "partial" | "failed";
  rows_fetched: number;
  rows_upserted: number;
  error?: string;
}

async function syncConnection(sb: any, conn: any, dateStr: string): Promise<SyncResult> {
  const result: SyncResult = {
    connection_id: conn.id, provider: conn.provider, tenant_id: conn.tenant_id,
    status: "running" as any, rows_fetched: 0, rows_upserted: 0,
  };

  // Insert sync run row
  const { data: run } = await sb.from("pos_sync_runs").insert({
    connection_id: conn.id, tenant_id: conn.tenant_id, provider: conn.provider,
    date_range_start: dateStr, date_range_end: dateStr,
  }).select("id").single();

  try {
    if (!conn.access_token_secret_id) throw new Error("No access token stored");
    const { data: token } = await sb.rpc("read_pos_secret", { p_id: conn.access_token_secret_id });
    if (!token) throw new Error("Token read returned null");

    let orders: any[] = [];
    let grossRevenue = 0;
    let txCount = 0;
    const transactions: any[] = [];

    if (conn.provider === "toast") {
      orders = await fetchToastOrders(token, conn.external_account_id, dateStr);
      result.rows_fetched = orders.length;
      for (const o of orders) {
        const checks = o.checks || [];
        for (const c of checks) {
          const gross = Number(c.amount || 0);
          grossRevenue += gross;
          txCount++;
          transactions.push({
            tenant_id: conn.tenant_id, provider: "toast",
            external_id: c.guid, occurred_at: c.openedDate,
            gross_amount: gross, tax_amount: Number(c.taxAmount || 0),
            tip_amount: Number(c.tipAmount || 0),
            net_amount: gross - Number(c.taxAmount || 0),
            payment_method: c.payments?.[0]?.type || null,
            raw: c,
          });
        }
      }
    } else if (conn.provider === "square") {
      const startIso = `${dateStr}T00:00:00Z`;
      const endIso = `${dateStr}T23:59:59Z`;
      orders = await fetchSquareOrders(token, conn.external_account_id, startIso, endIso);
      result.rows_fetched = orders.length;
      for (const o of orders) {
        const gross = Number(o.total_money?.amount || 0) / 100;
        grossRevenue += gross;
        txCount++;
        transactions.push({
          tenant_id: conn.tenant_id, provider: "square",
          external_id: o.id, occurred_at: o.closed_at || o.created_at,
          gross_amount: gross,
          tax_amount: Number(o.total_tax_money?.amount || 0) / 100,
          tip_amount: Number(o.total_tip_money?.amount || 0) / 100,
          discount_amount: Number(o.total_discount_money?.amount || 0) / 100,
          net_amount: gross - (Number(o.total_tax_money?.amount || 0) / 100),
          raw: o,
        });
      }
    } else {
      throw new Error(`Unsupported provider: ${conn.provider}`);
    }

    // Upsert transactions
    if (transactions.length > 0) {
      const { error: txErr } = await sb.from("pos_transactions").upsert(transactions, { onConflict: "tenant_id,provider,external_id" });
      if (txErr) throw new Error(`tx upsert: ${txErr.message}`);
      result.rows_upserted = transactions.length;
    }

    // Upsert daily_sales rollup (only if non-zero)
    if (grossRevenue > 0 || txCount > 0) {
      await sb.from("daily_sales").upsert({
        tenant_id: conn.tenant_id, sales_date: dateStr,
        gross_revenue: grossRevenue, transactions: txCount,
        source: conn.provider,
      }, { onConflict: "tenant_id,sales_date" });
    }

    // Update connection
    await sb.from("pos_connections").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "success",
      last_sync_error: null,
      rows_imported_total: (conn.rows_imported_total || 0) + transactions.length,
    }).eq("id", conn.id);

    // Update sync run
    if (run) {
      await sb.from("pos_sync_runs").update({
        finished_at: new Date().toISOString(), status: "success",
        rows_fetched: result.rows_fetched, rows_upserted: result.rows_upserted,
      }).eq("id", run.id);
    }

    result.status = "success";
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    result.status = "failed";
    result.error = msg;

    await sb.from("pos_connections").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "error", last_sync_error: msg,
    }).eq("id", conn.id);

    if (run) {
      await sb.from("pos_sync_runs").update({
        finished_at: new Date().toISOString(), status: "failed", error_message: msg,
      }).eq("id", run.id);
    }
    return result;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // yesterday in UTC (cron runs at 04:00 UTC = local midnight ET, so yesterday is correct)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateStr = isoDate(yesterday);

  let input: any = {};
  if (req.method === "POST") { try { input = await req.json(); } catch {} }

  let query = sb.from("pos_connections").select("*").eq("status", "active");
  if (input.connection_id) query = query.eq("id", input.connection_id);
  else if (input.tenant_id) query = query.eq("tenant_id", input.tenant_id);

  const { data: conns, error } = await query;
  if (error) return json(500, { ok: false, error: error.message });

  const results: SyncResult[] = [];
  for (const conn of conns || []) {
    const r = await syncConnection(sb, conn, input.date || dateStr);
    results.push(r);
  }

  return json(200, { ok: true, date: input.date || dateStr, processed: results.length, results });
});
