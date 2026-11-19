"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function CaseTabs({ base, tabs }: { base: string; tabs: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-black/10 text-sm dark:border-white/10" aria-label="Case sections">
      {tabs.map((t) => {
        const href = base + t.href;
        const active = t.href === "" ? path === base : path.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 ${active ? "border-blue-700 font-medium text-blue-700 dark:border-blue-300 dark:text-blue-300" : "border-transparent text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-xs text-black/40 dark:text-white/40">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
