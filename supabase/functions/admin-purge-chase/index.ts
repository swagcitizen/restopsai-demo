// Disabled one-shot function. Retained only because the connector has no delete method.
Deno.serve(() => new Response('gone', { status: 410 }));
