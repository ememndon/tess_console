import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth";
import { SetupForm } from "./setup-form";

// Must be decided per-request: once the admin exists this page redirects,
// so it can never be a build-time static render.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");
  return <SetupForm />;
}
