/** Format minutes into "0", "X min", "1 hr", or "1 hr 20 min". */
export function formatMinutes(mins: number): string {
  if (!mins || mins <= 0) return "0";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${String(m).padStart(2, "0")} min`;
}

/** Build short summary like "On Time", "Late 10 min", "Early 1 hr 30 min", "Extra Work 30 min". */
export function shortSummary(
  lateMin: number,
  earlyMin: number,
  status: string,
  extraWorkMin: number = 0,
): string {
  if (status === "absent") return "Absent";
  if (status === "incomplete")
    return lateMin > 0 ? `Late ${formatMinutes(lateMin)}, no Last Punch` : "No Last Punch";
  const parts: string[] = [];
  if (lateMin > 0) parts.push(`Late ${formatMinutes(lateMin)}`);
  if (earlyMin > 0) parts.push(`Early ${formatMinutes(earlyMin)}`);
  if (extraWorkMin > 0) parts.push(`Extra Work ${formatMinutes(extraWorkMin)}`);
  if (parts.length === 0) return "On Time";
  return parts.join(" and ");
}
