import { differenceInMinutes, parse } from "date-fns";

export type Settings = {
  reporting_time: string; // "09:00:00"
  grace_minutes: number;
  departure_time: string; // "17:00:00"
};

export const DEFAULT_SETTINGS: Settings = {
  reporting_time: "09:00:00",
  grace_minutes: 10,
  departure_time: "17:00:00",
};

const parseTime = (t: string) => parse(t, "HH:mm:ss", new Date(2000, 0, 1));

export type Status = "present" | "late" | "absent" | "early_departure";

export interface AttendanceCalc {
  late_minutes: number;
  early_departure_minutes: number;
  status: Status;
}

export function computeAttendance(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  settings: Settings = DEFAULT_SETTINGS,
): AttendanceCalc {
  if (!checkIn) {
    return { late_minutes: 0, early_departure_minutes: 0, status: "absent" };
  }
  const reporting = parseTime(settings.reporting_time);
  const departure = parseTime(settings.departure_time);
  const ci = parseTime(checkIn.length === 5 ? checkIn + ":00" : checkIn);

  const totalLate = Math.max(0, differenceInMinutes(ci, reporting));
  const lateAfterGrace = Math.max(0, totalLate - settings.grace_minutes);

  let early = 0;
  if (checkOut) {
    const co = parseTime(checkOut.length === 5 ? checkOut + ":00" : checkOut);
    early = Math.max(0, differenceInMinutes(departure, co));
  }

  let status: Status = "present";
  if (lateAfterGrace > 0) status = "late";
  else if (early > 0) status = "early_departure";

  return {
    late_minutes: lateAfterGrace,
    early_departure_minutes: early,
    status,
  };
}

export const formatTime = (t?: string | null) => (t ? t.slice(0, 5) : "—");
