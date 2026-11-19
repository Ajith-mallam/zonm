import type { CaseMemberRole, Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { allowedInStatus, canTransition, caseVisibilityWhere, formatCaseReference, reasonRequired, statusChangeAllowed } from "./cases";
import { casePermissions } from "./rbac";

const perms = (role: Role, member: CaseMemberRole | null) => new Set(casePermissions({ id: "u", role, status: "ACTIVE" }, member));

describe("case references and transitions", () => {
  it("formats references", () => {
    expect(formatCaseReference(2026, 42)).toBe("ZN-2026-0042");
    expect(formatCaseReference(2027, 12345)).toBe("ZN-2027-12345");
  });

  it("follows the status workflow", () => {
    expect(canTransition("OPEN", "IN_ANALYSIS")).toBe(true);
    expect(canTransition("OPEN", "UNDER_REVIEW")).toBe(false);
    expect(canTransition("CLOSED", "OPEN")).toBe(true);
    expect(canTransition("ARCHIVED", "OPEN")).toBe(false);
  });
});

describe("who may change status", () => {
  it("lets analysts move work forward but not close", () => {
    const p = perms("ANALYST", "ANALYST");
    expect(statusChangeAllowed(p, "OPEN", "IN_ANALYSIS")).toBe(true);
    expect(statusChangeAllowed(p, "IN_ANALYSIS", "UNDER_REVIEW")).toBe(true);
    expect(statusChangeAllowed(p, "IN_ANALYSIS", "CLOSED")).toBe(false);
  });

  it("lets leads and supervisors close, reopen and archive", () => {
    for (const p of [perms("ANALYST", "LEAD"), perms("SUPERVISOR", null)]) {
      expect(statusChangeAllowed(p, "UNDER_REVIEW", "CLOSED")).toBe(true);
      expect(statusChangeAllowed(p, "CLOSED", "OPEN")).toBe(true);
      expect(statusChangeAllowed(p, "CLOSED", "ARCHIVED")).toBe(true);
    }
  });

  it("lets reviewers return work but not close it", () => {
    const p = perms("REVIEWER", "REVIEWER");
    expect(statusChangeAllowed(p, "UNDER_REVIEW", "IN_ANALYSIS")).toBe(true);
    expect(statusChangeAllowed(p, "UNDER_REVIEW", "CLOSED")).toBe(false);
  });

  it("gives observers no status changes", () => {
    expect(statusChangeAllowed(perms("ANALYST", "OBSERVER"), "OPEN", "IN_ANALYSIS")).toBe(false);
  });

  it("requires reasons for decisive or backward moves", () => {
    expect(reasonRequired("IN_ANALYSIS", "CLOSED")).toBe(true);
    expect(reasonRequired("CLOSED", "OPEN")).toBe(true);
    expect(reasonRequired("UNDER_REVIEW", "IN_ANALYSIS")).toBe(true);
    expect(reasonRequired("OPEN", "IN_ANALYSIS")).toBe(false);
  });
});

describe("what case status allows", () => {
  it("makes archived cases read-only", () => {
    expect(allowedInStatus("ARCHIVED", "case.read")).toBe(true);
    expect(allowedInStatus("ARCHIVED", "case.note.write")).toBe(false);
    expect(allowedInStatus("ARCHIVED", "case.status.change")).toBe(false);
  });

  it("allows only notes and status decisions on closed cases", () => {
    expect(allowedInStatus("CLOSED", "case.note.write")).toBe(true);
    expect(allowedInStatus("CLOSED", "case.status.change")).toBe(true);
    expect(allowedInStatus("CLOSED", "document.upload")).toBe(false);
    expect(allowedInStatus("CLOSED", "case.task.write")).toBe(false);
  });

  it("allows everything on active cases", () => {
    expect(allowedInStatus("IN_ANALYSIS", "analysis.run")).toBe(true);
  });
});

describe("case visibility", () => {
  it("shows supervisors every case and members only their cases", () => {
    expect(caseVisibilityWhere({ id: "s", role: "SUPERVISOR" })).toEqual({});
    expect(caseVisibilityWhere({ id: "a", role: "ANALYST" })).toEqual({ members: { some: { userId: "a" } } });
    expect(caseVisibilityWhere({ id: "r", role: "AUDITOR" })).toEqual({ members: { some: { userId: "r" } } });
  });

  it("shows administrators and disabled users nothing", () => {
    expect(caseVisibilityWhere({ id: "x", role: "ADMIN" })).toEqual({ id: { in: [] } });
    expect(caseVisibilityWhere({ id: "x", role: "SUPERVISOR", status: "DISABLED" })).toEqual({ id: { in: [] } });
  });
});
