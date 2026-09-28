"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, ChevronsLeft, ChevronsRight, CircleHelp, FileText, Gauge, LogOut, Mail, Menu, Plus, Search, Settings, User, Wand2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { Button, Kbd, PageSkeleton, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { api, setToken } from "@/lib/api";
import { useActiveTasks, useLlmStatus, useLocalPref, useMe, useNotifications, useToken } from "@/lib/hooks";
import { Ok } from "@/lib/schemas";
import { toggleTheme } from "@/lib/theme";
import { cn, fmtRelative, humanize } from "@/lib/utils";

import { CommandPaletteProvider, usePalette } from "./command-palette";
import { THEME_OPTIONS, ThemeToggle, useThemeState } from "./theme-toggle";
import { DEFAULT_NOTIFICATION_GROUP, MOBILE_NAV, NAV, NOTIFICATION_GROUPS, isActive } from "./nav";

// ------------------------------------------------------------------ focus mode (spec §45)
const FocusCtx = React.createContext<{ focus: boolean; setFocus: (v: boolean) => void }>({ focus: false, setFocus: () => undefined });
export const useFocusMode = () => React.useContext(FocusCtx);

// ------------------------------------------------------------------ popovers
/** Open state for a header popover that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const MENU_ITEM = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-subtle hover:bg-hover hover:text-foreground";

// ------------------------------------------------------------------ sidebar
function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center px-2" aria-label="JobPilot home">
      {collapsed ? (
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">J</span>
      ) : (
        <span className="text-[21px] font-bold tracking-tight text-primary">
          JobPilot<span className="text-accent">_</span>
        </span>
      )}
    </Link>
  );
}

function AIStatus({ collapsed }: { collapsed?: boolean }) {
  const llm = useLlmStatus();
  const s = llm.data;
  const state = !s ? "…" : s.reachable ? "Online" : s.configured ? "Unreachable" : "Rules mode";
  const dot = !s ? "bg-muted" : s.reachable ? "bg-success" : s.configured ? "bg-danger" : "bg-warning";
  const title = !s
    ? "Checking the LLM"
    : s.reachable
      ? `Connected to ${s.model}`
      : s.configured
        ? "The LLM endpoint isn’t responding. Update the URL in Settings."
        : "No LLM connected. Matching, ATS tests and tailoring still work; explanations use rules.";
  return (
    <Link href="/settings" title={title} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-hover", collapsed && "justify-center")}>
      <span className="text-primary" aria-hidden>
        ✦
      </span>
      {!collapsed && <span className="font-medium">JobPilot AI</span>}
      <span className={cn("flex items-center gap-1.5 text-xs text-muted", !collapsed && "ml-auto")}>
        <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
        {!collapsed && state}
        <span className="sr-only">{`AI status: ${state}`}</span>
      </span>
    </Link>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {NAV.map((group) => (
        <div key={group.label ?? "top"}>
          {group.label && !collapsed && <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{group.label}</div>}
          {group.label && collapsed && <div className="mx-2 mb-3 border-t border-border" aria-hidden />}
          <ul className={cn("space-y-1", collapsed && "flex flex-col items-center")}>
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg text-[13px] font-medium transition-colors",
                      collapsed ? "h-10 w-10 justify-center" : "px-3 py-2",
                      active ? "bg-primary/10 text-primary" : "text-subtle hover:bg-hover hover:text-foreground",
                    )}
                  >
                    <item.icon className={cn("shrink-0", collapsed ? "h-[18px] w-[18px]" : "h-4 w-4", active ? "text-primary" : "text-muted group-hover:text-subtle")} aria-hidden />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {collapsed && <span className="sr-only">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------------ header widgets
function Notifications() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const { open, setOpen, ref } = usePopover();
  const unread = data?.unread ?? 0;
  const groups = new Map<string, NonNullable<typeof data>["notifications"]>();
  for (const n of data?.notifications ?? []) {
    const g = (NOTIFICATION_GROUPS[n.kind] ?? DEFAULT_NOTIFICATION_GROUP).label;
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  const markAll = async () => {
    await api(Ok, "POST", "/notifications/read-all");
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="icon" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[360px] max-w-[calc(100vw-1.5rem)] animate-rise overflow-hidden rounded-xl border border-border bg-elevated shadow-float">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-primary hover:underline" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
            {groups.size === 0 && <p className="px-4 py-10 text-center text-sm text-muted">You’re all caught up.</p>}
            {[...groups].map(([label, items]) => {
              const Icon = (Object.values(NOTIFICATION_GROUPS).find((g) => g.label === label) ?? DEFAULT_NOTIFICATION_GROUP).icon;
              return (
                <section key={label}>
                  <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  </div>
                  {items.map((n) => (
                    <div key={n.id} className="flex gap-3 px-4 py-2.5 hover:bg-hover">
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-label={n.read ? undefined : "Unread"} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="text-[13px] text-subtle">{n.body}</div>
                        <div className="mt-0.5 text-[11px] text-muted">{fmtRelative(n.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const theme = useThemeState();
  const { open, setOpen, ref } = usePopover();
  const email = me.data?.email ?? "";
  const initials = email ? email[0]!.toUpperCase() : "·";
  const handle = email.split("@")[0] ?? "";
  const ThemeIcon = THEME_OPTIONS[theme].icon;
  const signOut = () => {
    setToken(null);
    qc.clear();
    router.replace("/login");
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Account menu" className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1 transition-colors hover:bg-hover lg:pr-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-[13px] font-semibold text-white">{initials}</span>
        <span className="hidden max-w-[140px] truncate text-[13px] font-medium lg:block">{handle}</span>
        <ChevronDown className="hidden h-4 w-4 text-muted lg:block" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 animate-rise rounded-xl border border-border bg-elevated p-1.5 shadow-float">
          <div className="truncate px-3 py-2 text-xs text-muted">{email}</div>
          <Link href="/profile" className={MENU_ITEM} onClick={() => setOpen(false)}>
            <User className="h-4 w-4" /> Profile
          </Link>
          <Link href="/settings" className={MENU_ITEM} onClick={() => setOpen(false)}>
            <Settings className="h-4 w-4" /> Settings
          </Link>
          <button className={MENU_ITEM} onClick={toggleTheme}>
            <ThemeIcon className="h-4 w-4" /> Theme: {THEME_OPTIONS[theme].label}
          </button>
          <div className="my-1 border-t border-border" />
          <button className={MENU_ITEM} onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** "+ New" shortcuts: links to existing pages only. */
const NEW_ITEMS = [
  { href: "/jobs", label: "Find jobs", icon: Search },
  { href: "/resume-lab/new", label: "Tailored resume", icon: Wand2 },
  { href: "/ats", label: "ATS scan", icon: Gauge },
  { href: "/cover-letters", label: "Cover letter", icon: Mail },
  { href: "/resume", label: "Base resume", icon: FileText },
] as const;

function NewMenu() {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="relative" ref={ref}>
      <Button size="sm" aria-expanded={open} aria-haspopup="menu" aria-label="New" onClick={() => setOpen(!open)} className="h-9 px-3 sm:px-4">
        <Plus className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">New</span>
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 animate-rise rounded-xl border border-border bg-elevated p-1.5 shadow-float">
          {NEW_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} role="menuitem" className={MENU_ITEM} onClick={() => setOpen(false)}>
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Activity() {
  const { data } = useActiveTasks();
  const n = data?.tasks.length ?? 0;
  if (!n) return null;
  const labels = [...new Set(data!.tasks.map((t) => humanize(t.event_type.split(".")[0])))];
  return (
    <span className="hidden items-center gap-2 rounded-full border ai-border ai-gradient px-3 py-1 text-xs text-subtle sm:inline-flex" title={data!.tasks.map((t) => humanize(t.event_type)).join(", ")} role="status">
      <Spinner className="h-3 w-3 text-primary" />
      {labels.length === 1 ? `${labels[0]} running` : `${n} agent tasks running`}
    </span>
  );
}

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How JobPilot works" description="One workspace from discovery to offer. Nothing is sent without your review.">
      <ol className="space-y-3 text-sm">
        {[
          ["Discover", "Jobs come from public employer job boards (Greenhouse, Lever) and Adzuna. LinkedIn and Indeed are never scraped; you get search links instead."],
          ["Match", "Every requirement in a job description is mapped to evidence in your resume. Scores are computed from that evidence; the AI only explains them."],
          ["Resume", "Your base resume is never changed. Tailored versions only reorder and rephrase what your resume already proves, and every claim is verified."],
          ["Apply", "Applications are prepared for your review. Sensitive questions always wait for you, and submission needs your approval."],
        ].map(([t, b], i) => (
          <li key={t} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full tint-primary text-xs font-semibold">{i + 1}</span>
            <span>
              <span className="font-medium">{t}.</span> <span className="text-subtle">{b}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 grid grid-cols-2 gap-2 text-sm text-subtle">
        <span>Search everything</span>
        <span className="text-right">
          <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
        </span>
        <span>Close dialogs</span>
        <span className="text-right">
          <Kbd>Esc</Kbd>
        </span>
      </div>
    </Dialog>
  );
}

/** Full-width top bar. On desktop the logo cell is exactly as wide as the sidebar below it. */
function Header({ onMenu, collapsed }: { onMenu: () => void; collapsed: boolean }) {
  const palette = usePalette();
  const [help, setHelp] = React.useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-2 border-b border-border bg-surface px-3 md:pr-6 md:pl-0">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={onMenu}>
        <Menu className="h-4 w-4" />
      </Button>
      <div className={cn("hidden h-full shrink-0 items-center transition-[width] duration-200 md:flex", collapsed ? "w-[72px] justify-center" : "w-[248px] px-4")}>
        <Logo collapsed={collapsed} />
      </div>
      <button
        onClick={palette.open}
        className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border bg-background px-3.5 text-left text-[13px] text-muted transition-colors hover:border-border-strong md:ml-6 md:max-w-md"
        aria-label="Search JobPilot (Ctrl+K)"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">Search jobs, applications, resumes…</span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="flex flex-1 items-center justify-end gap-1.5 md:gap-2">
        <Activity />
        <NewMenu />
        <ThemeToggle compact className="hidden sm:inline-flex" />
        <Notifications />
        <Button variant="ghost" size="icon" aria-label="Help" onClick={() => setHelp(true)}>
          <CircleHelp className="h-[18px] w-[18px]" />
        </Button>
        <span className="mx-1 hidden h-6 border-l border-border sm:block" aria-hidden />
        <UserMenu />
      </div>
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </header>
  );
}

function MobileNav({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted")}>
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </Link>
        );
      })}
      <button onClick={onMenu} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted">
        <Menu className="h-5 w-5" aria-hidden />
        More
      </button>
    </nav>
  );
}

// ------------------------------------------------------------------ shell
export function AppShell({ children }: { children: React.ReactNode }) {
  const token = useToken();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useLocalPref<"0" | "1">("sidebar-collapsed", "0");
  const [drawer, setDrawer] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const isCollapsed = collapsed === "1";

  React.useEffect(() => {
    if (token === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [token, router, pathname]);
  React.useEffect(() => {
    setDrawer(false);
    setFocus(false);
  }, [pathname]);
  React.useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  if (!token)
    return (
      <div className="mx-auto max-w-6xl p-8">
        <PageSkeleton />
      </div>
    );

  return (
    <FocusCtx.Provider value={{ focus, setFocus }}>
      <CommandPaletteProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[90] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
          Skip to content
        </a>
        <div className={cn("min-h-screen bg-background", !focus && "pt-16", !focus && (isCollapsed ? "md:pl-[72px]" : "md:pl-[248px]"))}>
          {!focus && (
            <aside className={cn("fixed top-16 bottom-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex", isCollapsed ? "w-[72px]" : "w-[248px]")}>
              <SidebarNav collapsed={isCollapsed} />
              <div className="space-y-1 border-t border-border p-3">
                <AIStatus collapsed={isCollapsed} />
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("w-full text-muted", isCollapsed ? "px-0" : "justify-start px-2.5")}
                  aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  onClick={() => setCollapsed(isCollapsed ? "0" : "1")}
                >
                  {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                  {!isCollapsed && "Collapse"}
                </Button>
              </div>
            </aside>
          )}

          {drawer && (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
              <div className="absolute inset-0 animate-fade-in bg-overlay" onClick={() => setDrawer(false)} aria-hidden />
              <aside className="relative flex h-full w-[280px] animate-rise flex-col border-r border-border bg-surface">
                <div className="flex h-16 items-center justify-between border-b border-border px-3">
                  <Logo />
                  <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setDrawer(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <SidebarNav onNavigate={() => setDrawer(false)} />
                <div className="space-y-2 border-t border-border p-3">
                  <ThemeToggle className="w-full justify-between" />
                  <AIStatus />
                </div>
              </aside>
            </div>
          )}

          {focus ? (
            <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface px-4 md:px-8">
              <Logo />
              <Button variant="secondary" size="sm" onClick={() => setFocus(false)}>
                Exit focus mode
              </Button>
            </div>
          ) : (
            <Header onMenu={() => setDrawer(true)} collapsed={isCollapsed} />
          )}
          <main id="main" className="mx-auto w-full max-w-[1480px] px-4 pt-7 pb-28 md:px-8 md:pb-12">
            {children}
          </main>
          {!focus && <MobileNav onMenu={() => setDrawer(true)} />}
        </div>
      </CommandPaletteProvider>
    </FocusCtx.Provider>
  );
}
