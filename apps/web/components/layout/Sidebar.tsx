"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  Film,
  Users,
  BarChart2,
  Settings,
  ChevronLeft,
  Crosshair,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/demos", icon: Film, label: "My Demos" },
  { href: "/demos/upload", icon: Upload, label: "Upload Demo" },
  { href: "/players", icon: Users, label: "Players" },
  { href: "/compare", icon: BarChart2, label: "Compare" },
];

const bottomItems = [
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-border bg-surface transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border flex-shrink-0">
        <Link href="/demos" className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 flex-shrink-0">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <path d="M16 2L28 8V16L16 22L4 16V8L16 2Z" stroke="hsl(185 100% 52%)" strokeWidth="1.5" fill="hsl(185 100% 52% / 0.1)" />
              <circle cx="16" cy="15" r="3" fill="hsl(185 100% 52%)" />
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

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <SidebarItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + "/")}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Bottom */}
      <div className="py-4 px-2 space-y-1 border-t border-border">
        {bottomItems.map((item) => (
          <SidebarItem
            key={item.href}
            {...item}
            active={pathname === item.href}
            collapsed={collapsed}
          />
        ))}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-all duration-200 text-sm"
        >
          <ChevronLeft
            size={16}
            className={cn("transition-transform duration-300", collapsed && "rotate-180")}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
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
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 group",
        active
          ? "bg-primary-dim text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
      )}
      title={collapsed ? label : undefined}
    >
      <Icon size={16} className="flex-shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {active && !collapsed && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
      )}
    </Link>
  );
}
