import { GraduationCap, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export function AppHeader() {
  const { user, signOut } = useAuth();
  const initial = (user?.email ?? "A").charAt(0).toUpperCase();

  return (
    <header className="h-16 shrink-0 bg-header text-header-foreground flex items-center justify-between px-4 md:px-6 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-lg bg-white/10 grid place-items-center">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-white/70 leading-none">Rustamji Institute of Technology</div>
          <h1 className="text-base md:text-lg font-bold leading-tight truncate">
            Teacher Attendance Upload System
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/profile"
          className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-white/10 transition-colors"
          aria-label="Open user profile"
        >
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <div className="text-sm font-semibold truncate max-w-[180px]">{user?.email ?? "Admin"}</div>
            <div className="text-[11px] uppercase tracking-wider text-white/70">Administrator</div>
          </div>
          <div className="h-9 w-9 rounded-full bg-accent text-accent-foreground grid place-items-center font-bold">
            {initial}
          </div>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="text-white hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  );
}
