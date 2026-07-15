"use client";

import { useActionState } from "react";
import { acceptInvitation } from "../../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteForm({
  token,
  email,
  invitedBy,
  role,
}: {
  token: string;
  email: string;
  invitedBy: string;
  role: string;
}) {
  const action = acceptInvitation.bind(null, token);
  const [state, formAction, pending] = useActionState(action, null);
  const roleLabel = role === "admin" ? "an admin" : role === "user" ? "a user" : "a manager";

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Join Tess Console</CardTitle>
          <CardDescription>
            {invitedBy} invited you as {roleLabel}. Set up your account for{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" required autoFocus autoComplete="name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              <p className="text-xs text-muted-foreground">At least 16 characters.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? "Creating account…" : "Create account & sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
