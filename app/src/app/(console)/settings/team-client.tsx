"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, Copy, Check, Mail, Shield, Trash2, Clock } from "lucide-react";
import { inviteMember, revokeInvitation, removeMember } from "./team-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// What each role can do — shown in the invite dialog so the owner picks deliberately.
const ROLE_OPTIONS: { value: string; label: string; blurb: string }[] = [
  { value: "admin", label: "Admin", blurb: "Full access — everything you can do, including settings, secrets, team and Tess controls." },
  { value: "manager", label: "Manager", blurb: "Runs operations — inbox, social, outreach, feedback. No settings, secrets, team or Tess controls." },
  { value: "user", label: "User", blurb: "Read-only — can explore and view the console, but cannot change, send or post anything." },
];

export type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  lastLogin: string;
};
export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  expires: string;
};

function RoleBadge({ role }: { role: string }) {
  if (role === "admin")
    return (
      <Badge variant="secondary" className="gap-1">
        <Shield className="size-3" /> Admin
      </Badge>
    );
  if (role === "tess") return <Badge variant="outline">Tess (agent)</Badge>;
  if (role === "user") return <Badge variant="outline">User</Badge>;
  return <Badge variant="outline">Manager</Badge>;
}

function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(inviteMember, null);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState("manager");

  const fullLink =
    state && "ok" in state ? `${window.location.origin}${state.link}` : null;

  async function copy() {
    if (!fullLink) return;
    await navigator.clipboard.writeText(fullLink);
    setCopied(true);
    toast.success("Invite link copied");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <UserPlus className="size-3.5" /> Invite member
          </Button>
        }
      />
      <DialogContent className="gap-5 p-6 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Pick a role and generate a one-time link. Send it to them — they set their own long
            password. No email server needed.
          </DialogDescription>
        </DialogHeader>

        {fullLink ? (
          <div className="grid gap-2">
            <Label>
              Invite link for <span className="redact">{state && "ok" in state ? state.email : ""}</span>
              {state && "ok" in state ? ` (${state.role})` : ""}
            </Label>
            <div className="flex gap-2">
              <Input readOnly value={fullLink} className="redact font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Shown once — copy it now. Expires in 7 days. You can revoke it any time below.
            </p>
          </div>
        ) : (
          <form action={formAction} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Their email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                placeholder="name@example.com"
                autoComplete="off"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <input type="hidden" name="role" value={role} />
              <Select value={role} onValueChange={(v) => v && setRole(v)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_OPTIONS.find((r) => r.value === role)?.blurb}</p>
            </div>
            {state && "error" in state && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Generating…" : "Generate invite link"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TeamManager({
  members,
  pending,
  isOwner,
  currentUserId,
}: {
  members: Member[];
  pending: PendingInvite[];
  isOwner: boolean;
  currentUserId: string;
}) {
  const [, start] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Members</CardTitle>
          {isOwner && <InviteDialog />}
        </CardHeader>
        <CardContent className="divide-y py-0">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-3 first:pt-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{m.name}</span>
                  <RoleBadge role={m.role} />
                  {m.id === currentUserId && (
                    <span className="text-[11px] text-muted-foreground">you</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="redact">{m.email}</span> · last login {m.lastLogin}
                </p>
              </div>
              {isOwner && (m.role === "manager" || m.role === "user") && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${m.name}`}
                  onClick={() =>
                    start(async () => {
                      await removeMember(m.id);
                      toast.message(`${m.name} removed`);
                    })
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {isOwner && pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="divide-y py-0">
            {pending.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-3 first:pt-0">
                <Mail className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="redact">{inv.email}</span> <RoleBadge role={inv.role} />
                  </p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" /> expires {inv.expires} · invited by {inv.invitedBy}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    start(async () => {
                      await revokeInvitation(inv.id);
                      toast.message("Invitation revoked");
                    })
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isOwner && (
        <p className="text-sm text-muted-foreground">
          Only the owner can invite or remove team members.
        </p>
      )}
    </div>
  );
}
