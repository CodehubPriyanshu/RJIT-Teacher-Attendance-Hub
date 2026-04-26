import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ProfileRow {
  full_name: string | null;
  phone: string | null;
  department: string | null;
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "New password must be at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, {
    message: "New password and confirm password must match",
    path: ["confirm"],
  });

export default function Profile() {
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileRow>({ full_name: "", phone: "", department: "" });

  const [current, setCurrent] = useState("");
  const [nextPwd, setNextPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, phone, department")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) toast.error(error.message);
      if (data) setProfile(data as ProfileRow);
      setLoading(false);
    })();
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .upsert(
        { user_id: user.id, full_name: profile.full_name, phone: profile.phone, department: profile.department },
        { onConflict: "user_id" },
      );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated successfully");
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    const parsed = passwordSchema.safeParse({ current, next: nextPwd, confirm: confirmPwd });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setPwdSaving(true);
    // Verify current password by re-authenticating
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (signInErr) {
      setPwdSaving(false);
      return toast.error("Incorrect current password");
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: nextPwd });
    setPwdSaving(false);
    if (updErr) return toast.error(updErr.message);
    setCurrent(""); setNextPwd(""); setConfirmPwd("");
    toast.success("Password updated successfully");
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="page-title">User Profile</h2>
        <p className="text-sm text-muted-foreground">Manage your account information and password</p>
      </div>

      <Card className="p-6 space-y-4 shadow-card border-border/60">
        <h3 className="font-semibold text-lg">Profile Information</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full Name</Label>
            <Input
              id="full_name"
              value={profile.full_name ?? ""}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email Address</Label>
            <Input id="email" value={user?.email ?? ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              value={profile.phone ?? ""}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              maxLength={20}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Input id="role" value={isAdmin ? "Administrator" : "User"} disabled />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="department">Department</Label>
            <Input
              id="department"
              value={profile.department ?? ""}
              onChange={(e) => setProfile({ ...profile, department: e.target.value })}
              maxLength={100}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4 shadow-card border-border/60">
        <h3 className="font-semibold text-lg">Change Password</h3>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="current">Current Password</Label>
            <Input id="current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">New Password</Label>
            <Input id="new" type="password" value={nextPwd} onChange={(e) => setNextPwd(e.target.value)} />
            <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm New Password</Label>
            <Input id="confirm" type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleChangePassword} disabled={pwdSaving}>
            {pwdSaving ? "Updating…" : "Update Password"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
