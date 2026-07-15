import { requireUser } from "@/lib/auth";
import { utcStamp, relativeTime } from "@/lib/format";
import { AccountClient } from "./account-client";

export const metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  return (
    <div data-section="account" className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account details, login email, and password.</p>
      </div>
      <AccountClient
        name={user.name}
        email={user.email}
        role={user.role}
        memberSince={utcStamp(user.createdAt)}
        lastLogin={user.lastLoginAt ? relativeTime(user.lastLoginAt) : "this session"}
        startEditing={sp.edit === "1"}
        focusPassword={sp.section === "password"}
      />
    </div>
  );
}
