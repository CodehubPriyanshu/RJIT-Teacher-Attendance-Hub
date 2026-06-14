import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Save, Search, FileText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UploadAttendanceDialog } from "@/components/UploadAttendanceDialog";
import { formatMinutes, shortSummary } from "@/lib/timeFormat";
import { fetchActiveHolidays } from "@/lib/workingDays";
import { computeStatus, toMinutes } from "@/lib/attendanceCalc";
import { getAttendanceShift, type AttendanceShiftCategory } from "@/lib/attendanceShift";
import { fetchEmployeeLeaves, findLeaveForDate, type EmployeeLeave } from "@/lib/leaves";

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
const EXPORT_BATCH_SIZE = 200;

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

function normalizeStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toLowerCase();
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function parseISODate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfMonthDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function monthName(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function exportTitle(from: Date, to: Date) {
  const fromMonth = monthName(from);
  const toMonth = monthName(to);
  return `Attendance Report - ${fromMonth === toMonth ? fromMonth : `${fromMonth} to ${toMonth}`}`;
}

function getExportDateRange(records: Row[], filters: Filters) {
  if (filters.selectedDate) {
    const date = parseISODate(filters.selectedDate);
    return { from: date, to: date };
  }

  if (filters.from && filters.to) {
    return { from: parseISODate(filters.from), to: parseISODate(filters.to) };
  }

  const anchorDate =
    filters.from ||
    filters.to ||
    records.map((record) => record.attendance_date).sort()[0] ||
    formatISODate(new Date());
  const anchor = parseISODate(anchorDate);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);

  return {
    from: filters.from ? parseISODate(filters.from) : monthStart,
    to: filters.to ? parseISODate(filters.to) : endOfMonthDate(anchor),
  };
}

function getDatesInRange(from: Date, to: Date) {
  const dates: Date[] = [];
  let current = new Date(from);
  while (current <= to) {
    dates.push(new Date(current));
    current = addDays(current, 1);
  }
  return dates;
}

function normalizeTime(value: string | null) {
  return value?.slice(0, 5) || "";
}

function sleep(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function styleCell(cell: XLSX.CellObject | undefined, style: Record<string, unknown>) {
  if (cell) cell.s = style;
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
  // If the DB already says "leave", preserve it (do not override)
  if (normalizeStatus(row.status) === "leave") {
    return row;
  }

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
  const [pdfExporting, setPdfExporting] = useState(false);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());
  const [allLeaves, setAllLeaves] = useState<EmployeeLeave[]>([]);
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

  const loadLeaves = useCallback(async () => {
    try {
      const data = await fetchEmployeeLeaves();
      setAllLeaves(data);
    } catch (e) {
      console.error("Failed to load leaves:", e);
    }
  }, []);

  useEffect(() => {
    fetchDepartmentOptions();
  }, []);

  useEffect(() => {
    fetchPage();
    fetchHolidays();
    loadLeaves();
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

  // --- Leave helper ---
  const getLeaveCode = (type: string): string => {
    const map: Record<string, string> = {
      "Casual Leave": "CL",
      "Sick Leave": "SL",
      "Medical Leave": "ML",
      "Half Day": "HD",
      "Emergency Leave": "EL",
      "Official Duty": "OD",
      "Work From Home": "WFH",
      "Special Leave": "SPL",
    };
    return map[type] || type;
  };

  /** Get attendance display value for a cell — returns punch-specific display */
  const getCellDisplay = (
    dateKey: string,
    record: Row | undefined,
    holidayDatesSet: Set<string>,
    leaves: EmployeeLeave[],
    employeeId: string,
    punchType: "first_punch" | "last_punch",
  ): { value: string; style: string; note?: string } => {
    // Holiday check first
    if (holidayDatesSet.has(dateKey)) {
      const dayOfWeek = new Date(dateKey).getDay();
      if (dayOfWeek === 6) return { value: "H", style: "saturdayHoliday" };
      if (dayOfWeek === 0) return { value: "H", style: "sundayHoliday" };
      return { value: "H", style: "holiday" };
    }
    // Leave check
    const leave = findLeaveForDate(leaves, employeeId, dateKey);
    if (leave) {
      const code = getLeaveCode(leave.leave_type);
      if (code === "HD") return { value: "HD", style: "halfDay", note: leave.reason ?? undefined };
      return { value: code, style: "leave", note: leave.reason ?? undefined };
    }
    // If no record → absent
    if (!record) return { value: "A", style: "absent" };
    // Show actual punch time
    const val = normalizeTime(record[punchType]);
    return { value: val || (punchType === "first_punch" ? "P" : "O"), style: "present" };
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
      const { from, to } = getExportDateRange(filtered, appliedFilters);
      const exportDates = getDatesInRange(from, to);
      const exportDateKeys = exportDates.map(formatISODate);
      const exportDateKeySet = new Set(exportDateKeys);
      const exportHolidayDates = await fetchActiveHolidays(formatISODate(from), formatISODate(to));
      const leaves = await fetchEmployeeLeaves();

      // Build employee data map
      const employeeMap = new Map<string, { details: Row; recordsByDate: Map<string, Row> }>();
      for (let index = 0; index < filtered.length; index += 1) {
        const record = filtered[index];
        if (!exportDateKeySet.has(record.attendance_date)) continue;
        const key = record.employee_id || record.first_name;
        const employee = employeeMap.get(key);
        if (employee) {
          employee.recordsByDate.set(record.attendance_date, record);
        } else {
          employeeMap.set(key, {
            details: record,
            recordsByDate: new Map([[record.attendance_date, record]]),
          });
        }
        if (index > 0 && index % 5000 === 0) await sleep();
      }

      const employees = Array.from(employeeMap.values()).sort((a, b) => {
        const recordA = a.details.record_number ?? Number.MAX_SAFE_INTEGER;
        const recordB = b.details.record_number ?? Number.MAX_SAFE_INTEGER;
        if (recordA !== recordB) return recordA - recordB;
        return a.details.first_name.localeCompare(b.details.first_name);
      });

      const title = exportTitle(from, to);
      // Two header rows: first with day numbers, second with weekday abbreviations
      const headerRow2 = exportDates.map((d) => {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return days[d.getDay()];
      });

      // Static columns: No, Employee Name, Department, Punch Label
      const STATIC_COUNT = 4;
      // Leave display for notes
      const notes: { row: number; col: number; text: string }[] = [];

      // ===== BUILD DATA =====
      // Rows alternate: [Punch In row, Punch Out row] per employee
      const aoa: (string | number | null)[][] = [
        [title],
        ["#", "Employee Name", "Department", "Punch", ...exportDates.map((d) => String(d.getDate()))],
        ["", "", "", "", ...headerRow2],
      ];

      for (let index = 0; index < employees.length; index += 1) {
        const employee = employees[index];
        const { details, recordsByDate } = employee;

        const punchInRow: (string | number | null)[] = [
          index + 1,
          details.first_name,
          details.department ?? "",
          "Punch In",
        ];
        const punchOutRow: (string | number | null)[] = [
          "", // No index repeat
          "", // Name only on first row
          "", // Dept only on first row
          "Punch Out",
        ];

        for (const dateKey of exportDateKeys) {
          const record = recordsByDate.get(dateKey);
          const inDisplay = getCellDisplay(dateKey, record, exportHolidayDates, leaves, details.employee_id, "first_punch");
          const outDisplay = getCellDisplay(dateKey, record, exportHolidayDates, leaves, details.employee_id, "last_punch");
          punchInRow.push(inDisplay.value);
          punchOutRow.push(outDisplay.value);
          if (inDisplay.note) {
            notes.push({ row: 3 + index * 2, col: STATIC_COUNT + exportDateKeys.indexOf(dateKey), text: inDisplay.note });
          }
          if (outDisplay.note) {
            notes.push({ row: 4 + index * 2, col: STATIC_COUNT + exportDateKeys.indexOf(dateKey), text: outDisplay.note });
          }
        }

        aoa.push(punchInRow, punchOutRow);

        if (index > 0 && index % EXPORT_BATCH_SIZE === 0) await sleep();
      }

      // ===== BUILD WORKSHEET =====
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      const bodyStartRow = 3;
      const lastColumn = STATIC_COUNT - 1 + exportDates.length;

      // Merge title across all columns
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
      ];

      // Column widths
      ws["!cols"] = [
        { wch: 6 },   // #
        { wch: 28 },  // Employee Name
        { wch: 26 },  // Department
        { wch: 12 },  // Punch
        ...exportDates.map(() => ({ wch: 9 })),
      ];

      // Freeze: left 4 columns, top 3 rows (title + 2 header rows)
      (ws as any)["!freeze"] = {
        xSplit: STATIC_COUNT,
        ySplit: bodyStartRow,
      };

      // ===== STYLES =====
      const thinBorder = (color = "CCCCCC") => ({
        top: { style: "thin", color: { rgb: color } },
        bottom: { style: "thin", color: { rgb: color } },
        left: { style: "thin", color: { rgb: color } },
        right: { style: "thin", color: { rgb: color } },
      });
      const darkBorder = thinBorder("888888");

      const titleStyle: any = {
        font: { bold: true, sz: 16 },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: darkBorder,
      };

      const headerStyle: any = {
        font: { bold: true, sz: 9 },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        fill: { fgColor: { rgb: "D9EAF7" } },
        border: darkBorder,
      };

      const subHeaderStyle: any = {
        ...headerStyle,
        font: { bold: true, sz: 8 },
        fill: { fgColor: { rgb: "E8F0FE" } },
      };

      const borderThin = thinBorder();

      // Alternating employee row background colors (light shade)
      const evenEmpBg = "FFFFFF";
      const oddEmpBg = "F8FAFD";

      // ===== APPLY TITLE =====
      styleCell(ws[XLSX.utils.encode_cell({ r: 0, c: 0 })], titleStyle);

      // ===== APPLY HEADERS =====
      for (let col = 0; col <= lastColumn; col++) {
        styleCell(ws[XLSX.utils.encode_cell({ r: 1, c: col })], headerStyle);
        styleCell(ws[XLSX.utils.encode_cell({ r: 2, c: col })], subHeaderStyle);
      }

      // Mark the second header row labels as "Punch In" / "Punch Out" label columns
      // Actually date headers are already at row 1 (numbers) and row 2 (day names)
      // The "Punch In / Out" labels are implied because each employee has two rows.

      // For clarity, let's label row 1 columns: merge row 1 cell for static portion
      // already done above.

      // ===== APPLY DATA CELLS =====
      for (let row = bodyStartRow; row < aoa.length; row++) {
        const empIdx = Math.floor((row - bodyStartRow) / 2);
        const isPunchOut = (row - bodyStartRow) % 2 === 1;
        const isEvenEmployee = empIdx % 2 === 0;
        const empBg = isEvenEmployee ? evenEmpBg : oddEmpBg;

        for (let col = 0; col <= lastColumn; col++) {
          const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = ws[cellRef];
          if (!cell) continue;

          const isDetailCol = col < STATIC_COUNT;

          if (isDetailCol) {
            // Employee detail column
            styleCell(cell, {
              alignment: {
                horizontal: (col === 0 || col === 3) ? "center" : "left",
                vertical: "center",
                wrapText: true,
              },
              fill: { fgColor: { rgb: empBg } },
              font: isPunchOut ? { italic: true, color: { rgb: "888888" } } : { bold: true },
              border: borderThin,
            });
          } else {
            // Attendance data column
            const val = String(cell.v || "");
            const dateIdx = col - STATIC_COUNT;
            const d = exportDates[dateIdx];
            const dayOfWeek = d ? d.getDay() : -1;

            if (val === "H") {
              if (dayOfWeek === 6) styleCell(cell, { alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "FFE0B2" } }, border: borderThin });
              else if (dayOfWeek === 0) styleCell(cell, { alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "FFCDD2" } }, border: borderThin });
              else styleCell(cell, { alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "FFF9C4" } }, border: borderThin });
            } else if (val === "A") {
              styleCell(cell, { alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "F8BBD0" } }, border: borderThin });
            } else if (val === "HD") {
              styleCell(cell, { alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "E1BEE7" } }, border: borderThin });
            } else if (["CL", "SL", "ML", "EL", "OD", "WFH", "SPL"].includes(val)) {
              styleCell(cell, { alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "BBDEFB" } }, border: borderThin });
            } else {
              // Present / punch time
              styleCell(cell, {
                alignment: { horizontal: "center", vertical: "center" },
                fill: { fgColor: { rgb: empBg } },
                font: isPunchOut ? { color: { rgb: "666666" } } : { color: { rgb: "333333" } },
                border: borderThin,
              });
            }
          }
        }

        if (row % (EXPORT_BATCH_SIZE * 2) === 0) await sleep();
      }

      // ===== COMMENTS FOR LEAVE REASONS =====
      if (notes.length > 0) {
        ws["!comments"] = [];
        for (const note of notes) {
          (ws["!comments"] as any[]).push({
            ref: XLSX.utils.encode_cell({ r: note.row, c: note.col }),
            t: note.text,
            a: "Attendance System",
          });
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
      XLSX.writeFile(wb, `attendance_${formatISODate(from)}_${formatISODate(to)}.xlsx`);
      toast.success(`Exported ${employees.length.toLocaleString()} employees across ${exportDates.length} day(s)`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Export failed"));
    } finally {
      setExporting(false);
    }
};

  // ===================== PDF EXPORT =====================
  const handlePdfExport = async () => {
    setPdfExporting(true);
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
      const { from, to } = getExportDateRange(filtered, appliedFilters);
      const exportDates = getDatesInRange(from, to);
      const exportDateKeys = exportDates.map(formatISODate);
      const exportDateKeySet = new Set(exportDateKeys);
      const exportHolidayDates = await fetchActiveHolidays(formatISODate(from), formatISODate(to));
      const leaves = await fetchEmployeeLeaves();

      // Build employee data map
      const employeeMap = new Map<string, { details: Row; recordsByDate: Map<string, Row> }>();
      for (const record of filtered) {
        if (!exportDateKeySet.has(record.attendance_date)) continue;
        const key = record.employee_id || record.first_name;
        const employee = employeeMap.get(key);
        if (employee) {
          employee.recordsByDate.set(record.attendance_date, record);
        } else {
          employeeMap.set(key, {
            details: record,
            recordsByDate: new Map([[record.attendance_date, record]]),
          });
        }
      }

      const employees = Array.from(employeeMap.values()).sort((a, b) => {
        const recordA = a.details.record_number ?? Number.MAX_SAFE_INTEGER;
        const recordB = b.details.record_number ?? Number.MAX_SAFE_INTEGER;
        if (recordA !== recordB) return recordA - recordB;
        return a.details.first_name.localeCompare(b.details.first_name);
      });

      const INSTITUTE_NAME = "Rustamji Institute of Technology";

      // Create PDF in Landscape A3 for enterprise-grade reporting
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a3",
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Professional Centered Header section
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text(INSTITUTE_NAME, pageWidth / 2, 18, { align: "center" });

      doc.setFontSize(16);
      doc.text("Employee Attendance Report", pageWidth / 2, 28, { align: "center" });

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      const monthDisplay = from.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      doc.text(`Month: ${monthDisplay}`, pageWidth / 2, 36, { align: "center" });

      doc.setFontSize(10);
      const now = new Date();
      const genTime = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      doc.text(`Generated On: ${genTime}`, pageWidth / 2, 43, { align: "center" });

      // Build table data: TWO rows per employee (Punch In / Punch Out) — NO Department column
      const dayAbbr = exportDates.map((d) => {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return days[d.getDay()];
      });

      const headers = [
        "#",
        "Employee Name",
        "Punch",
        ...exportDates.map((d, i) => `${d.getDate()}\n${dayAbbr[i]}`),
      ];

      const tableBody: string[][] = [];
      const employeeDataList: Row[] = [];

      for (let index = 0; index < employees.length; index++) {
        const employee = employees[index];
        const { details, recordsByDate } = employee;
        employeeDataList.push(details);

        const punchInRow: string[] = [
          String(index + 1),
          details.first_name,
          "Punch In",
        ];
        const punchOutRow: string[] = ["", "", "Punch Out"];

        for (const dateKey of exportDateKeys) {
          const record = recordsByDate.get(dateKey);
          const inDisplay = getCellDisplay(dateKey, record, exportHolidayDates, leaves, details.employee_id, "first_punch");
          const outDisplay = getCellDisplay(dateKey, record, exportHolidayDates, leaves, details.employee_id, "last_punch");
          punchInRow.push(inDisplay.value);
          punchOutRow.push(outDisplay.value);
        }

        tableBody.push(punchInRow, punchOutRow);
      }

      // Color coding constants
      const COLOR_SAT: [number, number, number] = [255, 224, 178];
      const COLOR_SUN: [number, number, number] = [255, 205, 210];
      const COLOR_ABSENT: [number, number, number] = [248, 187, 208];
      const COLOR_HD: [number, number, number] = [225, 190, 231];
      const COLOR_LEAVE: [number, number, number] = [187, 222, 251];
      const COLOR_LATE: [number, number, number] = [255, 253, 208];
      const COLOR_PRESENT: [number, number, number] = [255, 255, 255];

      const STATIC_COLS = 3; // #, Employee Name, Punch
      const numDateCols = exportDates.length;
      const totalCols = STATIC_COLS + numDateCols;

      // Calculate date column width: remaining A3 landscape width after static cols and margins
      const pageMarginLeft = 8;
      const pageMarginRight = 8;
      const staticWidth = 10 + 60 + 20; // # + Name + Punch
      const availWidth = pageWidth - pageMarginLeft - pageMarginRight - staticWidth;
      const dateColWidth = Math.max(10, Math.min(14, Math.floor(availWidth / numDateCols)));

      const fontSize = numDateCols > 28 ? 6.5 : numDateCols > 25 ? 7 : 8;

      const dateColStyles: Record<string, any> = {};
      for (let i = STATIC_COLS; i < totalCols; i++) {
        dateColStyles[i] = { cellWidth: dateColWidth, minCellWidth: dateColWidth };
      }

      (doc as any).autoTable({
        head: [headers],
        body: tableBody,
        startY: 52,
        styles: {
          fontSize: fontSize,
          cellPadding: 1.2,
          halign: "center",
          valign: "middle",
          lineColor: [170, 170, 170],
          lineWidth: 0.15,
          overflow: "visible",
          minCellHeight: 6.5,
          font: "helvetica",
          cellWidth: "auto",
        },
        headStyles: {
          fillColor: [44, 62, 80],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: fontSize + 0.5,
          halign: "center",
        },
        columnStyles: {
          0: { cellWidth: 10 },  // #
          1: { cellWidth: 60 },  // Employee Name
          2: { cellWidth: 20 },  // Punch
          ...dateColStyles,
        },
        didParseCell: function (data: any) {
          if (data.section === "body") {
            const rowIdx = data.row.index;
            const empIdx = Math.floor(rowIdx / 2);
            const isPunchOut = rowIdx % 2 === 1;
            const isEvenEmp = empIdx % 2 === 0;
            const empBg: [number, number, number] = isEvenEmp ? [255, 255, 255] : [248, 250, 253];

            if (data.column.index < STATIC_COLS) {
              data.cell.styles.fillColor = empBg;
              if (isPunchOut) {
                data.cell.styles.textColor = [120, 120, 120];
                data.cell.styles.fontStyle = "italic";
              } else {
                data.cell.styles.textColor = [0, 0, 0];
                data.cell.styles.fontStyle = "bold";
              }
            } else {
              const val = String(data.cell.raw || "").trim();
              const dateIdx = data.column.index - STATIC_COLS;
              const d = exportDates[dateIdx];
              const employee = employees[empIdx];
              const record = employee?.recordsByDate.get(exportDateKeys[dateIdx]);

              if (val === "H") {
                const dayOfWeek = d ? d.getDay() : -1;
                if (dayOfWeek === 6) data.cell.styles.fillColor = COLOR_SAT;
                else if (dayOfWeek === 0) data.cell.styles.fillColor = COLOR_SUN;
                else data.cell.styles.fillColor = [255, 249, 196];
              } else if (val === "A") {
                data.cell.styles.fillColor = COLOR_ABSENT;
              } else if (val === "HD") {
                data.cell.styles.fillColor = COLOR_HD;
              } else if (["CL", "SL", "ML", "EL", "OD", "WFH", "SPL"].includes(val)) {
                data.cell.styles.fillColor = COLOR_LEAVE;
              } else if (val && val !== "P" && val !== "O") {
                if (!isPunchOut && record && record.late_minutes > 0) {
                  data.cell.styles.fillColor = COLOR_LATE;
                } else {
                  data.cell.styles.fillColor = COLOR_PRESENT;
                }
                data.cell.styles.fontStyle = "bold";
                data.cell.styles.textColor = isPunchOut ? [80, 80, 80] : [20, 20, 20];
              } else {
                data.cell.styles.fillColor = empBg;
              }
            }
          }
        },
        margin: { top: 52, left: pageMarginLeft, right: pageMarginRight, bottom: 15 },
        showHead: "everyPage",
        pageBreak: "auto",
        rowPageBreak: "avoid",
      });

      // Add Footer Legend
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text("Report Legend:", 10, finalY);
      doc.text("H = Holiday | A = Absent | HD = Half Day | CL/SL/ML/EL/OD/WFH/SPL = Leaves | Yellow Highlight = Late Entry", 10, finalY + 6);
      doc.text("Format: Each employee record consists of two rows (Punch In and Punch Out).", 10, finalY + 12);

      doc.save(`attendance_${formatISODate(from)}_${formatISODate(to)}.pdf`);
      toast.success(`PDF exported: ${employees.length.toLocaleString()} employees`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "PDF Export failed"));
    } finally {
      setPdfExporting(false);
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
          <Button size="sm" variant="secondary" onClick={handlePdfExport} disabled={pdfExporting || count === 0}>
            <FileText className="h-4 w-4 mr-2" />
            {pdfExporting ? "Exporting PDF…" : "Download PDF"}
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
              <SelectItem value="leave">Leave</SelectItem>
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
                <TableHead className="table-head">Leave Info</TableHead>
                <TableHead className="table-head">Summary</TableHead>
                <TableHead className="table-head">Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={16} className="text-center text-muted-foreground py-10">
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
                  <TableCell>
                    {(() => {
                      const leave = findLeaveForDate(allLeaves, r.employee_id, r.attendance_date);
                      if (!leave) return <span className="text-muted-foreground">\u2014</span>;
                      return (
                        <span className={cn("px-2 py-0.5 rounded text-xs font-semibold inline-block",
                          leave.leave_type === "Half Day" ? "bg-purple-100 text-purple-800" :
                          "bg-blue-100 text-blue-800"
                        )}>
                          {leave.leave_type}{leave.leave_type !== "Half Day" ? "" : " (HD)"}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate" title={
                      r.status === "leave"
                        ? (r.comment ?? "Leave")
                        : shortSummary(r.late_minutes, r.early_departure_minutes, r.status, r.extra_work_minutes ?? 0)
                    }>
                    {r.status === "leave"
                      ? (r.comment ?? "Leave")
                      : shortSummary(r.late_minutes, r.early_departure_minutes, r.status, r.extra_work_minutes ?? 0)}
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
    leave: { label: "Leave", cls: "bg-blue-100 text-blue-800 border-blue-200" },
  };

  // If holiday but the employee actually came to work, show their real status (present, late, etc.), not "Holiday"
  if (isHoliday && status !== "absent" && status !== "leave") {
    const v = map[status] ?? map.present;
    return <Badge variant="outline" className={cn("font-semibold", v.cls)}>{v.label}</Badge>;
  }

  // If holiday and absent → show "Holiday"
  if (isHoliday) {
    return <Badge variant="outline" className={cn("font-semibold", map.holiday.cls)}>{map.holiday.label}</Badge>;
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
