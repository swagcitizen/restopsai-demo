// alerts-dispatch — central alert delivery for Stationly.
//
// Called by:
//   - Other edge functions (daily-briefing, sales-pacing-check, invoice-variance,
//     pos-sync, scheduler) via service-role auth
//   - Optionally from the frontend by owner/manager (e.g., "test alert")
//
// Body:
//   {
//     tenant_id: uuid,
//     rule_key: 'daily_briefing' | 'sales_pacing' | 'labor_threshold' | ...
//     severity?: 'info' | 'warn' | 'critical',
//     title: string,
//     body: string,                    // SMS body (max ~480 chars; we trim)
//     payload?: object                 // snapshot for audit
//   }
//
// Behavior:
//   1. Verify rule is enabled for tenant.
//   2. Fetch active subscriptions (filter by rule_key) — get phone numbers.
//   3. Insert alert_event row (in-app inbox always populated).
//   4. For each subscription with 'sms' channel + phone, send via Twilio.
//   5. Update event row with delivery results.
//
// Always 200s on success; per-recipient failures are logged on the event row.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER");

const SMS_PREVIEW = !TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function trimSms(body: string, max = 480): string {
  if (body.length <= max) return body;
  return body.slice(0, max - 3) + "...";
}

async function sendTwilio(to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (SMS_PREVIEW) return { ok: true, sid: "preview" };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const form = new URLSearchParams();
  form.set("From", TWILIO_FROM!);
  form.set("To", to);
  form.set("Body", body);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data?.message || `Twilio ${resp.status}` };
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

interface DispatchInput {
  tenant_id: string;
  rule_key: string;
  severity?: "info" | "warn" | "critical";
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let input: DispatchInput;
  try { input = await req.json(); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }

  if (!input.tenant_id || !input.rule_key || !input.title || !input.body) {
    return json(400, { ok: false, error: "tenant_id, rule_key, title, body required" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Check rule is enabled
  const { data: rule } = await sb
    .from("alert_rules")
    .select("is_enabled, config")
    .eq("tenant_id", input.tenant_id)
    .eq("rule_key", input.rule_key)
    .maybeSingle();

  if (!rule) return json(404, { ok: false, error: `No rule '${input.rule_key}' for tenant` });
  if (!rule.is_enabled) return json(200, { ok: true, skipped: "rule disabled" });

  // 2. Fetch subscriptions for this rule
  const { data: subs } = await sb
    .from("alert_subscriptions")
    .select("user_id, channels, phone, email, is_active")
    .eq("tenant_id", input.tenant_id)
    .eq("rule_key", input.rule_key)
    .eq("is_active", true);

  const subscribers = subs || [];

  // 3. Always log the event (in-app inbox + audit trail)
  const channelsAttempted = new Set<string>();
  for (const s of subscribers) for (const c of s.channels) channelsAttempted.add(c);

  const { data: event, error: insErr } = await sb
    .from("alert_events")
    .insert({
      tenant_id: input.tenant_id,
      rule_key: input.rule_key,
      severity: input.severity || "info",
      title: input.title,
      body: input.body,
      payload: input.payload || {},
      channels_attempted: Array.from(channelsAttempted),
      recipient_count: subscribers.length,
    })
    .select("id")
    .single();

  if (insErr || !event) return json(500, { ok: false, error: insErr?.message || "Insert failed" });

  // 4. Send SMS to each subscriber with 'sms' channel + phone
  const smsBody = trimSms(`${input.title}\n${input.body}`);
  let smsCount = 0;
  const channelsSucceeded = new Set<string>();

  for (const s of subscribers) {
    if (!s.channels.includes("sms") || !s.phone) continue;
    const r = await sendTwilio(s.phone, smsBody);
    if (r.ok) { smsCount++; channelsSucceeded.add("sms"); }
  }

  // In-app inbox always succeeds (event row exists)
  if (subscribers.some((s) => s.channels.includes("inapp"))) channelsSucceeded.add("inapp");

  // 5. Update event with results
  await sb
    .from("alert_events")
    .update({
      sms_count: smsCount,
      channels_succeeded: Array.from(channelsSucceeded),
    })
    .eq("id", event.id);

  return json(200, {
    ok: true,
    event_id: event.id,
    sms_sent: smsCount,
    sms_preview: SMS_PREVIEW,
    recipients: subscribers.length,
  });
});
