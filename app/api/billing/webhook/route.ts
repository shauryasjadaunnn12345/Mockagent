import { NextResponse, type NextRequest } from "next/server";
import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks/webhooks";
import { createAdminClient } from "@/lib/supabase/server";
import { getDodoClient } from "@/lib/dodo";
import { PLAN_LIMITS, type WorkspacePlan } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscriptionEvents = new Set([
  "subscription.active",
  "subscription.updated",
  "subscription.past_due",
  "subscription.on_hold",
  "subscription.paused",
  "subscription.unpaused",
  "subscription.renewed",
  "subscription.plan_changed",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.failed",
]);

function planForProduct(productId: string): WorkspacePlan | null {
  if (productId === process.env.DODO_PAYMENTS_SOLO_PRODUCT_ID) return "solo";
  if (productId === process.env.DODO_PAYMENTS_TEAM_PRODUCT_ID) return "team";
  return null;
}

export async function POST(request: NextRequest) {
  const webhookId = request.headers.get("webhook-id");
  const signature = request.headers.get("webhook-signature");
  const timestamp = request.headers.get("webhook-timestamp");
  if (!webhookId || !signature || !timestamp || !process.env.DODO_PAYMENTS_WEBHOOK_KEY) {
    return NextResponse.json({ error: "Dodo webhook is not configured." }, { status: 503 });
  }

  const body = await request.text();
  let event: UnwrapWebhookEvent;
  try {
    event = getDodoClient().webhooks.unwrap(body, {
      headers: {
        "webhook-id": webhookId,
        "webhook-signature": signature,
        "webhook-timestamp": timestamp,
      },
    });
  } catch (error) {
    console.warn("MockAgent: Dodo webhook signature verification failed", error);
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: processedEvent, error: lookupError } = await admin
    .from("dodo_webhook_events")
    .select("webhook_id")
    .eq("webhook_id", webhookId)
    .maybeSingle();
  if (lookupError) {
    console.error("MockAgent: Dodo webhook idempotency lookup failed", lookupError.message);
    return NextResponse.json({ error: "Webhook storage is not ready." }, { status: 503 });
  }
  if (processedEvent) return NextResponse.json({ received: true, duplicate: true });

  if (subscriptionEvents.has(event.type)) {
    const subscription = event.data as Extract<UnwrapWebhookEvent, { type: "subscription.active" }> ["data"];
    const metadataWorkspaceId = subscription.metadata?.workspace_id;
    let workspaceId = typeof metadataWorkspaceId === "string" ? metadataWorkspaceId : null;

    if (!workspaceId && subscription.customer?.customer_id) {
      const { data: workspace } = await admin
        .from("workspaces")
        .select("id")
        .eq("dodo_customer_id", subscription.customer.customer_id)
        .maybeSingle();
      workspaceId = workspace?.id ?? null;
    }

    if (!workspaceId) {
      console.error("MockAgent: Dodo subscription webhook did not identify a workspace", webhookId);
      return NextResponse.json({ error: "Subscription metadata did not identify a workspace." }, { status: 400 });
    }

    const mappedPlan = planForProduct(subscription.product_id);
    const isPaid = mappedPlan !== null && ["active", "past_due"].includes(subscription.status);
    const plan: WorkspacePlan = isPaid ? mappedPlan : "free";
    const terminalStatus = ["cancelled", "expired", "failed"].includes(subscription.status);
    const { error } = await admin
      .from("workspaces")
      .update({
        plan,
        subscription_status: subscription.status,
        dodo_customer_id: subscription.customer.customer_id,
        dodo_subscription_id: terminalStatus ? null : subscription.subscription_id,
        dodo_environment: process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode",
        current_period_end: subscription.next_billing_date || null,
        log_retention_days: PLAN_LIMITS[plan].retentionDays,
      })
      .eq("id", workspaceId);
    if (error) {
      console.error("MockAgent: Dodo subscription update failed", error.message);
      return NextResponse.json({ error: "Could not update subscription." }, { status: 500 });
    }
  }

  const { error: recordError } = await admin.from("dodo_webhook_events").upsert({
    webhook_id: webhookId,
    event_type: event.type,
    processed_at: new Date().toISOString(),
  });
  if (recordError) {
    console.error("MockAgent: Dodo webhook idempotency write failed", recordError.message);
    return NextResponse.json({ error: "Could not record webhook receipt." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
