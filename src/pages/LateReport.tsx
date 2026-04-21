import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/attendance";

export default function LateReport() {
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from("attendance")
      .select("*, teachers(name, employee_id, department)")
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .gt("late_minutes", 0)
      .order("attendance_date", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, [from, to]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Late Attendance Report</h2>
        <p className="text-sm text-muted-foreground">Teachers who arrived after the grace window.</p>
      </div>

      <Card className="shadow-card border-border/60 p-4">
        <div className="grid sm:grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </Card>

      <Card className="shadow-card border-border/60 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="table-head">Date</TableHead>
              <TableHead className="table-head">Teacher</TableHead>
              <TableHead className="table-head">Employee ID</TableHead>
              <TableHead className="table-head">Department</TableHead>
              <TableHead className="table-head">Check In</TableHead>
              <TableHead className="table-head">Late Minutes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No late entries in this range.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="bg-row-late">
                <TableCell>{r.attendance_date}</TableCell>
                <TableCell className="font-medium">{r.teachers?.name}</TableCell>
                <TableCell>{r.teachers?.employee_id}</TableCell>
                <TableCell>{r.teachers?.department ?? "—"}</TableCell>
                <TableCell className="text-danger font-semibold">{formatTime(r.check_in)}</TableCell>
                <TableCell><Badge variant="outline" className="bg-danger/15 text-danger border-danger/30 font-semibold">{r.late_minutes} min</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
