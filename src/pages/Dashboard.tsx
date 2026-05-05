import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Database,
  CheckCircle2,
  AlarmClock,
  XCircle,
  LogOut,
  TrendingUp,
  TrendingDown,
  Percent,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { endOfMonth, format, startOfMonth, subDays } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip as TooltipUI, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type StatTone = "primary" | "success" | "danger" | "accent" | "muted";

const StatCard = ({
  icon: Icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  sub?: string;
  tone?: StatTone;
}) => {
  const toneMap: Record<StatTone, string> = {
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

interface AttendanceRecord {
  employee_id: string;
  first_name: string;
  department: string | null;
  attendance_date: string;
  status: string;
  late_minutes: number | null;
  early_departure_minutes: number | null;
  extra_work_minutes: number | null;
  first_punch: string | null;
  last_punch: string | null;
}

interface Trend {
  date: string;
  present: number;
  late: number;
  absent: number;
}

interface TeacherAgg {
  employee_id: string;
  name: string;
  department: string | null;
  working: number;
  present: number;
  absent: number;
  late: number;
  early: number;
  extra: number;
  pct: number;
}

interface MonthOption {
  value: string;
  label: string;
}

const PAGE_SIZES = [10, 25, 50, 100];
const ATTENDANCE_COLUMNS =
  "employee_id, first_name, department, attendance_date, status, late_minutes, early_departure_minutes, extra_work_minutes, first_punch, last_punch";

const normalizeStatus = (status: string | null | undefined) => String(status ?? "").trim().toLowerCase();

function formatPct(value: number) {
  return Number(value.toFixed(2));
}

function teacherKey(record: Pick<AttendanceRecord, "employee_id" | "first_name" | "department">) {
  return `${record.employee_id}|${record.first_name}|${record.department ?? ""}`;
}

function formatMonthLabel(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return format(new Date(year, monthIndex - 1, 1), "MMMM yyyy");
}

function getMonthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(year, monthIndex - 1, 1);
  const end = endOfMonth(start);
  return {
    from: format(start, "yyyy-MM-dd"),
    to: format(end, "yyyy-MM-dd"),
    start,
    end,
  };
}

async function fetchAvailableMonths() {
  const [{ data: firstRows, error: firstError }, { data: lastRows, error: lastError }] = await Promise.all([
    supabase.from("attendance_records").select("attendance_date").order("attendance_date", { ascending: true }).limit(1),
    supabase.from("attendance_records").select("attendance_date").order("attendance_date", { ascending: false }).limit(1),
  ]);

  if (firstError) throw firstError;
  if (lastError) throw lastError;

  const firstDate = firstRows?.[0]?.attendance_date;
  const lastDate = lastRows?.[0]?.attendance_date;
  if (!firstDate || !lastDate) return [];

  const months: string[] = [];
  const cursor = new Date(Number(firstDate.slice(0, 4)), Number(firstDate.slice(5, 7)) - 1, 1);
  const last = new Date(Number(lastDate.slice(0, 4)), Number(lastDate.slice(5, 7)) - 1, 1);

  while (cursor <= last) {
    months.push(format(cursor, "yyyy-MM"));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const available = await Promise.all(
    months.map(async (value) => {
      const range = getMonthRange(value);
      const { count, error } = await supabase
        .from("attendance_records")
        .select("*", { count: "exact", head: true })
        .gte("attendance_date", range.from)
        .lte("attendance_date", range.to);

      if (error) throw error;
      return count ? { value, label: formatMonthLabel(value) } : null;
    }),
  );

  return available.filter((month): month is MonthOption => month !== null).sort((a, b) => b.value.localeCompare(a.value));
}

async function fetchAllInRange(from: string, to: string) {
  const all: AttendanceRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select(ATTENDANCE_COLUMNS)
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .order("attendance_date", { ascending: true })
      .order("employee_id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const list = (data ?? []) as AttendanceRecord[];
    all.push(...list);
    if (list.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

async function countAllRecords() {
  const { count, error } = await supabase.from("attendance_records").select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function countTodayByStatus(date: string, status: "present" | "absent") {
  const { count, error } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact", head: true })
    .eq("attendance_date", date)
    .ilike("status", status);
  if (error) throw error;
  return count ?? 0;
}

async function countTodayByMinutes(date: string, column: "late_minutes" | "early_departure_minutes") {
  const { count, error } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact", head: true })
    .eq("attendance_date", date)
    .gt(column, 0);
  if (error) throw error;
  return count ?? 0;
}

function buildTrend(rows: AttendanceRecord[], fromDate: Date, toDate: Date) {
  const trend = new Map<string, Trend>();
  const cursor = new Date(fromDate);

  while (cursor <= toDate) {
    const date = format(cursor, "yyyy-MM-dd");
    trend.set(date, { date, present: 0, late: 0, absent: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const row of rows) {
    const day = trend.get(row.attendance_date);
    if (!day) continue;

    const status = normalizeStatus(row.status);
    if (status === "present") day.present++;
    if ((row.late_minutes ?? 0) > 0) day.late++;
    if (status === "absent") day.absent++;
  }

  return Array.from(trend.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateByTeacher(rows: AttendanceRecord[]) {
  const grouped = new Map<string, TeacherAgg>();
  const workingDates = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = teacherKey(row);
    if (!grouped.has(key)) {
      grouped.set(key, {
        employee_id: row.employee_id,
        name: row.first_name,
        department: row.department,
        working: 0,
        present: 0,
        absent: 0,
        late: 0,
        early: 0,
        extra: 0,
        pct: 0,
      });
      workingDates.set(key, new Set<string>());
    }

    const teacher = grouped.get(key)!;
    workingDates.get(key)!.add(row.attendance_date);

    const status = normalizeStatus(row.status);
    if (status === "present") teacher.present++;
    if (status === "absent") teacher.absent++;
    if ((row.late_minutes ?? 0) > 0) teacher.late++;
    if ((row.early_departure_minutes ?? 0) > 0) teacher.early++;
    if ((row.extra_work_minutes ?? 0) > 0) teacher.extra++;
  }

  const teachers = Array.from(grouped.values());
  for (const teacher of teachers) {
    const key = `${teacher.employee_id}|${teacher.name}|${teacher.department ?? ""}`;
    teacher.working = workingDates.get(key)?.size ?? 0;
    teacher.pct = teacher.working ? formatPct((teacher.present / teacher.working) * 100) : 0;
  }

  return teachers.sort(
    (a, b) => b.pct - a.pct || a.name.localeCompare(b.name) || a.employee_id.localeCompare(b.employee_id),
  );
}

export default function Dashboard() {
  const now = useMemo(() => new Date(), []);
  const today = format(now, "yyyy-MM-dd");
  const currentMonth = format(startOfMonth(now), "yyyy-MM");

  const [total, setTotal] = useState(0);
  const [present, setPresent] = useState(0);
  const [late, setLate] = useState(0);
  const [absent, setAbsent] = useState(0);
  const [early, setEarly] = useState(0);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [teachers, setTeachers] = useState<TeacherAgg[]>([]);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [todayAvg, setTodayAvg] = useState(0);
  const [monthAvg, setMonthAvg] = useState(0);
  const [highest, setHighest] = useState<TeacherAgg | null>(null);
  const [lowest, setLowest] = useState<TeacherAgg | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [availableMonths, setAvailableMonths] = useState<MonthOption[]>([]);

  const performanceMonth = useMemo(() => getMonthRange(selectedMonth || currentMonth), [currentMonth, selectedMonth]);
  const monthOptions = useMemo(() => {
    if (availableMonths.some((month) => month.value === selectedMonth)) return availableMonths;
    return [{ value: selectedMonth, label: formatMonthLabel(selectedMonth) }, ...availableMonths];
  }, [availableMonths, selectedMonth]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const trendStartDate = subDays(now, 13);
      const trendStart = format(trendStartDate, "yyyy-MM-dd");

      const [totalRows, presentToday, lateToday, absentToday, earlyToday, trendRows, monthRows, todayRows] =
        await Promise.all([
          countAllRecords(),
          countTodayByStatus(today, "present"),
          countTodayByMinutes(today, "late_minutes"),
          countTodayByStatus(today, "absent"),
          countTodayByMinutes(today, "early_departure_minutes"),
          fetchAllInRange(trendStart, today),
          fetchAllInRange(performanceMonth.from, performanceMonth.to),
          fetchAllInRange(today, today),
        ]);

      setTotal(totalRows);
      setPresent(presentToday);
      setLate(lateToday);
      setAbsent(absentToday);
      setEarly(earlyToday);
      setTrend(buildTrend(trendRows, trendStartDate, now));

      const monthAgg = aggregateByTeacher(monthRows);
      setTeachers(monthAgg);
      if (monthAgg.length) {
        setHighest(monthAgg[0]);
        setLowest(monthAgg[monthAgg.length - 1]);
        setMonthAvg(Number((monthAgg.reduce((sum, row) => sum + row.pct, 0) / monthAgg.length).toFixed(2)));
      } else {
        setHighest(null);
        setLowest(null);
        setMonthAvg(0);
      }

      const todayAgg = aggregateByTeacher(todayRows);
      setTodayAvg(
        todayAgg.length
          ? Number((todayAgg.reduce((sum, row) => sum + row.pct, 0) / todayAgg.length).toFixed(2))
          : 0,
      );
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [now, performanceMonth.from, performanceMonth.to, today]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchAvailableMonths()
      .then(setAvailableMonths)
      .catch((error) => {
        console.error("Failed to load dashboard data:", error);
        toast.error("Failed to load dashboard data");
      });
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-performance-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, () => {
        load();
        fetchAvailableMonths()
          .then(setAvailableMonths)
          .catch((error) => {
            console.error("Failed to load dashboard data:", error);
            toast.error("Failed to load dashboard data");
          });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "holidays" }, () => {
        load();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const filteredTeachers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.department ?? "").toLowerCase().includes(q),
    );
  }, [teachers, search]);

  const totalTeachers = filteredTeachers.length;
  const totalPages = Math.max(1, Math.ceil(totalTeachers / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedTeachers = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredTeachers.slice(start, start + pageSize);
  }, [filteredTeachers, pageSize, safePage]);
  const pageInfo = useMemo(() => {
    const start = totalTeachers === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const end = Math.min(safePage * pageSize, totalTeachers);
    return `${start.toLocaleString()}-${end.toLocaleString()} of ${totalTeachers.toLocaleString()}`;
  }, [pageSize, safePage, totalTeachers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, pageSize, selectedMonth]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Overview for {format(now, "EEEE, MMM d, yyyy")}</p>
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
          value={highest ? `${highest.pct.toFixed(2)}%` : "-"}
          sub={highest ? highest.name : "No data"}
          tone="success"
        />
        <StatCard
          icon={TrendingDown}
          label="Lowest Attendance"
          value={lowest ? `${lowest.pct.toFixed(2)}%` : "-"}
          sub={lowest ? lowest.name : "No data"}
          tone="danger"
        />
      </div>

      <Card className="shadow-card border-border/60">
        <div className="px-5 pt-5 pb-3">
          <h3 className="section-title">Attendance Trend (Last 14 Days)</h3>
        </div>
        <div className="h-80 px-3 pb-5" style={{ minHeight: 300, minWidth: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
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
            <p className="text-xs text-muted-foreground">Current month: {formatMonthLabel(selectedMonth)}</p>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Average is calculated based on working days, including adjustments for late entry, early departure, and extra working days.
            </p>
          </div>
          <div className="flex items-end gap-3 flex-wrap justify-end">
            <div>
              <label className="text-xs text-muted-foreground">Select Month</label>
              <Select value={selectedMonth} onValueChange={(value) => setSelectedMonth(value)}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Select Month" /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map((month) => (
                    <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Search teacher or department"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head">Teacher Name</TableHead>
                <TableHead className="table-head">Department</TableHead>
                <TableHead className="table-head">Working Days</TableHead>
                <TableHead className="table-head">Present Days</TableHead>
                <TableHead className="table-head">Late Entry</TableHead>
                <TableHead className="table-head">Early Dep.</TableHead>
                <TableHead className="table-head">Extra Work Days</TableHead>
                <TableHead className="table-head">
                  <TooltipUI>
                    <TooltipTrigger>Avg %</TooltipTrigger>
                    <TooltipContent>
                      Average is calculated based on working days, including adjustments for late entry, early departure, and extra working days.
                    </TooltipContent>
                  </TooltipUI>
                </TableHead>
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
              {pagedTeachers.map((t) => (
                <TableRow key={`${t.employee_id}-${t.name}-${t.department ?? ""}`}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.department ?? "-"}</TableCell>
                  <TableCell>{t.working}</TableCell>
                  <TableCell className="text-success font-semibold">{t.present}</TableCell>
                  <TableCell>{t.late}</TableCell>
                  <TableCell>{t.early}</TableCell>
                  <TableCell>{t.extra}</TableCell>
                  <TableCell>
                    <span className={cn(
                      "px-2 py-0.5 rounded font-semibold",
                      t.pct >= 90 ? "bg-success/15 text-success" :
                      t.pct >= 75 ? "bg-accent/20 text-accent-foreground" :
                      "bg-danger/15 text-danger",
                    )}>{t.pct.toFixed(2)}%</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border flex-wrap gap-3">
          <div className="text-sm text-muted-foreground">{pageInfo}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={safePage <= 1 || loading} onClick={() => setCurrentPage(1)}>First</Button>
            <Button variant="outline" size="sm" disabled={safePage <= 1 || loading} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="text-sm font-medium">Page {safePage} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages || loading} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages || loading} onClick={() => setCurrentPage(totalPages)}>Last</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
