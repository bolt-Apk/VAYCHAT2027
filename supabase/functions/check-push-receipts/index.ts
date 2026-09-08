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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: unchecked, error: fetchError } = await supabase
      .from("push_receipt_queue")
      .select("id, ticket_id")
      .eq("checked", false)
      .lt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .limit(300);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch tickets", details: fetchError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!unchecked?.length) {
      return new Response(
        JSON.stringify({ checked: 0, message: "No pending receipts" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const ticketIds = unchecked.map((r: { ticket_id: string }) => r.ticket_id);
    const chunks = chunkArray(ticketIds, 100);

    let totalChecked = 0;
    const invalidTokens: string[] = [];
    const errors: string[] = [];

    for (const chunk of chunks) {
      const response = await fetch(
        "https://exp.host/--/api/v2/push/getReceipts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ ids: chunk }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        errors.push(`Expo receipt API error: ${response.status} - ${errText}`);
        continue;
      }

      const result = await response.json();
      const receipts = result.data ?? {};

      for (const ticketId of chunk) {
        const receipt = receipts[ticketId];
        const queueRow = unchecked.find(
          (r: { ticket_id: string }) => r.ticket_id === ticketId
        );

        if (!queueRow) continue;

        if (receipt) {
          await supabase
            .from("push_receipt_queue")
            .update({
              checked: true,
              result: receipt.status === "ok" ? "ok" : receipt.details?.error ?? "unknown_error",
            })
            .eq("id", queueRow.id);

          if (
            receipt.details?.error === "DeviceNotRegistered" ||
            receipt.details?.error === "InvalidCredentials"
          ) {
            invalidTokens.push(ticketId);
          }

          totalChecked++;
        } else {
          await supabase
            .from("push_receipt_queue")
            .update({ checked: true, result: "no_receipt" })
            .eq("id", queueRow.id);
          totalChecked++;
        }
      }
    }

    if (invalidTokens.length > 0) {
      const { data: badTickets } = await supabase
        .from("push_receipt_queue")
        .select("ticket_id")
        .in("ticket_id", invalidTokens);

      if (badTickets?.length) {
        // We can't directly map ticket_id -> token from receipts,
        // but DeviceNotRegistered tokens were already cleaned during send.
        // This is a secondary safety net.
      }
    }

    // Clean up old checked receipts (older than 7 days)
    await supabase
      .from("push_receipt_queue")
      .delete()
      .eq("checked", true)
      .lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    return new Response(
      JSON.stringify({
        checked: totalChecked,
        total_pending: unchecked.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
