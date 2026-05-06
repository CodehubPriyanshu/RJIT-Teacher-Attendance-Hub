import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function AppHeader() {
  const { user } = useAuth();

  return (
    <header className="h-16 shrink-0 bg-header text-header-foreground flex items-center justify-between px-4 md:px-6 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <img src="/assets/logo.png" alt="RJIT Logo" className="h-10 w-auto object-contain" />
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-white/70 leading-none">Rustamji Institute of Technology</div>
          <h1 className="text-base md:text-lg font-bold leading-tight truncate">
            Employees Attendance Upload System
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/profile"
          className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-white/10 transition-colors"
          aria-label="Open user profile"
        >
          <div className="h-9 w-9 rounded-full bg-accent text-accent-foreground grid place-items-center font-bold">
            {(user?.email ?? "A").charAt(0).toUpperCase()}
          </div>
        </Link>
      </div>
    </header>
  );
}
