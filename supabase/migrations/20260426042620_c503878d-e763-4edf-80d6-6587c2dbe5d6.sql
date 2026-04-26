-- Drop unused table
DROP TABLE IF EXISTS public.monthly_summary CASCADE;

-- Clear data from used tables (keep schema, keep user_roles for admin access)
TRUNCATE TABLE public.attendance_records RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.attendance RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.holidays RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.teachers RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.settings RESTART IDENTITY CASCADE;