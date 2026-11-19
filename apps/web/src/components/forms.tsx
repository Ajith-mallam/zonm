"use client";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Alert, Button } from "./ui";

export function SubmitButton({ children, pendingText, variant }: { children: ReactNode; pendingText?: string; variant?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="w-full sm:w-auto">
      {pending ? (pendingText ?? "Working…") : children}
    </Button>
  );
}

export function FormErrors({ state }: { state?: { error?: string; errors?: string[] } }) {
  if (!state?.error && !state?.errors?.length) return null;
  return (
    <Alert>
      {state.error}
      {state.errors && (
        <ul className="list-disc pl-5">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
