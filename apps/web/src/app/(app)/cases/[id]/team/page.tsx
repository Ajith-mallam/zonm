import { CaseMemberRole } from "@prisma/client";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Button, Card, Label, Select, Table } from "@/components/ui";
import { getCaseAccess } from "@/lib/case-access";
import { MEMBER_ROLE_LABEL } from "@/lib/cases";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { casePermissions } from "@/lib/rbac";
import { addMemberAction, removeMemberAction, setMemberRoleAction } from "../actions";

const ROLE_HELP: Record<CaseMemberRole, string> = {
  LEAD: "runs the case, manages the team, closes the case",
  ANALYST: "uploads evidence and runs analyses",
  REVIEWER: "reviews and signs off results",
  OBSERVER: "read-only",
};

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getCaseAccess(id);
  const manage = a.can("case.team.manage");
  const members = await prisma.caseMember.findMany({
    where: { caseId: id },
    include: { user: { select: { id: true, name: true, email: true, role: true, status: true } } },
    orderBy: [{ role: "asc" }, { addedAt: "asc" }],
  });
  const candidates = manage
    ? await prisma.user.findMany({
        where: { status: "ACTIVE", role: { not: "ADMIN" }, id: { notIn: members.map((m) => m.userId) } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true },
      })
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Case role</th>
            <th>Can do</th>
            <th>Added</th>
            {manage && <th className="text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {members.length === 0 && (
            <tr><td colSpan={5} className="text-black/50 dark:text-white/50">No team members yet.</td></tr>
          )}
          {members.map((m) => {
            const effective = casePermissions({ id: m.user.id, role: m.user.role, status: m.user.status }, m.role);
            return (
              <tr key={m.id} className="align-top">
                <td>
                  <div className="font-medium">{m.user.name}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">{m.user.email} · {m.user.role.toLowerCase()}</div>
                </td>
                <td>
                  {manage ? (
                    <ActionForm action={setMemberRoleAction.bind(null, id)} className="flex gap-1">
                      <input type="hidden" name="userId" value={m.userId} />
                      <Select name="role" defaultValue={m.role} className="w-32 shrink-0 py-1 text-xs" aria-label={`Case role for ${m.user.name}`}>
                        {Object.values(CaseMemberRole).map((r) => (
                          <option key={r} value={r}>{MEMBER_ROLE_LABEL[r]}</option>
                        ))}
                      </Select>
                      <Button variant="secondary" className="py-1 text-xs">Set</Button>
                    </ActionForm>
                  ) : (
                    MEMBER_ROLE_LABEL[m.role]
                  )}
                </td>
                <td className="max-w-xs text-xs text-black/60 dark:text-white/60">
                  {effective.length <= 1
                    ? "Read only"
                    : [
                        effective.includes("case.team.manage") && "manage team",
                        effective.includes("analysis.run") && "run analyses",
                        effective.includes("document.upload") && "upload evidence",
                        effective.includes("result.review") && "review results",
                        effective.includes("case.note.write") && "add notes",
                      ].filter(Boolean).join(", ")}
                </td>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(m.addedAt)}</td>
                {manage && (
                  <td className="text-right">
                    <ActionForm action={removeMemberAction.bind(null, id)}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button variant="secondary" className="py-1 text-xs">Remove</Button>
                    </ActionForm>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>

      {manage && (
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Add member</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">Every eligible user is already on the team.</p>
          ) : (
            <ActionForm action={addMemberAction.bind(null, id)} className="space-y-3">
              <div>
                <Label htmlFor="userId">User</Label>
                <Select id="userId" name="userId" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role.toLowerCase()})</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="role">Case role</Label>
                <Select id="role" name="role" defaultValue="ANALYST">
                  {Object.values(CaseMemberRole).map((r) => (
                    <option key={r} value={r}>{MEMBER_ROLE_LABEL[r]}: {ROLE_HELP[r]}</option>
                  ))}
                </Select>
              </div>
              <p className="text-xs text-black/50 dark:text-white/50">
                A member can never do more than their system role allows. Making someone lead replaces the current lead.
              </p>
              <SubmitButton pendingText="Adding…">Add to team</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
