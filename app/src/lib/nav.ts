import {
  LayoutDashboard,
  ChartLine,
  Megaphone,
  Radar,
  Clapperboard,
  Search,
  Swords,
  Inbox,
  Handshake,
  Activity,
  MessageSquareHeart,
  BookOpen,
  ListChecks,
  ScrollText,
  Bot,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; phase?: number };

// Sidebar order: Site Overview first.
export const NAV: NavItem[] = [
  { href: "/", label: "Site Overview", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: ChartLine, phase: 2 },
  { href: "/content-strategy", label: "Content Director", icon: Radar, phase: 5 },
  { href: "/demo-studio", label: "Demo Studio", icon: Clapperboard, phase: 7 },
  { href: "/social", label: "Social Studio", icon: Megaphone, phase: 5 },
  { href: "/seo", label: "SEO Center", icon: Search, phase: 4 },
  { href: "/competitors", label: "Competitors", icon: Swords, phase: 4 },
  { href: "/inbox", label: "Inbox", icon: Inbox, phase: 6 },
  { href: "/outreach", label: "Outreach CRM", icon: Handshake, phase: 6 },
  { href: "/site-health", label: "Site Health", icon: Activity, phase: 3 },
  { href: "/feedback", label: "Feedback", icon: MessageSquareHeart, phase: 2 },
  { href: "/playbooks", label: "Playbooks", icon: BookOpen },
  { href: "/jobs", label: "Jobs Monitor", icon: ListChecks },
  { href: "/audit", label: "Audit Log", icon: ScrollText },
  { href: "/agent", label: "Tess (Agent)", icon: Bot, phase: 7 },
  { href: "/settings", label: "Settings", icon: Settings },
];
