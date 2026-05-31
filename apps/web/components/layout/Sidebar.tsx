"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Ban,
  BarChart2,
  ChevronLeft,
  ClipboardList,
  Crosshair,
  Library,
  PenTool,
  Settings,
  ShieldCheck,
  Telescope,
  Trophy,
  Upload,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";

import { useT } from "@/lib/i18n/useT";
import { useAuthStore } from "@/lib/stores/auth";
import { useUploadPopover } from "@/lib/stores/upload";
import { cn } from "@/lib/utils";

interface NavSpec {
  href: string;
  icon: React.ElementType;
  labelKey: string;
}

// "Análisis 2D" (demoReview) now points straight to /demos — clicking it
// always lands on the demo library, where a first-time welcome card appears
// if the user hasn't uploaded anything yet.
//
// The Upload entry is intentionally NOT a route here anymore — uploading
// goes through the floating ``UploadDemoPopover`` triggered by the
// button rendered above the Settings cog. See bottom of this file.
const navItems: NavSpec[] = [
  { href: "/demos",         icon: Telescope, labelKey: "nav.demoReview" },
  { href: "/pro",           icon: Trophy,    labelKey: "nav.proMatches" },
];

// Pre-beta sections — hidden from regular users until they're polished.
// Only admins see these in the sidebar (see ``isAdmin`` gate in render).
const adminNavItems: NavSpec[] = [
  { href: "/players",       icon: Users,     labelKey: "nav.players" },
  { href: "/compare",       icon: BarChart2, labelKey: "nav.compare" },
];

const bottomItems: NavSpec[] = [
  { href: "/settings", icon: Settings, labelKey: "nav.settings" },
];

interface SidebarProps {
  /**
   * Force the sidebar into compact icon-only mode regardless of user
   * preference. Used by the 2D replay viewer to claim every available
   * pixel for the canvas.
   */
  forceCollapsed?: boolean;
}

export function Sidebar({ forceCollapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const t = useT();
  const [userCollapsed, setUserCollapsed] = useState(false);
  const collapsed = forceCollapsed || userCollapsed;
  const showPopover = useUploadPopover((s) => s.show);
  const uploadBtnRef = useRef<HTMLButtonElement | null>(null);
  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);

  const openUpload = () => {
    const btn = uploadBtnRef.current;
    if (!btn) {
      showPopover();
      return;
    }
    const rect = btn.getBoundingClientRect();
    // Anchor the popover to the RIGHT edge of the button so it
    // floats out into the main content area instead of overlapping
    // the sidebar. Vertical alignment matches the button so it feels
    // attached.
    showPopover({ x: rect.right, y: rect.top });
  };

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-border bg-surface transition-all duration-300",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="h-16 flex items-center px-4 border-b border-border flex-shrink-0">
        <Link href="/demos" className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 flex-shrink-0">
            <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
              <path
                d="M16 2L28 8V16L16 22L4 16V8L16 2Z"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                fill="hsl(var(--primary) / 0.1)"
              />
              <circle cx="16" cy="15" r="3" fill="hsl(var(--primary))" />
            </svg>
          </div>
          {!collapsed && (
            <span className="font-display font-bold text-lg tracking-tight whitespace-nowrap">
              <span className="gradient-text">RIFT</span>
              <span className="text-foreground/80">SCOPE</span>
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <SidebarItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={t(item.labelKey)}
            active={pathname === item.href || pathname.startsWith(item.href + "/")}
            collapsed={collapsed}
          />
        ))}
        {/* Pre-beta sections — admin-only until they leave beta. */}
        {isAdmin &&
          adminNavItems.map((item) => (
            <SidebarItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={t(item.labelKey)}
              active={pathname === item.href || pathname.startsWith(item.href + "/")}
              collapsed={collapsed}
            />
          ))}
        {/* Tactical board + playbook — public, but flagged ``beta``. */}
        <SidebarItem
          href="/tactics"
          icon={PenTool}
          label="Tactics"
          active={pathname === "/tactics" || pathname.startsWith("/tactics/")}
          collapsed={collapsed}
          beta
        />
        <SidebarItem
          href="/playbook"
          icon={Library}
          label="Playbook"
          active={pathname === "/playbook" || pathname.startsWith("/playbook/")}
          collapsed={collapsed}
          beta
        />
        {/* Anti-strat / Vetos / Pre-partida — admin-only (pre-beta). */}
        {isAdmin && (
          <>
            <SidebarItem
              href="/anti-strat"
              icon={Crosshair}
              label="Anti-strat"
              active={pathname === "/anti-strat" || pathname.startsWith("/anti-strat/")}
              collapsed={collapsed}
            />
            <SidebarItem
              href="/vetos"
              icon={Ban}
              label="Vetos"
              active={pathname === "/vetos" || pathname.startsWith("/vetos/")}
              collapsed={collapsed}
            />
            <SidebarItem
              href="/pre-match"
              icon={ClipboardList}
              label="Pre-partida"
              active={pathname === "/pre-match" || pathname.startsWith("/pre-match/")}
              collapsed={collapsed}
            />
          </>
        )}
      </nav>

      <div className="py-4 px-2 space-y-1 border-t border-border">
        {/* Upload — floating popover trigger. Sits ABOVE the settings
            cog. Not a Link because we never want to navigate away from
            the current view to upload (especially mid-replay). */}
        <button
          ref={uploadBtnRef}
          onClick={openUpload}
          title={collapsed ? t("nav.upload") : undefined}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
            "text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
          )}
        >
          <Upload size={16} className="flex-shrink-0" />
          {!collapsed && (
            <span className="truncate">{t("nav.upload")}</span>
          )}
        </button>

        {/* Admin link — only rendered when the logged-in user is an
            admin. Sits above Settings since it's a higher-privilege
            action. Reads ``is_admin`` from the auth store, which is
            populated by the dashboard layout's fetchMe() call. */}
        {isAdmin && (
          <SidebarItem
            href="/admin"
            icon={ShieldCheck}
            label="Admin"
            active={pathname === "/admin" || pathname.startsWith("/admin/")}
            collapsed={collapsed}
          />
        )}

        {bottomItems.map((item) => (
          <SidebarItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={t(item.labelKey)}
            active={pathname === item.href}
            collapsed={collapsed}
          />
        ))}

        {!forceCollapsed && (
          <button
            onClick={() => setUserCollapsed(!userCollapsed)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-all duration-200 text-sm"
          >
            <ChevronLeft
              size={16}
              className={cn("transition-transform duration-300", collapsed && "rotate-180")}
            />
            {!collapsed && <span>{t("nav.collapse")}</span>}
          </button>
        )}
      </div>
    </aside>
  );
}

function SidebarItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  beta = false,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  collapsed: boolean;
  /** Render a subtle "beta" pill to flag pre-release sections. */
  beta?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 group",
        active
          ? "bg-primary-dim text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
      title={collapsed ? label : undefined}
    >
      <Icon size={16} className="flex-shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {beta && !collapsed && (
        <span className="ml-auto text-[9px] font-mono-rs uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-surface-elevated text-muted-foreground/70 border border-border/60">
          beta
        </span>
      )}
      {active && !collapsed && !beta && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
      )}
    </Link>
  );
}
