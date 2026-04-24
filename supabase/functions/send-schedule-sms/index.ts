// send-schedule-sms — send each staff member their formatted weekly schedule via Twilio.
//
// Input (POST body):
//   {
//     publish_id: string,       // schedule_publishes.id, for audit
//     messages: [
//       { staff_id, name, phone, body }
//     ]
//   }
//
// If TWILIO_* env vars are not set, the function returns status="preview" and
// per-message status="preview" so the frontend can show what WOULD be sent.
// Once the user adds Twilio secrets via the Supabase dashboard, real SMS go out.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface MessageIn {
  staff_id: string;
  name: string;
  phone: string;
  body: string;
}

interface DeliveryResult {
  staff_id: string;
  name: string;
  phone: string;
  status: "sent" | "failed" | "preview";
  sid?: string;
  error?: string;
}

async function sendTwilioSms(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string,
): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const form = new URLSearchParams();
  form.set("From", from);
  form.set("To", to);
  form.set("Body", body);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data?.message || `Twilio error ${resp.status}` };
    }
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let payload: { publish_id?: string; messages?: MessageIn[] };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length === 0) {
    return json(200, { ok: true, status: "sent", delivery_results: [] });
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromPhone = Deno.env.get("TWILIO_PHONE");

  // Preview mode — no Twilio creds configured yet
  if (!accountSid || !authToken || !fromPhone) {
    const results: DeliveryResult[] = messages.map((m) => ({
      staff_id: m.staff_id,
      name: m.name,
      phone: m.phone,
      status: "preview",
    }));
    return json(200, {
      ok: true,
      status: "preview",
      delivery_results: results,
      note: "TWILIO_* secrets not set. Add them in Supabase Dashboard > Edge Functions > Secrets to send real SMS.",
    });
  }

  // Real send — run in parallel with a sensible concurrency cap (fire all, Twilio handles ordering)
  const results: DeliveryResult[] = await Promise.all(
    messages.map(async (m): Promise<DeliveryResult> => {
      if (!m.phone) {
        return { staff_id: m.staff_id, name: m.name, phone: "", status: "failed", error: "no phone" };
      }
      const r = await sendTwilioSms(accountSid, authToken, fromPhone, m.phone, m.body);
      if (r.ok) return { staff_id: m.staff_id, name: m.name, phone: m.phone, status: "sent", sid: r.sid };
      return { staff_id: m.staff_id, name: m.name, phone: m.phone, status: "failed", error: r.error };
    }),
  );

  const anyFailed = results.some((r) => r.status === "failed");
  return json(200, {
    ok: true,
    status: anyFailed ? "partial" : "sent",
    delivery_results: results,
  });
});
