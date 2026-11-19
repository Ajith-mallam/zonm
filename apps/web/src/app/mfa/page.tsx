import { redirect } from "next/navigation";
import { GateShell } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { MfaChallengeForm } from "./challenge-form";
import { SignOutButton } from "@/components/sign-out";

export const metadata = { title: "Verify" };

export default async function MfaPage() {
  const s = await requireSession("mfa");
  if (!s.user.mfaEnabledAt) redirect("/mfa/setup");
  if (s.mfaVerified) redirect("/");
  return (
    <GateShell title="Two-step verification">
      <div className="space-y-4">
        <p className="text-sm">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        <MfaChallengeForm />
        <SignOutButton />
      </div>
    </GateShell>
  );
}
