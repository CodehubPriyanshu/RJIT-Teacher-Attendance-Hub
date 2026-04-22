import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CalendarDays, Sun, PartyPopper, Briefcase, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { computeWorkingDays, ymd, type WorkingDayBreakdown } from "@/lib/workingDays";
import { cn } from "@/lib/utils";

interface Holiday {
  id: string;
  holiday_date: string;
  holiday_name: string;
  holiday_type: string;
  description: string | null;
  status: string;
  created_at: string;
}

const TYPES = ["National Holiday", "Festival", "College Holiday"];
const STATUSES = ["Active", "Inactive"];

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

  const monthFrom = useMemo(() => startOfMonth(new Date(year, month - 1, 1)), [year, month]);
  const monthTo = useMemo(() => endOfMonth(new Date(year, month - 1, 1)), [year, month]);

  const load = async () => {
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
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, year]);

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
      if (form.id) {
        const { error } = await supabase
          .from("holidays")
          .update({
            holiday_date: form.holiday_date,
            holiday_name: form.holiday_name.trim(),
            holiday_type: form.holiday_type,
            description: form.description.trim() || null,
            status: form.status,
          })
          .eq("id", form.id);
        if (error) throw error;
        toast.success("Holiday updated");
      } else {
        const { error } = await supabase.from("holidays").insert({
          holiday_date: form.holiday_date,
          holiday_name: form.holiday_name.trim(),
          holiday_type: form.holiday_type,
          description: form.description.trim() || null,
          status: form.status,
        });
        if (error) throw error;
        toast.success("Holiday added");
      }
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
    const { error } = await supabase.from("holidays").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Holiday deleted");
      load();
    }
  };

  const toggleStatus = async (h: Holiday) => {
    const next = h.status === "Active" ? "Inactive" : "Active";
    const { error } = await supabase.from("holidays").update({ status: next }).eq("id", h.id);
    if (error) toast.error(error.message);
    else load();
  };

  const holidayDateObjs = useMemo(
    () => holidays.filter((h) => h.status === "Active").map((h) => {
      const [y, m, d] = h.holiday_date.split("-").map(Number);
      return new Date(y, m - 1, d);
    }),
    [holidays],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">Holiday and Working Day Management</h2>
          <p className="text-sm text-muted-foreground">
            Define holidays and compute total working days. Working days = total days − Sundays − active holidays.
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
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
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
                <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
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
              <h3 className="section-title">Holidays — {format(monthFrom, "MMMM yyyy")}</h3>
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
                    <TableCell className="text-muted-foreground max-w-xs truncate">{h.description ?? "—"}</TableCell>
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
                      <Button variant="ghost" size="icon" onClick={() => openEdit(h)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(h.id)}>
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
    </div>
  );
}
