"use client";
// A form bound to a server action returning ActionResult. Shows errors and an
// optional success message.
//
// React 19 resets an uncontrolled <form action={...}> after every action,
// including ones that fail validation, which throws away everything the user
// typed. This component submits through onSubmit instead (no automatic reset)
// and resets the fields only after a successful action.
import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { ActionResult } from "@/lib/form-state";
import { FormErrors } from "./forms";
import { ActionPendingContext } from "./pending-context";
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
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <ActionPendingContext.Provider value={pending}>
      {/* action={formAction} is the no-JavaScript fallback; onSubmit handles it otherwise. */}
      <form ref={ref} action={formAction} onSubmit={onSubmit} className={className}>
        <FormErrors state={state} />
        {state?.ok && success && <Alert tone="success">{success}</Alert>}
        {children}
      </form>
    </ActionPendingContext.Provider>
  );
}
