import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RefreshCw, FileSpreadsheet, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Sync() {
  const [sheetId, setSheetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("settings").select("google_sheet_id").maybeSingle().then(({ data }) => {
      if (data?.google_sheet_id) setSheetId(data.google_sheet_id);
    });
  }, []);

  const saveId = async () => {
    const { data: s } = await supabase.from("settings").select("id").maybeSingle();
    if (!s) return;
    const { error } = await supabase.from("settings").update({ google_sheet_id: sheetId, updated_at: new Date().toISOString() }).eq("id", s.id);
    if (error) toast.error(error.message);
    else toast.success("Sheet ID saved");
  };

  const sync = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-attendance", {
        body: { sheet_id: sheetId },
      });
      if (error) throw error;
      setLast(new Date().toLocaleString());
      toast.success(`Synced ${data?.processed ?? 0} rows`);
    } catch (err: any) {
      toast.error(err.message ?? "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Google Sheet Sync</h2>
        <p className="text-sm text-muted-foreground">Pull attendance entries from your configured Google Sheet.</p>
      </div>

      <Alert className="border-accent/40 bg-accent/5">
        <AlertCircle className="h-4 w-4 text-accent" />
        <AlertTitle>Required Sheet Format</AlertTitle>
        <AlertDescription className="text-sm">
          The sheet must have these column headers in row 1: <strong>employee_id</strong>, <strong>date</strong> (YYYY-MM-DD),
          <strong> check_in</strong> (HH:MM), <strong>check_out</strong> (HH:MM).
          The sheet must be shared with the Google service account email used by the backend.
        </AlertDescription>
      </Alert>

      <Card className="shadow-card border-border/60 p-5 space-y-4">
        <div className="space-y-1.5 max-w-xl">
          <Label>Google Sheet ID</Label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. 1AbCdEfGhIjKlMnOpQrStUvWxYz"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
            />
            <Button variant="outline" onClick={saveId}>Save</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            From the URL: docs.google.com/spreadsheets/d/<span className="font-semibold">SHEET_ID</span>/edit
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t">
          <Button onClick={sync} disabled={busy || !sheetId}>
            <RefreshCw className={busy ? "h-4 w-4 mr-1 animate-spin" : "h-4 w-4 mr-1"} />
            {busy ? "Syncing…" : "Sync Attendance from Google Sheet"}
          </Button>
          {last && <span className="text-sm text-muted-foreground">Last sync: {last}</span>}
        </div>
      </Card>

      <Card className="shadow-card border-border/60 p-5">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="h-6 w-6 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            On sync, late minutes and early departure minutes are computed using the rules in <strong>Settings</strong>:
            reporting time, grace minutes, and departure time.
          </div>
        </div>
      </Card>
    </div>
  );
}
