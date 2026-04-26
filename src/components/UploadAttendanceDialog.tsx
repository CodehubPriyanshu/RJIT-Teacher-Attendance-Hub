import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UploadCloud, FileSpreadsheet, AlertCircle, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { computeStatus, minutesToTimeStr, toDateStr, toMinutes } from "@/lib/attendanceCalc";
import { cn } from "@/lib/utils";

type RequiredField =
  | "No"
  | "Employee ID"
  | "First Name"
  | "Department"
  | "Date"
  | "Weekday"
  | "First Punch"
  | "Last Punch"
  | "Total Time";

const REQUIRED_FIELDS: RequiredField[] = [
  "No",
  "Employee ID",
  "First Name",
  "Department",
  "Date",
  "Weekday",
  "First Punch",
  "Last Punch",
  "Total Time",
];

const normalizeHeader = (s: unknown): string =>
  String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HEADER_ALIASES: Record<string, RequiredField> = {
  "no": "No",
  "sno": "No",
  "s no": "No",
  "sr no": "No",
  "serial": "No",
  "serial no": "No",
  "employee id": "Employee ID",
  "emp id": "Employee ID",
  "empid": "Employee ID",
  "employee code": "Employee ID",
  "emp code": "Employee ID",
  "first name": "First Name",
  "name": "First Name",
  "employee name": "First Name",
  "emp name": "First Name",
  "department": "Department",
  "dept": "Department",
  "date": "Date",
  "attendance date": "Date",
  "weekday": "Weekday",
  "day": "Weekday",
  "first punch": "First Punch",
  "punch in": "First Punch",
  "in time": "First Punch",
  "in": "First Punch",
  "check in": "First Punch",
  "last punch": "Last Punch",
  "punch out": "Last Punch",
  "out time": "Last Punch",
  "out": "Last Punch",
  "check out": "Last Punch",
  "total time": "Total Time",
  "work duration": "Total Time",
  "duration": "Total Time",
  "working hours": "Total Time",
  "total hours": "Total Time",
};

type ParsedRow = {
  record_number: number | null;
  employee_id: string;
  first_name: string;
  department: string | null;
  attendance_date: string;
  weekday: string | null;
  first_punch: string | null;
  last_punch: string | null;
  total_time: string | null;
  late_minutes: number;
  early_departure_minutes: number;
  status: string;
};

const BATCH_SIZE = 500;
const MANUAL_NONE = "__none__";

interface Props {
  onUploaded?: () => void;
}

export function UploadAttendanceDialog({ onUploaded }: Props) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [rawJson, setRawJson] = useState<Record<string, unknown>[]>([]);
  const [presentKeys, setPresentKeys] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<RequiredField, string>>(
    Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, ""])) as Record<RequiredField, string>,
  );
  const [needsManualMap, setNeedsManualMap] = useState(false);
  const [headerRowIdx, setHeaderRowIdx] = useState(0);
  const [totalDetected, setTotalDetected] = useState(0);

  const reset = () => {
    setFile(null);
    setRows([]);
    setErrors([]);
    setProgress(0);
    setRawJson([]);
    setPresentKeys([]);
    setMapping(Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, ""])) as Record<RequiredField, string>);
    setNeedsManualMap(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const buildRowsFromMapping = useCallback(
    (
      json: Record<string, unknown>[],
      map: Record<RequiredField, string>,
      headerRowIdx = 0,
    ) => {
      const get = (r: Record<string, unknown>, field: RequiredField) => {
        const key = map[field];
        return key ? r[key] : undefined;
      };
      const parsed: ParsedRow[] = [];
      const issues: string[] = [];
      json.forEach((r, idx) => {
        const excelRow = headerRowIdx + 2 + idx;
        const empId = String(get(r, "Employee ID") ?? "").trim();
        const firstName = String(get(r, "First Name") ?? "").trim();
        const dateRaw = get(r, "Date");
        const dateStr = toDateStr(dateRaw);
        if (!empId) {
          issues.push(`Skipped row ${excelRow}: Missing Employee ID`);
          return;
        }
        if (!firstName) {
          issues.push(`Skipped row ${excelRow}: Missing First Name`);
          return;
        }
        if (!dateStr) {
          issues.push(`Skipped row ${excelRow}: Invalid date format`);
          return;
        }
        const fp = toMinutes(get(r, "First Punch"));
        const lp = toMinutes(get(r, "Last Punch"));
        const calc = computeStatus(fp, lp);
        parsed.push({
          record_number: Number(get(r, "No")) || null,
          employee_id: empId,
          first_name: firstName,
          department: String(get(r, "Department") ?? "").trim() || null,
          attendance_date: dateStr,
          weekday: String(get(r, "Weekday") ?? "").trim() || null,
          first_punch: minutesToTimeStr(fp),
          last_punch: minutesToTimeStr(lp),
          total_time: String(get(r, "Total Time") ?? "").trim() || null,
          late_minutes: calc.late_minutes,
          early_departure_minutes: calc.early_departure_minutes,
          status: calc.status,
        });
      });
      return { parsed, issues };
    },
    [],
  );

  const handleFile = useCallback(
    async (f: File) => {
      if (!f.name.toLowerCase().endsWith(".xlsx")) {
        toast.error("Only .xlsx files are accepted");
        return;
      }
      setFile(f);
      setParsing(true);
      setRows([]);
      setErrors([]);
      setNeedsManualMap(false);
      try {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];

        // Force-extend the sheet range so trailing rows are not dropped
        const refRange = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
        let maxRow = refRange ? refRange.e.r : 0;
        let maxCol = refRange ? refRange.e.c : 0;
        Object.keys(ws).forEach((addr) => {
          if (addr.startsWith("!")) return;
          const { r, c } = XLSX.utils.decode_cell(addr);
          if (r > maxRow) maxRow = r;
          if (c > maxCol) maxCol = c;
        });
        ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });

        const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: null,
          raw: true,
          blankrows: true,
        });

        console.log("[UploadAttendance] Total rows detected in file:", matrix.length);

        if (matrix.length === 0) {
          setErrors(["Sheet is empty."]);
          return;
        }

        // Scan first 15 rows to detect the header row
        const SCAN_LIMIT = Math.min(15, matrix.length);
        let detectedHeaderIdx = -1;
        let bestMatches = 0;
        let bestMap: Record<RequiredField, string> = Object.fromEntries(
          REQUIRED_FIELDS.map((f) => [f, ""]),
        ) as Record<RequiredField, string>;
        let bestKeys: string[] = [];

        for (let i = 0; i < SCAN_LIMIT; i++) {
          const row = matrix[i] || [];
          const rowMap = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, ""])) as Record<RequiredField, string>;
          const cellKeys: string[] = [];
          row.forEach((cell, colIdx) => {
            const raw = String(cell ?? "").trim();
            if (!raw) return;
            const colKey = `${raw}__${colIdx}`;
            cellKeys.push(colKey);
            const norm = normalizeHeader(raw);
            const field = HEADER_ALIASES[norm];
            if (field && !rowMap[field]) rowMap[field] = colKey;
          });
          const matches = REQUIRED_FIELDS.filter((f) => rowMap[f]).length;
          if (matches > bestMatches) {
            bestMatches = matches;
            detectedHeaderIdx = i;
            bestMap = rowMap;
            bestKeys = cellKeys;
          }
          if (matches === REQUIRED_FIELDS.length) break;
        }

        console.log("[UploadAttendance] Detected header row (1-indexed):", detectedHeaderIdx + 1);
        console.log("[UploadAttendance] Detected columns:", bestKeys);
        console.log("[UploadAttendance] Auto mapping:", bestMap);

        if (detectedHeaderIdx === -1) {
          setErrors(["Could not detect a header row in the first 15 rows."]);
          return;
        }

        // Build JSON rows from detected header row.
        // Stop rule: only skip rows where ALL columns are empty.
        const headerRow = matrix[detectedHeaderIdx] || [];
        const keys: string[] = headerRow.map((cell, colIdx) => {
          const raw = String(cell ?? "").trim();
          return raw ? `${raw}__${colIdx}` : `__col_${colIdx}`;
        });
        const json: Record<string, unknown>[] = [];
        let blankSkipped = 0;
        for (let i = detectedHeaderIdx + 1; i < matrix.length; i++) {
          const row = matrix[i] || [];
          const allEmpty = row.length === 0 || row.every(
            (c) => c === null || c === undefined || String(c).trim() === "",
          );
          if (allEmpty) {
            blankSkipped++;
            continue;
          }
          const obj: Record<string, unknown> = {};
          keys.forEach((k, idx) => {
            obj[k] = row[idx] ?? null;
          });
          json.push(obj);
        }

        console.log("[UploadAttendance] Data rows after header:", json.length, "| blank rows skipped:", blankSkipped);

        setHeaderRowIdx(detectedHeaderIdx);
        setTotalDetected(matrix.length);
        setRawJson(json);
        setPresentKeys(keys);
        const autoMap = bestMap;
        console.log("[UploadAttendance] Mapping status:", {
          mapped: REQUIRED_FIELDS.filter((f) => autoMap[f]),
          missing: REQUIRED_FIELDS.filter((f) => !autoMap[f]),
          dataRows: json.length,
        });

        const missing = REQUIRED_FIELDS.filter((f) => !autoMap[f]);
        setMapping(autoMap);

        if (missing.length) {
          setNeedsManualMap(true);
          setErrors([
            `Detected columns: ${keys.map((k) => normalizeHeader(k)).join(", ")}`,
            `Missing required fields: ${missing.join(", ")}`,
            `Please map them manually below.`,
          ]);
          return;
        }

        const { parsed, issues } = buildRowsFromMapping(json, autoMap, detectedHeaderIdx);
        setRows(parsed);
        setErrors(issues);
        console.log("[UploadAttendance] Parsed valid rows:", parsed.length, "| Skipped during validation:", issues.length);
        if (parsed.length === 0) {
          toast.error("No valid rows found in the file");
        } else {
          toast.success(`Parsed ${parsed.length.toLocaleString()} rows`);
        }
      } catch (e: any) {
        setErrors([e?.message ?? "Failed to read file"]);
      } finally {
        setParsing(false);
      }
    },
    [buildRowsFromMapping],
  );

  const applyManualMapping = () => {
    const missing = REQUIRED_FIELDS.filter((f) => !mapping[f]);
    if (missing.length) {
      toast.error(`Still missing: ${missing.join(", ")}`);
      return;
    }
    const { parsed, issues } = buildRowsFromMapping(rawJson, mapping);
    setRows(parsed);
    setErrors(issues);
    setNeedsManualMap(false);
    if (parsed.length === 0) toast.error("No valid rows found");
    else toast.success(`Parsed ${parsed.length.toLocaleString()} rows`);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const startUpload = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    setProgress(0);
    try {
      const total = rows.length;
      let done = 0;
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("attendance_records")
          .upsert(batch, { onConflict: "employee_id,first_name,attendance_date" });
        if (error) throw error;
        done += batch.length;
        setProgress(Math.round((done / total) * 100));
      }
      toast.success(`Uploaded ${total.toLocaleString()} records`);
      onUploaded?.();
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const labelOf = (k: string) => k.replace(/__\d+$/, "");
  const detectedNormalized = useMemo(
    () => presentKeys.map((k) => normalizeHeader(labelOf(k))).filter(Boolean),
    [presentKeys],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !uploading) {
          setOpen(false);
          reset();
        } else {
          setOpen(o);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Attendance</DialogTitle>
          <DialogDescription>
            Upload an .xlsx file. Required: {REQUIRED_FIELDS.join(", ")}. Column names are matched flexibly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/30",
            )}
          >
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary grid place-items-center mb-3">
              <UploadCloud className="h-6 w-6" />
            </div>
            <div className="text-base font-semibold">Drag and drop your .xlsx file here</div>
            <div className="text-sm text-muted-foreground mt-1">or click to browse</div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          {file && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                    {rows.length > 0 && ` • ${rows.length.toLocaleString()} valid rows`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset} disabled={uploading}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={startUpload}
                  disabled={uploading || parsing || rows.length === 0 || needsManualMap}
                >
                  {uploading ? "Uploading…" : `Upload ${rows.length.toLocaleString()} rows`}
                </Button>
              </div>
            </div>
          )}

          {uploading && (
            <div className="space-y-2">
              <Progress value={progress} />
              <div className="text-xs text-muted-foreground">{progress}% complete</div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
              <div className="flex items-center gap-2 font-semibold text-danger mb-1">
                <AlertCircle className="h-4 w-4" /> Issues
              </div>
              <ul className="list-disc list-inside text-foreground/80 space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i} className="break-words">{e}</li>
                ))}
              </ul>
            </div>
          )}

          {needsManualMap && presentKeys.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="font-semibold mb-1">Manual Column Mapping</div>
              <p className="text-xs text-muted-foreground mb-4">
                Match each required field to a column from your Excel file.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {REQUIRED_FIELDS.map((field) => (
                  <div key={field} className="space-y-1">
                    <Label className="text-xs">{field}</Label>
                    <Select
                      value={mapping[field] || MANUAL_NONE}
                      onValueChange={(v) =>
                        setMapping((m) => ({ ...m, [field]: v === MANUAL_NONE ? "" : v }))
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={MANUAL_NONE}>— None —</SelectItem>
                        {presentKeys.map((k) => (
                          <SelectItem key={k} value={k}>
                            {labelOf(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground truncate">
                  Detected: {detectedNormalized.join(", ") || "—"}
                </div>
                <Button size="sm" onClick={applyManualMapping}>
                  Apply mapping
                </Button>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-lg border border-border">
              <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Preview</h3>
                  <p className="text-xs text-muted-foreground">First 5 of {rows.length.toLocaleString()} rows</p>
                </div>
                <Badge variant="secondary" className="bg-success/10 text-success border-0">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Ready
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="table-head">Emp ID</TableHead>
                      <TableHead className="table-head">Name</TableHead>
                      <TableHead className="table-head">Date</TableHead>
                      <TableHead className="table-head">In</TableHead>
                      <TableHead className="table-head">Out</TableHead>
                      <TableHead className="table-head">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 5).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.employee_id}</TableCell>
                        <TableCell>{r.first_name}</TableCell>
                        <TableCell>{r.attendance_date}</TableCell>
                        <TableCell>{r.first_punch?.slice(0, 5) ?? "—"}</TableCell>
                        <TableCell>{r.last_punch?.slice(0, 5) ?? "—"}</TableCell>
                        <TableCell>{r.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
