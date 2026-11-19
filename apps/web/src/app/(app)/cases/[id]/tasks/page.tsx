import { TaskStatus } from "@prisma/client";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Badge, Button, Card, Input, Label, Select, Table, Textarea } from "@/components/ui";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { createTaskAction, updateTaskAction } from "../actions";

const TASK_LABEL: Record<TaskStatus, string> = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getCaseAccess(id);
  const write = a.can("case.task.write");
  const [tasks, members] = await Promise.all([
    prisma.caseTask.findMany({ where: { caseId: id }, orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
    prisma.caseMember.findMany({ where: { caseId: id }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const names = new Map(members.map((m) => [m.user.id, m.user.name]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Due</th>
            <th>{write ? "Status / assignee" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.length === 0 && <tr><td colSpan={3} className="text-black/50 dark:text-white/50">No tasks yet.</td></tr>}
          {tasks.map((t) => {
            const overdue = t.status !== "DONE" && t.dueAt && fmtDate(t.dueAt) < today;
            return (
              <tr key={t.id} className="align-top">
                <td>
                  <div className={t.status === "DONE" ? "text-black/50 line-through dark:text-white/50" : "font-medium"}>{t.title}</div>
                  {t.description && <div className="whitespace-pre-wrap text-xs text-black/60 dark:text-white/60">{t.description}</div>}
                </td>
                <td className="whitespace-nowrap text-xs">{overdue ? <Badge tone="red">{fmtDate(t.dueAt)}</Badge> : fmtDate(t.dueAt)}</td>
                <td>
                  {write ? (
                    <ActionForm action={updateTaskAction.bind(null, id)} className="flex flex-wrap gap-1">
                      <input type="hidden" name="taskId" value={t.id} />
                      <Select name="status" defaultValue={t.status} className="w-32 py-1 text-xs" aria-label={`Status of ${t.title}`}>
                        {Object.values(TaskStatus).map((s) => <option key={s} value={s}>{TASK_LABEL[s]}</option>)}
                      </Select>
                      <Select name="assigneeId" defaultValue={t.assigneeId ?? ""} className="w-36 py-1 text-xs" aria-label={`Assignee of ${t.title}`}>
                        <option value="">Unassigned</option>
                        {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
                      </Select>
                      <Button variant="secondary" className="py-1 text-xs">Save</Button>
                    </ActionForm>
                  ) : (
                    <div className="text-xs">
                      {TASK_LABEL[t.status]} · {t.assigneeId ? (names.get(t.assigneeId) ?? "Former member") : "Unassigned"}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {write && (
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Add task</h2>
          <ActionForm action={createTaskAction.bind(null, id)} className="space-y-3">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required maxLength={200} />
            </div>
            <div>
              <Label htmlFor="description">Details</Label>
              <Textarea id="description" name="description" rows={3} maxLength={5000} />
            </div>
            <div>
              <Label htmlFor="assigneeId">Assign to</Label>
              <Select id="assigneeId" name="assigneeId" defaultValue="">
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="dueAt">Due date</Label>
              <Input id="dueAt" name="dueAt" type="date" />
            </div>
            <SubmitButton pendingText="Adding…">Add task</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
