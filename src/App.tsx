import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Teachers from "./pages/Teachers";
import Attendance from "./pages/Attendance";
import LateReport from "./pages/LateReport";
import MonthlySummary from "./pages/MonthlySummary";
import Sync from "./pages/Sync";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const Shell = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppLayout>{children}</AppLayout>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<Shell><Dashboard /></Shell>} />
            <Route path="/teachers" element={<Shell><Teachers /></Shell>} />
            <Route path="/attendance" element={<Shell><Attendance /></Shell>} />
            <Route path="/late-report" element={<Shell><LateReport /></Shell>} />
            <Route path="/monthly" element={<Shell><MonthlySummary /></Shell>} />
            <Route path="/sync" element={<Shell><Sync /></Shell>} />
            <Route path="/settings" element={<Shell><SettingsPage /></Shell>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
