"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Repeat,
  FileText,
  CreditCard,
  Package,
  Layers,
  Users,
  Percent,
  UserCog,
  ChartBar,
  Settings,
  LogOut,
  BookOpen,
  Bot,
} from "lucide-react";
import { useAuth, isStaff, type SessionUser } from "@/lib/auth-context";
import { initials } from "@/lib/format";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number }>;
  adminOnly?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Daily",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    group: "Catalog",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/plans", label: "Plans", icon: Layers },
    ],
  },
  {
    group: "People",
    items: [
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/staff", label: "Staff", icon: UserCog, adminOnly: true },
    ],
  },
  {
    group: "Setup",
    items: [
      { href: "/taxes", label: "Taxes & discounts", icon: Percent, adminOnly: true },
      { href: "/reports", label: "Reports", icon: ChartBar },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const PORTAL_NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "My account",
    items: [
      { href: "/portal", label: "Subscriptions", icon: Repeat },
      { href: "/portal/invoices", label: "Invoices & payments", icon: FileText },
      { href: "/portal/plans", label: "Browse plans", icon: Layers },
      { href: "/portal/profile", label: "Profile", icon: Settings },
    ],
  },
];

export function AppShell({ kind, children }: { kind: "console" | "portal"; children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [narrow, setNarrow] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const nav = kind === "portal" ? PORTAL_NAV : NAV;
  const role = kind === "portal" ? "customer" : user?.role;
  const visible = nav.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.adminOnly || role === "admin"),
  }));

  if (loading) {
    return <div className="min-h-screen" />;
  }
  if (!user || !role) {
    router.replace("/login");
    return null;
  }
  if (kind === "console" && !isStaff(user.role)) {
    return (
      <Gate title="Staff console is for admins and staff">
        <button className="btn btn-primary" onClick={() => router.replace("/portal")}>
          Go to your portal
        </button>
      </Gate>
    );
  }
  if (kind === "portal" && isStaff(user.role)) {
    return (
      <Gate title="This portal is for customer accounts">
        <button className="btn btn-primary" onClick={() => router.replace("/dashboard")}>
          Go to the console
        </button>
      </Gate>
    );
  }

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (narrow) {
    // Phone fold: a 48px top bar with the screen's name + a full-screen nav sheet.
    const current = visible.flatMap((g) => g.items).find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
    return (
      <div className="min-h-screen">
        <div
          className="sticky top-0 z-40 h-12 flex items-center gap-3 px-4"
          style={{ background: "var(--color-ground)", borderBottom: "1px solid var(--color-line)" }}
        >
          <button onClick={() => setSheetOpen(true)} aria-label="Open menu" className="p-1 -ml-1 cursor-pointer">
            <Menu size={20} strokeWidth={1.5} />
          </button>
          <span className="font-medium text-[15px] flex-1 text-center truncate">{current?.label ?? "Brightloop"}</span>
          <LoopMark size={20} />
        </div>
        {sheetOpen && (
          <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--color-ground)" }}>
            <div className="h-12 flex items-center justify-between px-4" style={{ borderBottom: "1px solid var(--color-line)" }}>
              <span className="flex items-center gap-2">
                <LoopMark size={20} /> <span className="font-medium text-[15px]">Brightloop</span>
              </span>
              <button onClick={() => setSheetOpen(false)} aria-label="Close menu" className="p-1 cursor-pointer">
                <X size={20} strokeWidth={1.5} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3" onClick={() => setSheetOpen(false)}>
              {visible.map((group) => (
                <div key={group.group}>
                  <div className="px-4 pt-5 pb-1.5 text-xs text-faint">{group.group}</div>
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-3 h-11 px-3 mx-2 rounded-md text-[15px]"
                        style={active ? { background: "#e9e9e9" } : { color: "#3d3d3d" }}
                      >
                        <Icon size={17} strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
              <Link href="/mailbox" className="flex items-center gap-3 h-11 px-3 mx-2 mt-4 rounded-md text-[15px]" style={{ color: "#3d3d3d" }}>
                <BookOpen size={17} strokeWidth={1.5} />
                Dev mailbox
              </Link>
            </nav>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderTop: "1px solid var(--color-line)" }}>
              <span>
                <span className="block text-sm">{user.name}</span>
                <span className="block text-xs text-faint">{user.email}</span>
              </span>
              <button onClick={onLogout} className="btn btn-outline" style={{ height: 34 }}>
                <LogOut size={15} strokeWidth={1.5} /> Sign out
              </button>
            </div>
          </div>
        )}
        <main className="px-4 pt-6 pb-20">{children}</main>
        <CopilotDock />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar nav={visible} pathname={pathname} user={user} onLogout={onLogout} portal={kind === "portal"} />
      <main className="flex-1 min-w-0">
        <div className="px-8 pt-8 pb-16 max-w-[1280px]">{children}</div>
        <CopilotDock />
      </main>
    </div>
  );
}

import { CopilotDock } from "@/components/copilot";

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p className="text-lg font-medium">{title}</p>
      {children}
    </div>
  );
}

function Sidebar({
  nav,
  pathname,
  user,
  onLogout,
  portal,
}: {
  nav: { group: string; items: NavItem[] }[];
  pathname: string;
  user: SessionUser;
  onLogout: () => void;
  portal?: boolean;
}) {
  const roleLabel = { admin: "Admin", staff: "Staff", customer: "Customer" }[user.role];

  return (
    <aside
      className="w-64 shrink-0 flex flex-col sticky top-0 h-screen"
      style={{ background: "var(--color-ground)", borderRight: "1px solid var(--color-line)" }}
    >
      {/* workspace switcher row */}
      <div className="px-4 pt-5 pb-4">
        <Link href={portal ? "/portal" : "/dashboard"} className="flex items-center gap-2.5">
          <LoopMark size={22} />
          <span className="font-medium text-[15px] tracking-tight">Brightloop</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto pb-4">
        {nav.map((group) => (
          <div key={group.group}>
            <div className="px-4 pt-6 pb-1.5 text-xs text-faint">{group.group}</div>
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="mx-2 mb-[2px] flex items-center gap-2.5 h-8 px-2 rounded-md text-sm transition-colors"
                  style={
                    active
                      ? { background: "#e9e9e9", color: "#0a0a0a" }
                      : { color: "#6b6b6b" }
                  }
                >
                  <Icon size={16} strokeWidth={1.5} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* utilities pinned to the bottom */}
      <div className="px-2 pb-2" style={{ borderTop: "1px solid var(--color-rule)" }}>
        <Link
          href="/mailbox"
          className="mx-2 mt-2 mb-[2px] flex items-center gap-2.5 h-8 px-2 rounded-md text-sm hover:bg-[#e9e9e9] transition-colors"
          style={{ color: "#6b6b6b" }}
        >
          <BookOpen size={16} strokeWidth={1.5} />
          Dev mailbox
        </Link>
        <div className="flex items-center gap-2.5 mx-2 mt-2 mb-1 px-2 py-2">
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium"
            style={{ background: "#e9e9e9" }}
          >
            {initials(user.name)}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm truncate">{user.name}</span>
            <span className="block text-xs text-faint">{roleLabel}</span>
          </span>
          <button
            onClick={onLogout}
            className="text-faint hover:text-negative p-1 cursor-pointer"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function LoopMark({ size = 20 }: { size?: number }) {
  // Product mark: a loop in the one chart hue.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="#1d5fbf" strokeWidth="3" strokeDasharray="42 12" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" fill="#141414" />
    </svg>
  );
}


