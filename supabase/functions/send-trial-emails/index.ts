// send-trial-emails — runs daily on cron.
//
// For each tenant with status='trialing', look up days_into_trial, decide
// which template to send today (if any), and send it via Resend. Each
// (tenant, kind) row in tenant_email_log is uniquely constrained so the
// cron is idempotent — re-running on the same day is a no-op.
//
// Trigger: pg_cron from a separate migration calls this edge function once
// per day at 13:00 UTC (≈ 9 AM Eastern). Service role key.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDR    = Deno.env.get("EMAIL_FROM") ?? "Stationly <hello@stationly.ai>";
const APP_URL      = Deno.env.get("APP_URL")    ?? "https://stationly.ai";

interface Target {
  tenant_id: string;
  tenant_name: string | null;
  status: string;
  trial_ends_at: string | null;
  days_into_trial: number;
  days_left: number;
  recipient_email: string | null;
}

type Kind = "welcome" | "day7" | "day15" | "day22" | "day27" | "day29" | "day30_expired";

function pickKind(daysIn: number): Kind | null {
  if (daysIn <= 0) return "welcome";
  if (daysIn === 7)  return "day7";
  if (daysIn === 15) return "day15";
  if (daysIn === 22) return "day22";
  if (daysIn === 27) return "day27";
  if (daysIn === 29) return "day29";
  if (daysIn >= 30)  return "day30_expired";
  return null;
}

interface Tmpl { subject: string; html: string; text: string; }

function template(kind: Kind, name: string, daysLeft: number): Tmpl {
  const billingUrl = `${APP_URL}/app.html#billing`;
  const greeting = name ? `Hi ${name.split(/\s+/)[0] || ""}` : "Hi there";

  const button = (href: string, label: string) =>
    `<p style="margin:24px 0;"><a href="${href}" style="background:#E8A33D;color:#0a0a0a;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">${label}</a></p>`;

  const wrap = (body: string) => `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.55;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:36px;max-width:560px;">
<tr><td>
<div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;margin-bottom:24px;">Stationly</div>
${body}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:28px 0 16px;">
<div style="font-size:12px;color:#888;">
Sent by Stationly · St. Cloud, MN · <a href="${APP_URL}" style="color:#888;">stationly.ai</a><br>
Manage billing in your <a href="${billingUrl}" style="color:#888;">account settings</a>.
</div>
</td></tr></table>
</td></tr></table>
</body></html>`;

  switch (kind) {
    case "welcome":
      return {
        subject: "Welcome to Stationly — your 30-day trial just started",
        html: wrap(`
<p>${greeting},</p>
<p>Your Stationly trial is live. You have <strong>30 days</strong> to set up your stations, run a few prep cycles, and see what shifts feel like with everything in one place.</p>
<p>Three things worth doing first:</p>
<ul>
  <li>Add your team and stations</li>
  <li>Import your menu or your first prep list</li>
  <li>Print a test ticket to make sure your printer's wired up</li>
</ul>
${button(APP_URL + "/app.html", "Open Stationly")}
<p>Reply to this email with any questions — it goes straight to me.</p>
<p>— Stationly</p>`),
        text: `${greeting},\n\nYour Stationly trial is live. You have 30 days to set things up.\n\nGet started: ${APP_URL}/app.html\n\n— Stationly`,
      };

    case "day7":
      return {
        subject: "How's your first week with Stationly going?",
        html: wrap(`
<p>${greeting},</p>
<p>You're a week into your Stationly trial. <strong>${daysLeft} days left.</strong></p>
<p>If something's not clicking — POS import, station setup, anything — reply to this email and I'll help you sort it out same day.</p>
<p>The teams that get the most out of Stationly usually do these in week one:</p>
<ul>
  <li>Run a real prep cycle on a station, not just a test</li>
  <li>Watch the dashboard during a live shift</li>
  <li>Set up at least one alert</li>
</ul>
${button(APP_URL + "/app.html", "Open Stationly")}
<p>— Stationly</p>`),
        text: `${greeting},\n\nYou're a week in. ${daysLeft} days left in your trial.\n\nReply with any questions. ${APP_URL}/app.html\n\n— Stationly`,
      };

    case "day15":
      return {
        subject: `${daysLeft} days left in your Stationly trial`,
        html: wrap(`
<p>${greeting},</p>
<p>You're halfway through your 30-day trial. <strong>${daysLeft} days left.</strong></p>
<p>If Stationly is working for you, now is a good time to add a payment method so there's no break in service when the trial ends.</p>
<p>Pricing is straightforward: <strong>$89/location/month</strong> month-to-month, or $71/location/month billed annually (20% off). Cancel anytime from your dashboard.</p>
${button(billingUrl, "Add billing")}
<p>If something's holding you back, hit reply — I'd genuinely like to know.</p>
<p>— Stationly</p>`),
        text: `${greeting},\n\nHalfway through your trial — ${daysLeft} days left.\n\n$89/location/month or $71/location/month annual.\n\nAdd billing: ${billingUrl}\n\n— Stationly`,
      };

    case "day22":
      return {
        subject: `Stationly trial — ${daysLeft} days left`,
        html: wrap(`
<p>${greeting},</p>
<p>About a week left in your Stationly trial. <strong>${daysLeft} days.</strong></p>
<p>Adding billing now means nothing changes when the trial ends — same data, same setup, no rebuild.</p>
${button(billingUrl, "Add a payment method")}
<p>Questions about pricing or rolling out to multiple locations? Reply here.</p>
<p>— Stationly</p>`),
        text: `${greeting},\n\n${daysLeft} days left in your trial.\n\nAdd billing: ${billingUrl}\n\n— Stationly`,
      };

    case "day27":
      return {
        subject: "3 days left — keep your Stationly access",
        html: wrap(`
<p>${greeting},</p>
<p><strong>3 days left</strong> in your trial. After that your account flips to read-only — your data stays put, but you can't add prep, log waste, or run shifts until billing is added.</p>
${button(billingUrl, "Add billing now")}
<p>Takes about 60 seconds.</p>
<p>— Stationly</p>`),
        text: `${greeting},\n\n3 days left. Your account flips read-only after that.\n\nAdd billing: ${billingUrl}\n\n— Stationly`,
      };

    case "day29":
      return {
        subject: "Trial ends tomorrow",
        html: wrap(`
<p>${greeting},</p>
<p>Your Stationly trial ends <strong>tomorrow</strong>. If you don't add billing, the account drops to read-only at midnight — data preserved, writes paused.</p>
${button(billingUrl, "Add billing")}
<p>Need more time or have a question? Reply here, I'll see it within the hour.</p>
<p>— Stationly</p>`),
        text: `${greeting},\n\nTrial ends tomorrow. Read-only after that until billing is added.\n\n${billingUrl}\n\n— Stationly`,
      };

    case "day30_expired":
      return {
        subject: "Trial ended — your Stationly data is safe, account is read-only",
        html: wrap(`
<p>${greeting},</p>
<p>Your trial ended. Your account is now <strong>read-only</strong> — every station, recipe, count, and shift you set up is preserved exactly as you left it.</p>
<p>Add a payment method whenever you're ready and writes resume immediately. There's no expiration on the data.</p>
${button(billingUrl, "Reactivate Stationly")}
<p>Any questions or feedback about why you didn't convert, please reply — I read every one.</p>
<p>— Stationly</p>`),
        text: `${greeting},\n\nTrial ended — account is read-only. Data preserved.\n\nReactivate: ${billingUrl}\n\n— Stationly`,
      };
  }
}

async function sendOne(to: string, t: Tmpl): Promise<{ id?: string; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDR,
      to: [to],
      subject: t.subject,
      html: t.html,
      text: t.text,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.message || `resend ${res.status}` };
  return { id: data.id };
}

async function sb(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

Deno.serve(async (req: Request) => {
  // Allow either POST (cron / manual) or GET (manual debug).
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  // 1. Pull trial targets.
  const targetsRes = await sb("GET", "/trial_email_targets?select=*");
  if (!targetsRes.ok) {
    return new Response(JSON.stringify({ error: "fetch_targets_failed", status: targetsRes.status }), { status: 500 });
  }
  const targets = await targetsRes.json() as Target[];

  const summary: Record<string, unknown>[] = [];

  for (const tgt of targets) {
    if (!tgt.recipient_email) continue;
    const kind = pickKind(tgt.days_into_trial);
    if (!kind) { summary.push({ tenant: tgt.tenant_id, skipped: "no_kind_today" }); continue; }

    // Check dedup
    const checkRes = await sb("GET",
      `/tenant_email_log?tenant_id=eq.${tgt.tenant_id}&kind=eq.${kind}&select=id`);
    const existing = await checkRes.json() as { id: string }[];
    if (existing.length) {
      summary.push({ tenant: tgt.tenant_id, kind, skipped: "already_sent" });
      continue;
    }

    const tmpl = template(kind, tgt.tenant_name ?? "", tgt.days_left);

    if (dryRun) {
      summary.push({ tenant: tgt.tenant_id, kind, dry_run: true, subject: tmpl.subject });
      continue;
    }

    const sendRes = await sendOne(tgt.recipient_email, tmpl);

    await sb("POST", "/tenant_email_log", {
      tenant_id: tgt.tenant_id,
      recipient_email: tgt.recipient_email,
      kind,
      subject: tmpl.subject,
      resend_id: sendRes.id ?? null,
      error: sendRes.error ?? null,
    });

    summary.push({ tenant: tgt.tenant_id, kind, sent: !!sendRes.id, error: sendRes.error });
  }

  return new Response(JSON.stringify({ ok: true, processed: summary.length, summary }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
