import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Cases" };

export default async function HomePage() {
  const { actor } = await requireSession();
  // Administrators have no case access; send them to their own area.
  if (actor.role === "ADMIN") redirect("/admin/users");
  return (
    <>
      <PageHeader title="Cases" />
      <Card>
        <p className="text-sm text-black/60 dark:text-white/60">Case management (M2) is the next step in the build.</p>
      </Card>
    </>
  );
}
