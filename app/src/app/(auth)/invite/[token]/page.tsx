import crypto from "crypto";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invitations } from "@/lib/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inv] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, sha256(token)))
    .limit(1);
  const valid = inv && !inv.acceptedAt && inv.expiresAt > new Date();

  if (!valid) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">Invitation unavailable</CardTitle>
            <CardDescription>
              This link is invalid, already used, or expired. Ask the owner to send a fresh
              invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login" className="text-sm underline underline-offset-2 hover:text-foreground">
              Go to sign in
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <InviteForm token={token} email={inv.email} invitedBy={inv.invitedBy} role={inv.role} />;
}
