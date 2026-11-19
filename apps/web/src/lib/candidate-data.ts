// Queries shared by candidate pages.
import { corpusSufficiency, type Sufficiency } from "./candidates";
import { prisma } from "./db";

/** Known writing per candidate: excluded documents do not count. */
export async function knownWriting(caseId: string): Promise<Map<string, Sufficiency>> {
  const rows = await prisma.document.groupBy({
    by: ["candidateId"],
    where: { caseId, role: "KNOWN", excluded: false, candidateId: { not: null } },
    _sum: { wordCount: true },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.candidateId!, corpusSufficiency(r._sum.wordCount ?? 0, r._count._all)]));
}

export const noWriting = corpusSufficiency(0, 0);
