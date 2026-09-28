"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getDodoClient } from "@/lib/dodo";
import { dodoProductId, type PaidPlan } from "@/lib/billing";

async function getManagedWorkspace(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." } as const;

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (!membership) return { error: "Only workspace owners and admins can manage billing." } as const;

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id,name,dodo_customer_id,dodo_environment,plan,subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error || !workspace) return { error: "Workspace not found." } as const;
  return { supabase, user, workspace } as const;
}

export async function createCheckoutSession(
  workspaceId: string,
  plan: PaidPlan
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  if (plan !== "solo" && plan !== "team") {
    return { success: false, error: "Choose a valid subscription plan." };
  }
  const productId = dodoProductId(plan);
  if (!productId) return { success: false, error: `Dodo product for the ${plan} plan is not configured.` };

  const result = await getManagedWorkspace(workspaceId);
  if ("error" in result) return { success: false, error: result.error ?? "Workspace access failed." };
  if (["active", "past_due"].includes(result.workspace.subscription_status)) {
    return { success: false, error: "Manage the current subscription in the billing portal." };
  }

  if (!result.user.email) {
    return { success: false, error: "A verified email address is required for subscription checkout." };
  }

  let dodo: ReturnType<typeof getDodoClient>;
  try {
    dodo = getDodoClient();
  } catch {
    return { success: false, error: "Dodo Payments is not configured." };
  }

  const environment = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";
  let customerId = result.workspace.dodo_environment === environment
    ? result.workspace.dodo_customer_id
    : null;
  if (!customerId) {
    try {
      const customer = await dodo.customers.create({
        email: result.user.email,
        name: result.workspace.name,
        metadata: { workspace_id: workspaceId },
      });
      customerId = customer.customer_id;
      const admin = createAdminClient();
      const { error } = await admin
        .from("workspaces")
        .update({ dodo_customer_id: customerId, dodo_environment: environment })
        .eq("id", workspaceId);
      if (error) throw error;
    } catch (error) {
      console.error("MockAgent: Dodo customer creation failed", error);
      return { success: false, error: "Could not create the Dodo customer." };
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let session;
  try {
    session = await dodo.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { customer_id: customerId },
      metadata: { workspace_id: workspaceId, plan },
      return_url: `${appUrl}/dashboard?billing=success`,
      cancel_url: `${appUrl}/dashboard?billing=cancelled`,
    });
  } catch (error) {
    console.error("MockAgent: Dodo checkout session creation failed", error);
    return { success: false, error: "Could not start checkout. Check Dodo product and API key configuration." };
  }

  if (!session.checkout_url) return { success: false, error: "Dodo did not return a checkout URL." };
  return { success: true, url: session.checkout_url };
}

export async function createBillingPortalSession(
  workspaceId: string
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const result = await getManagedWorkspace(workspaceId);
  if ("error" in result) return { success: false, error: result.error ?? "Workspace access failed." };
  if (!result.workspace.dodo_customer_id) {
    return { success: false, error: "This workspace has no billing account yet." };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let session;
  try {
    session = await getDodoClient().customers.customerPortal.create(
      result.workspace.dodo_customer_id,
      { return_url: `${appUrl}/dashboard` }
    );
  } catch (error) {
    console.error("MockAgent: Dodo customer portal session creation failed", error);
    return { success: false, error: "Could not open the Dodo customer portal." };
  }
  return { success: true, url: session.link };
}
