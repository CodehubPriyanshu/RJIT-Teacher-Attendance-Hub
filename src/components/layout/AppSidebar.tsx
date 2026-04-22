import { NavLink as RRNavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  ClipboardList,
  CalendarDays,
  LogOut,
  GraduationCap,
  PartyPopper,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/upload", label: "Upload Attendance", icon: Upload },
  { to: "/attendance", label: "Attendance Records", icon: ClipboardList },
  { to: "/monthly", label: "Monthly Summary", icon: CalendarDays },
  { to: "/holidays", label: "Holiday and Working Days", icon: PartyPopper },
];

export function AppSidebar() {
  const { signOut } = useAuth();
  const location = useLocation();

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="h-10 w-10 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center font-bold">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-bold leading-tight">RJIT</div>
          <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/70">Admin Portal</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {items.map((it) => {
          const active = location.pathname === it.to;
          const Icon = it.icon;
          return (
            <RRNavLink
              key={it.to}
              to={it.to}
              end
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="uppercase tracking-wide text-[11px] font-semibold">{it.label}</span>
            </RRNavLink>
          );
        })}
      </nav>

      <button
        onClick={signOut}
        className="m-3 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-sidebar-border/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
      >
        <LogOut className="h-4 w-4" />
        <span className="uppercase tracking-wide text-[11px] font-semibold">Logout</span>
      </button>
    </aside>
  );
}
