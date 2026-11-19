import { Platform } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { SufficiencyMeter } from "@/components/sufficiency";
import { Button, Card, Input, Label, Select, Table, Textarea } from "@/components/ui";
import { knownWriting, noWriting } from "@/lib/candidate-data";
import { PLATFORM_LABEL } from "@/lib/candidates";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { addHandleAction, deleteCandidateAction, removeHandleAction, updateCandidateAction } from "../actions";
import { IdentityPanel } from "./identity-panel";

export default async function CandidatePage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const a = await getCaseAccess(id);
  const c = await prisma.candidate.findFirst({
    where: { id: cid, caseId: id },
    include: { handles: { orderBy: [{ platform: "asc" }, { handle: "asc" }] }, identity: { select: { candidateId: true } } },
  });
  if (!c) notFound();
  const [writing, docCount] = await Promise.all([
    knownWriting(id),
    prisma.document.count({ where: { candidateId: c.id } }),
  ]);
  const write = a.can("candidate.write");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{c.pseudonym}</h2>
        <Link href={`/cases/${id}/candidates`} className="text-sm underline">All candidates</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Known writing</h3>
          <SufficiencyMeter s={writing.get(c.id) ?? noWriting} />
          <p className="mt-3 text-xs text-black/50 dark:text-white/50">Documents are added on the Evidence page (M4).</p>
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Restricted identity</h3>
          <IdentityPanel
            caseId={id}
            candidateId={c.id}
            canRead={a.can("candidate.identity.read")}
            canWrite={a.can("candidate.identity.write")}
            onFile={a.perms.has("candidate.identity.read") ? !!c.identity : null}
          />
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Handles and contact points</h3>
        {c.handles.length > 0 && (
          <div className="mb-4">
            <Table>
              <thead>
                <tr><th>Platform</th><th>Handle</th><th>Profile</th><th>Added</th>{write && <th />}</tr>
              </thead>
              <tbody>
                {c.handles.map((h) => (
                  <tr key={h.id}>
                    <td>{PLATFORM_LABEL[h.platform]}</td>
                    <td className="font-mono text-xs">{h.handle}</td>
                    <td className="max-w-xs truncate text-xs">
                      {h.profileUrl ? <a href={h.profileUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-700 underline dark:text-blue-300">{h.profileUrl}</a> : "—"}
                    </td>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(h.createdAt)}</td>
                    {write && (
                      <td className="text-right">
                        <ActionForm action={removeHandleAction.bind(null, id, c.id)}>
                          <input type="hidden" name="handleId" value={h.id} />
                          <Button variant="secondary" className="py-1 text-xs">Remove</Button>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {c.handles.length === 0 && <p className="mb-4 text-sm text-black/50 dark:text-white/50">No handles recorded.</p>}
        {write && (
          <ActionForm action={addHandleAction.bind(null, id, c.id)} className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="platform">Platform</Label>
              <Select id="platform" name="platform" defaultValue="FACEBOOK">
                {Object.values(Platform).map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="handle">Handle, number or address</Label>
              <Input id="handle" name="handle" required maxLength={200} />
            </div>
            <div>
              <Label htmlFor="profileUrl">Profile URL (optional)</Label>
              <Input id="profileUrl" name="profileUrl" type="url" maxLength={500} placeholder="https://" />
            </div>
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </ActionForm>
        )}
      </Card>

      {write && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 font-semibold">Edit candidate</h3>
            <ActionForm action={updateCandidateAction.bind(null, id, c.id)} className="space-y-3" success="Saved.">
              <div>
                <Label htmlFor="pseudonym">Pseudonym</Label>
                <Input id="pseudonym" name="pseudonym" defaultValue={c.pseudonym} required maxLength={80} />
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" defaultValue={c.notes ?? ""} rows={4} maxLength={5000} />
              </div>
              <SubmitButton pendingText="Saving…">Save</SubmitButton>
            </ActionForm>
          </Card>
          <Card className="h-fit">
            <h3 className="mb-2 font-semibold">Delete candidate</h3>
            {docCount > 0 ? (
              <p className="text-sm text-black/60 dark:text-white/60">This candidate has {docCount} document(s) attached and cannot be deleted.</p>
            ) : (
              <ActionForm action={deleteCandidateAction.bind(null, id, c.id)} className="space-y-3">
                <p className="text-sm text-black/60 dark:text-white/60">Removes the candidate, their handles and any recorded identity. This is recorded in the audit log.</p>
                <SubmitButton variant="danger" pendingText="Deleting…">Delete {c.pseudonym}</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      )}
      {!write && c.notes && (
        <Card>
          <h3 className="mb-2 font-semibold">Notes</h3>
          <p className="whitespace-pre-wrap text-sm">{c.notes}</p>
        </Card>
      )}
    </div>
  );
}
