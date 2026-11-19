import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { SufficiencyMeter } from "@/components/sufficiency";
import { Badge, Card, Input, Label, Table, Textarea } from "@/components/ui";
import { knownWriting, noWriting } from "@/lib/candidate-data";
import { CORPUS_THRESHOLDS, nextPseudonym, PLATFORM_LABEL } from "@/lib/candidates";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { createCandidateAction } from "./actions";

const nf = new Intl.NumberFormat("en-GB");

export default async function CandidatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getCaseAccess(id);
  const canSeeIdentityFlag = a.perms.has("candidate.identity.read");
  const [candidates, writing] = await Promise.all([
    prisma.candidate.findMany({
      where: { caseId: id },
      orderBy: { pseudonym: "asc" },
      include: { handles: { orderBy: { platform: "asc" } }, identity: { select: { candidateId: true } } },
    }),
    knownWriting(id),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        {candidates.length === 0 ? (
          <Card>
            <p className="text-sm text-black/60 dark:text-white/60">No candidates yet.</p>
          </Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Handles</th>
                <th>Known writing</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="align-top">
                  <td>
                    <Link href={`/cases/${id}/candidates/${c.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">
                      {c.pseudonym}
                    </Link>
                    {canSeeIdentityFlag && c.identity && (
                      <div className="mt-1"><Badge tone="blue">Identity on file</Badge></div>
                    )}
                  </td>
                  <td className="text-xs">
                    {c.handles.length === 0 ? (
                      <span className="text-black/40 dark:text-white/40">None</span>
                    ) : (
                      <ul>
                        {c.handles.slice(0, 4).map((h) => (
                          <li key={h.id}>
                            <span className="text-black/50 dark:text-white/50">{PLATFORM_LABEL[h.platform]}:</span> {h.handle}
                          </li>
                        ))}
                        {c.handles.length > 4 && <li className="text-black/50">+{c.handles.length - 4} more</li>}
                      </ul>
                    )}
                  </td>
                  <td><SufficiencyMeter s={writing.get(c.id) ?? noWriting} compact /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          Known writing: at least {nf.format(CORPUS_THRESHOLDS.minimum)} words per candidate are needed for analysis, and{" "}
          {nf.format(CORPUS_THRESHOLDS.recommended)} or more are recommended. Excluded documents do not count.
        </p>
      </div>

      {a.can("candidate.write") && (
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Add candidate</h2>
          <ActionForm action={createCandidateAction.bind(null, id)} className="space-y-3">
            <div>
              <Label htmlFor="pseudonym">Pseudonym</Label>
              <Input id="pseudonym" name="pseudonym" defaultValue={nextPseudonym(candidates.map((c) => c.pseudonym))} required maxLength={80} />
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">Shown everywhere instead of the real name.</p>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} maxLength={5000} placeholder="Why this person is a candidate. Do not enter the real name here." />
            </div>
            <SubmitButton pendingText="Adding…">Add candidate</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
