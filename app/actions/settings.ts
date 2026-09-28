"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { PLAN_LIMITS, type WorkspacePlan } from "@/lib/billing";

export async function updateLogRetention(
  workspaceId: string,
  days: number
): Promise<{ success: boolean; error?: string }> {
  if (![7, 30, 90].includes(days)) {
    return { success: false, error: "Choose a supported retention period." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (!membership) return { success: false, error: "Only workspace owners and admins can change retention." };

  const { error } = await supabase
    .from("workspaces")
    .update({ log_retention_days: days })
    .eq("id", workspaceId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function setCurrentWorkspace(
  workspaceId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { success: false, error: "You are not a member of that workspace." };

  const { error } = await supabase
    .from("user_settings")
    .update({ current_workspace_id: workspaceId, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function inviteWorkspaceMember(
  workspaceId: string,
  email: string
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { success: false, error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { data: manager } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (!manager) return { success: false, error: "Only workspace owners and admins can invite members." };

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();
  const plan: WorkspacePlan = workspace && ["active", "past_due"].includes(workspace.subscription_status)
    ? workspace.plan as WorkspacePlan
    : "free";
  const { count: memberCount } = await supabase
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((memberCount ?? 0) >= PLAN_LIMITS[plan].seats) {
    return { success: false, error: `The ${plan} plan allows ${PLAN_LIMITS[plan].seats} workspace seats.` };
  }

  const admin = createAdminClient();
  let invitedUserId: string | null = null;
  for (let page = 1; !invitedUserId; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { success: false, error: "Could not look up the invited account." };
    const existing = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);
    if (existing) {
      invitedUserId = existing.id;
      break;
    }
    if (data.users.length < 1000) break;
  }

  if (!invitedUserId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    });
    if (error || !data.user) {
      return { success: false, error: error?.message ?? "Could not send the invitation." };
    }
    invitedUserId = data.user.id;
  }

  const { error } = await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: invitedUserId,
    role: "member",
  });
  if (error) {
    return {
      success: false,
      error: error.code === "23505" ? "That account is already a workspace member." : error.message,
    };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function createWorkspace(
  name: string
): Promise<{ success: boolean; error?: string }> {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 80) {
    return { success: false, error: "Workspace name must be between 1 and 80 characters." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const admin = createAdminClient();
  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({ name: normalizedName, created_by: user.id })
    .select("id")
    .single();
  if (workspaceError || !workspace) {
    return { success: false, error: workspaceError?.message ?? "Could not create workspace." };
  }

  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
  });
  if (memberError) {
    await admin.from("workspaces").delete().eq("id", workspace.id);
    return { success: false, error: memberError.message };
  }

  const { error: settingsError } = await supabase
    .from("user_settings")
    .update({ current_workspace_id: workspace.id, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (settingsError) return { success: false, error: settingsError.message };

  revalidatePath("/dashboard");
  return { success: true };
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { data: manager } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (!manager) return { success: false, error: "Only workspace owners and admins can remove members." };

  const { data: target } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", memberId)
    .maybeSingle();
  if (!target) return { success: false, error: "Workspace member not found." };
  if (target.role === "owner") return { success: false, error: "The workspace owner cannot be removed." };

  if (target.role === "admin") {
    const { count } = await supabase
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("role", ["owner", "admin"]);
    if ((count ?? 0) <= 1) {
      return { success: false, error: "Promote another admin before removing the last admin." };
    }
  }

  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", memberId);
  if (error) return { success: false, error: error.message };

  if (memberId === user.id) {
    const { data: remainingMembership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    await supabase
      .from("user_settings")
      .update({ current_workspace_id: remainingMembership?.workspace_id ?? null })
      .eq("user_id", user.id);
  }

  revalidatePath("/dashboard");
  return { success: true };
}