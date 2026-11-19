// F12.3 integrity verification endpoint.
// GET /api/audit/verify[?from=1&to=500] -> chain report as JSON.
import { NextResponse, type NextRequest } from "next/server";
import { recordAudit, verifyAuditChain } from "@/lib/audit";
import { requestContextFrom } from "@/lib/auth/request-context";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const seqParam = (v: string | null) => (v && /^\d+$/.test(v) ? BigInt(v) : null);

export async function GET(req: NextRequest) {
  const s = await getCurrentSession();
  if (!s || !s.mfaVerified) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!can(s.actor, "audit.verify")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const from = seqParam(req.nextUrl.searchParams.get("from")) ?? 1n;
  const to = seqParam(req.nextUrl.searchParams.get("to"));
  const report = await verifyAuditChain(from, to);
  await recordAudit(prisma, {
    action: "audit.verify",
    actor: s.user,
    ...requestContextFrom(req.headers),
    details: { from: from.toString(), to: to?.toString() ?? null, intact: report.intact, problems: report.problems.length },
  });

  return NextResponse.json({
    intact: report.intact,
    checkedFrom: report.checkedFrom.toString(),
    checkedTo: report.checkedTo?.toString() ?? null,
    head: report.head && { seq: report.head.seq.toString(), hash: report.head.hash, at: report.head.at.toISOString() },
    problems: report.problems.map((p) => ({ seq: p.seq.toString(), problem: p.problem })),
    verifiedAt: report.verifiedAt.toISOString(),
  });
}
