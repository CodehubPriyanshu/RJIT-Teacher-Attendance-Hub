import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Database, CheckCircle2, AlarmClock, XCircle, LogOut } from "lucide-react";
import { format, subDays } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { cn } from "@/lib/utils";

const StatCard = ({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: any;
  label: string;
  value: number | string;
  tone?: "primary" | "success" | "danger" | "accent" | "muted";
}) => {
  const toneMap: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    danger: "bg-danger/10 text-danger",
    accent: "bg-accent/10 text-accent",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="shadow-card border-border/60">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("h-12 w-12 rounded-xl grid place-items-center", toneMap[tone])}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
};

interface Trend { date: string; present: number; late: number; absent: number; }

export default function Dashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [total, setTotal] = useState(0);
  const [present, setPresent] = useState(0);
  const [late, setLate] = useState(0);
  const [absent, setAbsent] = useState(0);
  const [early, setEarly] = useState(0);
  const [trend, setTrend] = useState<Trend[]>([]);

  useEffect(() => {
    (async () => {
      const countOf = async (build: (q: any) => any) => {
        const { count } = await build(
          supabase.from("attendance_records").select("*", { count: "exact", head: true }),
        );
        return count ?? 0;
      };

      const [t, p, l, a, e] = await Promise.all([
        countOf((q) => q),
        countOf((q) => q.eq("attendance_date", today).eq("status", "present")),
        countOf((q) => q.eq("attendance_date", today).eq("status", "late")),
        countOf((q) => q.eq("attendance_date", today).eq("status", "absent")),
        countOf((q) => q.eq("attendance_date", today).eq("status", "early_departure")),
      ]);
      setTotal(t); setPresent(p); setLate(l); setAbsent(a); setEarly(e);

      // 14-day trend
      const fromDate = format(subDays(new Date(), 13), "yyyy-MM-dd");
      const { data } = await supabase
        .from("attendance_records")
        .select("attendance_date, status")
        .gte("attendance_date", fromDate)
        .lte("attendance_date", today)
        .limit(50000);
      const map = new Map<string, Trend>();
      (data ?? []).forEach((r: any) => {
        const k = r.attendance_date;
        if (!map.has(k)) map.set(k, { date: k, present: 0, late: 0, absent: 0 });
        const row = map.get(k)!;
        if (r.status === "late") row.late++;
        else if (r.status === "absent") row.absent++;
        else row.present++;
      });
      setTrend(Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)));
    })();
  }, [today]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Overview for {format(new Date(), "EEEE, MMM d, yyyy")}</p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={Database} label="Total Records" value={total.toLocaleString()} tone="primary" />
        <StatCard icon={CheckCircle2} label="Present Today" value={present} tone="success" />
        <StatCard icon={AlarmClock} label="Late Today" value={late} tone="accent" />
        <StatCard icon={XCircle} label="Absent Today" value={absent} tone="danger" />
        <StatCard icon={LogOut} label="Early Departure" value={early} tone="muted" />
      </div>

      <Card className="shadow-card border-border/60">
        <div className="px-5 pt-5 pb-3">
          <h3 className="section-title">Attendance Trend (Last 14 Days)</h3>
        </div>
        <div className="h-80 px-3 pb-5">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Legend />
              <Bar dataKey="present" stackId="a" fill="hsl(var(--success))" name="Present" />
              <Bar dataKey="late" stackId="a" fill="hsl(var(--accent))" name="Late" />
              <Bar dataKey="absent" stackId="a" fill="hsl(var(--danger))" name="Absent" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
