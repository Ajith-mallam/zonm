import { redirect } from "next/navigation";
import { Alert, GateShell } from "@/components/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  locked: "Too many failed attempts. Your account is locked for a short time.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getCurrentSession()) redirect("/");
  const sp = await searchParams;
  const notice = sp.reason ? REASONS[sp.reason] : sp.expired ? "Your session has ended. Please sign in again." : undefined;
  return (
    <GateShell title="Sign in to continue">
      <div className="space-y-4">
        {notice && <Alert tone="info">{notice}</Alert>}
        <LoginForm />
        <p className="text-xs text-black/50 dark:text-white/50">
          Authorised users only. All activity is recorded in a tamper-evident audit log.
        </p>
      </div>
    </GateShell>
  );
}
