"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWorkspace, inviteWorkspaceMember, removeWorkspaceMember, setCurrentWorkspace } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Users } from "lucide-react";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
}

export interface WorkspaceMemberOption {
  user_id: string;
  email: string | null;
  role: string;
}

interface WorkspacePanelProps {
  workspaces: WorkspaceOption[];
  members: WorkspaceMemberOption[];
  activeWorkspaceId: string;
  canInvite: boolean;
}

export function WorkspacePanel({ workspaces, members, activeWorkspaceId, canInvite }: WorkspacePanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function switchWorkspace(workspaceId: string) {
    setError(null);
    startTransition(async () => {
      const result = await setCurrentWorkspace(workspaceId);
      if (!result.success) setError(result.error ?? "Could not switch workspace.");
      else router.refresh();
    });
  }

  function invite(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await inviteWorkspaceMember(
        activeWorkspaceId,
        String(formData.get("email") ?? "")
      );
      if (!result.success) setError(result.error ?? "Could not invite member.");
      else {
        setMessage("Invitation sent and workspace access added.");
        router.refresh();
      }
    });
  }

  function create(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createWorkspace(String(formData.get("name") ?? ""));
      if (!result.success) setError(result.error ?? "Could not create workspace.");
      else router.refresh();
    });
  }

  function removeMember(memberId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeWorkspaceMember(activeWorkspaceId, memberId);
      if (!result.success) setError(result.error ?? "Could not remove member.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Users className="h-4 w-4" /> Workspace
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="active-workspace">Active workspace</Label>
          <select
            id="active-workspace"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 sm:max-w-sm"
            value={activeWorkspaceId}
            disabled={isPending}
            onChange={(event) => switchWorkspace(event.currentTarget.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} ({workspace.role})
              </option>
            ))}
          </select>
        </div>

        <form action={create} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="new-workspace-name">Create workspace</Label>
            <Input id="new-workspace-name" name="name" placeholder="Acme engineering" maxLength={80} required />
          </div>
          <Button type="submit" variant="outline" disabled={isPending}>Create workspace</Button>
        </form>

        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-800">Members</h3>
          <ul className="divide-y divide-slate-200 border-y border-slate-200">
            {members.map((member) => (
              <li key={member.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate text-slate-700">{member.email ?? member.user_id}</span>
                <span className="ml-auto text-slate-500">{member.role}</span>
                {canInvite && member.role !== "owner" && (
                  <Button type="button" variant="ghost" size="icon" disabled={isPending} onClick={() => removeMember(member.user_id)} aria-label={`Remove member ${member.email ?? member.user_id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {canInvite && (
          <form action={invite} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Invite by email</Label>
              <Input id="invite-email" name="email" type="email" placeholder="teammate@example.com" required />
            </div>
            <Button type="submit" disabled={isPending}>Send invite</Button>
          </form>
        )}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}
