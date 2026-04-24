import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `You are an invoice OCR engine for a restaurant back-office system. Extract the invoice data from the image and return STRICT JSON only — no prose, no markdown fences.

Return shape:
{
  "vendor": string,
  "invoice_number": string,
  "invoice_date": string (YYYY-MM-DD, use best guess if format differs),
  "subtotal": number,
  "tax": number,
  "total": number,
  "lines": [
    {
      "description": string,
      "qty": number,
      "unit": string (e.g. lb, ea, cs, gal, doz, #10),
      "unit_price": number,
      "extended_price": number
    }
  ]
}

Rules:
- Use numbers, not strings, for prices and quantities.
- If a value is missing or illegible, use 0 for numbers and "" for strings.
- Preserve the raw product descriptions as printed on the invoice.
- Only include real line items (skip subtotal/tax/freight/total rows).
- Return JSON only, starting with { and ending with }.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY not set",
        hint: "Set the secret in Supabase Dashboard → Edge Functions → Secrets",
      }),
      { status: 500, headers: { ...CORS, "content-type": "application/json" } },
    );
  }

  let body: { image_base64?: string; media_type?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  const { image_base64, media_type } = body;
  if (!image_base64) {
    return new Response(JSON.stringify({ error: "image_base64 is required" }), {
      status: 400,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
  const mediaType = media_type || "image/jpeg";

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image_base64 },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(
        JSON.stringify({ error: "Anthropic API error", status: anthropicRes.status, detail: errText }),
        { status: 502, headers: { ...CORS, "content-type": "application/json" } },
      );
    }

    const data = await anthropicRes.json();
    const text = data?.content?.[0]?.text ?? "";

    // Strip accidental code fences if the model added any
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Best-effort: try to extract the first {...} block
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      } else {
        parsed = null;
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return new Response(
        JSON.stringify({ error: "OCR returned non-JSON", raw: text }),
        { status: 502, headers: { ...CORS, "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, invoice: parsed, model: data?.model ?? "claude-sonnet-4-5" }),
      { status: 200, headers: { ...CORS, "content-type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Edge function crash", detail: String(err) }),
      { status: 500, headers: { ...CORS, "content-type": "application/json" } },
    );
  }
});
