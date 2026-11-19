import { CasePriority } from "@prisma/client";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Card, Input, Label, Select, Textarea } from "@/components/ui";
import { getCaseAccess } from "@/lib/case-access";
import { CASE_TRANSITIONS, PRIORITY_LABEL, reasonRequired, STATUS_LABEL, statusChangeAllowed } from "@/lib/cases";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { changeStatusAction, updateCaseAction } from "./actions";

const TRANSITION_VERB: Partial<Record<string, string>> = {
  "OPEN>IN_ANALYSIS": "Start analysis",
  "IN_ANALYSIS>UNDER_REVIEW": "Send for review",
  "UNDER_REVIEW>IN_ANALYSIS": "Return to analysis",
  "IN_ANALYSIS>OPEN": "Move back to open",
  "CLOSED>OPEN": "Reopen",
  "CLOSED>ARCHIVED": "Archive",
};

export default async function CaseOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getCaseAccess(id);
  const c = a.case;
  const createdBy = await prisma.user.findUnique({ where: { id: c.createdById }, select: { name: true } });
  const next = a.can("case.status.change") ? CASE_TRANSITIONS[c.status].filter((to) => statusChangeAllowed(a.perms, c.status, to)) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card>
          <h2 className="mb-2 font-semibold">Description</h2>
          <p className="whitespace-pre-wrap text-sm">{c.description || <span className="text-black/40 dark:text-white/40">No description.</span>}</p>
          <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-black/5 pt-4 text-xs dark:border-white/10 sm:grid-cols-4">
            <div><dt className="text-black/50 dark:text-white/50">Created</dt><dd>{fmtDateTime(c.createdAt)}</dd></div>
            <div><dt className="text-black/50 dark:text-white/50">Created by</dt><dd>{createdBy?.name ?? "—"}</dd></div>
            <div><dt className="text-black/50 dark:text-white/50">Last updated</dt><dd>{fmtDateTime(c.updatedAt)}</dd></div>
            <div><dt className="text-black/50 dark:text-white/50">Closed</dt><dd>{fmtDateTime(c.closedAt)}</dd></div>
          </dl>
        </Card>

        {a.can("case.update") && (
          <Card>
            <h2 className="mb-4 font-semibold">Edit details</h2>
            <ActionForm action={updateCaseAction.bind(null, id)} className="space-y-4" success="Saved.">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" defaultValue={c.title} required minLength={3} maxLength={200} />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" defaultValue={c.description ?? ""} rows={5} maxLength={5000} />
              </div>
              <div className="max-w-xs">
                <Label htmlFor="priority">Priority</Label>
                <Select id="priority" name="priority" defaultValue={c.priority}>
                  {Object.values(CasePriority).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                  ))}
                </Select>
              </div>
              <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <h2 className="mb-1 font-semibold">Status</h2>
          <p className="mb-4 text-sm">Currently <strong>{STATUS_LABEL[c.status]}</strong>.</p>
          {next.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">No status changes are available to you.</p>
          ) : (
            <ActionForm action={changeStatusAction.bind(null, id)} className="space-y-3">
              <div>
                <Label htmlFor="to">Change to</Label>
                <Select id="to" name="to" defaultValue={next[0]}>
                  {next.map((to) => (
                    <option key={to} value={to}>
                      {TRANSITION_VERB[`${c.status}>${to}`] ?? STATUS_LABEL[to]}
                      {reasonRequired(c.status, to) ? " (reason required)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="reason">Reason</Label>
                <Textarea id="reason" name="reason" rows={3} maxLength={2000} />
              </div>
              <SubmitButton pendingText="Updating…">Update status</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </div>
  );
}
