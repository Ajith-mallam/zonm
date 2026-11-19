import type { RunStatus } from "@prisma/client";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCEEDED: "Finished",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const RUN_STATUS_TONE: Record<RunStatus, "neutral" | "blue" | "green" | "red" | "amber"> = {
  QUEUED: "neutral",
  RUNNING: "blue",
  SUCCEEDED: "green",
  FAILED: "red",
  CANCELLED: "neutral",
};

export const GRADE_LABEL = { strong: "Strong", moderate: "Moderate", limited: "Limited", inconclusive: "Inconclusive" } as const;
export const GRADE_TONE = { strong: "green", moderate: "blue", limited: "amber", inconclusive: "neutral" } as const;
/** Status icon so the grade never relies on colour alone. */
export const GRADE_ICON = { strong: "●●●", moderate: "●●○", limited: "●○○", inconclusive: "○○○" } as const;
