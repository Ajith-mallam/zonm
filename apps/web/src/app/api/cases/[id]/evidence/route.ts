// M4 upload: POST multipart/form-data with a "file" field. Stores the original
// bytes encrypted, records a SourceFile and redirects to the import preview.
// A plain HTML form posts here, so uploads work without JavaScript.
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requestContextFrom } from "@/lib/auth/request-context";
import { getCurrentSession } from "@/lib/auth/session";
import { CaseActionError, requireCasePermission } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { checkSignature, sourceTypeFor } from "@/lib/ingest/extract";
import { ExtractionError, MAX_UPLOAD_BYTES } from "@/lib/ingest/types";
import { writeEvidence } from "@/lib/storage";
import { sha256Hex } from "@/lib/text";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  TXT: "text/plain",
  WHATSAPP: "text/plain",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PDF: "application/pdf",
  CSV: "text/csv",
  JSON: "application/json",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/cases/${caseId}/evidence?error=${encodeURIComponent(error)}`, req.url), 303);

  // Same-origin check: route handlers do not get the CSRF protection server actions have.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "bad origin" }, { status: 403 });

  const s = await getCurrentSession();
  if (!s || !s.mfaVerified) return NextResponse.redirect(new URL("/login", req.url), 303);
  let access;
  try {
    access = await requireCasePermission(caseId, "document.upload");
  } catch (e) {
    if (e instanceof CaseActionError) return back(e.message);
    throw e;
  }

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) return back("The file is larger than 25 MB.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return back("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) return back("The file is larger than 25 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = file.name.replace(/[\\/]/g, "_").slice(0, 255) || "upload";

  let type;
  try {
    type = sourceTypeFor(filename, bytes.subarray(0, 8192));
    checkSignature(type, bytes); // a renamed file is refused before it is stored
  } catch (e) {
    if (e instanceof ExtractionError) return back(e.message);
    throw e;
  }

  const fileId = randomBytes(12).toString("hex");
  const sha256 = sha256Hex(bytes);
  const storagePath = await writeEvidence(caseId, fileId, bytes);
  const ctx = requestContextFrom(req.headers);
  await prisma.$transaction(async (tx) => {
    await tx.sourceFile.create({
      data: {
        id: fileId,
        caseId,
        filename,
        mimeType: MIME[type] ?? "application/octet-stream",
        sizeBytes: bytes.length,
        sha256,
        storagePath,
        scanStatus: "NOT_SCANNED", // no antivirus engine yet (open client item)
        uploadedById: access.user.id,
      },
    });
    await recordAudit(tx, {
      action: "evidence.upload",
      actor: access.user,
      entityType: "SourceFile",
      entityId: fileId,
      caseId,
      ...ctx,
      details: { sha256, sizeBytes: bytes.length, type },
    });
  });
  return NextResponse.redirect(new URL(`/cases/${caseId}/evidence/import/${fileId}`, req.url), 303);
}
