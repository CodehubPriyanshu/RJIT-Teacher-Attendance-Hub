import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";

export default function Auth() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) navigate("/", { replace: true });
  }, [session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Rustamji Institute</div>
            <h1 className="text-lg font-bold">Attendance Admin Portal</h1>
          </div>
        </div>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>{mode === "login" ? "Admin Sign In" : "Create Admin Account"}</CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Sign in to access the attendance system."
                : "First account created becomes the administrator."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
              </Button>
            </form>
            <div className="mt-4 text-sm text-center text-muted-foreground">
              {mode === "login" ? (
                <>
                  No account?{" "}
                  <button className="text-primary font-medium hover:underline" onClick={() => setMode("signup")}>
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Have an account?{" "}
                  <button className="text-primary font-medium hover:underline" onClick={() => setMode("login")}>
                    Sign in
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground mt-4">
          <Link to="/" className="hover:underline">← Back</Link>
        </p>
      </div>
    </div>
  );
}
