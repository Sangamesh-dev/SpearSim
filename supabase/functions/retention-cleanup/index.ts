// Supabase Edge Function: Data Retention Cleanup
// Runs daily via Supabase cron scheduler
// Implements GDPR Article 5(1)(e) - Storage Limitation

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();
  const deleted: string[] = [];

  try {
    // Find expired campaigns
    const { data: expiredCampaigns, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, name, org_id")
      .lt("auto_delete_at", now);

    if (fetchError) throw fetchError;
    if (!expiredCampaigns || expiredCampaigns.length === 0) {
      return new Response(JSON.stringify({ message: "No expired campaigns", deleted: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    for (const campaign of expiredCampaigns) {
      // Get all employees for this campaign
      const { data: employees } = await supabase
        .from("employees")
        .select("id, alias")
        .eq("campaign_id", campaign.id);

      // Delete events
      await supabase.from("events").delete().eq("campaign_id", campaign.id);

      // Delete name_map entries
      if (employees && employees.length > 0) {
        const aliases = employees.map((e: { alias: string }) => e.alias);
        await supabase.from("name_map").delete().in("alias", aliases);
      }

      // Delete employees
      await supabase.from("employees").delete().eq("campaign_id", campaign.id);

      // Delete campaign
      await supabase.from("campaigns").delete().eq("id", campaign.id);

      // Log deletion to audit_logs
      await supabase.from("audit_logs").insert({
        actor_email: "system@phishsim.internal",
        action: "RETENTION_AUTO_DELETE",
        target_table: "campaigns",
        target_id: campaign.id,
        ip_address: "system",
        metadata: {
          campaign_name: campaign.name,
          reason: "90-day retention policy (GDPR Article 5(1)(e))",
          employees_deleted: employees?.length ?? 0,
        },
      });

      deleted.push(campaign.id);
    }

    return new Response(
      JSON.stringify({ message: `Deleted ${deleted.length} expired campaigns`, deleted }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Retention cleanup error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
