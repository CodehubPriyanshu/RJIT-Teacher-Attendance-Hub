import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface Agg {
  employee_id: string;
  first_name: string;
  department: string | null;
  total_working_days: number;
  total_present_days: number;
  total_absent_days: number;
  total_late_minutes: number;
  total_early_departure_minutes: number;
}

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function MonthlySummary() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Agg[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const endDate = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;

      const all: any[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: chunk, error } = await supabase
          .from("attendance_records")
          .select("employee_id, first_name, department, status, late_minutes, early_departure_minutes")
          .gte("attendance_date", start)
          .lte("attendance_date", end)
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        const list = chunk ?? [];
        all.push(...list);
        if (list.length < PAGE) break;
        offset += PAGE;
        if (all.length >= 200000) break;
      }

      const map = new Map<string, Agg>();
      for (const r of all) {
        const key = r.employee_id;
        if (!map.has(key)) {
          map.set(key, {
            employee_id: r.employee_id,
            first_name: r.first_name,
            department: r.department,
            total_working_days: 0,
            total_present_days: 0,
            total_absent_days: 0,
            total_late_minutes: 0,
            total_early_departure_minutes: 0,
          });
        }
        const a = map.get(key)!;
        a.total_working_days++;
        if (r.status === "absent") a.total_absent_days++;
        else a.total_present_days++;
        a.total_late_minutes += r.late_minutes ?? 0;
        a.total_early_departure_minutes += r.early_departure_minutes ?? 0;
      }
      setData(Array.from(map.values()).sort((a, b) => a.first_name.localeCompare(b.first_name)));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (r) => r.employee_id.toLowerCase().includes(q) || r.first_name.toLowerCase().includes(q),
    );
  }, [data, search]);

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        "Employee ID": r.employee_id,
        "Name": r.first_name,
        "Department": r.department ?? "",
        "Working Days": r.total_working_days,
        "Present Days": r.total_present_days,
        "Absent Days": r.total_absent_days,
        "Late Minutes": r.total_late_minutes,
        "Early Departure Minutes": r.total_early_departure_minutes,
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
          <p className="text-sm text-muted-foreground">Aggregated attendance per employee.</p>
        </div>
        <Button onClick={exportXlsx} disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Export Excel
        </Button>
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
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by Employee ID or Name"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="shadow-card border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head">Employee ID</TableHead>
                <TableHead className="table-head">Name</TableHead>
                <TableHead className="table-head">Department</TableHead>
                <TableHead className="table-head">Working Days</TableHead>
                <TableHead className="table-head">Present Days</TableHead>
                <TableHead className="table-head">Absent Days</TableHead>
                <TableHead className="table-head">Late Minutes</TableHead>
                <TableHead className="table-head">Early Departure (min)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    No data for selected month.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.employee_id}>
                  <TableCell className="font-medium">{r.employee_id}</TableCell>
                  <TableCell>{r.first_name}</TableCell>
                  <TableCell>{r.department ?? "—"}</TableCell>
                  <TableCell>{r.total_working_days}</TableCell>
                  <TableCell className="text-success font-semibold">{r.total_present_days}</TableCell>
                  <TableCell className="text-danger font-semibold">{r.total_absent_days}</TableCell>
                  <TableCell>{r.total_late_minutes}</TableCell>
                  <TableCell>{r.total_early_departure_minutes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
