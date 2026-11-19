import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/forms";
import { Alert, Badge, buttonClass, Card, Input, Label, Select, Table } from "@/components/ui";
import { startCaptureAction } from "./capture/actions";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { fmtBytes } from "@/lib/evidence";
import { fmtDateTime } from "@/lib/format";
import { ACCEPTED_EXTENSIONS } from "@/lib/ingest/extract";
import { snippet } from "@/lib/text";

const PAGE = 100;
const nf = new Intl.NumberFormat("en-GB");

export default async function EvidencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const a = await getCaseAccess(id);
  const candidates = await prisma.candidate.findMany({ where: { caseId: id }, orderBy: { pseudonym: "asc" }, select: { id: true, pseudonym: true } });
  const pseud = new Map(candidates.map((c) => [c.id, c.pseudonym]));

  const role = sp.role === "QUESTIONED" || sp.role === "KNOWN" ? sp.role : undefined;
  const candidateId = sp.candidate && pseud.has(sp.candidate) ? sp.candidate : undefined;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const showExcluded = sp.excluded === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.DocumentWhereInput = {
    caseId: id,
    ...(role && { role }),
    ...(candidateId && { candidateId }),
    ...(!showExcluded && { excluded: false }),
    ...(q && { OR: [{ authorLabel: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] }),
  };

  const [docs, total, summary, files, captures] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: [{ role: "desc" }, { authoredAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { _count: { select: { versions: true } } },
    }),
    prisma.document.count({ where }),
    prisma.document.groupBy({ by: ["role", "candidateId"], where: { caseId: id, excluded: false }, _count: { _all: true }, _sum: { wordCount: true } }),
    prisma.sourceFile.findMany({ where: { caseId: id }, orderBy: { uploadedAt: "desc" }, include: { _count: { select: { documents: true } } } }),
    prisma.captureJob.findMany({ where: { caseId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const uploaders = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(files.map((f) => f.uploadedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  const questioned = summary.find((s) => s.role === "QUESTIONED");
  const qs = (over: Record<string, string | undefined>) =>
    `?${new URLSearchParams(Object.entries({ role, candidate: candidateId, q, excluded: showExcluded ? "1" : undefined, ...over }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-6">
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.imported && <Alert tone="success">{sp.imported} document(s) imported.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <h2 className="mb-3 font-semibold">Summary</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-black/50 dark:text-white/50">Questioned</dt>
              <dd>{questioned?._count._all ?? 0} docs · {nf.format(questioned?._sum.wordCount ?? 0)} words</dd>
            </div>
            {candidates.map((c) => {
              const s = summary.find((x) => x.role === "KNOWN" && x.candidateId === c.id);
              return (
                <div key={c.id}>
                  <dt className="text-xs text-black/50 dark:text-white/50">{c.pseudonym} (known)</dt>
                  <dd>{s?._count._all ?? 0} docs · {nf.format(s?._sum.wordCount ?? 0)} words</dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-xs text-black/50 dark:text-white/50">Excluded documents are not counted.</p>
        </Card>

        {a.can("document.upload") && (
          <Card>
            <h2 className="mb-3 font-semibold">Upload evidence</h2>
            {/* Plain form post: works without JavaScript; the server redirects to the import preview. */}
            <form action={`/api/cases/${id}/evidence`} method="post" encType="multipart/form-data" className="space-y-3">
              <input
                type="file"
                name="file"
                required
                accept={ACCEPTED_EXTENSIONS.join(",")}
                aria-label="Evidence file"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
              />
              <p className="text-xs text-black/50 dark:text-white/50">
                TXT, DOCX, PDF, CSV, JSON, or a WhatsApp chat export (.txt). Up to 25 MB. The original is kept unchanged, encrypted and hashed.
              </p>
              <button className={buttonClass("primary")}>Upload and preview</button>
            </form>
          </Card>
        )}
      </div>

      {a.can("document.upload") && (
        <Card>
          <h2 className="mb-1 font-semibold">Check a Facebook post</h2>
          <p className="mb-3 text-sm text-black/60 dark:text-white/60">
            Paste the link to a public post. Its text is captured, stored as questioned evidence with its hash, and can be compared with the candidates straight away.
          </p>
          <ActionForm action={startCaptureAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-72 flex-1">
              <Label htmlFor="post-url">Post URL</Label>
              <Input id="post-url" name="url" required placeholder="https://www.facebook.com/…/posts/…" maxLength={500} />
            </div>
            {a.can("analysis.run") && (
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="autoAnalyse" defaultChecked /> Check authorship against the candidates
              </label>
            )}
            <SubmitButton pendingText="Starting…">Check post</SubmitButton>
          </ActionForm>
          {captures.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {captures.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.status === "SUCCEEDED" ? "green" : c.status === "FAILED" ? "red" : "blue"}>{c.status === "SUCCEEDED" ? "Captured" : c.status === "FAILED" ? "Failed" : "In progress"}</Badge>
                  <Link href={`/cases/${id}/evidence/capture/${c.id}`} className="max-w-xl truncate text-blue-700 underline dark:text-blue-300">{c.url}</Link>
                  <span className="text-xs text-black/50 dark:text-white/50">{fmtDateTime(c.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <section>
        <form className="mb-3 flex flex-wrap gap-2" action={`/cases/${id}/evidence`}>
          <Select name="role" defaultValue={role ?? ""} className="w-40" aria-label="Role">
            <option value="">All roles</option>
            <option value="QUESTIONED">Questioned</option>
            <option value="KNOWN">Known</option>
          </Select>
          <Select name="candidate" defaultValue={candidateId ?? ""} className="w-44" aria-label="Candidate">
            <option value="">All candidates</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.pseudonym}</option>)}
          </Select>
          <Input name="q" defaultValue={q} placeholder="Author or title" className="max-w-52" aria-label="Search" />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="excluded" value="1" defaultChecked={showExcluded} /> Show excluded
          </label>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>

        {docs.length === 0 ? (
          <Card><p className="text-sm text-black/60 dark:text-white/60">No documents{role || candidateId || q ? " match" : " yet"}.</p></Card>
        ) : (
          <Table>
            <thead>
              <tr><th>Document</th><th>Role</th><th>Author</th><th>Date</th><th>Words</th><th>Status</th></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="max-w-md">
                    <Link href={`/cases/${id}/evidence/${d.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">{d.title ?? "Untitled"}</Link>
                    <div className="text-xs text-black/60 dark:text-white/60">{snippet(d.originalText, 110)}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    {d.role === "QUESTIONED" ? <Badge tone="amber">Questioned</Badge> : d.role === "KNOWN" ? <Badge tone="blue">{pseud.get(d.candidateId!) ?? "Known"}</Badge> : <Badge>Reference</Badge>}
                  </td>
                  <td className="text-xs">{d.authorLabel ?? "—"}</td>
                  <td className="whitespace-nowrap text-xs">{d.authoredAt ? fmtDateTime(d.authoredAt) : "—"}</td>
                  <td>{nf.format(d.wordCount)}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    {d.excluded && <Badge tone="red">Excluded</Badge>}
                    {d.duplicateOfId && <Badge tone="amber">Duplicate</Badge>}
                    {d._count.versions > 1 && <Badge>v{d._count.versions}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-black/60 dark:text-white/60">
            {total === 0 ? "" : `${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, total)} of ${nf.format(total)}`}
          </span>
          {page > 1 && <Link className={buttonClass("secondary")} href={qs({ page: String(page - 1) })}>Previous</Link>}
          {page * PAGE < total && <Link className={buttonClass("secondary")} href={qs({ page: String(page + 1) })}>Next</Link>}
        </div>
      </section>

      {files.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Files received</h2>
          <Table>
            <thead><tr><th>File</th><th>Size</th><th>SHA-256</th><th>Uploaded</th><th>Documents</th><th /></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td className="max-w-xs break-all">{f.filename}</td>
                  <td className="whitespace-nowrap text-xs">{fmtBytes(f.sizeBytes)}</td>
                  <td className="font-mono text-xs" title={f.sha256}>{f.sha256.slice(0, 16)}…</td>
                  <td className="text-xs">{fmtDateTime(f.uploadedAt)}<div className="text-black/50 dark:text-white/50">{uploaders.get(f.uploadedById)}</div></td>
                  <td>
                    {f._count.documents > 0 ? f._count.documents : a.can("document.upload") ? (
                      <Link href={`/cases/${id}/evidence/import/${f.id}`} className="text-blue-700 underline dark:text-blue-300">Import…</Link>
                    ) : "0"}
                  </td>
                  <td className="text-right">
                    <a href={`/api/cases/${id}/files/${f.id}`} className="text-xs text-blue-700 underline dark:text-blue-300">Download original</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}
