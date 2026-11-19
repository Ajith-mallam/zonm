"use client";
import { useActionState } from "react";
import { FormErrors, SubmitButton } from "@/components/forms";
import { Input, Label } from "@/components/ui";
import { loginAction } from "@/lib/auth/actions";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormErrors state={state} />
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
