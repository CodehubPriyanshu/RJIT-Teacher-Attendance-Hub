import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { RefreshCw, Download } from "lucide-react";
import { formatTime } from "@/lib/attendance";
import * as XLSX from "xlsx";

export default function Attendance() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [teacherId, setTeacherId] = useState<string>("all");
  const [dept, setDept] = useState<string>("all");
  const [teachers, setTeachers] = useState<{ id: string; name: string; department: string | null }[]>([]);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("teachers").select("id, name, department").order("name").then(({ data }) => setTeachers(data ?? []));
  }, []);

  useEffect(() => {
    let q = supabase
      .from("attendance")
      .select("*, teachers(name, employee_id, department)")
      .eq("attendance_date", date)
      .order("created_at");
    if (teacherId !== "all") q = q.eq("teacher_id", teacherId);
    q.then(({ data }) => {
      let d = data ?? [];
      if (dept !== "all") d = d.filter((r: any) => r.teachers?.department === dept);
      setRows(d);
    });
  }, [date, teacherId, dept]);

  const departments = useMemo(() => Array.from(new Set(teachers.map((t) => t.department).filter(Boolean))) as string[], [teachers]);

  const exportXlsx = () => {
    const data = rows.map((r) => ({
      Name: r.teachers?.name,
      "Employee ID": r.teachers?.employee_id,
      Department: r.teachers?.department,
      Date: r.attendance_date,
      "Check In": formatTime(r.check_in),
      "Check Out": formatTime(r.check_out),
      "Late Minutes": r.late_minutes,
      "Early Departure": r.early_departure_minutes,
      Status: r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `attendance-${date}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="page-title">Attendance Records</h2>
          <p className="text-sm text-muted-foreground">Filter and review daily attendance.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportXlsx}><Download className="h-4 w-4 mr-1" /> Export</Button>
          <Button asChild><Link to="/sync"><RefreshCw className="h-4 w-4 mr-1" /> Sync from Google Sheet</Link></Button>
        </div>
      </div>

      <Card className="shadow-card border-border/60 p-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Teacher</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teachers</SelectItem>
                {teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
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
              <TableHead className="table-head">Check In</TableHead>
              <TableHead className="table-head">Check Out</TableHead>
              <TableHead className="table-head">Late</TableHead>
              <TableHead className="table-head">Early Dep.</TableHead>
              <TableHead className="table-head">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No records.</TableCell></TableRow>
            )}
            {rows.map((r) => {
              const danger = r.late_minutes > 0 || r.early_departure_minutes > 0;
              return (
                <TableRow key={r.id} className={cn(danger ? "bg-row-late" : "bg-row-present")}>
                  <TableCell className="font-medium">{r.teachers?.name}</TableCell>
                  <TableCell>{r.teachers?.employee_id}</TableCell>
                  <TableCell>{r.teachers?.department ?? "—"}</TableCell>
                  <TableCell className={cn(r.late_minutes > 0 && "text-danger font-semibold")}>{formatTime(r.check_in)}</TableCell>
                  <TableCell className={cn(r.early_departure_minutes > 0 && "text-danger font-semibold")}>{formatTime(r.check_out)}</TableCell>
                  <TableCell>{r.late_minutes} min</TableCell>
                  <TableCell>{r.early_departure_minutes} min</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      "font-semibold",
                      r.status === "present" && "bg-success/15 text-success border-success/30",
                      r.status === "late" && "bg-danger/15 text-danger border-danger/30",
                      r.status === "early_departure" && "bg-danger/15 text-danger border-danger/30",
                      r.status === "absent" && "bg-muted text-muted-foreground",
                    )}>{r.status.replace("_", " ")}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
