export type AttendanceShiftCategory = "09:00" | "08:00";

export interface AttendanceShiftSettings {
  category: AttendanceShiftCategory;
  label: string;
  reportingHour: number;
  reportingMin: number;
  graceMin: number;
  departureHour: number;
  departureMin: number;
}

export const NINE_AM_SHIFT: AttendanceShiftSettings = {
  category: "09:00",
  label: "09:00 Shift",
  reportingHour: 9,
  reportingMin: 0,
  graceMin: 10,
  departureHour: 17,
  departureMin: 0,
};

export const EIGHT_AM_SHIFT: AttendanceShiftSettings = {
  category: "08:00",
  label: "08:00 Shift",
  reportingHour: 8,
  reportingMin: 0,
  graceMin: 10,
  departureHour: 17,
  departureMin: 0,
};

export function normalizeTeacherName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const EIGHT_AM_SHIFT_NAMES = new Set(
  [
    "Mr.Pappu Singh",
    "Mrst Vidhyawati Devi",
    "Mr Ravi Kant Sharma",
    "Mr Ramesh Singh Rawat",
    "Mr Gajendra Singh",
    "Mr Sone PAL",
    "Mr Devendra Kumar",
    "Mrs. Ramkali Batham",
    "Mr. Alok Kumar",
    "Mr Chhabi Ram",
    "Mr Rambir Singh",
    "Mr Ranvir",
    "Mr D S Shrivastava",
    "Mr. Umesh Prajapati",
    "Mr Kuldeep Soni",
    "Mr Sanjay Dangi",
    "DAYA SHANKAR SHRIVASTAVA",
    "UMESH PRAJAPATI",
    "KULDEEP SONI",
    "SANJAY DANGI",
    "PAPPU SINGH PRAJAPATI",
    "VIDHYAWATI DEVI",
    "RAVIKANT SHARMA",
    "RAMESH SINGH RAWAT",
    "GAJENDER SINGH",
    "SONE PAL",
    "DEVENDRA KUMAR",
    "RAMKALI BATHAM",
    "ALOK KUMAR",
    "CHAVI RAM",
    "RAMVIR SINGH",
    "RANVIR SINGH",
    "DEVENDRA KARAN",
    "SHIVANG SINGH GURJAR",
    "VINOD KUMAR SHAKYA",
    "SONU KUMAR",
    "PAWAN",
    "SONU",
    "REKHA DEVI",
  ].map(normalizeTeacherName),
);

export function isEightAmShiftTeacher(name: unknown): boolean {
  return EIGHT_AM_SHIFT_NAMES.has(normalizeTeacherName(name));
}

export function getAttendanceShift(name: unknown): AttendanceShiftSettings {
  return isEightAmShiftTeacher(name) ? EIGHT_AM_SHIFT : NINE_AM_SHIFT;
}
