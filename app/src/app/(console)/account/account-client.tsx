"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Save, KeyRound, ShieldCheck, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { updateProfile, changePassword } from "./account-actions";

const MIN_PW = 16;

export function AccountClient({
  name: initialName, email: initialEmail, role, memberSince, lastLogin, startEditing, focusPassword,
}: {
  name: string; email: string; role: string; memberSince: string; lastLogin: string;
  startEditing?: boolean; focusPassword?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!!startEditing);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [savedName, setSavedName] = useState(initialName);
  const [savedEmail, setSavedEmail] = useState(initialEmail);
  const [busy, start] = useTransition();

  const initials = savedName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  function saveProfile() {
    start(async () => {
      const r = await updateProfile({ name, email });
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      setSavedName(name); setSavedEmail(email);
      setEditing(false);
      router.refresh();
    });
  }
  function cancelEdit() {
    setName(savedName); setEmail(savedEmail); setEditing(false);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* Profile */}
      <section className="rounded-xl border p-5">
        <div className="mb-4 flex items-center gap-3">
          <Avatar className="size-12"><AvatarFallback className="text-base font-medium">{initials}</AvatarFallback></Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{savedName}</p>
            <p className="truncate text-sm text-muted-foreground">{savedEmail}</p>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> Edit profile
            </Button>
          )}
        </div>

        {editing ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="acc-name">Name</Label><Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="acc-email">Login email</Label><Input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button onClick={saveProfile} disabled={busy} className="gap-1.5"><Save className="size-3.5" /> {busy ? "Saving…" : "Save changes"}</Button>
              <Button variant="ghost" onClick={cancelEdit} disabled={busy}>Cancel</Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck className="size-3.5" /> Role</dt>
            <dd className="font-medium capitalize">{role === "admin" ? "Administrator" : role}</dd>
            <dt className="text-muted-foreground">Avatar fallback</dt>
            <dd className="font-medium">{initials}</dd>
            <dt className="text-muted-foreground">Member since</dt>
            <dd>{memberSince}</dd>
            <dt className="text-muted-foreground">Last sign-in</dt>
            <dd>{lastLogin}</dd>
          </dl>
        )}
      </section>

      {/* Password */}
      <PasswordCard autoFocus={!!focusPassword} />
    </div>
  );
}

function PasswordCard({ autoFocus }: { autoFocus: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, start] = useTransition();

  const tooShort = next.length > 0 && next.length < MIN_PW;
  const mismatch = confirm.length > 0 && confirm !== next;

  function submit() {
    start(async () => {
      const r = await changePassword({ current, next, confirm });
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      setCurrent(""); setNext(""); setConfirm("");
    });
  }

  return (
    <section className="rounded-xl border p-5">
      <div className="mb-4 flex items-start gap-2.5">
        <KeyRound className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Change password</h2>
          <p className="text-xs text-muted-foreground">Minimum {MIN_PW} characters (long passwords mandatory).</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="pw-current">Current password</Label><Input id="pw-current" type="password" autoComplete="current-password" autoFocus={autoFocus} value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="grid gap-1.5">
          <Label htmlFor="pw-next">New password</Label>
          <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          {tooShort && <span className="text-[11px] text-destructive">{MIN_PW - next.length} more character(s) needed.</span>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pw-confirm">Confirm new password</Label>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <span className="text-[11px] text-destructive">Passwords do not match.</span>}
        </div>
        <div className="sm:col-span-2">
          <Button onClick={submit} disabled={busy || !current || next.length < MIN_PW || next !== confirm} className="gap-1.5">
            <KeyRound className="size-3.5" /> {busy ? "Updating…" : "Update password"}
          </Button>
        </div>
      </div>
    </section>
  );
}
