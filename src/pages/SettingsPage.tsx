import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Settings() {
  const [id, setId] = useState<string | null>(null);
  const [reporting, setReporting] = useState("09:00");
  const [grace, setGrace] = useState(10);
  const [departure, setDeparture] = useState("17:00");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("settings").select("*").maybeSingle().then(({ data }) => {
      if (!data) return;
      setId(data.id);
      setReporting(data.reporting_time?.slice(0, 5) ?? "09:00");
      setDeparture(data.departure_time?.slice(0, 5) ?? "17:00");
      setGrace(data.grace_minutes ?? 10);
    });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    const { error } = await supabase.from("settings").update({
      reporting_time: reporting + ":00",
      departure_time: departure + ":00",
      grace_minutes: grace,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Settings</h2>
        <p className="text-sm text-muted-foreground">Configure working hours used for attendance calculations.</p>
      </div>
      <Card className="shadow-card border-border/60 p-5 max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Reporting Time</Label>
            <Input type="time" value={reporting} onChange={(e) => setReporting(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Grace Period (minutes)</Label>
            <Input type="number" min={0} max={120} value={grace} onChange={(e) => setGrace(parseInt(e.target.value || "0", 10))} />
          </div>
          <div className="space-y-1.5">
            <Label>Departure Time</Label>
            <Input type="time" value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Settings"}</Button>
        </form>
      </Card>
    </div>
  );
}
