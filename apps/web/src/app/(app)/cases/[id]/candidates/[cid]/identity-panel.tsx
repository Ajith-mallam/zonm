"use client";
// The real identity is never sent to the browser until the user asks for it
// with a stated purpose. The reveal is audited server-side. Supervisors edit
// the identity only after revealing it, so every edit follows an audited read.
import { useActionState, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { FormErrors, SubmitButton } from "@/components/forms";
import { Alert, Button, Input, Label, Textarea } from "@/components/ui";
import { revealIdentityAction, saveIdentityAction, type RevealedIdentity, type RevealResult } from "../actions";

type Props = { caseId: string; candidateId: string; canRead: boolean; canWrite: boolean; onFile: boolean | null };

export function IdentityPanel({ caseId, candidateId, canRead, canWrite, onFile }: Props) {
  const [state, reveal] = useActionState<RevealResult, FormData>(revealIdentityAction.bind(null, caseId, candidateId), undefined);
  const [editing, setEditing] = useState(false);

  if (!canRead) {
    return <p className="text-sm text-black/60 dark:text-white/60">The real identity is restricted. Your role on this case does not include access to it.</p>;
  }

  // Nothing on file yet: supervisors can record one directly (nothing to reveal).
  if (onFile === false && !state?.ok) {
    return canWrite ? (
      <IdentityForm caseId={caseId} candidateId={candidateId} />
    ) : (
      <p className="text-sm text-black/60 dark:text-white/60">No identity has been recorded for this candidate.</p>
    );
  }

  if (!state?.ok) {
    return (
      <form action={reveal} className="space-y-3">
        <FormErrors state={state} />
        <p className="text-sm">An identity is on file. Viewing it is recorded in the audit log with your reason.</p>
        <div>
          <Label htmlFor="purpose">Reason for viewing</Label>
          <Input id="purpose" name="purpose" required minLength={5} maxLength={300} placeholder="e.g. preparing the disclosure schedule" />
        </div>
        <SubmitButton pendingText="Revealing…">Reveal identity</SubmitButton>
      </form>
    );
  }

  const id = state.identity;
  if (!id) return <p className="text-sm">No identity has been recorded for this candidate.</p>;
  if (editing && canWrite) return <IdentityForm caseId={caseId} candidateId={candidateId} initial={id} />;

  return (
    <div className="space-y-3 text-sm">
      <Alert tone="warning">Restricted information. Your access has been recorded.</Alert>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-black/50 dark:text-white/50">Real name</dt><dd className="font-medium" data-testid="real-name">{id.realName}</dd>
        <dt className="text-black/50 dark:text-white/50">Date of birth</dt><dd>{id.dateOfBirth ?? "—"}</dd>
        <dt className="text-black/50 dark:text-white/50">Identifiers</dt><dd className="whitespace-pre-wrap">{id.identifiers || "—"}</dd>
        <dt className="text-black/50 dark:text-white/50">Legal basis</dt><dd className="whitespace-pre-wrap">{id.legalBasis}</dd>
        <dt className="text-black/50 dark:text-white/50">Legal reference</dt><dd>{id.legalReference ?? "—"}</dd>
        <dt className="text-black/50 dark:text-white/50">Recorded by</dt><dd>{id.recordedBy}, {id.recordedAt.slice(0, 16).replace("T", " ")} UTC</dd>
      </dl>
      {canWrite && <Button variant="secondary" onClick={() => setEditing(true)}>Edit identity</Button>}
    </div>
  );
}

function IdentityForm({ caseId, candidateId, initial }: { caseId: string; candidateId: string; initial?: RevealedIdentity | null }) {
  return (
    <ActionForm action={saveIdentityAction.bind(null, caseId, candidateId)} className="space-y-3" success="Identity saved. Reload to view it again (a new reveal is required).">
      <div>
        <Label htmlFor="realName">Real name</Label>
        <Input id="realName" name="realName" defaultValue={initial?.realName} required maxLength={200} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="dateOfBirth">Date of birth</Label>
          <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={initial?.dateOfBirth ?? ""} />
        </div>
        <div>
          <Label htmlFor="legalReference">Warrant / order no.</Label>
          <Input id="legalReference" name="legalReference" defaultValue={initial?.legalReference ?? ""} maxLength={200} />
        </div>
      </div>
      <div>
        <Label htmlFor="identifiers">Identifiers (national ID, passport…)</Label>
        <Textarea id="identifiers" name="identifiers" defaultValue={initial?.identifiers} rows={2} maxLength={2000} />
      </div>
      <div>
        <Label htmlFor="legalBasis">Legal basis for processing</Label>
        <Textarea id="legalBasis" name="legalBasis" defaultValue={initial?.legalBasis} rows={2} required minLength={5} maxLength={500} />
      </div>
      <SubmitButton pendingText="Saving…">Save identity</SubmitButton>
    </ActionForm>
  );
}
