import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Badge, buttonClass, Input, PageHeader, Table } from "@/components/ui";
import { recordAudit, verifyAuditChain } from "@/lib/audit";
import { currentRequestContext } from "@/lib/auth/request-context";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

export const metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, user } = await requireSession();
  if (!can(actor, "audit.read")) redirect("/");
  const sp = await searchParams;
  const action = sp.action?.trim() || undefined;
  const before = sp.before && /^\d+$/.test(sp.before) ? BigInt(sp.before) : undefined;

  let report: Awaited<ReturnType<typeof verifyAuditChain>> | null = null;
  if (sp.verify && can(actor, "audit.verify")) {
    report = await verifyAuditChain();
    await recordAudit(prisma, {
      action: "audit.verify",
      actor: user,
      ...(await currentRequestContext()),
      details: { intact: report.intact, headSeq: report.head?.seq.toString() ?? null, problems: report.problems.length },
    });
  }

  const events = await prisma.auditEvent.findMany({
    where: { ...(action && { action: { startsWith: action } }), ...(before && { seq: { lt: before } }) },
    orderBy: { seq: "desc" },
    take: PAGE,
  });
  const last = events.at(-1);

  return (
    <>
      <PageHeader title="Audit log">
        {can(actor, "audit.verify") && (
          <Link href="/audit?verify=1" className={buttonClass("secondary")} prefetch={false}>
            Verify integrity
          </Link>
        )}
      </PageHeader>

      {report && (
        <div className="mb-4">
          {report.intact ? (
            <Alert tone="success">
              Chain intact: {report.head ? `${report.head.seq} events verified. Head hash ` : "no events yet."}
              {report.head && <code className="font-mono text-xs">{report.head.hash}</code>}
            </Alert>
          ) : (
            <Alert>
              <strong>Integrity failure:</strong> {report.problems.length} problem(s) found.
              <ul className="mt-1 list-disc pl-5">
                {report.problems.slice(0, 20).map((p, i) => (
                  <li key={i}>seq {p.seq.toString()}: {p.problem}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      <form className="mb-4 flex gap-2" action="/audit">
        <Input name="action" defaultValue={action} placeholder="Filter by action prefix, e.g. auth.login" className="max-w-sm" />
        <button className={buttonClass("secondary")}>Filter</button>
      </form>

      <Table>
        <thead>
          <tr>
            <th>#</th>
            <th>Time (UTC)</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Entity</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq.toString()} className="align-top">
              <td className="font-mono text-xs">{e.seq.toString()}</td>
              <td className="whitespace-nowrap font-mono text-xs">{e.at.toISOString().replace("T", " ").slice(0, 23)}</td>
              <td>
                <Badge tone={/failure|lockout|reset|disable/.test(e.action) ? "amber" : "neutral"}>{e.action}</Badge>
              </td>
              <td className="text-xs">
                {e.actorEmail ?? <span className="text-black/40 dark:text-white/40">system</span>}
                {e.ip && <div className="text-black/40 dark:text-white/40">{e.ip}</div>}
              </td>
              <td className="text-xs">{e.entityType && `${e.entityType} ${e.entityId?.slice(0, 10) ?? ""}`}</td>
              <td className="max-w-md break-all font-mono text-xs">{JSON.stringify(e.details)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {last && events.length === PAGE && (
        <div className="mt-4">
          <Link className={buttonClass("secondary")} href={`/audit?${new URLSearchParams({ ...(action && { action }), before: last.seq.toString() })}`}>
            Older events
          </Link>
        </div>
      )}
    </>
  );
}
