"use client";
import { useActionState } from "react";
import { FormErrors, SubmitButton } from "@/components/forms";
import { Alert, Button, Card, Input, Label, Select } from "@/components/ui";
import { createUserAction, resetPasswordAction, type AdminState } from "./actions";

const ROLES = [
  ["ANALYST", "Analyst: works assigned cases"],
  ["REVIEWER", "Reviewer: reviews results on assigned cases"],
  ["SUPERVISOR", "Supervisor: creates cases, oversees all cases"],
  ["AUDITOR", "Auditor: reads the audit log"],
  ["ADMIN", "Administrator: users and settings, no case access"],
] as const;

function TemporaryPassword({ state }: { state: AdminState }) {
  if (!state?.created) return null;
  return (
    <Alert tone="success">
      Temporary password for <strong>{state.created.email}</strong>:
      <code className="mt-1 block select-all font-mono text-base">{state.created.temporaryPassword}</code>
      Give it to the user through a separate channel. It is shown only once, and the user must change it and set up
      two-step verification at first sign-in.
    </Alert>
  );
}

export function CreateUserForm() {
  const [state, action] = useActionState(createUserAction, undefined);
  return (
    <Card className="h-fit">
      <h2 className="mb-4 font-semibold">Add user</h2>
      <form action={action} className="space-y-3">
        <FormErrors state={state} />
        <TemporaryPassword state={state} />
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" required maxLength={200} />
        </div>
        <div>
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" required maxLength={320} />
        </div>
        <div>
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" defaultValue="ANALYST">
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <SubmitButton pendingText="Creating…">Create user</SubmitButton>
      </form>
    </Card>
  );
}

export function ResetPasswordButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      {state?.created ? (
        <code className="select-all rounded bg-green-100 px-1.5 py-1 font-mono text-xs text-green-900" title="Temporary password, shown once">
          {state.created.temporaryPassword}
        </code>
      ) : (
        <Button variant="secondary" className="py-1 text-xs" disabled={pending}>Reset password</Button>
      )}
    </form>
  );
}
