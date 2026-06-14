import { supabase } from "@/integrations/supabase/client";

export interface EmployeeLeave {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  leave_date: string; // YYYY-MM-DD (single date for simplicity)
  shift: string | null;
  document_url: string | null; // Base64 or object URL or remote URL
  document_name: string | null;
  reason: string | null;
  created_by: string | null;
  previous_status: string | null;
  created_at: string;
}

const LOCAL_STORAGE_KEY = "rit_attendance_employee_leaves";

// Helper to load fallback leaves from localStorage
function getLocalLeaves(): EmployeeLeave[] {
  try {
    const val = localStorage.getItem(LOCAL_STORAGE_KEY);
    return val ? JSON.parse(val) : [];
  } catch (e) {
    console.error("Failed to read leaves from localStorage", e);
    return [];
  }
}

// Helper to save fallback leaves to localStorage
function saveLocalLeaves(leaves: EmployeeLeave[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(leaves));
  } catch (e) {
    console.error("Failed to write leaves to localStorage", e);
  }
}

/**
 * Fetch all leaves via RPC (bypasses RLS). Falls back to direct table,
 * then localStorage.
 */
export async function fetchEmployeeLeaves(): Promise<EmployeeLeave[]> {
  // Try RPC first (SECURITY DEFINER, bypasses RLS)
  try {
    const { data, error } = await supabase.rpc("fetch_employee_leaves");
    if (!error && data) {
      return data as EmployeeLeave[];
    }
    console.warn("[leaves] RPC fetch_employee_leaves failed, trying direct table", error);
  } catch (e) {
    console.warn("[leaves] RPC fetch_employee_leaves threw, trying direct table", e);
  }

  // Fallback: direct table query
  try {
    const { data, error } = await supabase
      .from("employee_leaves" as any)
      .select("*")
      .order("start_date", { ascending: false });

    if (!error && data) {
      return data as EmployeeLeave[];
    }
    if (error && error.message?.includes("does not exist")) {
      console.warn("[leaves] employee_leaves table not found. Using localStorage fallback.");
      return getLocalLeaves();
    }
    console.warn("[leaves] Direct table query failed", error);
  } catch (err) {
    console.warn("[leaves] Error fetching from Supabase, falling back to localStorage", err);
  }

  return getLocalLeaves();
}

// Helper to check if attendance exists for an employee on a date
export async function checkAttendanceForLeave(
  employeeId: string,
  leaveDate: string
): Promise<{ hasAttendance: boolean; currentStatus: string | null; recordId: string | null; sourceTable: string | null }> {
  try {
    const { data, error } = await supabase.rpc("check_attendance_for_leave", {
      p_employee_id: employeeId,
      p_leave_date: leaveDate,
    });
    if (!error && data && data.length > 0) {
      return {
        hasAttendance: data[0].has_attendance ?? false,
        currentStatus: data[0].current_status,
        recordId: data[0].record_id,
        sourceTable: data[0].source_table,
      };
    }
    if (error) {
      console.warn("[leaves] check_attendance_for_leave error:", error.message);
    }
  } catch (e) {
    console.warn("[leaves] check_attendance_for_leave threw:", e);
  }
  return { hasAttendance: false, currentStatus: null, recordId: null, sourceTable: null };
}

/**
 * Insert a leave via RPC v2 (bypasses RLS, updates attendance).
 * Falls back to direct table insert, then localStorage.
 */
export async function createEmployeeLeave(
  leave: Omit<EmployeeLeave, "id" | "created_at" | "created_by" | "previous_status"> & {
    created_by?: string | null;
    previous_status?: string | null;
  }
): Promise<EmployeeLeave> {
  const newLeave: EmployeeLeave = {
    ...leave,
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
    created_by: leave.created_by ?? null,
    previous_status: leave.previous_status ?? "absent",
    created_at: new Date().toISOString()
  };

  // Try RPC v2 first (SECURITY DEFINER, bypasses RLS, updates attendance)
  try {
    const { data, error } = await supabase.rpc("create_employee_leave_v2", {
      p_employee_id: leave.employee_id,
      p_employee_name: leave.employee_name,
      p_leave_type: leave.leave_type,
      p_leave_date: leave.leave_date,
      p_shift: leave.shift ?? null,
      p_reason: leave.reason ?? null,
      p_document_url: leave.document_url ?? null,
      p_document_name: leave.document_name ?? null,
      p_created_by: leave.created_by ?? null,
      p_previous_status: leave.previous_status ?? "absent",
    });

    if (!error && data && data.length > 0) {
      return data[0] as EmployeeLeave;
    }
    if (error) {
      console.warn("[leaves] RPC create_employee_leave_v2 error:", error.message, error.details, error.hint);
    }
  } catch (e) {
    console.warn("[leaves] RPC create_employee_leave_v2 threw:", e);
  }

  // Fallback: direct insert (only works if RLS permits)
  try {
    const { data, error } = await supabase
      .from("employee_leaves" as any)
      .upsert(
        {
          ...newLeave,
          shift: newLeave.shift,
          created_by: newLeave.created_by,
          previous_status: newLeave.previous_status,
          leave_date: newLeave.leave_date,
        },
        { onConflict: "employee_id,leave_date" }
      )
      .select();

    if (!error && data && data.length > 0) {
      // Also update attendance record locally
      try {
        await supabase
          .from("attendance_records")
          .update({
            status: "leave",
            late_minutes: 0,
            early_departure_minutes: 0,
            extra_work_minutes: 0,
            comment: `${leave.leave_type}${leave.reason ? ` - ${leave.reason}` : ""}`,
          })
          .eq("employee_id", leave.employee_id)
          .eq("attendance_date", leave.leave_date);
        await supabase
          .from("attendance_records_archive")
          .update({
            status: "leave",
            late_minutes: 0,
            early_departure_minutes: 0,
            extra_work_minutes: 0,
            comment: `${leave.leave_type}${leave.reason ? ` - ${leave.reason}` : ""}`,
          })
          .eq("employee_id", leave.employee_id)
          .eq("attendance_date", leave.leave_date);
      } catch (_) {}
      return data[0] as EmployeeLeave;
    }
    if (error) {
      console.warn("[leaves] Direct insert error:", error.message);
    }
  } catch (err) {
    console.warn("[leaves] Direct insert threw:", err);
  }

  // Final fallback: localStorage (always succeeds)
  const local = getLocalLeaves();
  // Remove any existing local entry for same employee+date to keep behaviour consistent
  const filteredLocal = local.filter((l) => !(l.employee_id === newLeave.employee_id && l.leave_date === newLeave.leave_date));
  filteredLocal.push(newLeave);
  saveLocalLeaves(filteredLocal);
  return newLeave;
}

/**
 * Create leave records for a date range (inclusive).
 * Calls createEmployeeLeave for every day from startDate to endDate.
 */
export async function createMultipleLeaves(
  baseLeave: Omit<EmployeeLeave, "id" | "created_at" | "leave_date" | "start_date" | "end_date" | "created_by" | "previous_status"> & {
    created_by?: string | null;
    previous_status?: string | null;
  },
  startDate: string,
  endDate: string
): Promise<{ created: EmployeeLeave[]; errors: string[] }> {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return { created: [], errors: ["Invalid date range"] };
  }
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  const created: EmployeeLeave[] = [];
  const errors: string[] = [];
  for (const d of dates) {
    try {
      const result = await createEmployeeLeave({
        ...baseLeave,
        leave_date: d,
        start_date: d,
        end_date: d,
      });
      created.push(result);
    } catch (e: any) {
      errors.push(`${d}: ${e?.message ?? "Failed"}`);
    }
  }
  return { created, errors };
}

/**
 * Update an existing leave record.
 */
export async function updateEmployeeLeave(
  id: string,
  updates: {
    leave_type?: string;
    leave_date?: string;
    shift?: string | null;
    reason?: string | null;
    document_url?: string | null;
    document_name?: string | null;
  }
): Promise<EmployeeLeave | null> {
  // Try RPC first
  try {
    const { data, error } = await supabase.rpc("update_employee_leave", {
      p_id: id,
      p_leave_type: updates.leave_type ?? null,
      p_leave_date: updates.leave_date ?? null,
      p_shift: updates.shift ?? null,
      p_reason: updates.reason ?? null,
      p_document_url: updates.document_url ?? null,
      p_document_name: updates.document_name ?? null,
    });

    if (!error && data && data.length > 0) {
      return data[0] as EmployeeLeave;
    }
  } catch (e) {
    console.warn("[leaves] update_employee_leave RPC failed", e);
  }

  // Fallback: direct update
  try {
    const updateData: any = {};
    if (updates.leave_type) updateData.leave_type = updates.leave_type;
    if (updates.leave_date) {
      updateData.leave_date = updates.leave_date;
      updateData.start_date = updates.leave_date;
      updateData.end_date = updates.leave_date;
    }
    if (updates.shift !== undefined) updateData.shift = updates.shift;
    if (updates.reason !== undefined) updateData.reason = updates.reason;
    if (updates.document_url !== undefined) updateData.document_url = updates.document_url;
    if (updates.document_name !== undefined) updateData.document_name = updates.document_name;

    const { data, error } = await supabase
      .from("employee_leaves" as any)
      .update(updateData)
      .eq("id", id)
      .select();

    if (!error && data && data.length > 0) {
      return data[0] as EmployeeLeave;
    }
  } catch (err) {
    console.warn("[leaves] Direct update failed, falling back to localStorage", err);
  }

  // Final fallback: localStorage
  const local = getLocalLeaves();
  const idx = local.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const updated = { ...local[idx], ...updates };
  if (updates.leave_date) {
    updated.start_date = updates.leave_date;
    updated.end_date = updates.leave_date;
  }
  local[idx] = updated;
  saveLocalLeaves(local);
  return updated;
}

/**
 * Delete a leave via RPC v2 (restores attendance). Falls back to direct table delete, then localStorage.
 */
export async function deleteEmployeeLeave(id: string): Promise<boolean> {
  // Try RPC v2 first (restores attendance)
  try {
    const { error } = await supabase.rpc("delete_employee_leave_v2", { p_id: id });
    if (!error) return true;
    console.warn("[leaves] RPC delete_employee_leave_v2 failed, trying direct delete", error);
  } catch (e) {
    console.warn("[leaves] RPC delete_employee_leave_v2 threw, trying direct delete", e);
  }

  // Fallback: direct table delete
  try {
    // First get the leave details to restore attendance
    const { data: leaveData } = await supabase
      .from("employee_leaves" as any)
      .select("employee_id, leave_date, previous_status")
      .eq("id", id)
      .single();

    const { error } = await supabase
      .from("employee_leaves" as any)
      .delete()
      .eq("id", id);

    if (!error) {
      // Try to restore attendance
      if (leaveData) {
        try {
          await supabase
            .from("attendance_records")
            .update({
              status: leaveData.previous_status || "absent",
              comment: null,
            })
            .eq("employee_id", leaveData.employee_id)
            .eq("attendance_date", leaveData.leave_date)
            .eq("status", "leave");
        } catch (_) {}
      }
      return true;
    }

    if (error.message?.includes("does not exist")) {
      const local = getLocalLeaves();
      const filtered = local.filter((l) => l.id !== id);
      saveLocalLeaves(filtered);
      return true;
    }
    console.warn("[leaves] Direct delete failed, falling back to localStorage", error);
  } catch (err) {
    console.warn("[leaves] Error deleting from Supabase, falling back to localStorage", err);
  }

  // Final fallback: localStorage
  const local = getLocalLeaves();
  const filtered = local.filter((l) => l.id !== id);
  saveLocalLeaves(filtered);
  return true;
}

/**
 * Get active leave for a specific employee and date.
 * Range inclusive.
 */
export function findLeaveForDate(leaves: EmployeeLeave[], employeeId: string, dateStr: string): EmployeeLeave | null {
  const targetTime = new Date(dateStr).getTime();
  for (const leave of leaves) {
    if (leave.employee_id === employeeId) {
      const start = new Date(leave.start_date).getTime();
      const end = new Date(leave.end_date).getTime();
      if (targetTime >= start && targetTime <= end) {
        return leave;
      }
    }
  }
  return null;
}