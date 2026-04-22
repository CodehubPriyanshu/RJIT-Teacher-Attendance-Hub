import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, RefreshCw, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Agg {
  employee_id: string;
  name: string;
  department: string | null;
  month: number;
  year: number;
  working: number;
  present: number;
  absent: number;
  late: number;
  early: number;
  pct: number;
}

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const PAGE_SIZES = [10, 25, 50, 100];
const FETCH_PAGE = 1000;

export default function MonthlySummary() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [department, setDepartment] = useState<string>("all");
  const [departments, setDepartments] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Agg[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = async () => {
    setLoading(true);
    try {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const endDate = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;

      const all: any[] = [];
      let offset = 0;
      while (true) {
        let q = supabase
          .from("attendance_records")
          .select("employee_id, first_name, department, attendance_date, status, late_minutes, early_departure_minutes, first_punch, last_punch")
          .gte("attendance_date", start)
          .lte("attendance_date", end);
        if (department !== "all") q = q.eq("department", department);
        const { data: chunk, error } = await q.range(offset, offset + FETCH_PAGE - 1);
        if (error) throw error;
        const list = chunk ?? [];
        all.push(...list);
        if (list.length < FETCH_PAGE) break;
        offset += FETCH_PAGE;
        if (all.length >= 200000) break;
      }

      // Dedupe per (employee, date)
      const dayMap = new Map<string, any>();
      for (const r of all) {
        const k = `${r.employee_id}|${r.attendance_date}`;
        const existing = dayMap.get(k);
        if (!existing) dayMap.set(k, r);
        else if (existing.status === "absent" && r.status !== "absent") dayMap.set(k, r);
      }

      const map = new Map<string, Agg>();
      for (const r of dayMap.values()) {
        const key = r.employee_id;
        if (!map.has(key)) {
          map.set(key, {
            employee_id: r.employee_id,
            name: r.first_name,
            department: r.department,
            month: m,
            year: y,
            working: 0, present: 0, absent: 0, late: 0, early: 0, pct: 0,
          });
        }
        const a = map.get(key)!;
        a.working++;
        const hasBoth = !!r.first_punch && !!r.last_punch;
        if (r.status === "absent" || !hasBoth) a.absent++;
        else a.present++;
        if ((r.late_minutes ?? 0) > 0) a.late++;
        if ((r.early_departure_minutes ?? 0) > 0) a.early++;
      }
      const list = Array.from(map.values());
      list.forEach((a) => { a.pct = a.working ? +(a.present / a.working * 100).toFixed(1) : 0; });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setData(list);
      setPage(1);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    const { data } = await supabase
      .from("attendance_records")
      .select("department")
      .not("department", "is", null)
      .limit(1000);
    const set = new Set<string>();
    (data ?? []).forEach((r: any) => r.department && set.add(r.department));
    setDepartments(Array.from(set).sort());
  };

  useEffect(() => { loadDepartments(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, year, department]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (r) => r.employee_id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        "Teacher Name": r.name,
        "Employee ID": r.employee_id,
        "Department": r.department ?? "",
        "Month": months[r.month - 1],
        "Year": r.year,
        "Working Days": r.working,
        "Present Days": r.present,
        "Absent Days": r.absent,
        "Late Days": r.late,
        "Early Departure Days": r.early,
        "Average Attendance %": r.pct,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Monthly");
    XLSX.writeFile(wb, `monthly_${year}_${month.padStart(2, "0")}.xlsx`);
  };

  const years = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Monthly Summary</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length.toLocaleString()} teachers · {months[parseInt(month, 10) - 1]} {year}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button onClick={exportXlsx} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Export Excel
          </Button>
        </div>
      </div>

      <Card className="shadow-card border-border/60 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search Teacher Name"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </Card>

      <Card className="shadow-card border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head">Teacher Name</TableHead>
                <TableHead className="table-head">Department</TableHead>
                <TableHead className="table-head">Month</TableHead>
                <TableHead className="table-head">Year</TableHead>
                <TableHead className="table-head">Working Days</TableHead>
                <TableHead className="table-head">Present</TableHead>
                <TableHead className="table-head">Absent</TableHead>
                <TableHead className="table-head">Late</TableHead>
                <TableHead className="table-head">Early Dep.</TableHead>
                <TableHead className="table-head">Avg %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                    No data for selected month.
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((r) => (
                <TableRow key={r.employee_id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.department ?? "—"}</TableCell>
                  <TableCell>{months[r.month - 1]}</TableCell>
                  <TableCell>{r.year}</TableCell>
                  <TableCell>{r.working}</TableCell>
                  <TableCell className="text-success font-semibold">{r.present}</TableCell>
                  <TableCell className="text-danger font-semibold">{r.absent}</TableCell>
                  <TableCell>{r.late}</TableCell>
                  <TableCell>{r.early}</TableCell>
                  <TableCell>
                    <span className={cn(
                      "px-2 py-0.5 rounded font-semibold",
                      r.pct >= 90 ? "bg-success/15 text-success" :
                      r.pct >= 75 ? "bg-accent/20 text-accent-foreground" :
                      "bg-danger/15 text-danger",
                    )}>{r.pct}%</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border flex-wrap gap-3">
          <div className="text-sm text-muted-foreground">
            Showing {pageRows.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length.toLocaleString()}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)}>First</Button>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-sm font-medium">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Last</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
