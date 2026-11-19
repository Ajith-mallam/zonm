// Download an original evidence file, exactly as uploaded. The stored bytes
// are re-hashed and compared with the SHA-256 recorded at upload before
// anything is sent; a mismatch is refused and recorded as an integrity failure.
import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requestContextFrom } from "@/lib/auth/request-context";
import { getCurrentSession } from "@/lib/auth/session";
import { getCaseAccess } from "@/lib/case-access";
import { prisma } from "@/lib/db";
import { IntegrityError, readVerified } from "@/lib/evidence";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id: caseId, fileId } = await params;
  const s = await getCurrentSession();
  if (!s || !s.mfaVerified) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const a = await getCaseAccess(caseId); // 404 without case access
  const file = await prisma.sourceFile.findFirst({ where: { id: fileId, caseId } });
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ctx = requestContextFrom(req.headers);

  let bytes: Buffer;
  try {
    bytes = await readVerified(file);
  } catch (e) {
    await recordAudit(prisma, {
      action: "evidence.integrity_failure",
      actor: a.user,
      entityType: "SourceFile",
      entityId: file.id,
      caseId,
      ...ctx,
      details: { expectedSha256: file.sha256, error: e instanceof IntegrityError ? "hash mismatch" : "unreadable" },
    });
    return NextResponse.json({ error: "The stored file failed its integrity check. This has been recorded." }, { status: 500 });
  }

  await recordAudit(prisma, { action: "evidence.download", actor: a.user, entityType: "SourceFile", entityId: file.id, caseId, ...ctx, details: { sha256: file.sha256 } });
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      // Always a download, never rendered inline (uploaded content is untrusted).
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-Evidence-SHA256": file.sha256,
    },
  });
}
