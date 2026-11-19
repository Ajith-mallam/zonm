import { CasePriority } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Card, Input, Label, PageHeader, Select, Textarea } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { PRIORITY_LABEL } from "@/lib/cases";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { createCaseAction } from "../actions";

export const metadata = { title: "New case" };

export default async function NewCasePage() {
  const { actor } = await requireSession();
  if (!can(actor, "case.create")) redirect("/");
  const leads = await prisma.user.findMany({
    where: { status: "ACTIVE", role: { in: ["SUPERVISOR", "ANALYST"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  return (
    <>
      <PageHeader title="New case" />
      <Card className="max-w-2xl">
        <ActionForm action={createCaseAction} className="space-y-4">
          <p className="text-sm text-black/60 dark:text-white/60">A reference number (ZN-YYYY-NNNN) is assigned when the case is created.</p>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required minLength={3} maxLength={200} />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={5} maxLength={5000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select id="priority" name="priority" defaultValue="NORMAL">
                {Object.values(CasePriority).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="leadId">Case lead</Label>
              <Select id="leadId" name="leadId" defaultValue="">
                <option value="">Assign later</option>
                {leads.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role.toLowerCase()})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SubmitButton pendingText="Creating…">Create case</SubmitButton>
            <Link href="/" className="text-sm underline">Cancel</Link>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
