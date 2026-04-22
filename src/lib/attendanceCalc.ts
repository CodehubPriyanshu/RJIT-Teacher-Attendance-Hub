// Attendance calculation rules for uploaded Excel rows.
// Reporting time 09:00, grace 10 min => late if first_punch > 09:10
// Departure 17:00 => early departure if last_punch < 17:00
// No punch => Absent

export const REPORTING_HOUR = 9;
export const REPORTING_MIN = 0;
export const GRACE_MIN = 10;
export const DEPARTURE_HOUR = 17;
export const DEPARTURE_MIN = 0;

export type ComputedStatus = "present" | "late" | "absent" | "early_departure" | "incomplete";

export interface ComputedAttendance {
  late_minutes: number;
  early_departure_minutes: number;
  status: ComputedStatus;
  summary: string;
}

export function buildSummary(lateMin: number, earlyMin: number, status: ComputedStatus): string {
  if (status === "absent") return "Absent";
  if (status === "incomplete") return lateMin > 0 ? `Late by ${lateMin} min, no Last Punch` : "No Last Punch";
  if (lateMin > 0 && earlyMin > 0) return `Late by ${lateMin} min and Early departure by ${earlyMin} min`;
  if (lateMin > 0) return `Late by ${lateMin} min`;
  if (earlyMin > 0) return `Early departure by ${earlyMin} min`;
  return "On Time";
}

/** Parse "HH:MM" or "HH:MM:SS" or Excel decimal day (0..1) into minutes since midnight, or null. */
export function toMinutes(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && isFinite(value)) {
    // Excel time fraction
    if (value >= 0 && value < 2) {
      return Math.round((value % 1) * 24 * 60);
    }
  }
  const s = String(value).trim();
  if (!s) return null;
  // Try "HH:MM" or "HH:MM:SS" possibly with AM/PM
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[4]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }
  return null;
}

/** Convert minutes-since-midnight to "HH:MM:SS" or null. */
export function minutesToTimeStr(mins: number | null): string | null {
  if (mins === null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export function computeStatus(firstPunchMin: number | null, lastPunchMin: number | null): ComputedAttendance {
  // Validation rules:
  // - Missing First Punch -> Absent
  // - Missing Last Punch (but has First) -> Incomplete
  // - Both present -> Present (with possible Late / Early Departure)
  if (firstPunchMin === null) {
    return { late_minutes: 0, early_departure_minutes: 0, status: "absent", summary: "Absent" };
  }

  const startMin = REPORTING_HOUR * 60 + REPORTING_MIN; // 09:00
  const departLimit = DEPARTURE_HOUR * 60 + DEPARTURE_MIN; // 17:00

  // Late = First Punch - 09:00 (only if > 09:00). Grace ignored per spec.
  const late = firstPunchMin > startMin ? firstPunchMin - startMin : 0;

  let early = 0;
  let status: ComputedStatus;
  if (lastPunchMin === null) {
    status = "incomplete";
  } else {
    early = lastPunchMin < departLimit ? departLimit - lastPunchMin : 0;
    if (late > 0) status = "late";
    else if (early > 0) status = "early_departure";
    else status = "present";
  }

  return {
    late_minutes: late,
    early_departure_minutes: early,
    status,
    summary: buildSummary(late, early, status),
  };
}

/** Excel date serial / string -> "YYYY-MM-DD" or null */
export function toDateStr(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && isFinite(value)) {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  // dd-mm-yyyy or dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    let [_, d, mo, y] = m as any;
    if (y.length === 2) y = "20" + y;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // ISO-ish
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
