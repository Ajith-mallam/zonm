import { signOutAction } from "@/lib/auth/actions";
import { Button } from "./ui";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction} className={className}>
      <Button type="submit" variant="ghost" className="w-full text-black/60 dark:text-white/60">
        Sign out
      </Button>
    </form>
  );
}
