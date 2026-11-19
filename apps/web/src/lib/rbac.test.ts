import type { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canTransition, formatCaseReference } from "./cases";
import { can, canOnCase, casePermissions } from "./rbac";

const user = (role: Role, status: "ACTIVE" | "DISABLED" = "ACTIVE") => ({ id: "u", role, status });

describe("rbac", () => {
  it("gives admins user management but no case access", () => {
    expect(can(user("ADMIN"), "user.manage")).toBe(true);
    expect(canOnCase(user("ADMIN"), "LEAD", "case.read")).toBe(false);
  });

  it("gives supervisors oversight of every case", () => {
    expect(canOnCase(user("SUPERVISOR"), null, "case.read")).toBe(true);
    expect(canOnCase(user("SUPERVISOR"), null, "candidate.identity.write")).toBe(true);
    expect(can(user("SUPERVISOR"), "case.create")).toBe(true);
  });

  it("requires membership for analysts", () => {
    expect(canOnCase(user("ANALYST"), null, "case.read")).toBe(false);
    expect(canOnCase(user("ANALYST"), "ANALYST", "analysis.run")).toBe(true);
    expect(canOnCase(user("ANALYST"), "ANALYST", "case.team.manage")).toBe(false);
  });

  it("caps case permissions by system role even for a case lead", () => {
    // An analyst made LEAD still cannot write restricted identity data.
    expect(canOnCase(user("ANALYST"), "LEAD", "candidate.identity.write")).toBe(false);
    expect(canOnCase(user("ANALYST"), "LEAD", "analysis.run")).toBe(true);
    // An auditor on a team can only read.
    expect(casePermissions(user("AUDITOR"), "LEAD")).toEqual(["case.read"]);
  });

  it("restricts observers to reading", () => {
    expect(casePermissions(user("ANALYST"), "OBSERVER")).toEqual(["case.read"]);
    expect(canOnCase(user("REVIEWER"), "OBSERVER", "candidate.identity.read")).toBe(false);
  });

  it("lets reviewers review but not run analyses", () => {
    expect(canOnCase(user("REVIEWER"), "REVIEWER", "result.review")).toBe(true);
    expect(canOnCase(user("REVIEWER"), "REVIEWER", "analysis.run")).toBe(false);
  });

  it("denies everything to disabled users", () => {
    expect(can(user("ADMIN", "DISABLED"), "user.manage")).toBe(false);
    expect(canOnCase(user("SUPERVISOR", "DISABLED"), null, "case.read")).toBe(false);
  });
});

describe("cases", () => {
  it("formats references", () => {
    expect(formatCaseReference(2026, 42)).toBe("ZN-2026-0042");
  });

  it("enforces the status workflow", () => {
    expect(canTransition("OPEN", "IN_ANALYSIS")).toBe(true);
    expect(canTransition("OPEN", "UNDER_REVIEW")).toBe(false);
    expect(canTransition("ARCHIVED", "OPEN")).toBe(false);
  });
});
