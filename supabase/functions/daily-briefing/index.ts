// daily-briefing — generates and dispatches the morning operator digest.
//
// Triggered by:
//   - Supabase pg_cron every 15 minutes (loops over tenants, checks local time)
//   - Or manual POST { tenant_id } from the app for "send a test briefing"
//
// For each enabled tenant, if "now in tenant tz" matches send_at_local (within
// the last 15 minutes), build digest from yesterday's data and dispatch.
// De-duped by checking alert_events for an existing 'daily_briefing' today.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function fmtUSD(n: number): string {
  return `$${(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number, decimals = 1): string {
  return `${(n || 0).toFixed(decimals)}%`;
}

// Get YYYY-MM-DD and HH:MM in given tz right now
function localNow(tz: string): { date: string; time: string; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  const minute = parseInt(get("hour")) * 60 + parseInt(get("minute"));
  return { date, time, minute };
}

// Yesterday in tenant tz as YYYY-MM-DD
function yesterdayInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const now = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

interface BriefingData {
  yesterdayRevenue: number;
  priorWeekSameDay: number;
  deltaPct: number;
  laborPct: number;
  primePct: number;
  callouts: number;
  invoicesDue: number;
  upcomingInspection: { name: string; days: number } | null;
}

async function buildBriefing(sb: any, tenantId: string, tz: string): Promise<BriefingData> {
  const yest = yesterdayInTz(tz);
  // Same weekday last week
  const yestDate = new Date(yest + "T12:00:00Z");
  const priorDate = new Date(yestDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prior = priorDate.toISOString().slice(0, 10);

  const [yestRow, priorRow] = await Promise.all([
    sb.from("daily_sales").select("gross_revenue, food_cost, labor_cost").eq("tenant_id", tenantId).eq("sales_date", yest).maybeSingle(),
    sb.from("daily_sales").select("gross_revenue").eq("tenant_id", tenantId).eq("sales_date", prior).maybeSingle(),
  ]);

  const yRev = Number(yestRow.data?.gross_revenue || 0);
  const pRev = Number(priorRow.data?.gross_revenue || 0);
  const food = Number(yestRow.data?.food_cost || 0);
  const labor = Number(yestRow.data?.labor_cost || 0);
  const laborPct = yRev > 0 ? (labor / yRev) * 100 : 0;
  const primePct = yRev > 0 ? ((food + labor) / yRev) * 100 : 0;
  const deltaPct = pRev > 0 ? ((yRev - pRev) / pRev) * 100 : 0;

  // Today's callouts (shifts marked called_out)
  const today = localNow(tz).date;
  const { data: shifts } = await sb
    .from("schedule_shifts")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .gte("starts_at", `${today}T00:00:00Z`)
    .lt("starts_at", `${today}T23:59:59Z`);
  const callouts = (shifts || []).filter((s: any) => s.status === "called_out").length;

  // Invoices due in next 7 days
  const weekAhead = new Date();
  weekAhead.setDate(weekAhead.getDate() + 7);
  const { count: invoicesDue } = await sb
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .lte("due_date", weekAhead.toISOString().slice(0, 10));

  // Upcoming inspection in 14 days
  const fortnightAhead = new Date();
  fortnightAhead.setDate(fortnightAhead.getDate() + 14);
  const { data: insp } = await sb
    .from("inspections")
    .select("name, scheduled_for")
    .eq("tenant_id", tenantId)
    .gte("scheduled_for", new Date().toISOString().slice(0, 10))
    .lte("scheduled_for", fortnightAhead.toISOString().slice(0, 10))
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();
  let upcoming = null;
  if (insp) {
    const days = Math.round((new Date(insp.scheduled_for).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    upcoming = { name: insp.name, days };
  }

  return {
    yesterdayRevenue: yRev, priorWeekSameDay: pRev, deltaPct,
    laborPct, primePct, callouts, invoicesDue: invoicesDue || 0,
    upcomingInspection: upcoming,
  };
}

function formatBriefingSMS(b: BriefingData, tenantName: string): { title: string; body: string } {
  const dlt = b.deltaPct >= 0 ? `+${b.deltaPct.toFixed(0)}%` : `${b.deltaPct.toFixed(0)}%`;
  const lines: string[] = [];
  lines.push(`Sales: ${fmtUSD(b.yesterdayRevenue)} (${dlt} vs last wk)`);
  if (b.laborPct > 0) {
    const flag = b.laborPct > 35 ? " ⚠️" : b.laborPct > 30 ? " ↑" : "";
    lines.push(`Labor ${fmtPct(b.laborPct, 0)}${flag} · Prime ${fmtPct(b.primePct, 0)}`);
  }
  if (b.callouts > 0) lines.push(`⚠️ ${b.callouts} callout${b.callouts > 1 ? "s" : ""} today`);
  if (b.invoicesDue > 0) lines.push(`${b.invoicesDue} invoice${b.invoicesDue > 1 ? "s" : ""} due this week`);
  if (b.upcomingInspection) lines.push(`📋 ${b.upcomingInspection.name} in ${b.upcomingInspection.days}d`);

  return {
    title: `${tenantName} · Morning briefing`,
    body: lines.join("\n"),
  };
}

async function dispatchBriefing(tenantId: string, tenantName: string, b: BriefingData): Promise<any> {
  const { title, body } = formatBriefingSMS(b, tenantName);
  const resp = await fetch(ALERTS_DISPATCH_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: tenantId, rule_key: "daily_briefing", severity: "info",
      title, body,
      payload: {
        revenue: b.yesterdayRevenue, delta_pct: b.deltaPct,
        labor_pct: b.laborPct, prime_pct: b.primePct,
        callouts: b.callouts, invoices_due: b.invoicesDue,
      },
    }),
  });
  return await resp.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let input: any = {};
  try { input = await req.json(); } catch {}

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Manual test mode: { tenant_id }
  if (input.tenant_id) {
    const { data: tenant } = await sb.from("tenants").select("id, name, timezone").eq("id", input.tenant_id).single();
    if (!tenant) return json(404, { ok: false, error: "Tenant not found" });
    const b = await buildBriefing(sb, tenant.id, tenant.timezone || "America/New_York");
    const r = await dispatchBriefing(tenant.id, tenant.name, b);
    return json(200, { ok: true, mode: "manual", tenant: tenant.name, briefing: b, dispatch: r });
  }

  // Cron mode: scan all tenants
  const { data: rules } = await sb
    .from("alert_rules")
    .select("tenant_id, config, tenants:tenant_id(id, name, timezone)")
    .eq("rule_key", "daily_briefing")
    .eq("is_enabled", true);

  const results: any[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const r of rules || []) {
    const tenant = (r as any).tenants;
    if (!tenant) continue;
    const tz = tenant.timezone || (r.config as any)?.tz || "America/New_York";
    const sendAt = (r.config as any)?.send_at_local || "06:00";
    const [hh, mm] = sendAt.split(":").map(Number);
    const targetMin = hh * 60 + mm;
    const { minute, date } = localNow(tz);

    // Within 15-minute window of target time
    if (Math.abs(minute - targetMin) > 15 && Math.abs(minute - targetMin) < 60 * 24 - 15) continue;

    // Already sent today? (dedupe)
    const { data: existing } = await sb
      .from("alert_events")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("rule_key", "daily_briefing")
      .gte("created_at", `${date}T00:00:00Z`)
      .limit(1)
      .maybeSingle();
    if (existing) { results.push({ tenant: tenant.name, skipped: "already sent today" }); continue; }

    const b = await buildBriefing(sb, tenant.id, tz);
    const dispatched = await dispatchBriefing(tenant.id, tenant.name, b);
    results.push({ tenant: tenant.name, sent: true, dispatch: dispatched });
  }

  return json(200, { ok: true, mode: "cron", processed: results.length, results });
});
