import { getPlaybooks } from "@/lib/playbooks";
import { getDesignMode } from "@/lib/design-mode";
import { PlaybooksClient } from "./playbooks-client";

export const metadata = { title: "Playbooks" };
export const dynamic = "force-dynamic";

export default async function PlaybooksPage() {
  const [playbooks, design] = await Promise.all([getPlaybooks(), getDesignMode()]);
  return <PlaybooksClient playbooks={playbooks} design={design} />;
}
