import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Card, Label, Textarea } from "@/components/ui";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { addNoteAction } from "../actions";

export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getCaseAccess(id);
  const notes = await prisma.caseNote.findMany({ where: { caseId: id }, orderBy: { createdAt: "desc" } });
  const authors = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.authorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  return (
    <div className="max-w-3xl space-y-4">
      {a.can("case.note.write") && (
        <Card>
          <ActionForm action={addNoteAction.bind(null, id)} className="space-y-3">
            <Label htmlFor="body">Add a note</Label>
            <Textarea id="body" name="body" rows={4} required maxLength={10000} />
            <p className="text-xs text-black/50 dark:text-white/50">Notes are permanent case records and cannot be edited or deleted.</p>
            <SubmitButton pendingText="Saving…">Add note</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {notes.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">No notes yet.</p>}
      {notes.map((n) => (
        <Card key={n.id} className="p-4">
          <div className="mb-2 text-xs text-black/50 dark:text-white/50">
            <strong className="text-black/80 dark:text-white/80">{authors.get(n.authorId) ?? "Unknown user"}</strong> · {fmtDateTime(n.createdAt)}
          </div>
          <p className="whitespace-pre-wrap text-sm">{n.body}</p>
        </Card>
      ))}
    </div>
  );
}
