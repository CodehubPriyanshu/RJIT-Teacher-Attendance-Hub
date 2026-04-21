// Sync attendance from a Google Sheet using a service account JSON.
// Expected sheet headers (row 1): employee_id, date, check_in, check_out
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

function parseTime(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // Accept "HH:MM" or "HH:MM:SS"
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hh = m[1].padStart(2, "0");
  return `${hh}:${m[2]}:${m[3] ?? "00"}`;
}

function diffMinutes(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return (ah * 60 + am) - (bh * 60 + bm);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Validate caller is an admin
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const sheetId: string | undefined = body.sheet_id;
    if (!sheetId) throw new Error("sheet_id is required");

    const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!saRaw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON secret is not set");
    const sa = JSON.parse(saRaw);

    const token = await getAccessToken(sa);

    const range = "A1:Z10000";
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!sheetRes.ok) throw new Error(`Sheets error: ${await sheetRes.text()}`);
    const sheetJson = await sheetRes.json();
    const values: string[][] = sheetJson.values ?? [];
    if (values.length < 2) {
      return new Response(JSON.stringify({ processed: 0, message: "No rows" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const header = values[0].map((h) => h.toLowerCase().trim());
    const idx = {
      employee_id: header.indexOf("employee_id"),
      date: header.indexOf("date"),
      check_in: header.indexOf("check_in"),
      check_out: header.indexOf("check_out"),
    };
    if (idx.employee_id < 0 || idx.date < 0) {
      throw new Error("Headers must include employee_id and date");
    }

    // Settings
    const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
    const reporting = settings?.reporting_time ?? "09:00:00";
    const departure = settings?.departure_time ?? "17:00:00";
    const grace = settings?.grace_minutes ?? 10;

    // Map employee_id -> teacher.id
    const { data: teachers } = await supabase.from("teachers").select("id, employee_id");
    const teacherMap = new Map((teachers ?? []).map((t: any) => [t.employee_id, t.id]));

    const upserts: any[] = [];
    let skipped = 0;
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const employeeId = (row[idx.employee_id] ?? "").toString().trim();
      const date = (row[idx.date] ?? "").toString().trim();
      if (!employeeId || !date) { skipped++; continue; }
      const teacherId = teacherMap.get(employeeId);
      if (!teacherId) { skipped++; continue; }

      const ci = idx.check_in >= 0 ? parseTime(row[idx.check_in]) : null;
      const co = idx.check_out >= 0 ? parseTime(row[idx.check_out]) : null;

      let lateMin = 0, earlyMin = 0;
      let status = "absent";
      if (ci) {
        const totalLate = Math.max(0, diffMinutes(ci, reporting));
        lateMin = Math.max(0, totalLate - grace);
        status = lateMin > 0 ? "late" : "present";
        if (co) {
          earlyMin = Math.max(0, diffMinutes(departure, co));
          if (earlyMin > 0 && status === "present") status = "early_departure";
        }
      }

      upserts.push({
        teacher_id: teacherId,
        attendance_date: date,
        check_in: ci,
        check_out: co,
        late_minutes: lateMin,
        early_departure_minutes: earlyMin,
        status,
      });
    }

    let processed = 0;
    if (upserts.length) {
      const { error } = await supabase
        .from("attendance")
        .upsert(upserts, { onConflict: "teacher_id,attendance_date" });
      if (error) throw error;
      processed = upserts.length;
    }

    return new Response(JSON.stringify({ processed, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("sync-attendance error", err);
    return new Response(JSON.stringify({ error: err.message ?? "sync failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
