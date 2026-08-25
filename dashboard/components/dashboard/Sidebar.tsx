// PATH: dashboard/components/dashboard/Sidebar.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Shield,
  LayoutDashboard,
  Crosshair,
  Video,
  Map,
  List,
  LogOut,
  Upload,
  Brain,
  UserCog,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/attacks", label: "Attacks", icon: Crosshair },
  { href: "/sessions", label: "Sessions", icon: Video },
  { href: "/map", label: "Attacker Map", icon: Map },
  { href: "/requests", label: "Requests", icon: List },
  { href: "/uploads", label: "Uploads", icon: Upload },
  { href: "/admin", label: "Admin", icon: UserCog, adminOnly: true },
];

interface Props {
  userEmail: string;
  userRole: string;
}

function LogoBlock() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Shield className="w-5 h-5 text-primary" />
      </div>
      <div>
        <div className="font-bold text-foreground text-sm leading-tight">HoneyShield</div>
        <div className="text-xs text-muted-foreground font-mono">v1.0.0</div>
      </div>
    </div>
  );
}

function LiveIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
      </div>
      <span className="text-xs font-mono text-primary">MONITORING ACTIVE</span>
    </div>
  );
}

export default function Sidebar({ userEmail, userRole }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMobileOpen(false);
    router.push("/login");
    router.refresh();
  }

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || userRole === "admin");

  const renderNav = () => (
    <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3 px-2">
        Navigation
      </div>
      {visibleNavItems.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
            pathname === href || pathname.startsWith(href + "/")
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
        >
          <Icon className="w-4 h-4" />
          {label}
        </Link>
      ))}
      <div className="pt-1">
        <Link
          href="/ai"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
            pathname === "/ai" || pathname.startsWith("/ai/")
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
        >
          <Brain className="w-4 h-4" />
          AI Analysis
        </Link>
      </div>
    </nav>
  );

  const renderFooter = () => (
    <div className="p-4 border-t border-border space-y-2">
      <div className="px-3 py-2">
        <div className="text-xs text-muted-foreground truncate font-mono">{userEmail}</div>
      </div>
      <button
        onClick={handleLogout}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-card border-r border-border flex-col z-50">
        <div className="p-6 border-b border-border">
          <LogoBlock />
        </div>
        <div className="px-6 py-3 border-b border-border">
          <LiveIndicator />
        </div>
        {renderNav()}
        {renderFooter()}
      </aside>

      <div className="lg:hidden fixed inset-x-0 top-0 z-40 h-14 border-b border-border bg-card/95 backdrop-blur">
        <div className="h-full px-3 flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <LogoBlock />
          <div className="w-9" />
        </div>
      </div>

      {mobileOpen && (
        <button
          className="lg:hidden fixed inset-0 z-40 bg-black/65 backdrop-blur-[1px]"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
        />
      )}

      <aside
        className={cn(
          "lg:hidden fixed left-0 top-0 z-50 h-full w-[82vw] max-w-[320px] bg-card border-r border-border flex flex-col transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <LogoBlock />
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <LiveIndicator />
        </div>
        {renderNav()}
        {renderFooter()}
      </aside>
    </>
  );
}
