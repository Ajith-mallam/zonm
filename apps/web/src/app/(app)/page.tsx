import { CaseStatus, type Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, buttonClass, Card, Input, PageHeader, Select, Table } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { caseVisibilityWhere } from "@/lib/case-access";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/cases";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/rbac";

export const metadata = { title: "Cases" };

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requireSession();
  // Administrators have no case access; send them to their own area.
  if (actor.role === "ADMIN") redirect("/admin/users");
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const status = Object.values(CaseStatus).includes(sp.status as CaseStatus) ? (sp.status as CaseStatus) : undefined;
  const showArchived = status === "ARCHIVED";

  const where: Prisma.CaseWhereInput = {
    AND: [
      caseVisibilityWhere(actor),
      status ? { status } : showArchived ? {} : { status: { not: "ARCHIVED" } },
      q ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };
  const cases = await prisma.case.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    include: {
      lead: { select: { name: true } },
      _count: { select: { tasks: { where: { status: { not: "DONE" } } } } },
    },
  });

  return (
    <>
      <PageHeader title="Cases">
        {can(actor, "case.create") && (
          <Link href="/cases/new" className={buttonClass("primary")}>
            New case
          </Link>
        )}
      </PageHeader>

      <form className="mb-4 flex flex-wrap gap-2" action="/">
        <Input name="q" defaultValue={q} placeholder="Search reference or title" className="max-w-xs" aria-label="Search" />
        <Select name="status" defaultValue={status ?? ""} className="w-44" aria-label="Status">
          <option value="">All active</option>
          {Object.values(CaseStatus).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>

      {cases.length === 0 ? (
        <Card>
          <p className="text-sm text-black/60 dark:text-white/60">
            {q || status ? "No cases match." : can(actor, "case.create") ? "No cases yet. Create the first one." : "You have not been added to any cases yet."}
          </p>
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Lead</th>
              <th>Open tasks</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap font-mono text-xs">
                  <Link href={`/cases/${c.id}`} className="text-blue-700 hover:underline dark:text-blue-300">{c.reference}</Link>
                </td>
                <td>
                  <Link href={`/cases/${c.id}`} className="hover:underline">{c.title}</Link>
                </td>
                <td><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge></td>
                <td>{c.priority === "URGENT" || c.priority === "HIGH" ? <Badge tone="red">{PRIORITY_LABEL[c.priority]}</Badge> : PRIORITY_LABEL[c.priority]}</td>
                <td>{c.lead?.name ?? <span className="text-black/40 dark:text-white/40">None</span>}</td>
                <td>{c._count.tasks}</td>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
