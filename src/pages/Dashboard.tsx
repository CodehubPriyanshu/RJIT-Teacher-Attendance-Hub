import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Database, CheckCircle2, AlarmClock, XCircle, LogOut, TrendingUp, TrendingDown, Percent, RefreshCw } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const StatCard = ({
  icon: Icon, label, value, sub, tone = "primary",
}: {
  icon: any; label: string; value: number | string; sub?: string;
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
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
          <div className="text-2xl font-bold truncate">{value}</div>
          {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
};

interface Trend { date: string; present: number; late: number; absent: number; }

interface TeacherAgg {
  employee_id: string;
  name: string;
  department: string | null;
  working: number;
  present: number;
  absent: number;
  late: number;
  early: number;
  pct: number;
}

const PAGE_SIZE = 1000;

async function fetchAllInRange(from: string, to: string) {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("employee_id, first_name, department, attendance_date, status, late_minutes, early_departure_minutes, first_punch, last_punch")
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const list = data ?? [];
    all.push(...list);
    if (list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (all.length >= 200000) break;
  }
  return all;
}

function aggregateByTeacher(rows: any[]): TeacherAgg[] {
  // Group rows by employee_id+date to dedupe punches per day per teacher
  const perTeacher = new Map<string, TeacherAgg>();
  // Track unique (emp, date) keys with the strongest status per day
  const dayMap = new Map<string, any>();
  for (const r of rows) {
    const k = `${r.employee_id}|${r.attendance_date}`;
    const existing = dayMap.get(k);
    if (!existing) dayMap.set(k, r);
    else {
      // Prefer present/late over absent
      if (existing.status === "absent" && r.status !== "absent") dayMap.set(k, r);
    }
  }
  for (const r of dayMap.values()) {
    const id = r.employee_id;
    if (!perTeacher.has(id)) {
      perTeacher.set(id, {
        employee_id: id,
        name: r.first_name,
        department: r.department,
        working: 0, present: 0, absent: 0, late: 0, early: 0, pct: 0,
      });
    }
    const a = perTeacher.get(id)!;
    a.working++;
    const hasBoth = !!r.first_punch && !!r.last_punch;
    if (r.status === "absent" || !hasBoth) a.absent++;
    else a.present++;
    if ((r.late_minutes ?? 0) > 0) a.late++;
    if ((r.early_departure_minutes ?? 0) > 0) a.early++;
  }
  for (const a of perTeacher.values()) {
    a.pct = a.working ? +(a.present / a.working * 100).toFixed(1) : 0;
  }
  return Array.from(perTeacher.values()).sort((a, b) => b.pct - a.pct);
}

export default function Dashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");

  const [total, setTotal] = useState(0);
  const [present, setPresent] = useState(0);
  const [late, setLate] = useState(0);
  const [absent, setAbsent] = useState(0);
  const [early, setEarly] = useState(0);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [teachers, setTeachers] = useState<TeacherAgg[]>([]);
  const [todayAvg, setTodayAvg] = useState(0);
  const [monthAvg, setMonthAvg] = useState(0);
  const [highest, setHighest] = useState<TeacherAgg | null>(null);
  const [lowest, setLowest] = useState<TeacherAgg | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
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

      const fromDate = format(subDays(new Date(), 13), "yyyy-MM-dd");
      const trendRows = await fetchAllInRange(fromDate, today);
      const map = new Map<string, Trend>();
      trendRows.forEach((r: any) => {
        const k = r.attendance_date;
        if (!map.has(k)) map.set(k, { date: k, present: 0, late: 0, absent: 0 });
        const row = map.get(k)!;
        if (r.status === "late") row.late++;
        else if (r.status === "absent") row.absent++;
        else row.present++;
      });
      setTrend(Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)));

      // Month-wide teacher aggregation
      const monthRows = await fetchAllInRange(monthStart, monthEnd);
      const aggMonth = aggregateByTeacher(monthRows);
      setTeachers(aggMonth);
      if (aggMonth.length) {
        const sorted = [...aggMonth].sort((a, b) => b.pct - a.pct);
        setHighest(sorted[0]);
        setLowest(sorted[sorted.length - 1]);
        const avg = aggMonth.reduce((s, x) => s + x.pct, 0) / aggMonth.length;
        setMonthAvg(+avg.toFixed(1));
      } else {
        setHighest(null); setLowest(null); setMonthAvg(0);
      }

      // Today aggregation
      const todayRows = await fetchAllInRange(today, today);
      const aggToday = aggregateByTeacher(todayRows);
      if (aggToday.length) {
        const avg = aggToday.reduce((s, x) => s + x.pct, 0) / aggToday.length;
        setTodayAvg(+avg.toFixed(1));
      } else setTodayAvg(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [today]);

  const filteredTeachers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.department ?? "").toLowerCase().includes(q),
    );
  }, [teachers, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Overview for {format(new Date(), "EEEE, MMM d, yyyy")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={Database} label="Total Records" value={total.toLocaleString()} tone="primary" />
        <StatCard icon={CheckCircle2} label="Present Today" value={present} tone="success" />
        <StatCard icon={AlarmClock} label="Late Today" value={late} tone="accent" />
        <StatCard icon={XCircle} label="Absent Today" value={absent} tone="danger" />
        <StatCard icon={LogOut} label="Early Departure" value={early} tone="muted" />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Percent} label="Avg Attendance Today" value={`${todayAvg}%`} tone="primary" />
        <StatCard icon={Percent} label="Avg Attendance This Month" value={`${monthAvg}%`} tone="success" />
        <StatCard
          icon={TrendingUp}
          label="Highest Attendance"
          value={highest ? `${highest.pct}%` : "—"}
          sub={highest ? highest.name : "No data"}
          tone="success"
        />
        <StatCard
          icon={TrendingDown}
          label="Lowest Attendance"
          value={lowest ? `${lowest.pct}%` : "—"}
          sub={lowest ? lowest.name : "No data"}
          tone="danger"
        />
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

      <Card className="shadow-card border-border/60">
        <div className="flex items-end justify-between flex-wrap gap-3 px-5 pt-5 pb-3">
          <div>
            <h3 className="section-title">Teacher Attendance Performance</h3>
            <p className="text-xs text-muted-foreground">Current month: {format(new Date(), "MMMM yyyy")}</p>
          </div>
          <Input
            placeholder="Search teacher or department"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head">Teacher Name</TableHead>
                <TableHead className="table-head">Department</TableHead>
                <TableHead className="table-head">Working Days</TableHead>
                <TableHead className="table-head">Present</TableHead>
                <TableHead className="table-head">Absent</TableHead>
                <TableHead className="table-head">Late</TableHead>
                <TableHead className="table-head">Early Dep.</TableHead>
                <TableHead className="table-head">Avg %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTeachers.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    No teacher data for this month.
                  </TableCell>
                </TableRow>
              )}
              {filteredTeachers.map((t) => (
                <TableRow key={t.employee_id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.department ?? "—"}</TableCell>
                  <TableCell>{t.working}</TableCell>
                  <TableCell className="text-success font-semibold">{t.present}</TableCell>
                  <TableCell className="text-danger font-semibold">{t.absent}</TableCell>
                  <TableCell>{t.late}</TableCell>
                  <TableCell>{t.early}</TableCell>
                  <TableCell>
                    <span className={cn(
                      "px-2 py-0.5 rounded font-semibold",
                      t.pct >= 90 ? "bg-success/15 text-success" :
                      t.pct >= 75 ? "bg-accent/20 text-accent-foreground" :
                      "bg-danger/15 text-danger",
                    )}>{t.pct}%</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
