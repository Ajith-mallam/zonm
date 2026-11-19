import { Badge, Table } from "@/components/ui";
import { getCaseAccess } from "@/lib/case-access";
import { STATUS_LABEL } from "@/lib/cases";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";

const ACTION_LABEL: Record<string, string> = {
  "case.create": "Case created",
  "case.update": "Details edited",
  "case.status.change": "Status changed",
  "case.member.add": "Member added",
  "case.member.remove": "Member removed",
  "case.member.role": "Member role changed",
  "case.note.add": "Note added",
  "case.task.create": "Task created",
  "case.task.update": "Task updated",
};

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getCaseAccess(id);
  const [history, events] = await Promise.all([
    prisma.caseStatusChange.findMany({ where: { caseId: id }, orderBy: { changedAt: "desc" } }),
    prisma.auditEvent.findMany({ where: { caseId: id }, orderBy: { seq: "desc" }, take: 200 }),
  ]);
  const people = new Map(
    (await prisma.user.findMany({
      where: { id: { in: [...new Set([...history.map((h) => h.changedById), ...events.flatMap((e) => [e.actorId, e.entityType === "User" ? e.entityId : null])].filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    })).map((u) => [u.id, u.name]),
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-semibold">Status history</h2>
        <Table>
          <thead><tr><th>When</th><th>Change</th><th>By</th><th>Reason</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="align-top">
                <td className="whitespace-nowrap text-xs">{fmtDateTime(h.changedAt)}</td>
                <td className="whitespace-nowrap">{h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ""}{STATUS_LABEL[h.toStatus]}</td>
                <td>{people.get(h.changedById) ?? "—"}</td>
                <td className="whitespace-pre-wrap text-sm">{h.reason}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section>
        <h2 className="mb-1 font-semibold">Audit trail</h2>
        <p className="mb-3 text-xs text-black/50 dark:text-white/50">From the tamper-evident audit log. Entries reference records by id and do not repeat case content.</p>
        <Table>
          <thead><tr><th>#</th><th>When</th><th>Event</th><th>By</th><th>Details</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.seq.toString()} className="align-top">
                <td className="font-mono text-xs">{e.seq.toString()}</td>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(e.at)}</td>
                <td><Badge>{ACTION_LABEL[e.action] ?? e.action}</Badge></td>
                <td className="text-sm">{(e.actorId && people.get(e.actorId)) ?? e.actorEmail ?? "system"}</td>
                <td className="text-xs">
                  {e.entityType === "User" && e.entityId && people.get(e.entityId) && <span>{people.get(e.entityId)} </span>}
                  <span className="break-all font-mono text-black/60 dark:text-white/60">{JSON.stringify(e.details)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
