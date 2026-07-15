// Client-safe agent-control constants/types (no server-only imports).

export const AGENT_MODULES = ["social", "email", "seo", "outreach", "vps", "content"] as const;
export type AgentModule = (typeof AGENT_MODULES)[number];

export type AgentControl = {
  paused: boolean;
  modules: Partial<Record<AgentModule, boolean>>;
  pausedBy?: string;
  pausedAt?: string;
};
