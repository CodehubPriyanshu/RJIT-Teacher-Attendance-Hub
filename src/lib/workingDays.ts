// Working day calculation: Total calendar days - active holidays (Sundays included as working days unless marked as holiday)
import { supabase } from "@/integrations/supabase/client";

export interface WorkingDayBreakdown {
  totalDays: number;
  sundays: number;
  holidays: number;
  workingDays: number;
  holidayDates: Set<string>; // YYYY-MM-DD of active holidays in range
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function countSundaysInRange(from: Date, to: Date): number {
  let count = 0;
  const d = new Date(from);
  while (d <= to) {
    if (d.getDay() === 0) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function daysInRange(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86400000) + 1;
}

/** Fetch active holiday dates in [fromISO, toISO] inclusive. */
export async function fetchActiveHolidays(fromISO: string, toISO: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("holidays")
    .select("holiday_date,status")
    .eq("status", "Active")
    .gte("holiday_date", fromISO)
    .lte("holiday_date", toISO);
  if (error) throw error;
  const set = new Set<string>();
  (data ?? []).forEach((r: any) => set.add(r.holiday_date));
  return set;
}

export async function computeWorkingDays(from: Date, to: Date): Promise<WorkingDayBreakdown> {
  const fromISO = ymd(from);
  const toISO = ymd(to);
  const totalDays = daysInRange(from, to);
  const holidaySet = await fetchActiveHolidays(fromISO, toISO);
  // All holidays (including Sundays if marked) are subtracted from total days
  const workingDays = Math.max(0, totalDays - holidaySet.size);
  return {
    totalDays,
    sundays: 0, // Sundays are now included as working days unless explicitly marked as holiday
    holidays: holidaySet.size,
    workingDays,
    holidayDates: holidaySet,
  };
}
