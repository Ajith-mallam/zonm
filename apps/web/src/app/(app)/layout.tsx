import Link from "next/link";
import { SignOutButton } from "@/components/sign-out";
import { SHOW_TEST_MODE_BANNER } from "@/lib/auth/policy";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/rbac";

const ROLE_LABEL = { ADMIN: "Administrator", SUPERVISOR: "Supervisor", ANALYST: "Analyst", REVIEWER: "Reviewer", AUDITOR: "Auditor" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await requireSession();
  const nav = [
    { href: "/", label: "Cases", show: actor.role !== "ADMIN" },
    { href: "/audit", label: "Audit log", show: can(actor, "audit.read") },
    { href: "/admin/users", label: "Users", show: can(actor, "user.manage") },
  ].filter((n) => n.show);

  return (
    <div className="min-h-screen">
      {SHOW_TEST_MODE_BANNER && (
        <div role="status" className="bg-amber-400 px-4 py-1 text-center text-xs font-medium text-black">
          Test mode: two-step verification is switched off (AUTH_MFA_REQUIRED=false). Turn it back on before real use.
        </div>
      )}
      <header className="border-b border-black/10 bg-white dark:border-white/10 dark:bg-black/30">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-bold tracking-wide">ZONM NET</Link>
          <nav className="flex flex-1 gap-4 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/account/password" className="text-right leading-tight" title="Change password">
              <div>{user.name}</div>
              <div className="text-xs text-black/50 dark:text-white/50">{ROLE_LABEL[user.role]}</div>
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
