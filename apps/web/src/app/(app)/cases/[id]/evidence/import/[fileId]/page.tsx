import { Platform } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Alert, Badge, buttonClass, Card, Label, Select, Table } from "@/components/ui";
import { PLATFORM_LABEL } from "@/lib/candidates";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { caseTextHashes, extractOptionsFrom, extractSourceFile, fmtBytes, IntegrityError } from "@/lib/evidence";
import { fmtDateTime } from "@/lib/format";
import { authorStats, NO_AUTHOR, planImport } from "@/lib/ingest/plan";
import { ExtractionError, type Extraction } from "@/lib/ingest/types";
import { countWords, sha256Hex } from "@/lib/text";
import { importAction } from "../../actions";

const nf = new Intl.NumberFormat("en-GB");
const SAMPLE = 25;

export default async function ImportPreviewPage({ params, searchParams }: { params: Promise<{ id: string; fileId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id, fileId } = await params;
  const sp = await searchParams;
  const a = await getCaseAccess(id);
  const file = await prisma.sourceFile.findFirst({ where: { id: fileId, caseId: id }, include: { _count: { select: { documents: true } } } });
  if (!file) notFound();
  const opts = extractOptionsFrom((k) => sp[k]);
  const [candidates, sameFile, hashes] = await Promise.all([
    prisma.candidate.findMany({ where: { caseId: id }, orderBy: { pseudonym: "asc" }, select: { id: true, pseudonym: true } }),
    prisma.sourceFile.findMany({ where: { caseId: id, sha256: file.sha256, id: { not: file.id } }, select: { filename: true, uploadedAt: true } }),
    caseTextHashes(id),
  ]);

  let ex: Extraction | null = null;
  let error: string | null = null;
  let errorFields: string[] | undefined;
  try {
    ex = await extractSourceFile(file, opts);
  } catch (e) {
    if (e instanceof ExtractionError || e instanceof IntegrityError) {
      error = e.message;
      errorFields = e instanceof ExtractionError ? e.fields : undefined;
    }
    else throw e;
  }

  const canImport = a.can("document.upload");
  const targetOptions = (
    <>
      <option value="skip">Do not import</option>
      <option value="questioned">Questioned (unknown author)</option>
      {candidates.map((c) => <option key={c.id} value={`known:${c.id}`}>Known writing of {c.pseudonym}</option>)}
    </>
  );
  const authors = ex ? authorStats(ex.units) : [];
  const totals = ex ? { units: ex.units.length, words: ex.units.reduce((n, u) => n + countWords(u.text), 0) } : null;
  const dupes = ex ? ex.units.filter((u) => hashes.has(sha256Hex(u.text))).length : 0;
  // Preview duplicates within the file too (as if everything were imported).
  const inFileDupes = ex ? planImport(ex.units, () => ({ kind: "questioned" }), new Map()).filter((p) => p.duplicateInFile).length : 0;
  const fields = ex?.fields ?? errorFields;
  const tabular = !!fields;
  const splittable = !error && ex && ["TXT", "DOCX", "PDF"].includes(ex.sourceType);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Import preview</h2>
        <Link href={`/cases/${id}/evidence`} className="text-sm underline">Back to evidence</Link>
      </div>

      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div className="sm:col-span-2"><dt className="text-xs text-black/50 dark:text-white/50">File</dt><dd className="break-all font-medium">{file.filename}</dd></div>
          <div><dt className="text-xs text-black/50 dark:text-white/50">Size</dt><dd>{fmtBytes(file.sizeBytes)}</dd></div>
          <div><dt className="text-xs text-black/50 dark:text-white/50">Type</dt><dd>{ex?.sourceType ?? "—"}</dd></div>
          <div className="sm:col-span-4"><dt className="text-xs text-black/50 dark:text-white/50">SHA-256 of the original file</dt><dd className="break-all font-mono text-xs">{file.sha256}</dd></div>
        </dl>
        {file._count.documents > 0 && <div className="mt-3"><Alert tone="info">{file._count.documents} document(s) have already been imported from this file.</Alert></div>}
        {sameFile.length > 0 && (
          <div className="mt-3">
            <Alert tone="warning">This exact file was uploaded before ({sameFile.map((f) => `${f.filename}, ${fmtDateTime(f.uploadedAt)}`).join("; ")}). Text already in the case is skipped as a duplicate.</Alert>
          </div>
        )}
      </Card>

      {(tabular || splittable) && (
        <Card>
          <h3 className="mb-3 font-semibold">How to read the file</h3>
          <form className="flex flex-wrap items-end gap-3" action={`/cases/${id}/evidence/import/${fileId}`}>
            {splittable && (
              <div>
                <Label htmlFor="split">Split into</Label>
                <Select id="split" name="split" defaultValue={opts.split} className="w-56">
                  <option value="none">One document</option>
                  <option value="paragraph">One document per paragraph</option>
                </Select>
              </div>
            )}
            {tabular && fields && (
              <>
                {([["textField", "Text column", false], ["authorField", "Author column", true], ["dateField", "Date column", true]] as const).map(([name, label, optional]) => (
                  <div key={name}>
                    <Label htmlFor={name}>{label}</Label>
                    <Select id={name} name={name} defaultValue={ex?.used?.[name] ?? opts[name] ?? ""} className="w-48">
                      {optional && <option value="">(none)</option>}
                      {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </Select>
                  </div>
                ))}
              </>
            )}
            <button className={buttonClass("secondary")}>Update preview</button>
          </form>
        </Card>
      )}

      {error && <Alert>{error}</Alert>}

      {ex && totals && (
        <>
          {ex.warnings.length > 0 && <Alert tone="info"><ul className="list-disc pl-5">{ex.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
          <p className="text-sm">
            Found <strong>{nf.format(totals.units)}</strong> {totals.units === 1 ? "item" : "items"} with <strong>{nf.format(totals.words)}</strong> words
            {ex.hasAuthors && <> from <strong>{authors.length}</strong> author(s)</>}.
            {dupes > 0 && <> <Badge tone="amber">{dupes} already in this case</Badge></>}
            {inFileDupes > 0 && <> <Badge tone="amber">{inFileDupes} repeated in this file</Badge></>}
          </p>

          {canImport && totals.units > 0 && (
            <Card>
              <h3 className="mb-3 font-semibold">Import as</h3>
              {candidates.length === 0 && <div className="mb-3"><Alert tone="info">No candidates yet. Add candidates first to import known writing.</Alert></div>}
              <ActionForm action={importAction.bind(null, id, fileId)} className="space-y-4">
                {/* Carry the reading options so the import parses exactly what was previewed. */}
                {Object.entries({ split: opts.split, textField: ex.used?.textField, authorField: ex.used?.authorField ?? "", dateField: ex.used?.dateField ?? "" }).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v ?? ""} />
                ))}
                {ex.hasAuthors ? (
                  <Table>
                    <thead><tr><th>Author in file</th><th>Items</th><th>Words</th><th>Import as</th></tr></thead>
                    <tbody>
                      {authors.map((s, i) => (
                        <tr key={s.author}>
                          <td className="font-medium">{s.author === NO_AUTHOR ? <span className="text-black/50">{NO_AUTHOR}</span> : s.author}</td>
                          <td>{nf.format(s.units)}</td>
                          <td>{nf.format(s.words)}</td>
                          <td>
                            <input type="hidden" name={`a_${i}`} value={s.author} />
                            <Select name={`t_${i}`} defaultValue="skip" className="w-64" aria-label={`Import ${s.author} as`}>{targetOptions}</Select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="max-w-sm">
                    <Label htmlFor="target">Role</Label>
                    <Select id="target" name="target" defaultValue="questioned">{targetOptions}</Select>
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-4">
                  {!ex.platform && (
                    <div>
                      <Label htmlFor="platform">Platform (optional)</Label>
                      <Select id="platform" name="platform" defaultValue="" className="w-44">
                        <option value="">Not specified</option>
                        {Object.values(Platform).map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
                      </Select>
                    </div>
                  )}
                  {(dupes > 0 || inFileDupes > 0) && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="includeDuplicates" /> Import duplicates too (they are marked as duplicates)
                    </label>
                  )}
                </div>
                <SubmitButton pendingText="Importing…">Import</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <section>
            <h3 className="mb-2 font-semibold">Extracted text {totals.units > SAMPLE && <span className="text-sm font-normal text-black/50">(first {SAMPLE} of {nf.format(totals.units)})</span>}</h3>
            <div className="space-y-2">
              {ex.units.slice(0, SAMPLE).map((u) => (
                <Card key={u.position} className="p-3">
                  <div className="mb-1 flex flex-wrap gap-2 text-xs text-black/50 dark:text-white/50">
                    <span>#{u.position}</span>
                    {u.authorLabel && <span className="font-medium text-black/70 dark:text-white/70">{u.authorLabel}</span>}
                    {u.authoredAt && <span>{fmtDateTime(u.authoredAt)}</span>}
                    <span>{countWords(u.text)} words</span>
                    {hashes.has(sha256Hex(u.text)) && <Badge tone="amber">Already in case</Badge>}
                  </div>
                  <p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{u.text}</p>
                </Card>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
