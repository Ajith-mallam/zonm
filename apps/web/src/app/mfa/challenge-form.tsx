"use client";
import { useActionState } from "react";
import { FormErrors, SubmitButton } from "@/components/forms";
import { Input, Label } from "@/components/ui";
import { verifyMfaAction } from "@/lib/auth/actions";

export function MfaChallengeForm() {
  const [state, action] = useActionState(verifyMfaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormErrors state={state} />
      <div>
        <Label htmlFor="code">Code</Label>
        <Input id="code" name="code" autoComplete="one-time-code" inputMode="numeric" required autoFocus maxLength={32} />
      </div>
      <SubmitButton pendingText="Verifying…">Verify</SubmitButton>
    </form>
  );
}
