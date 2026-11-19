"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormErrors, SubmitButton } from "@/components/forms";
import { Alert, buttonClass, Input, Label } from "@/components/ui";
import { confirmMfaEnrolment } from "@/lib/auth/actions";

export function EnrolForm() {
  const [state, action] = useActionState(confirmMfaEnrolment, undefined);

  if (state?.recoveryCodes) {
    return (
      <div className="space-y-4">
        <Alert tone="success">Two-step verification is on.</Alert>
        <p>
          Save these recovery codes somewhere safe. Each one works once if you lose your phone. <strong>They will not be shown again.</strong>
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded bg-black/5 p-3 font-mono text-xs dark:bg-white/10">
          {state.recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Link href="/" className={buttonClass("primary", "w-full")}>
          I have saved my codes, continue
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <FormErrors state={state} />
      <div>
        <Label htmlFor="code">6-digit code</Label>
        <Input id="code" name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" required maxLength={7} />
      </div>
      <SubmitButton pendingText="Checking…">Turn on two-step verification</SubmitButton>
    </form>
  );
}
