import { NextResponse, type NextRequest } from "next/server";
import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks/webhooks";
import type { Subscription } from "dodopayments/resources/subscriptions";
import { createAdminClient } from "@/lib/supabase/server";
import { getDodoClient } from "@/lib/dodo";
import {
  effectiveWorkspacePlan,
  isTerminalSubscriptionStatus,
  PLAN_LIMITS,
  shouldIgnoreSubscriptionUpdate,
} from "@/lib/billing";

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

function planForProduct(productId: string): "solo" | "team" | null {
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
    let currentSubscription: Subscription;
    try {
      currentSubscription = await getDodoClient().subscriptions.retrieve(subscription.subscription_id);
    } catch (error) {
      console.error("MockAgent: could not refresh subscription state from Dodo", error);
      return NextResponse.json({ error: "Could not verify the current subscription state." }, { status: 503 });
    }

    const metadataWorkspaceId = currentSubscription.metadata?.workspace_id;
    let workspaceId = typeof metadataWorkspaceId === "string" ? metadataWorkspaceId : null;
    const customerId = currentSubscription.customer.customer_id;
    if (!workspaceId) {
      const { data: workspace, error: workspaceLookupError } = await admin
        .from("workspaces")
        .select("id")
        .eq("dodo_customer_id", customerId)
        .maybeSingle();
      if (workspaceLookupError) {
        console.error("MockAgent: Dodo customer workspace lookup failed", workspaceLookupError.message);
        return NextResponse.json({ error: "Could not identify the billing workspace." }, { status: 503 });
      }
      workspaceId = workspace?.id ?? null;
    }

    if (!workspaceId) {
      console.error("MockAgent: Dodo subscription webhook did not identify a workspace", webhookId);
      return NextResponse.json({ error: "Subscription metadata did not identify a workspace." }, { status: 400 });
    }

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("dodo_customer_id,dodo_subscription_id")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceError) {
      console.error("MockAgent: Dodo subscription workspace lookup failed", workspaceError.message);
      return NextResponse.json({ error: "Could not load billing workspace state." }, { status: 503 });
    }
    if (!workspace) {
      return NextResponse.json({ error: "Subscription workspace does not exist." }, { status: 404 });
    }
    if (workspace.dodo_customer_id && workspace.dodo_customer_id !== customerId) {
      console.error("MockAgent: Dodo subscription customer does not match workspace", workspaceId);
      return NextResponse.json({ error: "Subscription customer does not match its workspace." }, { status: 409 });
    }
    if (shouldIgnoreSubscriptionUpdate(workspace.dodo_subscription_id, currentSubscription.subscription_id)) {
      const { error: recordError } = await admin.from("dodo_webhook_events").upsert({
        webhook_id: webhookId,
        event_type: event.type,
        processed_at: new Date().toISOString(),
      });
      if (recordError) {
        console.error("MockAgent: stale Dodo event receipt could not be recorded", recordError.message);
        return NextResponse.json({ error: "Could not record webhook receipt." }, { status: 500 });
      }
      return NextResponse.json({ received: true, ignored: true, reason: "stale_subscription" });
    }

    const mappedPlan = planForProduct(currentSubscription.product_id);
    if (!mappedPlan) {
      console.error("MockAgent: Dodo subscription product is not mapped to a plan", currentSubscription.product_id);
      return NextResponse.json({ error: "Subscription product is not configured for a MockAgent plan." }, { status: 503 });
    }
    const plan = effectiveWorkspacePlan(mappedPlan, currentSubscription.status);
    const terminalStatus = isTerminalSubscriptionStatus(currentSubscription.status);
    const { error } = await admin
      .from("workspaces")
      .update({
        plan,
        subscription_status: currentSubscription.status,
        dodo_customer_id: customerId,
        dodo_subscription_id: terminalStatus ? null : currentSubscription.subscription_id,
        dodo_environment: process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode",
        current_period_end: currentSubscription.next_billing_date || null,
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
