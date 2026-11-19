"use client";
// A form bound to a server action returning ActionResult. Shows errors, an
// optional success message, and resets its fields after success.
import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/form-state";
import { FormErrors } from "./forms";
import { Alert } from "./ui";

export function ActionForm({
  action,
  children,
  className,
  success,
}: {
  action: (state: ActionResult, form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  success?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      <FormErrors state={state} />
      {state?.ok && success && <Alert tone="success">{success}</Alert>}
      {children}
    </form>
  );
}
