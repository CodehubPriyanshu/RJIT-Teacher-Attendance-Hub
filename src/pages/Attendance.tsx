import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UploadAttendanceDialog } from "@/components/UploadAttendanceDialog";
import { formatMinutes, shortSummary } from "@/lib/timeFormat";
import { fetchActiveHolidays } from "@/lib/workingDays";
import { computeStatus, toMinutes } from "@/lib/attendanceCalc";
import { getAttendanceShift, type AttendanceShiftCategory } from "@/lib/attendanceShift";

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
  extra_work_minutes?: number;
  status: string;
  comment: string | null;
  archived?: boolean;
}

const PAGE_SIZES = [10, 25, 50, 100];
type SortKey = "attendance_date" | "first_name" | "employee_id" | "record_number";
type MinuteFilter = "all" | "10" | "20" | "30" | "more_than_30";

const DEFAULT_DEPARTMENT_OPTIONS = [
  "Faculty (Regular)",
  "Other Academic (Regular)",
  "Non-Teaching Staff (Regular)",
  "Admin Staff (Regular)",
  "Faculty (Contractual)",
  "Non-Teaching (Contractual)",
  "Admin Staff (Contractual)",
  "Staff Muster Roll",
];

const MINUTE_FILTER_OPTIONS: { value: MinuteFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "10", label: "10 min" },
  { value: "20", label: "20 min" },
  { value: "30", label: "30 min" },
  { value: "more_than_30", label: "More than 30 min" },
];

const minuteFilterLabel = (option: { value: MinuteFilter; label: string }, allLabel: string) =>
  option.value === "all" ? allLabel : option.label;

function matchesMinuteFilter(value: number, filter: MinuteFilter) {
  if (filter === "10") return value >= 10 && value < 20;
  if (filter === "20") return value >= 20 && value < 30;
  if (filter === "30") return value >= 30 && value < 60;
  if (filter === "more_than_30") return value >= 30;
  return true;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

interface Filters {
  search: string;
  teacherName: string;
  department: string;
  from: string;
  to: string;
  selectedDate: string;
  status: string;
  lateOnly: MinuteFilter;
  earlyOnly: MinuteFilter;
  extraWorkFilter: MinuteFilter;
  shiftCategory: AttendanceShiftCategory;
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  teacherName: "",
  department: "all",
  from: "",
  to: "",
  selectedDate: "",
  status: "all",
  lateOnly: "all",
  earlyOnly: "all",
  extraWorkFilter: "all",
  shiftCategory: "09:00",
};

function withShiftCalculations(row: Row): Row {
  const calc = computeStatus(
    toMinutes(row.first_punch),
    toMinutes(row.last_punch),
    getAttendanceShift(row.first_name),
  );

  return {
    ...row,
    late_minutes: calc.late_minutes,
    early_departure_minutes: calc.early_departure_minutes,
    extra_work_minutes: calc.extra_work_minutes,
    status: calc.status,
  };
}

export default function Attendance() {
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filterVersion, setFilterVersion] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("attendance_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());
  const [departmentOptions, setDepartmentOptions] = useState<string[]>(DEFAULT_DEPARTMENT_OPTIONS);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [savingCommentIds, setSavingCommentIds] = useState<Set<string>>(new Set());
  const savingCommentIdsRef = useRef<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  const buildBaseQuery = () => {
    const {
      search,
      teacherName,
      department,
      from,
      to,
      selectedDate,
    } = appliedFilters;
    let q = supabase.from("attendance_records_all").select("*");
    if (search) q = q.or(`employee_id.ilike.%${search}%,first_name.ilike.%${search}%`);
    if (teacherName) q = q.ilike("first_name", `%${teacherName}%`);
    if (department !== "all") q = q.ilike("department", `%${department.trim()}%`);
    if (from) q = q.gte("attendance_date", from);
    if (to) q = q.lte("attendance_date", to);
    if (selectedDate) q = q.eq("attendance_date", selectedDate);
    q = q.order(sortKey, { ascending: sortDir === "asc" });
    return q;
  };

  const applyClientFilters = (records: Row[]) => {
    const { status, lateOnly, earlyOnly, extraWorkFilter, shiftCategory } = appliedFilters;
    return records
      .map(withShiftCalculations)
      .filter((record) => getAttendanceShift(record.first_name).category === shiftCategory)
      .filter((record) => status === "all" || record.status === status)
      .filter((record) => matchesMinuteFilter(record.late_minutes, lateOnly))
      .filter((record) => matchesMinuteFilter(record.early_departure_minutes, earlyOnly))
      .filter((record) => matchesMinuteFilter(record.extra_work_minutes ?? 0, extraWorkFilter));
  };

  const fetchPage = async () => {
    setLoading(true);
    try {
      const start = (page - 1) * pageSize;
      const end = start + pageSize - 1;
      const pageRows: Row[] = [];
      let filteredCount = 0;
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await buildBaseQuery().range(offset, offset + PAGE - 1);
        if (error) throw error;
        const rawChunk = (data as Row[]) ?? [];
        const filteredChunk = applyClientFilters(rawChunk);
        for (const row of filteredChunk) {
          if (filteredCount >= start && filteredCount <= end) {
            pageRows.push(row);
          }
          filteredCount += 1;
        }
        if (rawChunk.length < PAGE) break;
        offset += PAGE;
        if (offset >= 100000) break;
      }
      setRows(pageRows);
      setCommentDrafts((current) => {
        const next = { ...current };
        for (const row of pageRows) {
          next[row.id] = row.comment ?? "";
        }
        return next;
      });
      setCount(filteredCount);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Failed to load"));
    } finally {
      setLoading(false);
    }
  };

  const fetchHolidays = async () => {
    const dateFrom = appliedFilters.selectedDate || appliedFilters.from || "2000-01-01";
    const dateTo = appliedFilters.selectedDate || appliedFilters.to || "2100-12-31";
    try {
      const holidays = await fetchActiveHolidays(dateFrom, dateTo);
      setHolidayDates(holidays);
    } catch (e) {
      console.error("Failed to fetch holidays:", e);
    }
  };

  const fetchDepartmentOptions = async () => {
    try {
      const { data, error } = await supabase
        .from("attendance_records_all")
        .select("department")
        .not("department", "is", null)
        .limit(10000);
      if (error) throw error;

      const normalizedFromDb = (data ?? [])
        .map((item) => item.department?.replace(/\s+/g, " ").trim())
        .filter((department): department is string => Boolean(department));

      const unique = new Map<string, string>();
      for (const department of [...DEFAULT_DEPARTMENT_OPTIONS, ...normalizedFromDb]) {
        const key = department.toLowerCase();
        if (!unique.has(key)) unique.set(key, department);
      }

      const options = Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
      setDepartmentOptions(options.length ? options : DEFAULT_DEPARTMENT_OPTIONS);
    } catch (e) {
      console.error("Failed to fetch department options:", e);
      setDepartmentOptions(DEFAULT_DEPARTMENT_OPTIONS);
    }
  };

  useEffect(() => {
    fetchDepartmentOptions();
  }, []);

  useEffect(() => {
    fetchPage();
    fetchHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, appliedFilters, sortKey, sortDir, filterVersion]);

  const setSort = (k: SortKey, dir: "asc" | "desc") => {
    setSortKey(k);
    setSortDir(dir);
    setPage(1);
  };
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
    setPage(1);
  };

  const applyFilters = () => {
    setAppliedFilters({
      ...filters,
      search: filters.search.trim(),
      teacherName: filters.teacherName.trim(),
    });
    setPage(1);
    setFilterVersion((v) => v + 1);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
    setFilterVersion((v) => v + 1);
  };

  const setShiftCategory = (shiftCategory: AttendanceShiftCategory) => {
    setFilters((current) => ({ ...current, shiftCategory }));
    setAppliedFilters((current) => ({ ...current, shiftCategory }));
    setPage(1);
    setFilterVersion((v) => v + 1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const all: Row[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await buildBaseQuery().range(offset, offset + PAGE - 1);
        if (error) throw error;
        const chunk = (data as Row[]) ?? [];
        all.push(...chunk);
        if (chunk.length < PAGE) break;
        offset += PAGE;
        if (all.length >= 100000) break;
      }
      const filtered = applyClientFilters(all);
      const ws = XLSX.utils.json_to_sheet(
        filtered.map((r) => ({
          No: r.record_number,
          "Employee ID": r.employee_id,
          "Teacher Name": r.first_name,
          Department: r.department,
          Date: r.attendance_date,
          Weekday: r.weekday,
          "First Punch": r.first_punch?.slice(0, 5) ?? "",
          "Last Punch": r.last_punch?.slice(0, 5) ?? "",
          "Total Time": r.total_time ?? "",
          "Late Entry (Min)": formatMinutes(r.late_minutes),
          "Early Dep. (Min)": formatMinutes(r.early_departure_minutes),
          "Extra Work Time": formatMinutes(r.extra_work_minutes ?? 0),
          Status: r.status,
          Summary: shortSummary(r.late_minutes, r.early_departure_minutes, r.status, r.extra_work_minutes ?? 0),
        })),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
      XLSX.writeFile(wb, `attendance_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Exported ${filtered.length.toLocaleString()} records`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  const updateCommentDraft = (id: string, value: string) => {
    setCommentDrafts((current) => ({
      ...current,
      [id]: value.slice(0, 500),
    }));
  };

  const saveComment = async (row: Row) => {
    if (savingCommentIdsRef.current.has(row.id)) return;

    const comment = (commentDrafts[row.id] ?? "").trim().slice(0, 500);
    const table = row.archived ? "attendance_records_archive" : "attendance_records";

    savingCommentIdsRef.current.add(row.id);
    setSavingCommentIds((current) => new Set(current).add(row.id));
    try {
      const { error } = await supabase
        .from(table)
        .update({ comment })
        .eq("id", row.id);

      if (error) throw error;

      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, comment } : item)));
      setCommentDrafts((current) => ({ ...current, [row.id]: comment }));
      toast.success("Comment saved");
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Failed to save comment"));
    } finally {
      savingCommentIdsRef.current.delete(row.id);
      setSavingCommentIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    }
  };

  const pageInfo = useMemo(() => {
    const start = count === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, count);
    return `${start.toLocaleString()}–${end.toLocaleString()} of ${count.toLocaleString()}`;
  }, [page, pageSize, count]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Attendance Records</h2>
          <p className="text-sm text-muted-foreground">{count.toLocaleString()} matching records</p>
        </div>
        <div className="flex gap-2">
          <UploadAttendanceDialog onUploaded={() => { setPage(1); setFilterVersion((v) => v + 1); }} />
          <Button size="sm" onClick={handleExport} disabled={exporting || count === 0}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? "Exporting…" : "Export Excel"}
          </Button>
        </div>
      </div>

      <Card className="shadow-card border-border/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={filters.shiftCategory}
            onValueChange={(value) => value && setShiftCategory(value as AttendanceShiftCategory)}
            className="justify-start rounded-md border border-border bg-muted/30 p-1"
          >
            <ToggleGroupItem value="09:00" className="px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">
              09:00 Shift
            </ToggleGroupItem>
            <ToggleGroupItem value="08:00" className="px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">
              08:00 Shift
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Employee ID or Name"
                className="pl-9"
                value={filters.search}
                onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
            <Button variant="secondary" onClick={applyFilters}>Go</Button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Filter by Teacher Name"
              value={filters.teacherName}
              onChange={(e) => setFilters((current) => ({ ...current, teacherName: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            />
            <Button variant="secondary" onClick={applyFilters}>Go</Button>
          </div>
          <Select value={filters.department} onValueChange={(v) => setFilters((current) => ({ ...current, department: v }))}>
            <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departmentOptions.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => setFilters((current) => ({ ...current, status: v }))}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="present">Present</SelectItem>
              <SelectItem value="late">Late</SelectItem>
              <SelectItem value="early_departure">Early Departure</SelectItem>
              <SelectItem value="incomplete">Incomplete</SelectItem>
              <SelectItem value="absent">Absent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={filters.from} onChange={(e) => setFilters((current) => ({ ...current, from: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={filters.to} onChange={(e) => setFilters((current) => ({ ...current, to: e.target.value }))} />
          </div>
          <Select value={filters.lateOnly} onValueChange={(v) => setFilters((current) => ({ ...current, lateOnly: v as MinuteFilter }))}>
            <SelectTrigger><SelectValue placeholder="Late filter" /></SelectTrigger>
            <SelectContent>
              {MINUTE_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {minuteFilterLabel(option, "All (Late filter)")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.earlyOnly} onValueChange={(v) => setFilters((current) => ({ ...current, earlyOnly: v as MinuteFilter }))}>
            <SelectTrigger><SelectValue placeholder="Early filter" /></SelectTrigger>
            <SelectContent>
              {MINUTE_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {minuteFilterLabel(option, "All (Early filter)")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Select value={filters.extraWorkFilter} onValueChange={(v) => setFilters((current) => ({ ...current, extraWorkFilter: v as MinuteFilter }))}>
            <SelectTrigger><SelectValue placeholder="All (Extra Work filter)" /></SelectTrigger>
            <SelectContent>
              {MINUTE_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.value === "all" ? "All (Extra Work filter)" : option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div>
            <label className="text-xs text-muted-foreground">Select Date</label>
            <Input type="date" value={filters.selectedDate} onChange={(e) => setFilters((current) => ({ ...current, selectedDate: e.target.value }))} />
          </div>
          <div className="flex items-end gap-2">
            <Button variant="secondary" onClick={applyFilters}>Go</Button>
            <Button variant="outline" onClick={clearFilters}>Clear</Button>
          </div>
        </div>
      </Card>

      <Card className="shadow-card border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head"><SortHeader label="No" col="record_number" sortKey={sortKey} sortDir={sortDir} setSort={setSort} /></TableHead>
                <TableHead className="table-head"><SortHeader label="Employee ID" col="employee_id" sortKey={sortKey} sortDir={sortDir} setSort={setSort} /></TableHead>
                <TableHead className="table-head"><SortHeader label="Teacher Name" col="first_name" sortKey={sortKey} sortDir={sortDir} setSort={setSort} /></TableHead>
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
                <TableHead className="table-head">Late Entry (Min)</TableHead>
                <TableHead className="table-head">Early Dep. (Min)</TableHead>
                <TableHead className="table-head">Extra Work Time</TableHead>
                <TableHead className="table-head">Status</TableHead>
                <TableHead className="table-head">Summary</TableHead>
                <TableHead className="table-head">Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={15} className="text-center text-muted-foreground py-10">
                    No records match your filters.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
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
                  <TableCell className={cn(r.late_minutes > 0 && "text-danger font-semibold")}>{formatMinutes(r.late_minutes)}</TableCell>
                  <TableCell className={cn(r.early_departure_minutes > 0 && "text-warning font-semibold")}>{formatMinutes(r.early_departure_minutes)}</TableCell>
                  <TableCell className={cn((r.extra_work_minutes ?? 0) > 0 && "text-success font-semibold")}>{formatMinutes(r.extra_work_minutes ?? 0)}</TableCell>
                  <TableCell><StatusBadge status={r.status} isHoliday={holidayDates.has(r.attendance_date)} /></TableCell>
                  <TableCell className="max-w-[260px] truncate" title={shortSummary(r.late_minutes, r.early_departure_minutes, r.status, r.extra_work_minutes ?? 0)}>
                    {shortSummary(r.late_minutes, r.early_departure_minutes, r.status, r.extra_work_minutes ?? 0)}
                  </TableCell>
                  <TableCell>
                    <div className="flex w-[320px] items-center gap-2">
                      <Input
                        value={commentDrafts[r.id] ?? ""}
                        onChange={(e) => updateCommentDraft(r.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveComment(r);
                        }}
                        maxLength={500}
                        className="min-w-0 overflow-x-auto whitespace-nowrap"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => saveComment(r)}
                        disabled={savingCommentIds.has(r.id)}
                      >
                        <Save className="h-4 w-4 mr-2" />
                        {savingCommentIds.has(r.id) ? "Saving" : "Save"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border flex-wrap gap-3">
          <div className="text-sm text-muted-foreground">{pageInfo}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
              </SelectContent>
            </Select>
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

function StatusBadge({ status, isHoliday }: { status: string; isHoliday: boolean }) {
  const map: Record<string, { label: string; cls: string }> = {
    present: { label: "Present", cls: "bg-success/15 text-success border-success/30" },
    late: { label: "Late Entry", cls: "bg-danger/15 text-danger border-danger/30" },
    absent: { label: "Absent", cls: "bg-muted text-muted-foreground border-border" },
    early_departure: { label: "Early Dep.", cls: "bg-warning/15 text-warning border-warning/30" },
    incomplete: { label: "Incomplete", cls: "bg-accent/30 text-accent-foreground border-accent/50" },
    holiday: { label: "Holiday", cls: "bg-accent/30 text-accent-foreground border-accent/50" },
  };
  if (isHoliday) {
    const v = map.holiday;
    return <Badge variant="outline" className={cn("font-semibold", v.cls)}>{v.label}</Badge>;
  }
  const v = map[status] ?? map.present;
  return <Badge variant="outline" className={cn("font-semibold", v.cls)}>{v.label}</Badge>;
}

function SortHeader({
  label, col, sortKey, sortDir, setSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  setSort: (k: SortKey, dir: "asc" | "desc") => void;
}) {
  const activeAsc = sortKey === col && sortDir === "asc";
  const activeDesc = sortKey === col && sortDir === "desc";
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="inline-flex flex-col leading-none">
        <button
          type="button"
          aria-label={`Sort ${label} ascending`}
          onClick={() => setSort(col, "asc")}
          className={cn("hover:text-foreground", activeAsc ? "text-primary" : "text-muted-foreground")}
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={`Sort ${label} descending`}
          onClick={() => setSort(col, "desc")}
          className={cn("hover:text-foreground", activeDesc ? "text-primary" : "text-muted-foreground")}
        >
          <ArrowDown className="h-3 w-3" />
        </button>
      </span>
    </span>
  );
}
