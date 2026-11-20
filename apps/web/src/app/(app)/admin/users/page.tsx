import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { Badge, Button, PageHeader, Select, Table } from "@/components/ui";
import { FORCE_PASSWORD_CHANGE, MFA_REQUIRED } from "@/lib/auth/policy";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { isLocked } from "@/lib/security/password";
import { resetMfaAction, setRoleAction, setStatusAction, unlockAction } from "./actions";
import { CreateUserForm, ResetPasswordButton } from "./forms";

export const metadata = { title: "Users" };

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "Never");

export default async function UsersPage() {
  const { actor } = await requireSession();
  if (!can(actor, "user.manage")) redirect("/");
  const users = await prisma.user.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] });

  return (
    <>
      <PageHeader title="Users" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === actor.id;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-black/50 dark:text-white/50">{u.email}</div>
                  </td>
                  <td>
                    {self ? (
                      u.role
                    ) : (
                      <form action={setRoleAction} className="flex gap-1">
                        <input type="hidden" name="userId" value={u.id} />
                        <Select name="role" defaultValue={u.role} className="w-32 shrink-0 py-1 text-xs" aria-label={`Role for ${u.email}`}>
                          {Object.values(Role).map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </Select>
                        <Button variant="secondary" className="py-1 text-xs">Set</Button>
                      </form>
                    )}
                  </td>
                  <td className="space-x-1">
                    <Badge tone={u.status === "ACTIVE" ? "green" : "neutral"}>{u.status === "ACTIVE" ? "Active" : "Disabled"}</Badge>
                    {isLocked(u) && <Badge tone="red">Locked</Badge>}
                    {MFA_REQUIRED && !u.mfaEnabledAt && <Badge tone="amber">No MFA</Badge>}
                    {u.mustChangePassword && <Badge tone="blue">Temp password</Badge>}
                  </td>
                  <td className="whitespace-nowrap text-xs">{fmt(u.lastLoginAt)}</td>
                  <td>
                    {!self && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {isLocked(u) && (
                          <form action={unlockAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <Button variant="secondary" className="py-1 text-xs">Unlock</Button>
                          </form>
                        )}
                        <ResetPasswordButton userId={u.id} />
                        {MFA_REQUIRED && u.mfaEnabledAt && (
                          <form action={resetMfaAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <Button variant="secondary" className="py-1 text-xs">Reset MFA</Button>
                          </form>
                        )}
                        <form action={setStatusAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="status" value={u.status === "ACTIVE" ? "DISABLED" : "ACTIVE"} />
                          <Button variant={u.status === "ACTIVE" ? "danger" : "secondary"} className="py-1 text-xs">
                            {u.status === "ACTIVE" ? "Disable" : "Enable"}
                          </Button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <CreateUserForm rules={{ mfa: MFA_REQUIRED, forceChange: FORCE_PASSWORD_CHANGE }} />
      </div>
    </>
  );
}
