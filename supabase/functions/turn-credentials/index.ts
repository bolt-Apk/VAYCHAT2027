import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (i < retries) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    } catch {
      if (i >= retries) throw new Error("Failed after retries");
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error("Failed after retries");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const apiKey = Deno.env.get("METERED_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "METERED_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const res = await fetchWithRetry(
      `https://vaychat.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
    );

    const meteredServers = await res.json();

    if (!Array.isArray(meteredServers) || meteredServers.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No TURN servers returned from Metered",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.metered.ca:3478" },
      ...meteredServers,
    ];

    return new Response(JSON.stringify({ iceServers }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=21600",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
