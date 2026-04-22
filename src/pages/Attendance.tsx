import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpDown, Download, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  record_number: number | null;
  employee_id: string;
  first_name: string;
  department: string | null;
  attendance_date: string;
  weekday: string | null;
  first_punch: string | null;
  last_punch: string | null;
  total_time: string | null;
  late_minutes: number;
  early_departure_minutes: number;
  status: string;
}

const PAGE_SIZE = 50;
type SortKey = "attendance_date" | "first_name";

export default function Attendance() {
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [department, setDepartment] = useState<string>("all");
  const [departments, setDepartments] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("attendance_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const buildQuery = () => {
    let q = supabase.from("attendance_records").select("*", { count: "exact" });
    if (search) q = q.or(`employee_id.ilike.%${search}%,first_name.ilike.%${search}%`);
    if (department !== "all") q = q.eq("department", department);
    if (from) q = q.gte("attendance_date", from);
    if (to) q = q.lte("attendance_date", to);
    q = q.order(sortKey, { ascending: sortDir === "asc" });
    return q;
  };

  const fetchPage = async () => {
    setLoading(true);
    try {
      const start = (page - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;
      const { data, count: c, error } = await buildQuery().range(start, end);
      if (error) throw error;
      setRows((data as Row[]) ?? []);
      setCount(c ?? 0);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    const { data } = await supabase
      .from("attendance_records")
      .select("department")
      .not("department", "is", null)
      .limit(1000);
    const set = new Set<string>();
    (data ?? []).forEach((r: any) => r.department && set.add(r.department));
    setDepartments(Array.from(set).sort());
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, department, from, to, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  };

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const all: Row[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await buildQuery().range(offset, offset + PAGE - 1);
        if (error) throw error;
        const chunk = (data as Row[]) ?? [];
        all.push(...chunk);
        if (chunk.length < PAGE) break;
        offset += PAGE;
        if (all.length >= 100000) break;
      }
      const ws = XLSX.utils.json_to_sheet(
        all.map((r) => ({
          No: r.record_number,
          "Employee ID": r.employee_id,
          "First Name": r.first_name,
          Department: r.department,
          Date: r.attendance_date,
          Weekday: r.weekday,
          "First Punch": r.first_punch?.slice(0, 5) ?? "",
          "Last Punch": r.last_punch?.slice(0, 5) ?? "",
          "Total Time": r.total_time ?? "",
          "Late Minutes": r.late_minutes,
          "Early Departure Minutes": r.early_departure_minutes,
          Status: r.status,
        })),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
      XLSX.writeFile(wb, `attendance_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Exported ${all.length.toLocaleString()} records`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const pageInfo = useMemo(() => {
    const start = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, count);
    return `${start.toLocaleString()}–${end.toLocaleString()} of ${count.toLocaleString()}`;
  }, [page, count]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Attendance Records</h2>
          <p className="text-sm text-muted-foreground">{count.toLocaleString()} total records</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPage} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleExport} disabled={exporting || count === 0}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? "Exporting…" : "Export Excel"}
          </Button>
        </div>
      </div>

      <Card className="shadow-card border-border/60 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search Employee ID or Name"
                className="pl-9"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
              />
            </div>
            <Button variant="secondary" onClick={applySearch}>Search</Button>
          </div>
          <Select value={department} onValueChange={(v) => { setDepartment(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      </Card>

      <Card className="shadow-card border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head">No</TableHead>
                <TableHead className="table-head">Employee ID</TableHead>
                <TableHead className="table-head">
                  <button className="inline-flex items-center gap-1" onClick={() => toggleSort("first_name")}>
                    First Name <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="table-head">Department</TableHead>
                <TableHead className="table-head">
                  <button className="inline-flex items-center gap-1" onClick={() => toggleSort("attendance_date")}>
                    Date <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="table-head">Weekday</TableHead>
                <TableHead className="table-head">First Punch</TableHead>
                <TableHead className="table-head">Last Punch</TableHead>
                <TableHead className="table-head">Total Time</TableHead>
                <TableHead className="table-head">Late (min)</TableHead>
                <TableHead className="table-head">Early Dep. (min)</TableHead>
                <TableHead className="table-head">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-10">
                    No records. Upload an Excel file from “Upload Attendance”.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => {
                const tinted =
                  r.status === "absent" || r.late_minutes > 0 || r.early_departure_minutes > 0
                    ? "bg-row-late"
                    : "bg-row-present";
                return (
                  <TableRow key={r.id} className={tinted}>
                    <TableCell>{r.record_number ?? "—"}</TableCell>
                    <TableCell className="font-medium">{r.employee_id}</TableCell>
                    <TableCell>{r.first_name}</TableCell>
                    <TableCell>{r.department ?? "—"}</TableCell>
                    <TableCell>{r.attendance_date}</TableCell>
                    <TableCell>{r.weekday ?? "—"}</TableCell>
                    <TableCell className={cn(r.late_minutes > 0 && "text-danger font-semibold")}>
                      {r.first_punch?.slice(0, 5) ?? "—"}
                    </TableCell>
                    <TableCell className={cn(r.early_departure_minutes > 0 && "text-danger font-semibold")}>
                      {r.last_punch?.slice(0, 5) ?? "—"}
                    </TableCell>
                    <TableCell>{r.total_time ?? "—"}</TableCell>
                    <TableCell>{r.late_minutes}</TableCell>
                    <TableCell>{r.early_departure_minutes}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="text-sm text-muted-foreground">{pageInfo}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(1)}>First</Button>
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-sm font-medium">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(totalPages)}>Last</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    present: { label: "Present", cls: "bg-success/15 text-success border-success/30" },
    late: { label: "Late", cls: "bg-danger/15 text-danger border-danger/30" },
    absent: { label: "Absent", cls: "bg-muted text-muted-foreground border-border" },
    early_departure: { label: "Early Dep.", cls: "bg-danger/15 text-danger border-danger/30" },
  };
  const v = map[status] ?? map.present;
  return <Badge variant="outline" className={cn("font-semibold", v.cls)}>{v.label}</Badge>;
}
