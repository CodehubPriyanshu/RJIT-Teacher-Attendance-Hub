import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function MonthlySummary() {
  const now = new Date();
  const [month, setMonth] = useState((now.getMonth() + 1).toString());
  const [year, setYear] = useState(now.getFullYear().toString());
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      // compute on the fly from attendance
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const end = new Date(y, m, 0);
      const endStr = `${y}-${String(m).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;

      const { data: teachers } = await supabase.from("teachers").select("id, name, employee_id, department").eq("status", "active");
      const { data: att } = await supabase
        .from("attendance")
        .select("*")
        .gte("attendance_date", start)
        .lte("attendance_date", endStr);

      const summary = (teachers ?? []).map((t: any) => {
        const records = (att ?? []).filter((a: any) => a.teacher_id === t.id);
        const totalLate = records.reduce((s: number, r: any) => s + (r.late_minutes || 0), 0);
        const totalEarly = records.reduce((s: number, r: any) => s + (r.early_departure_minutes || 0), 0);
        const present = records.filter((r: any) => r.status !== "absent" && r.check_in).length;
        const workingDays = records.length;
        const absent = records.filter((r: any) => r.status === "absent").length;
        return {
          name: t.name,
          employee_id: t.employee_id,
          department: t.department,
          total_working_days: workingDays,
          total_present: present,
          total_absent_days: absent,
          total_late_minutes: totalLate,
          total_early_departure_minutes: totalEarly,
        };
      });
      setRows(summary);
    })();
  }, [month, year]);

  const dataForExport = useMemo(() => rows.map((r) => ({
    Teacher: r.name,
    "Employee ID": r.employee_id,
    Department: r.department ?? "",
    "Working Days": r.total_working_days,
    Present: r.total_present,
    "Absent Days": r.total_absent_days,
    "Late Minutes": r.total_late_minutes,
    "Early Dep. Minutes": r.total_early_departure_minutes,
  })), [rows]);

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(dataForExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Monthly");
    XLSX.writeFile(wb, `monthly-${year}-${month}.xlsx`);
  };
  const exportCsv = () => {
    const ws = XLSX.utils.json_to_sheet(dataForExport);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `monthly-${year}-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="page-title">Monthly Summary</h2>
          <p className="text-sm text-muted-foreground">Aggregated attendance by teacher.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> CSV</Button>
          <Button onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4 mr-1" /> Excel</Button>
        </div>
      </div>

      <Card className="shadow-card border-border/60 p-4">
        <div className="grid sm:grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m, i) => <SelectItem key={m} value={(i + 1).toString()}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }).map((_, i) => {
                  const y = (now.getFullYear() - i).toString();
                  return <SelectItem key={y} value={y}>{y}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="shadow-card border-border/60 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="table-head">Teacher</TableHead>
              <TableHead className="table-head">Employee ID</TableHead>
              <TableHead className="table-head">Department</TableHead>
              <TableHead className="table-head">Working Days</TableHead>
              <TableHead className="table-head">Present</TableHead>
              <TableHead className="table-head">Absent</TableHead>
              <TableHead className="table-head">Total Late (min)</TableHead>
              <TableHead className="table-head">Total Early Dep. (min)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No data.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.employee_id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.employee_id}</TableCell>
                <TableCell>{r.department ?? "—"}</TableCell>
                <TableCell>{r.total_working_days}</TableCell>
                <TableCell>{r.total_present}</TableCell>
                <TableCell className={r.total_absent_days > 0 ? "text-danger font-semibold" : ""}>{r.total_absent_days}</TableCell>
                <TableCell className={r.total_late_minutes > 0 ? "text-danger font-semibold" : ""}>{r.total_late_minutes}</TableCell>
                <TableCell className={r.total_early_departure_minutes > 0 ? "text-danger font-semibold" : ""}>{r.total_early_departure_minutes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
