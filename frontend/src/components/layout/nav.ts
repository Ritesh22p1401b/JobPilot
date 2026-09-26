import {
  BarChart3,
  Bell,
  Bookmark,
  Bot,
  Building2,
  CalendarClock,
  FileText,
  FlaskConical,
  Gauge,
  Home,
  LayoutList,
  Layers,
  LineChart,
  Mail,
  MessagesSquare,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Target,
  User,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that should mark this item active. */
  match?: string[];
  keywords?: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: null, items: [{ href: "/dashboard", label: "Overview", icon: Home, keywords: "dashboard home brief" }] },
  {
    label: "Discover",
    items: [
      { href: "/matches", label: "AI Job Match", icon: Sparkles, keywords: "best matches fit" },
      { href: "/jobs", label: "Job Search", icon: Search, match: ["/jobs/"], keywords: "find jobs search filter" },
      { href: "/saved", label: "Saved Jobs", icon: Bookmark, keywords: "bookmarks" },
      { href: "/companies", label: "Companies", icon: Building2, keywords: "employers" },
    ],
  },
  {
    label: "Applications",
    items: [
      { href: "/applications", label: "Application Tracker", icon: LayoutList, keywords: "kanban board table status" },
      { href: "/applications/agent", label: "Application Agent", icon: Bot, keywords: "autofill ready submit" },
      { href: "/applications/interviews", label: "Interviews", icon: MessagesSquare, keywords: "interview prep" },
      { href: "/applications/follow-ups", label: "Follow-ups", icon: CalendarClock, keywords: "reminder follow up" },
    ],
  },
  {
    label: "Resume Lab",
    items: [
      { href: "/resume", label: "Base Resume", icon: FileText, keywords: "master upload cv" },
      { href: "/ats", label: "ATS Scanner", icon: Gauge, keywords: "ats scan keywords formatting" },
      { href: "/resume-lab", label: "Resume Versions", icon: Layers, match: ["/resume-lab/"], keywords: "tailored versions compare diff" },
      { href: "/cover-letters", label: "Cover Letters", icon: Mail, keywords: "cover letter" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3, keywords: "funnel response rate" },
      { href: "/skills", label: "Skill Gap", icon: Target, keywords: "missing skills learn" },
      { href: "/market", label: "Market Insights", icon: LineChart, keywords: "demand skills market" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/profile", label: "Profile", icon: User, keywords: "experience skills contact" },
      { href: "/preferences", label: "Preferences", icon: SlidersHorizontal, keywords: "automation auto-apply locations salary" },
      { href: "/settings", label: "Settings", icon: Settings, keywords: "llm sources privacy theme" },
    ],
  },
];

export const ALL_NAV: NavItem[] = NAV.flatMap((g) => g.items);

export function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  // Sub-routes of the tracker ("/applications/agent" …) have their own entries; only ids belong to the tracker.
  const others = ALL_NAV.filter((n) => n !== item && n.href.startsWith(`${item.href}/`)).map((n) => n.href);
  if (item.href === "/applications" && pathname.startsWith("/applications/")) return !others.some((o) => pathname.startsWith(o));
  return (item.match ?? []).some((m) => pathname.startsWith(m));
}

export const MOBILE_NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/jobs", label: "Jobs", icon: Search },
  { href: "/applications", label: "Apply", icon: LayoutList },
  { href: "/resume-lab", label: "Resume", icon: FlaskConical },
] as const;

export const NOTIFICATION_GROUPS: Record<string, { label: string; icon: LucideIcon }> = {
  new_matches: { label: "Jobs", icon: Sparkles },
  approval_required: { label: "Applications", icon: LayoutList },
  resume_ready: { label: "Resume", icon: FileText },
};
export const DEFAULT_NOTIFICATION_GROUP = { label: "Updates", icon: Bell };
