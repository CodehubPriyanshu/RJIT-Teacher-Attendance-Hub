import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface Teacher {
  id: string;
  employee_id: string;
  name: string;
  department: string | null;
  phone: string | null;
  email: string | null;
  status: string;
}

const PAGE = 10;

export default function Teachers() {
  const [list, setList] = useState<Teacher[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("teachers").select("*").order("name");
    if (error) return toast.error(error.message);
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const filtered = list.filter((t) =>
    [t.name, t.employee_id, t.department, t.email].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase())),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);

  const remove = async (id: string) => {
    const { error } = await supabase.from("teachers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Teacher deleted");
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="page-title">Teachers Management</h2>
          <p className="text-sm text-muted-foreground">Add, edit, and manage faculty records.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4 mr-1" /> Add Teacher
            </Button>
          </DialogTrigger>
          <TeacherForm
            initial={editing}
            onDone={() => { setOpen(false); setEditing(null); load(); }}
          />
        </Dialog>
      </div>

      <Card className="shadow-card border-border/60">
        <div className="p-4 flex items-center gap-3 border-b">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name, ID, dept…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Badge variant="secondary" className="bg-primary/10 text-primary border-0">{filtered.length} total</Badge>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="table-head">Name</TableHead>
                <TableHead className="table-head">Employee ID</TableHead>
                <TableHead className="table-head">Department</TableHead>
                <TableHead className="table-head">Phone</TableHead>
                <TableHead className="table-head">Email</TableHead>
                <TableHead className="table-head">Status</TableHead>
                <TableHead className="table-head text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No teachers yet.</TableCell></TableRow>
              )}
              {visible.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.employee_id}</TableCell>
                  <TableCell>{t.department ?? "—"}</TableCell>
                  <TableCell>{t.phone ?? "—"}</TableCell>
                  <TableCell>{t.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={t.status === "active" ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground"}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="text-danger hover:text-danger">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete teacher?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove {t.name} and all their attendance records.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove(t.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between p-4 border-t text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="space-x-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function TeacherForm({ initial, onDone }: { initial: Teacher | null; onDone: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    employee_id: initial?.employee_id ?? "",
    department: initial?.department ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    status: initial?.status ?? "active",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({
      name: initial?.name ?? "",
      employee_id: initial?.employee_id ?? "",
      department: initial?.department ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
      status: initial?.status ?? "active",
    });
  }, [initial]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const payload = { ...form };
    const res = initial
      ? await supabase.from("teachers").update(payload).eq("id", initial.id)
      : await supabase.from("teachers").insert(payload);
    setBusy(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(initial ? "Teacher updated" : "Teacher added");
    onDone();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{initial ? "Edit Teacher" : "Add Teacher"}</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Employee ID</Label><Input required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-1.5 col-span-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1.5 col-span-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
