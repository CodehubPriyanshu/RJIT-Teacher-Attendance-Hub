import { useEffect, useMemo, useState, useCallback } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, Sun, PartyPopper, Briefcase, Plus, Pencil, Trash2, RefreshCw, X, Upload, Download, FileText, Eye, Clock, Users, Search, Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { computeWorkingDays, ymd, type WorkingDayBreakdown } from "@/lib/workingDays";
import { fetchEmployeeLeaves, createEmployeeLeave, createMultipleLeaves, deleteEmployeeLeave, updateEmployeeLeave, checkAttendanceForLeave, type EmployeeLeave } from "@/lib/leaves";
import { getAttendanceShift, isEightAmShiftTeacher } from "@/lib/attendanceShift";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);

interface Holiday {
  id: string;
  holiday_date: string;
  holiday_name: string;
  holiday_type: string;
  description: string | null;
  status: string;
  created_at: string;
}

const TYPES = ["National Holiday", "Festival", "College Holiday", "Weekend Holiday"];
const STATUSES = ["Active", "Inactive"];

// --- Leave-related constants ---
const LEAVE_TYPES = [
  { value: "Casual Leave", code: "CL" },
  { value: "Sick Leave", code: "SL" },
  { value: "Earned Leave", code: "EL" },
  { value: "Half Day", code: "HD" },
  { value: "Medical Leave", code: "ML" },
  { value: "Emergency Leave", code: "EML" },
  { value: "Official Duty", code: "OD" },
  { value: "Other", code: "OTH" },
];

const REASON_OPTIONS = [
  "Medical Emergency",
  "Personal Work",
  "Family Function",
  "Official Duty",
  "Examination",
  "Other",
];

const SHIFT_OPTIONS = [
  { value: "08:00", label: "8:00 AM Shift" },
  { value: "09:00", label: "9:00 AM Shift" },
];

const ACCEPTED_FILE_TYPES = ".pdf,.jpg,.jpeg,.png";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// --- Stat Card ---
const StatCard = ({
  icon: Icon, label, value, tone = "primary",
}: { icon: any; label: string; value: number | string; tone?: string }) => {
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
        </div>
      </CardContent>
    </Card>
  );
};

const monthOptions = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const yearOptions = (() => {
  const y = new Date().getFullYear();
  return Array.from({ length: 7 }, (_, i) => y - 3 + i);
})();

interface FormState {
  id?: string;
  holiday_date: string;
  holiday_name: string;
  holiday_type: string;
  description: string;
  status: string;
}

const blankForm: FormState = {
  holiday_date: ymd(new Date()),
  holiday_name: "",
  holiday_type: "College Holiday",
  description: "",
  status: "Active",
};

// --- Leave Form State ---
interface LeaveFormState {
  id?: string;
  shift: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  custom_leave_type: string;
  from_date: string;
  to_date: string;
  reason: string;
  custom_reason: string;
  document_file: File | null;
  is_custom_reason: boolean;
}

const blankLeaveForm: LeaveFormState = {
  id: undefined,
  shift: "",
  employee_id: "",
  employee_name: "",
  leave_type: "Casual Leave",
  custom_leave_type: "",
  from_date: "",
  to_date: "",
  reason: "",
  custom_reason: "",
  document_file: null,
  is_custom_reason: false,
};

export default function Holidays() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [search, setSearch] = useState("");

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [breakdown, setBreakdown] = useState<WorkingDayBreakdown | null>(null);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);

  // Leave management state
  const [leaves, setLeaves] = useState<EmployeeLeave[]>([]);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState<LeaveFormState>(blankLeaveForm);
  const [savingLeave, setSavingLeave] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<{ id: string; name: string }[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeesLoading, setEmployeesLoading] = useState(false);

  // Attendance check state
  const [attendanceCheckResult, setAttendanceCheckResult] = useState<{
    checked: boolean;
    hasAttendance: boolean;
    currentStatus: string | null;
  }>({ checked: false, hasAttendance: false, currentStatus: null });
  const [confirmAttendanceOpen, setConfirmAttendanceOpen] = useState(false);

  // Document preview state
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [docPreviewData, setDocPreviewData] = useState<{
    url: string;
    name: string;
    type: string;
    employeeName: string;
    leaveType: string;
    reason: string | null;
    date: string;
  } | null>(null);

  const { user } = useAuth();

  const monthFrom = useMemo(() => startOfMonth(new Date(year, month - 1, 1)), [year, month]);
  const monthTo = useMemo(() => endOfMonth(new Date(year, month - 1, 1)), [year, month]);

  // Load holidays
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromISO = ymd(monthFrom);
      const toISO = ymd(monthTo);
      const { data, error } = await supabase
        .from("holidays")
        .select("*")
        .gte("holiday_date", fromISO)
        .lte("holiday_date", toISO)
        .order("holiday_date", { ascending: true });
      if (error) throw error;
      setHolidays((data ?? []) as Holiday[]);
      const wb = await computeWorkingDays(monthFrom, monthTo);
      setBreakdown(wb);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load holidays");
    } finally {
      setLoading(false);
    }
  }, [monthFrom, monthTo]);

  // Load employee options for leave management
  const loadEmployeeOptions = useCallback(async () => {
    setEmployeesLoading(true);
    try {
      const { data, error } = await supabase
        .from("attendance_records_all")
        .select("employee_id, first_name")
        .order("first_name", { ascending: true });
      if (error) throw error;
      const unique = new Map<string, { id: string; name: string }>();
      for (const row of data ?? []) {
        const key = `${row.employee_id}|${row.first_name}`;
        if (!unique.has(key) && row.employee_id && row.first_name) {
          unique.set(key, { id: row.employee_id, name: row.first_name });
        }
      }
      setEmployeeOptions(Array.from(unique.values()));
    } catch (e: any) {
      console.error("Failed to load employee options", e);
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  // Load leaves
  const loadLeaves = useCallback(async () => {
    try {
      const data = await fetchEmployeeLeaves();
      setLeaves(data);
    } catch (e: any) {
      console.error("Failed to load leaves", e);
    }
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, year, load]);
  useEffect(() => { loadLeaves(); }, [loadLeaves]);
  useEffect(() => { loadEmployeeOptions(); }, [loadEmployeeOptions]);

  // Filtered holidays
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return holidays;
    return holidays.filter(
      (h) =>
        h.holiday_name.toLowerCase().includes(q) ||
        h.holiday_type.toLowerCase().includes(q) ||
        h.holiday_date.includes(q),
    );
  }, [holidays, search]);

  // Employees filtered by selected shift
  const shiftFilteredEmployees = useMemo(() => {
    if (!leaveForm.shift) return [];
    return employeeOptions.filter((emp) => {
      const isEightAm = isEightAmShiftTeacher(emp.name);
      if (leaveForm.shift === "08:00") return isEightAm;
      return !isEightAm;
    });
  }, [employeeOptions, leaveForm.shift]);

  // Search within shift-filtered employees
  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return shiftFilteredEmployees;
    return shiftFilteredEmployees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q),
    );
  }, [shiftFilteredEmployees, employeeSearch]);

  // Compute shift for selected employee
  const selectedEmployeeShift = useMemo(() => {
    if (!leaveForm.employee_name) return "";
    const shift = getAttendanceShift(leaveForm.employee_name);
    return shift.label;
  }, [leaveForm.employee_name]);

  // Holiday form handlers
  const openAdd = () => {
    setForm({ ...blankForm, holiday_date: ymd(new Date(year, month - 1, 1)) });
    setOpen(true);
  };

  const openEdit = (h: Holiday) => {
    setForm({
      id: h.id,
      holiday_date: h.holiday_date,
      holiday_name: h.holiday_name,
      holiday_type: h.holiday_type,
      description: h.description ?? "",
      status: h.status,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.holiday_date || !form.holiday_name.trim()) {
      toast.error("Date and name are required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("upsert_holiday", {
        p_holiday_date: form.holiday_date,
        p_holiday_name: form.holiday_name.trim(),
        p_holiday_type: form.holiday_type,
        p_description: form.description.trim() || null,
        p_status: form.status,
        p_id: form.id || null,
      });
      if (error) throw error;
      toast.success(form.id ? "Holiday updated" : "Holiday added");
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this holiday?")) return;
    try {
      const { error } = await supabase.rpc("delete_holiday", { p_id: id });
      if (error) throw error;
      toast.success("Holiday deleted. It is now a normal working day.");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  };

  const toggleStatus = async (h: Holiday) => {
    try {
      const { error } = await supabase.rpc("toggle_holiday_status", { p_id: h.id });
      if (error) throw error;
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to toggle status");
    }
  };

  const holidayDateObjs = useMemo(
    () => holidays.filter((h) => h.status === "Active").map((h) => {
      const [y, m, d] = h.holiday_date.split("-").map(Number);
      return new Date(y, m - 1, d);
    }),
    [holidays],
  );

  // --- Generate Weekends ---
  const generateWeekends = async () => {
    const fromISO = ymd(monthFrom);
    const toISO = ymd(monthTo);
    const existingSet = new Set(holidays.map((h) => h.holiday_date));
    const weekends: { holiday_date: string; holiday_name: string; holiday_type: string; status: string }[] = [];

    const d = new Date(monthFrom);
    while (d <= monthTo) {
      const day = d.getDay();
      const dateStr = ymd(d);
      const dayName = day === 0 ? "Sunday" : day === 6 ? "Saturday" : null;
      if (dayName && !existingSet.has(dateStr)) {
        weekends.push({
          holiday_date: dateStr,
          holiday_name: `${dayName}`,
          holiday_type: "Weekend Holiday",
          status: "Active",
        });
      }
      d.setDate(d.getDate() + 1);
    }

    if (weekends.length === 0) {
      toast.info("All weekends already exist as holidays.");
      return;
    }

    try {
      const { error } = await supabase.rpc("batch_insert_holidays", {
        p_holidays: weekends,
      });
      if (error) throw error;
      toast.success(`${weekends.length} weekend(s) added as holidays.`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate weekends");
    }
  };

  // --- Leave Form Handlers ---
  const openLeaveAdd = () => {
    setLeaveForm(blankLeaveForm);
    setEmployeeSearch("");
    setAttendanceCheckResult({ checked: false, hasAttendance: false, currentStatus: null });
    setLeaveDialogOpen(true);
  };

  const openLeaveEdit = (leave: EmployeeLeave) => {
    setLeaveForm({
      id: leave.id,
      shift: leave.shift || "",
      employee_id: leave.employee_id,
      employee_name: leave.employee_name,
      leave_type: LEAVE_TYPES.some((t) => t.value === leave.leave_type) ? leave.leave_type : "Other",
      custom_leave_type: LEAVE_TYPES.some((t) => t.value === leave.leave_type) ? "" : leave.leave_type,
      from_date: leave.leave_date || leave.start_date,
      to_date: leave.leave_date || leave.start_date,
      reason: leave.reason ?? "",
      custom_reason: "",
      document_file: null,
      is_custom_reason: leave.reason ? !REASON_OPTIONS.includes(leave.reason) : false,
    });
    setEmployeeSearch("");
    setAttendanceCheckResult({ checked: false, hasAttendance: false, currentStatus: null });
    setLeaveDialogOpen(true);
  };

  // Check attendance when employee and date are selected
  const handleAttendanceCheck = useCallback(async () => {
    if (!leaveForm.employee_id || !leaveForm.from_date) {
      setAttendanceCheckResult({ checked: false, hasAttendance: false, currentStatus: null });
      return;
    }

    try {
      const result = await checkAttendanceForLeave(leaveForm.employee_id, leaveForm.from_date);
      setAttendanceCheckResult({
        checked: true,
        hasAttendance: result.hasAttendance,
        currentStatus: result.currentStatus,
      });

      if (result.hasAttendance && !leaveForm.id) {
        setConfirmAttendanceOpen(true);
      }
    } catch (e) {
      console.warn("Failed to check attendance", e);
    }
  }, [leaveForm.employee_id, leaveForm.from_date, leaveForm.id]);

  const handleSaveLeave = async () => {
    // Final leave type
    const finalLeaveType = leaveForm.leave_type === "Other"
      ? leaveForm.custom_leave_type.trim()
      : leaveForm.leave_type;

    if (!leaveForm.shift) {
      toast.error("Please select a shift");
      return;
    }
    if (!leaveForm.employee_id || !leaveForm.employee_name) {
      toast.error("Please select an employee");
      return;
    }
    if (!finalLeaveType) {
      toast.error("Please select or enter a leave type");
      return;
    }
    if (!leaveForm.from_date) {
      toast.error("From date is required");
      return;
    }
    const toDate = leaveForm.to_date || leaveForm.from_date;
    if (toDate < leaveForm.from_date) {
      toast.error("To date must be on or after From date");
      return;
    }

    if (leaveForm.document_file && leaveForm.document_file.size > MAX_FILE_SIZE) {
      toast.error("File size exceeds 10 MB limit");
      return;
    }

    setSavingLeave(true);
    try {
      let document_url: string | null = null;
      let document_name: string | null = null;

      if (leaveForm.document_file) {
        document_name = leaveForm.document_file.name;
        document_url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(leaveForm.document_file);
        });
      }

      const finalReason = leaveForm.is_custom_reason ? leaveForm.custom_reason.trim() : leaveForm.reason;
      const isRange = leaveForm.from_date !== toDate;
      const previousStatus = attendanceCheckResult.hasAttendance
        ? (attendanceCheckResult.currentStatus ?? "absent")
        : "absent";

      if (leaveForm.id) {
        // Edit single leave
        await updateEmployeeLeave(leaveForm.id, {
          leave_type: finalLeaveType,
          leave_date: leaveForm.from_date,
          shift: leaveForm.shift,
          reason: finalReason || null,
          document_url,
          document_name,
        });
        toast.success("Leave updated successfully.");
        setLeaveDialogOpen(false);
        loadLeaves();
      } else if (isRange) {
        // Create leaves for each date in range
        const result = await createMultipleLeaves(
          {
            employee_id: leaveForm.employee_id,
            employee_name: leaveForm.employee_name,
            leave_type: finalLeaveType,
            shift: leaveForm.shift,
            reason: finalReason || null,
            document_url,
            document_name,
            created_by: user?.id ?? null,
            previous_status: previousStatus,
          },
          leaveForm.from_date,
          toDate
        );
        if (result.errors.length > 0) {
          toast.error(`Created ${result.created.length} leaves; ${result.errors.length} failed.`);
          console.warn("Leave creation errors:", result.errors);
        } else {
          toast.success(`Leave created successfully. ${result.created.length} day(s) recorded.`);
        }
        setLeaveDialogOpen(false);
        loadLeaves();
      } else {
        // Single day
        await createEmployeeLeave({
          employee_id: leaveForm.employee_id,
          employee_name: leaveForm.employee_name,
          leave_type: finalLeaveType,
          leave_date: leaveForm.from_date,
          start_date: leaveForm.from_date,
          end_date: leaveForm.from_date,
          shift: leaveForm.shift,
          reason: finalReason || null,
          document_url,
          document_name,
          created_by: user?.id ?? null,
          previous_status: previousStatus,
        });
        toast.success("Leave created successfully.");
        setLeaveDialogOpen(false);
        loadLeaves();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Unable to create leave. Please check required fields.");
    } finally {
      setSavingLeave(false);
    }
  };

  const handleDeleteLeave = async (id: string) => {
    if (!confirm("Delete this leave record? The attendance record will be restored.")) return;
    try {
      await deleteEmployeeLeave(id);
      toast.success("Leave deleted. Attendance restored.");
      loadLeaves();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete leave");
    }
  };

  // --- Leave Export Handlers ---
  const [leaveExporting, setLeaveExporting] = useState(false);
  const [leavePdfExporting, setLeavePdfExporting] = useState(false);

  const handleExportLeavesExcel = async () => {
    if (leaves.length === 0) { toast.error("No leave records to export"); return; }
    setLeaveExporting(true);
    try {
      const aoa: (string | null)[][] = [
        ["#", "Employee ID", "Employee Name", "Shift", "Leave Type", "Leave Date", "Reason", "Document"],
      ];
      for (let i = 0; i < leaves.length; i++) {
        const l = leaves[i];
        aoa.push([
          String(i + 1),
          l.employee_id,
          l.employee_name,
          l.shift ?? "",
          `${l.leave_type} (${getLeaveCode(l.leave_type)})`,
          l.leave_date || l.start_date,
          l.reason ?? "",
          l.document_name ?? "",
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [
        { wch: 6 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 30 }, { wch: 24 },
      ];
      // Style header
      const headerStyle = { font: { bold: true, sz: 11 }, alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "D9EAF7" } }, border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } } };
      for (let c = 0; c < 8; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = headerStyle;
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Leaves");
      XLSX.writeFile(wb, `employee_leaves_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Exported ${leaves.length} leave record(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setLeaveExporting(false);
    }
  };

  const handleExportLeavesPdf = async () => {
    if (leaves.length === 0) { toast.error("No leave records to export"); return; }
    setLeavePdfExporting(true);
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Employee Leave Records", pageWidth / 2, 15, { align: "center" });
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      const nowStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      doc.text(`Generated: ${nowStr}  |  Total Records: ${leaves.length}`, pageWidth / 2, 22, { align: "center" });

      const headers = ["#", "Employee ID", "Employee Name", "Shift", "Leave Type", "Leave Date", "Reason", "Document"];
      const body = leaves.map((l, i) => [
        String(i + 1), l.employee_id, l.employee_name, l.shift ?? "",
        `${l.leave_type} (${getLeaveCode(l.leave_type)})`,
        l.leave_date || l.start_date, l.reason ?? "", l.document_name ?? "",
      ]);

      (doc as any).autoTable({
        head: [headers],
        body,
        startY: 28,
        styles: { fontSize: 7, cellPadding: 1.5, halign: "center", valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.2 },
        headStyles: { fillColor: [44, 62, 80], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, halign: "center" },
        columnStyles: {
          0: { cellWidth: 8 }, 1: { cellWidth: 28 }, 2: { cellWidth: 40 },
          3: { cellWidth: 18 }, 4: { cellWidth: 30 }, 5: { cellWidth: 22 },
          6: { cellWidth: 50 }, 7: { cellWidth: 30 },
        },
        margin: { top: 28, left: 8, right: 8 },
        showHead: "everyPage",
      });

      doc.save(`employee_leaves_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success(`PDF exported: ${leaves.length} leave record(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "PDF Export failed");
    } finally {
      setLeavePdfExporting(false);
    }
  };

  // --- Leave Display Helpers ---
  const getLeaveCode = (type: string): string => {
    const found = LEAVE_TYPES.find((lt) => lt.value === type);
    return found ? found.code : type;
  };

  const getLeaveColor = (type: string): string => {
    const colorMap: Record<string, string> = {
      "Casual Leave": "bg-blue-100 text-blue-800",
      "Sick Leave": "bg-red-100 text-red-800",
      "Earned Leave": "bg-green-100 text-green-800",
      "Half Day": "bg-purple-100 text-purple-800",
      "Medical Leave": "bg-pink-100 text-pink-800",
      "Emergency Leave": "bg-orange-100 text-orange-800",
      "Official Duty": "bg-teal-100 text-teal-800",
    };
    return colorMap[type] || "bg-gray-100 text-gray-800";
  };

  const getDocumentUrl = (leave: EmployeeLeave): string | null => {
    if (!leave.document_url) return null;
    // If it's already a full URL (starts with http or data), use it directly
    if (leave.document_url.startsWith("http") || leave.document_url.startsWith("data:")) {
      return leave.document_url;
    }
    // Otherwise, it might be a Supabase storage path
    const { data } = supabase.storage.from("leave-documents").getPublicUrl(leave.document_url);
    return data?.publicUrl ?? null;
  };

  const getDocumentType = (leave: EmployeeLeave): string => {
    const name = (leave.document_name || leave.document_url || "").toLowerCase();
    if (name.endsWith(".pdf")) return "pdf";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image";
    if (name.endsWith(".png")) return "image";
    if (name.endsWith(".gif")) return "image";
    if (name.endsWith(".webp")) return "image";
    if (leave.document_url?.startsWith("data:image")) return "image";
    if (leave.document_url?.startsWith("data:application/pdf")) return "pdf";
    return "unknown";
  };

  const openDocumentPreview = (leave: EmployeeLeave) => {
    const url = getDocumentUrl(leave);
    if (!url) return;
    setDocPreviewData({
      url,
      name: leave.document_name || "Document",
      type: getDocumentType(leave),
      employeeName: leave.employee_name,
      leaveType: leave.leave_type,
      reason: leave.reason,
      date: leave.leave_date || leave.start_date,
    });
    setDocPreviewOpen(true);
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="holidays" className="space-y-6">
        <TabsList>
          <TabsTrigger value="holidays">Holiday Management</TabsTrigger>
          <TabsTrigger value="leaves">Employee Leave Management</TabsTrigger>
        </TabsList>

        {/* ============ TAB: HOLIDAY MANAGEMENT ============ */}
        <TabsContent value="holidays" className="space-y-6">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h2 className="page-title">Holiday and Working Day Management</h2>
              <p className="text-sm text-muted-foreground">
                Define holidays and compute total working days. Working days = total days − active holidays.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={generateWeekends} disabled={loading} className="transition-all duration-200 hover:scale-105 active:scale-95">
                <Sun className="h-4 w-4 mr-2" /> Generate Weekends
              </Button>
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="transition-all duration-200 hover:scale-105 active:scale-95">
                <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Refresh
              </Button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" onClick={openAdd}>
                    <Plus className="h-4 w-4 mr-2" /> Add Holiday
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{form.id ? "Edit Holiday" : "Add Holiday"}</DialogTitle>
                    <DialogDescription>
                      {form.id ? "Update the holiday details below." : "Fill in the details to add a new holiday."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={form.holiday_date}
                        onChange={(e) => setForm({ ...form, holiday_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Name</Label>
                      <Input
                        value={form.holiday_name}
                        onChange={(e) => setForm({ ...form, holiday_name: e.target.value })}
                        placeholder="e.g. Republic Day"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Type</Label>
                        <Select value={form.holiday_type} onValueChange={(v) => setForm({ ...form, holiday_type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Status</Label>
                        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Description</Label>
                      <Textarea
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>{saving ? "Saving\u2026" : "Save"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
            <StatCard icon={CalendarDays} label="Total Days in Month" value={breakdown?.totalDays ?? 0} tone="primary" />
            <StatCard icon={PartyPopper} label="Total Holidays" value={breakdown?.holidays ?? 0} tone="accent" />
            <StatCard icon={Sun} label="Total Sundays" value={breakdown?.sundays ?? 0} tone="muted" />
            <StatCard icon={Briefcase} label="Total Working Days" value={breakdown?.workingDays ?? 0} tone="success" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="shadow-card border-border/60 lg:col-span-1">
              <div className="px-5 pt-5 pb-2">
                <h3 className="section-title">Calendar</h3>
                <p className="text-xs text-muted-foreground">Active holidays highlighted</p>
              </div>
              <div className="p-3">
                <Calendar
                  mode="multiple"
                  month={monthFrom}
                  selected={holidayDateObjs}
                  onMonthChange={(d) => { setMonth(d.getMonth() + 1); setYear(d.getFullYear()); }}
                  className={cn("p-3 pointer-events-auto rounded-md border")}
                />
              </div>
            </Card>

            <Card className="shadow-card border-border/60 lg:col-span-2">
              <div className="flex items-end justify-between flex-wrap gap-3 px-5 pt-5 pb-3">
                <div>
                  <h3 className="section-title">Holidays \u2014 {format(monthFrom, "MMMM yyyy")}</h3>
                  <p className="text-xs text-muted-foreground">{filtered.length} record(s)</p>
                </div>
                <Input
                  placeholder="Search name, type, or date"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-xs"
                />
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="table-head">Date</TableHead>
                      <TableHead className="table-head">Name</TableHead>
                      <TableHead className="table-head">Type</TableHead>
                      <TableHead className="table-head">Description</TableHead>
                      <TableHead className="table-head">Status</TableHead>
                      <TableHead className="table-head text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 && !loading && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                          No holidays for this month.
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">{h.holiday_date}</TableCell>
                        <TableCell>{h.holiday_name}</TableCell>
                        <TableCell>{h.holiday_type}</TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">{h.description ?? "\u2014"}</TableCell>
                        <TableCell>
                          <button
                            onClick={() => toggleStatus(h)}
                            className={cn(
                              "px-2 py-0.5 rounded text-xs font-semibold",
                              h.status === "Active" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                            )}
                          >
                            {h.status}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(h)}
                            className="transition-all duration-200 hover:scale-110 active:scale-90">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => remove(h.id)}
                            className="transition-all duration-200 hover:scale-110 active:scale-90">
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ============ TAB: EMPLOYEE LEAVE MANAGEMENT ============ */}
        <TabsContent value="leaves" className="space-y-6">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h2 className="page-title">Employee Leave Management</h2>
              <p className="text-sm text-muted-foreground">
                Manage employee leaves. Leaves are automatically reflected in attendance reports, Excel/PDF exports, and dashboard calculations.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportLeavesExcel}
                disabled={leaveExporting || leaves.length === 0}
                className="transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <Download className="h-4 w-4 mr-2" />
                {leaveExporting ? "Exporting\u2026" : "Export Excel"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportLeavesPdf}
                disabled={leavePdfExporting || leaves.length === 0}
                className="transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <FileText className="h-4 w-4 mr-2" />
                {leavePdfExporting ? "Exporting PDF\u2026" : "Download PDF"}
              </Button>
              <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={openLeaveAdd} className="transition-all duration-200 hover:scale-105 active:scale-95">
                  <Plus className="h-4 w-4 mr-2" /> Add Leave
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{leaveForm.id ? "Edit Leave" : "Add Leave"}</DialogTitle>
                  <DialogDescription>
                    {leaveForm.id ? "Update the leave record below." : "Fill in the details to add a new leave record."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {/* 1. Shift Selection */}
                  <div className="space-y-1">
                    <Label>Shift <span className="text-danger">*</span></Label>
                    <div className="flex gap-2">
                      {SHIFT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={cn(
                            "flex-1 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all",
                            leaveForm.shift === opt.value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:border-primary/50 hover:bg-muted/50",
                          )}
                          onClick={() => {
                            setLeaveForm({ ...leaveForm, shift: opt.value, employee_id: "", employee_name: "" });
                            setEmployeeSearch("");
                            setAttendanceCheckResult({ checked: false, hasAttendance: false, currentStatus: null });
                          }}
                        >
                          <Clock className="h-4 w-4 inline mr-1.5" />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {!leaveForm.shift && (
                      <p className="text-xs text-muted-foreground mt-1">Select a shift to view employees</p>
                    )}
                  </div>

                  {/* 2. Dynamic Employee Dropdown */}
                  {leaveForm.shift && (
                    <div className="space-y-1">
                      <Label>Employee <span className="text-danger">*</span></Label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={employeesLoading ? "Loading employees..." : "Search employee by name or ID..."}
                          value={employeeSearch}
                          onChange={(e) => setEmployeeSearch(e.target.value)}
                          className="pl-9"
                          disabled={employeesLoading}
                        />
                        {employeesLoading && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
                        )}
                      </div>
                      {!leaveForm.employee_name && !employeesLoading && (
                        <div className="max-h-40 overflow-y-auto border rounded-md mt-1">
                          {filteredEmployees.length === 0 && (
                            <div className="p-2 text-sm text-muted-foreground">
                              {employeeOptions.length === 0
                                ? "No employees loaded"
                                : "No employees found for this shift"}
                            </div>
                          )}
                          {filteredEmployees.map((emp) => (
                            <button
                              key={`${emp.id}|${emp.name}`}
                              type="button"
                              className={cn(
                                "w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors",
                                leaveForm.employee_id === emp.id && "bg-primary/10 font-medium",
                              )}
                              onClick={() => {
                                setLeaveForm({ ...leaveForm, employee_id: emp.id, employee_name: emp.name });
                                setEmployeeSearch("");
                                setAttendanceCheckResult({ checked: false, hasAttendance: false, currentStatus: null });
                              }}
                            >
                              <span className="font-medium">{emp.name}</span>
                              <span className="text-muted-foreground ml-2 text-xs">({emp.id})</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {leaveForm.employee_name && (
                        <div className="flex items-center gap-2 mt-1 text-sm bg-muted/50 rounded-md px-3 py-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{leaveForm.employee_name}</span>
                          <span className="text-muted-foreground">({leaveForm.employee_id})</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium ml-auto">
                            {selectedEmployeeShift}
                          </span>
                          {!leaveForm.id && (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground ml-1"
                              onClick={() => {
                                setLeaveForm({ ...leaveForm, employee_id: "", employee_name: "" });
                                setAttendanceCheckResult({ checked: false, hasAttendance: false, currentStatus: null });
                              }}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. Leave Date Range */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>From Date <span className="text-danger">*</span></Label>
                      <Input
                        type="date"
                        value={leaveForm.from_date}
                        onChange={(e) => {
                          setLeaveForm({ ...leaveForm, from_date: e.target.value, to_date: e.target.value });
                          setAttendanceCheckResult({ checked: false, hasAttendance: false, currentStatus: null });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>To Date <span className="text-muted-foreground">(optional)</span></Label>
                      <Input
                        type="date"
                        value={leaveForm.to_date}
                        min={leaveForm.from_date}
                        onChange={(e) => setLeaveForm({ ...leaveForm, to_date: e.target.value })}
                      />
                    </div>
                  </div>
                  {leaveForm.from_date && leaveForm.to_date && leaveForm.to_date > leaveForm.from_date && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                      A leave record will be created for each day from <strong>{leaveForm.from_date}</strong> to <strong>{leaveForm.to_date}</strong> (inclusive).
                    </p>
                  )}

                  {/* Attendance Check Alert */}
                  {attendanceCheckResult.checked && attendanceCheckResult.hasAttendance && leaveForm.employee_name && leaveForm.from_date && !leaveForm.id && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
                      <p className="font-medium">Employee attendance already exists for this date.</p>
                      <p className="text-xs mt-1">
                        Current status: <strong>{attendanceCheckResult.currentStatus === "present" ? "Present" : attendanceCheckResult.currentStatus}</strong>.
                        Click <strong>Continue</strong> to convert this attendance record to Leave.
                      </p>
                    </div>
                  )}

                  {/* 4. Leave Type */}
                  <div className="space-y-1">
                    <Label>Leave Type <span className="text-danger">*</span></Label>
                    <Select
                      value={leaveForm.leave_type}
                      onValueChange={(v) => setLeaveForm({ ...leaveForm, leave_type: v, custom_leave_type: v === "Other" ? leaveForm.custom_leave_type : "" })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEAVE_TYPES.map((lt) => (
                          <SelectItem key={lt.value} value={lt.value}>
                            {lt.value} ({lt.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {leaveForm.leave_type === "Other" && (
                      <Input
                        className="mt-2"
                        placeholder="Custom Leave Type (e.g. Research Work, University Duty)"
                        value={leaveForm.custom_leave_type}
                        onChange={(e) => setLeaveForm({ ...leaveForm, custom_leave_type: e.target.value.slice(0, 100) })}
                        maxLength={100}
                      />
                    )}
                  </div>

                  {/* 5. Leave Reason */}
                  <div className="space-y-1">
                    <Label>Leave Reason</Label>
                    {!leaveForm.is_custom_reason ? (
                      <>
                        <Select
                          value={leaveForm.reason}
                          onValueChange={(v) => {
                            if (v === "__custom__") {
                              setLeaveForm({ ...leaveForm, is_custom_reason: true, custom_reason: "", reason: "" });
                            } else {
                              setLeaveForm({ ...leaveForm, reason: v });
                            }
                          }}
                        >
                          <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                          <SelectContent>
                            {REASON_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                            <SelectItem value="__custom__">Other (Custom)...</SelectItem>
                          </SelectContent>
                        </Select>
                        {leaveForm.reason && (
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {REASON_OPTIONS.filter((r) => r !== leaveForm.reason && r !== "Other").slice(0, 4).map((r) => (
                              <button
                                key={r}
                                type="button"
                                className="px-2 py-0.5 text-xs rounded-full border border-border hover:bg-muted transition-colors"
                                onClick={() => setLeaveForm({ ...leaveForm, reason: r })}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2">
                        <Textarea
                          value={leaveForm.custom_reason}
                          onChange={(e) => setLeaveForm({ ...leaveForm, custom_reason: e.target.value.slice(0, 500) })}
                          placeholder="Enter detailed leave reason..."
                          rows={3}
                          maxLength={500}
                        />
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() => setLeaveForm({ ...leaveForm, is_custom_reason: false, custom_reason: "" })}
                          >
                            Use predefined reason instead
                          </button>
                          <span className="text-xs text-muted-foreground">{leaveForm.custom_reason.length}/500</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 6. Document Upload */}
                  <div className="space-y-1">
                    <Label>Supporting Document <span className="text-muted-foreground">(PDF, JPG, JPEG, PNG - max 10 MB)</span></Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="file"
                        accept={ACCEPTED_FILE_TYPES}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          if (file && file.size > MAX_FILE_SIZE) {
                            toast.error("File size exceeds 10 MB limit");
                            e.target.value = "";
                            return;
                          }
                          setLeaveForm({ ...leaveForm, document_file: file });
                        }}
                        className="flex-1"
                      />
                      {leaveForm.document_file && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setLeaveForm({ ...leaveForm, document_file: null })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {leaveForm.document_file && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {leaveForm.document_file.name} ({(leaveForm.document_file.size / 1024 / 1024).toFixed(2)} MB)
                      </p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLeaveDialogOpen(false)} disabled={savingLeave}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveLeave} disabled={savingLeave}>
                    {savingLeave ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...
                      </>
                    ) : leaveForm.id ? "Update Leave" : "Save Leave"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </div>

          {/* Confirmation Alert Dialog for existing attendance */}
          <AlertDialog open={confirmAttendanceOpen} onOpenChange={setConfirmAttendanceOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Attendance Already Exists</AlertDialogTitle>
                <AlertDialogDescription>
                  Employee attendance already exists for this date.
                  <br /><br />
                  The employee is currently marked as <strong>{attendanceCheckResult.currentStatus === "present" ? "Present" : attendanceCheckResult.currentStatus}</strong> on{" "}
                  <strong>{leaveForm.from_date}</strong>.
                  <br /><br />
                  Do you want to convert this attendance record to Leave?
                  <br /><br />
                  <span className="text-amber-600 text-sm">
                    Note: The original attendance status will be stored and restored if the leave is deleted.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Leaves Table */}
          <Card className="shadow-card border-border/60">
            <div className="px-5 pt-5 pb-2">
              <h3 className="section-title">All Leave Records</h3>
              <p className="text-xs text-muted-foreground">{leaves.length} record(s)</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="table-head">Employee ID</TableHead>
                    <TableHead className="table-head">Employee Name</TableHead>
                    <TableHead className="table-head">Shift</TableHead>
                    <TableHead className="table-head">Leave Type</TableHead>
                    <TableHead className="table-head">Leave Date</TableHead>
                    <TableHead className="table-head">Reason</TableHead>
                    <TableHead className="table-head">Document</TableHead>
                    <TableHead className="table-head text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaves.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                        No leave records found.
                      </TableCell>
                    </TableRow>
                  )}
                  {leaves.map((leave) => (
                    <TableRow key={leave.id}>
                      <TableCell className="font-medium">{leave.employee_id}</TableCell>
                      <TableCell>{leave.employee_name}</TableCell>
                      <TableCell>
                        {leave.shift ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted">
                            {leave.shift === "08:00" ? "8:00 AM" : "9:00 AM"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">\u2014</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", getLeaveColor(leave.leave_type))}>
                          {getLeaveCode(leave.leave_type)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">({leave.leave_type})</span>
                      </TableCell>
                      <TableCell>{leave.leave_date || leave.start_date}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {leave.reason ?? "\u2014"}
                      </TableCell>
                      <TableCell>
                        {leave.document_url ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openDocumentPreview(leave)}
                              className="inline-flex items-center gap-1 text-primary hover:underline text-xs cursor-pointer"
                              title="View Document"
                            >
                              <Eye className="h-3 w-3" />
                              {leave.document_name ?? "View"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">\u2014</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openLeaveEdit(leave)}
                            className="transition-all duration-200 hover:scale-110 active:scale-90"
                            title="Edit Leave"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteLeave(leave.id)}
                            className="transition-all duration-200 hover:scale-110 active:scale-90 hover:text-danger"
                            title="Delete Leave"
                          >
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Document Preview Dialog */}
          <Dialog open={docPreviewOpen} onOpenChange={setDocPreviewOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Leave Document</DialogTitle>
                <DialogDescription>
                  {docPreviewData ? (
                    <>
                      Document for <strong>{docPreviewData.employeeName}</strong> &mdash; {docPreviewData.leaveType} on {docPreviewData.date}
                    </>
                  ) : (
                    "Loading document..."
                  )}
                </DialogDescription>
              </DialogHeader>
              {docPreviewData && (
                <div className="space-y-4">
                  {/* Document details */}
                  <div className="grid grid-cols-2 gap-3 text-sm bg-muted/30 rounded-lg p-4">
                    <div>
                      <span className="text-muted-foreground">Employee:</span>
                      <p className="font-medium">{docPreviewData.employeeName}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Leave Type:</span>
                      <p className="font-medium">{docPreviewData.leaveType}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Date:</span>
                      <p className="font-medium">{docPreviewData.date}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">File:</span>
                      <p className="font-medium break-all">{docPreviewData.name}</p>
                    </div>
                    {docPreviewData.reason && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Reason:</span>
                        <p className="font-medium">{docPreviewData.reason}</p>
                      </div>
                    )}
                  </div>

                  {/* Document preview */}
                  <div className="border rounded-lg overflow-hidden bg-muted/10">
                    {docPreviewData.type === "pdf" ? (
                      <div className="flex flex-col items-center justify-center p-8 gap-4">
                        <FileText className="h-16 w-16 text-primary/60" />
                        <p className="text-sm text-muted-foreground">PDF Document</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => window.open(docPreviewData.url, "_blank", "noopener,noreferrer")}
                          >
                            <Eye className="h-4 w-4 mr-2" /> Open PDF
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const a = document.createElement("a");
                              a.href = docPreviewData.url;
                              a.download = docPreviewData.name;
                              a.click();
                            }}
                          >
                            <Download className="h-4 w-4 mr-2" /> Download
                          </Button>
                        </div>
                      </div>
                    ) : docPreviewData.type === "image" ? (
                      <div className="p-4">
                        <img
                          src={docPreviewData.url}
                          alt={docPreviewData.name}
                          className="max-w-full max-h-[50vh] object-contain mx-auto rounded-md"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                            (e.target as HTMLImageElement).parentElement!.innerHTML = `
                              <div class="flex flex-col items-center justify-center p-8 gap-4">
                                <FileText class="h-16 w-16 text-muted-foreground" />
                                <p class="text-sm text-muted-foreground">Failed to load image</p>
                              </div>
                            `;
                          }}
                        />
                        <div className="flex justify-center gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const a = document.createElement("a");
                              a.href = docPreviewData.url;
                              a.download = docPreviewData.name;
                              a.click();
                            }}
                          >
                            <Download className="h-4 w-4 mr-2" /> Download
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-8 gap-4">
                        <FileText className="h-16 w-16 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Cannot preview this document type</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(docPreviewData.url, "_blank", "noopener,noreferrer")}
                        >
                          <Eye className="h-4 w-4 mr-2" /> Open in New Tab
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDocPreviewOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
