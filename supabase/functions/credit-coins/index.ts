import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COIN_PRICES: Record<string, number> = {
  "price_1TECiI2ObXNkJIex6PVwIe5z": 100,
  "price_1TECjy2ObXNkJIex11ihCBWX": 500,
  "price_1TECo52ObXNkJIexehQMdRx4": 1000,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" });

    // Find recent completed checkout sessions for this user
    const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ credited: false, reason: "no_customer" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessions = await stripe.checkout.sessions.list({
      customer: customers.data[0].id,
      status: "complete",
      limit: 5,
    });

    // Find coin purchase sessions that haven't been credited yet
    let totalCoinsToCredit = 0;
    for (const session of sessions.data) {
      if (session.metadata?.coins && !session.metadata?.credited) {
        const coins = parseInt(session.metadata.coins);
        if (coins > 0) {
          totalCoinsToCredit += coins;
          // Mark as credited
          await stripe.checkout.sessions.update(session.id, {
            metadata: { ...session.metadata, credited: "true" },
          });
        }
      }
    }

    if (totalCoinsToCredit > 0) {
      // Get current coins
      const { data: profile } = await supabase
        .from("profiles")
        .select("coins")
        .eq("user_id", user.id)
        .single();

      const newBalance = (profile?.coins ?? 0) + totalCoinsToCredit;
      await supabase.from("profiles").update({ coins: newBalance }).eq("user_id", user.id);

      return new Response(JSON.stringify({ credited: true, coins_added: totalCoinsToCredit, new_balance: newBalance }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ credited: false, reason: "no_pending" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
