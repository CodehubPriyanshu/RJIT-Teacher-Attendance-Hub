import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Users, CheckCircle2, AlarmClock, XCircle, LogOut } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/attendance";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  late_minutes: number;
  early_departure_minutes: number;
  status: string;
  teachers: { name: string; employee_id: string } | null;
}

const StatCard = ({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: any;
  label: string;
  value: number | string;
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
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
};

export default function Dashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [rows, setRows] = useState<Row[]>([]);
  const [totalTeachers, setTotalTeachers] = useState(0);

  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from("teachers")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");
      setTotalTeachers(count ?? 0);

      const { data } = await supabase
        .from("attendance")
        .select("id, attendance_date, check_in, check_out, late_minutes, early_departure_minutes, status, teachers(name, employee_id)")
        .eq("attendance_date", today)
        .order("check_in", { ascending: true });
      setRows((data as any) ?? []);
    })();
  }, [today]);

  const present = rows.filter((r) => r.status === "present" || r.status === "late" || r.status === "early_departure").length;
  const late = rows.filter((r) => r.late_minutes > 0).length;
  const early = rows.filter((r) => r.early_departure_minutes > 0).length;
  const absent = Math.max(0, totalTeachers - present);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Overview for {format(new Date(), "EEEE, MMM d, yyyy")}</p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={Users} label="Total Teachers" value={totalTeachers} tone="primary" />
        <StatCard icon={CheckCircle2} label="Present Today" value={present} tone="success" />
        <StatCard icon={AlarmClock} label="Late Today" value={late} tone="accent" />
        <StatCard icon={XCircle} label="Absent Today" value={absent} tone="danger" />
        <StatCard icon={LogOut} label="Early Departure" value={early} tone="muted" />
      </div>

      <Card className="shadow-card border-border/60">
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <h3 className="section-title">Today's Attendance</h3>
          <Badge variant="secondary" className="bg-primary/10 text-primary border-0">{rows.length} records</Badge>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head">Teacher Name</TableHead>
                <TableHead className="table-head">Employee ID</TableHead>
                <TableHead className="table-head">Date</TableHead>
                <TableHead className="table-head">Check In</TableHead>
                <TableHead className="table-head">Check Out</TableHead>
                <TableHead className="table-head">Late (min)</TableHead>
                <TableHead className="table-head">Early Dep. (min)</TableHead>
                <TableHead className="table-head">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    No attendance records for today. Use Google Sheet Sync to fetch.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => {
                const isLate = r.late_minutes > 0 || r.early_departure_minutes > 0 || r.status === "absent";
                return (
                  <TableRow key={r.id} className={cn(isLate ? "bg-row-late" : "bg-row-present")}>
                    <TableCell className="font-medium">{r.teachers?.name ?? "—"}</TableCell>
                    <TableCell>{r.teachers?.employee_id ?? "—"}</TableCell>
                    <TableCell>{r.attendance_date}</TableCell>
                    <TableCell className={cn(r.late_minutes > 0 && "text-danger font-semibold")}>
                      {formatTime(r.check_in)}
                    </TableCell>
                    <TableCell className={cn(r.early_departure_minutes > 0 && "text-danger font-semibold")}>
                      {formatTime(r.check_out)}
                    </TableCell>
                    <TableCell>{r.late_minutes}</TableCell>
                    <TableCell>{r.early_departure_minutes}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
    early_departure: { label: "Early Departure", cls: "bg-danger/15 text-danger border-danger/30" },
  };
  const v = map[status] ?? map.present;
  return <Badge variant="outline" className={cn("font-semibold", v.cls)}>{v.label}</Badge>;
}
