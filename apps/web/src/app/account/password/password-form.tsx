"use client";
import { useActionState } from "react";
import { FormErrors, SubmitButton } from "@/components/forms";
import { Input, Label } from "@/components/ui";
import { changePasswordAction } from "@/lib/auth/actions";

export function PasswordForm({ temporary = false }: { temporary?: boolean }) {
  const [state, action] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormErrors state={state} />
      <div>
        <Label htmlFor="current">{temporary ? "Temporary password (the one you just signed in with)" : "Current password"}</Label>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <Label htmlFor="next">New password</Label>
        <Input id="next" name="next" type="password" autoComplete="new-password" required minLength={12} />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} />
      </div>
      <SubmitButton pendingText="Saving…">Change password</SubmitButton>
    </form>
  );
}
