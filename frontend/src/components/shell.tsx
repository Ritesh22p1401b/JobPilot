"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Briefcase,
  FileText,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  SlidersHorizontal,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, Button, Loading, Spinner } from "@/components/ui";
import { api, setToken } from "@/lib/api";
import { useActiveTasks, useMe, useNotifications, useToken } from "@/lib/hooks";
import { Ok } from "@/lib/schemas";
import { cn, fmtDateTime, humanize } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/applications", label: "Applications", icon: ListChecks },
  { href: "/resume", label: "Resume", icon: FileText },
  { href: "/resume-lab", label: "Resume Lab", icon: FlaskConical },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/preferences", label: "Preferences", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Notifications() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label={`Notifications (${unread} unread)`} onClick={() => setOpen(!open)}>
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button
                className="text-xs text-primary"
                onClick={async () => {
                  await api(Ok, "POST", "/notifications/read-all");
                  void qc.invalidateQueries({ queryKey: ["notifications"] });
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.notifications.length && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>}
            {data?.notifications.map((n) => (
              <div key={n.id} className={cn("border-b px-4 py-3 last:border-0", !n.read && "bg-info-soft/50")}>
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-xs text-muted-foreground">{n.body}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{fmtDateTime(n.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Activity() {
  const { data } = useActiveTasks();
  const n = data?.tasks.length ?? 0;
  if (!n) return null;
  const first = data?.tasks[0];
  return (
    <Badge tone="info" className="hidden sm:inline-flex" title={data?.tasks.map((t) => humanize(t.event_type)).join(", ")}>
      <Spinner className="h-3 w-3" />
      {n === 1 && first ? humanize(first.event_type.split(".")[0]) : `${n} agent tasks`} running
    </Badge>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const token = useToken();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const me = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (token === null) router.replace("/");
  }, [token, router]);
  useEffect(() => setMenuOpen(false), [pathname]);

  if (!token) return <Loading />;

  const signOut = () => {
    setToken(null);
    qc.clear();
  };

  const nav = (
    <nav className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-info-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r bg-card px-3 py-4 md:block">
        <div className="sticky top-4">
          <Link href="/dashboard" className="mb-5 block px-3 text-base font-semibold">
            JobPilot <span className="text-primary">AI</span>
          </Link>
          {nav}
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)}>
          <aside className="h-full w-64 bg-card px-3 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between px-3">
              <span className="font-semibold">
                JobPilot <span className="text-primary">AI</span>
              </span>
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-8">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex-1" />
          <Activity />
          <Notifications />
          <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">{me.data?.email}</span>
          <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
