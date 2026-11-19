import Link from "next/link";
import { CaseTabs } from "@/components/case-tabs";
import { Alert, Badge } from "@/components/ui";
import { getCaseAccess } from "@/lib/case-access";
import { MEMBER_ROLE_LABEL, PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/cases";
import { prisma } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { case: c } = await getCaseAccess((await params).id);
  return { title: c.reference };
}

export default async function CaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getCaseAccess(id);
  const c = a.case;
  const [members, openTasks, notes] = await Promise.all([
    prisma.caseMember.count({ where: { caseId: id } }),
    prisma.caseTask.count({ where: { caseId: id, status: { not: "DONE" } } }),
    prisma.caseNote.count({ where: { caseId: id } }),
  ]);

  return (
    <>
      <div className="mb-1 text-sm">
        <Link href="/" className="text-black/50 hover:underline dark:text-white/50">Cases</Link>
      </div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-black/60 dark:text-white/60">{c.reference}</div>
          <h1 className="text-xl font-semibold">{c.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
          <Badge tone={c.priority === "URGENT" || c.priority === "HIGH" ? "red" : "neutral"}>{PRIORITY_LABEL[c.priority]} priority</Badge>
          <span className="text-black/60 dark:text-white/60">
            Lead: {c.lead?.name ?? "none"} · You: {a.membership ? MEMBER_ROLE_LABEL[a.membership] : "supervisor (oversight)"}
          </span>
        </div>
      </div>
      {c.status === "ARCHIVED" && <div className="mb-4"><Alert tone="info">This case is archived and read-only.</Alert></div>}
      {c.status === "CLOSED" && <div className="mb-4"><Alert tone="info">This case is closed. Notes can still be added. A lead or supervisor can reopen or archive it.</Alert></div>}
      <CaseTabs
        base={`/cases/${id}`}
        tabs={[
          { href: "", label: "Overview" },
          { href: "/team", label: "Team", count: members },
          { href: "/tasks", label: "Tasks", count: openTasks },
          { href: "/notes", label: "Notes", count: notes },
          { href: "/activity", label: "Activity" },
        ]}
      />
      {children}
    </>
  );
}
