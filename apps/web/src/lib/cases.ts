// M2 case helpers.
import type { CaseStatus } from "@prisma/client";
import type { Tx } from "./db";

/**
 * Allocate the next case reference (ZN-YYYY-NNNN) atomically. The upsert takes
 * a row lock on the year's counter, so concurrent creations never collide.
 * Call inside the transaction that creates the case so a rollback releases the
 * number together with the case.
 */
export async function allocateCaseReference(tx: Tx, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const [row] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "CaseCounter" (year, last) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last = "CaseCounter".last + 1
    RETURNING last`;
  return formatCaseReference(year, row.last);
}

export function formatCaseReference(year: number, n: number): string {
  return `ZN-${year}-${String(n).padStart(4, "0")}`;
}

/** Allowed status transitions. Reopening a closed case goes back to OPEN. */
export const CASE_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  OPEN: ["IN_ANALYSIS", "CLOSED"],
  IN_ANALYSIS: ["OPEN", "UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["IN_ANALYSIS", "CLOSED"],
  CLOSED: ["OPEN", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}
