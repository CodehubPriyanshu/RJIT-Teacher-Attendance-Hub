# RJIT College Employees Attendance Hub

Teacher Attendance Management System for Rustamji Institute of Technology.

## Features

- Attendance tracking and upload via Excel files
- Late entry detection with 10-minute grace period (09:10 threshold)
- Extra work time tracking after 17:00
- Holiday and working day management
- Dashboard with attendance statistics and performance metrics
- Export attendance data to Excel

## Attendance Calculation Rules

### Office Hours
- **Start Time:** 09:00
- **Grace Period:** 10 minutes
- **Late Entry Threshold:** 09:10
- **End Time:** 17:00

### Late Entry Calculation
- First Punch ≤ 09:10 → On Time (0 minutes late)
- First Punch > 09:10 → Late Entry (minutes after 09:10)

**Examples:**
- 09:05 → On Time
- 09:10 → On Time
- 09:12 → Late 2 minutes
- 09:30 → Late 20 minutes

### Extra Work Time Calculation
- Last Punch ≤ 17:00 → Extra Work Time = 0
- Last Punch > 17:00 → Extra Work Time = Last Punch - 17:00

**Examples:**
- 17:00 → 0
- 17:15 → 15 minutes
- 18:30 → 1 hour 30 minutes

### Working Days
- All days are considered working days by default (including Sundays)
- Days marked as holidays in the holidays table are excluded
- Formula: Working Days = Total Calendar Days - Active Holidays

---

## Reset Attendance Data — Administrator Guide

This section explains how to safely remove all attendance data from the system.

### SECTION A — Remove All Data from Database

To delete all attendance records, execute the following SQL command in Supabase SQL Editor:

```sql
DELETE FROM attendance_records;
```

**Important:** This action is permanent and cannot be undone. All attendance data will be removed.

### SECTION B — Reset Auto Increment ID

If you need to restart record numbering from 1, run this command after deleting the data:

```sql
ALTER SEQUENCE attendance_records_id_seq RESTART WITH 1;
```

**Note:** This is optional and only needed if you want to reset the ID counter.

### SECTION C — Clear Data from Frontend

After deleting data from the database:

1. Navigate to the `/attendance` page
2. Refresh the page (F5 or Ctrl+R)
3. The table will automatically show: "No records match your filters"

No additional frontend action is required. The system will automatically reflect the empty database state.

### SECTION D — Optional Safety Backup

**Before deleting data, it is highly recommended to create a backup:**

1. Go to the `/attendance` page
2. Click the **Export Excel** button
3. Save the downloaded file as a backup
4. Verify the backup file opens correctly in Excel
5. Only then proceed with the database deletion

### Complete Reset Workflow

1. **Backup:** Export all attendance data to Excel
2. **Delete:** Run `DELETE FROM attendance_records;` in Supabase SQL Editor
3. **Reset IDs (Optional):** Run `ALTER SEQUENCE attendance_records_id_seq RESTART WITH 1;`
4. **Verify:** Refresh the `/attendance` page and confirm no records are shown
5. **Restore (If Needed):** Re-upload attendance data using the Upload feature

---

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite
- **UI Components:** shadcn/ui, Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **File Processing:** xlsx (SheetJS)

## Environment Setup

Create a `.env` file in the root directory with the following variables:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Database Migrations

All database schema changes are managed through Supabase migrations in the `supabase/migrations/` directory.

To apply migrations:
1. Go to Supabase Dashboard
2. Navigate to SQL Editor
3. Run the migration files in chronological order

Or use Supabase CLI:
```bash
supabase db push
```

---

## License

Private - Rustamji Institute of Technology
