import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date().toISOString();

    const { data: due, error: fetchErr } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (fetchErr) {
      return new Response(
        JSON.stringify({ error: fetchErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!due || due.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let processed = 0;
    const errors: string[] = [];

    for (const sm of due) {
      const { error: insertErr } = await supabase.from("messages").insert({
        conversation_id: sm.conversation_id,
        sender_id: sm.sender_id,
        content: sm.content,
        message_type: sm.message_type,
        media_url: sm.media_url,
        media_duration: sm.media_duration,
        reply_to_id: sm.reply_to_id,
        is_read: false,
      });

      if (insertErr) {
        errors.push(`${sm.id}: ${insertErr.message}`);
        continue;
      }

      await supabase
        .from("scheduled_messages")
        .update({ status: "sent" })
        .eq("id", sm.id);

      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sm.conversation_id);

      processed++;
    }

    return new Response(
      JSON.stringify({ processed, total: due.length, errors }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
