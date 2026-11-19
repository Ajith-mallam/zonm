import Link from "next/link";
import { SignOutButton } from "@/components/sign-out";
import { Alert, GateShell } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { PASSWORD_POLICY } from "@/lib/security/password";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const s = await requireSession("password");
  return (
    <GateShell title="Change password">
      <div className="space-y-4 text-sm">
        {s.passwordChangeRequired && (
          <Alert tone="warning">
            {s.user.mustChangePassword ? "You must set a new password before continuing." : "Your password has expired. Set a new one to continue."}
          </Alert>
        )}
        <p className="text-black/70 dark:text-white/70">
          Use at least {PASSWORD_POLICY.minLength} characters with {PASSWORD_POLICY.minCharClasses} of: lower-case, upper-case, digits, symbols.
          A short phrase of several words works well.
        </p>
        <PasswordForm temporary={s.user.mustChangePassword} />
        {s.passwordChangeRequired ? <SignOutButton /> : <Link href="/" className="block text-center text-black/60 underline dark:text-white/60">Cancel</Link>}
      </div>
    </GateShell>
  );
}
