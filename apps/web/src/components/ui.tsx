// Shared UI primitives (Tailwind). Server-safe: no hooks here.
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, ...p }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-lg border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5", className)}
      {...p}
    />
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function Label({ className, ...p }: ComponentProps<"label">) {
  return <label className={cx("mb-1 block text-sm font-medium", className)} {...p} />;
}

const field =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-white/15 dark:bg-black/20";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(field, className)} {...p} />;
}

export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cx(field, className)} {...p} />;
}

export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cx(field, className)} {...p} />;
}

const variants = {
  primary: "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-700/50",
  secondary: "border border-black/15 bg-white hover:bg-black/5 dark:border-white/15 dark:bg-transparent dark:hover:bg-white/10",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "hover:bg-black/5 dark:hover:bg-white/10",
};

export function buttonClass(variant: keyof typeof variants = "primary", className?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
    variants[variant],
    className,
  );
}

export function Button({ variant, className, ...p }: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button className={buttonClass(variant, className)} {...p} />;
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const tones = {
    error: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
    info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
    success: "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "red" | "amber" | "blue" }) {
  const tones = {
    neutral: "bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/80",
    green: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  };
  return <span className={cx("inline-flex rounded px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
      <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_thead]:bg-black/[0.03] [&_tr]:border-b [&_tr]:border-black/5 dark:[&_thead]:bg-white/5 dark:[&_tr]:border-white/5">
        {children}
      </table>
    </div>
  );
}

export function GateShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold tracking-wide">ZONM NET</div>
          <h1 className="mt-1 text-sm text-black/60 dark:text-white/60">{title}</h1>
        </div>
        <Card>{children}</Card>
      </div>
    </main>
  );
}
