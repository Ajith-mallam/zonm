// Small server-rendered charts for analysis results. Built in HTML (no chart
// library): each mark carries a native tooltip (title) and an accessible name,
// and every chart sits next to a table with the same numbers.
import type { LanguageComposition } from "@/lib/analysis";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Horizontal bars for one measure (relative support). One series, so no
 * legend; the highlighted bar (the top candidate) takes the accent, the rest
 * stay muted. Bars are 16px thick, 4px rounded at the data end, square at the
 * baseline, with the value at the tip.
 */
export function SupportBars({ rows, label }: { rows: { name: string; value: number; highlight?: boolean }[]; label: string }) {
  return (
    <div role="img" aria-label={`${label}: ${rows.map((r) => `${r.name} ${pct(r.value)}`).join(", ")}`} className="space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[8rem_1fr] items-center gap-3 text-sm">
          <span className="truncate text-right text-black/70 dark:text-white/70" title={r.name}>{r.name}</span>
          <div className="flex items-center gap-2" title={`${r.name}: ${pct(r.value)} of the relative support`}>
            <div
              className="h-4 rounded-r-[4px]"
              style={{ width: `${Math.max(r.value * 100, 0.5)}%`, maxWidth: "calc(100% - 3rem)", background: r.highlight ? "var(--viz-1)" : "var(--viz-muted)" }}
            />
            <span className="text-xs tabular-nums text-black/70 dark:text-white/70">{pct(r.value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const LANGS = [
  { key: "crs", name: "Kreol", color: "var(--viz-1)" },
  { key: "en", name: "English", color: "var(--viz-2)" },
  { key: "fr", name: "French", color: "var(--viz-3)" },
] as const;

export function LanguageLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-black/70 dark:text-white/70" aria-hidden>
      {LANGS.map((l) => (
        <span key={l.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
          {l.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Tall segmented bar (one whole, split by language). 28px, 4px corners, 2px
 * surface gaps; the share prints inside a block only when it fits (>= 12%),
 * otherwise it stays in the tooltip and the table.
 */
export function LanguageBar({ name, comp }: { name: string; comp: LanguageComposition }) {
  const parts = LANGS.map((l) => ({ ...l, share: comp.proportions[l.key] ?? 0 })).filter((p) => p.share > 0);
  const label = `${name}: ${parts.map((p) => `${p.name} ${pct(p.share)}`).join(", ") || "no language-tagged words"}; code-mixing index ${comp.cmi.toFixed(1)}`;
  return (
    <div className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3 text-sm">
      <span className="truncate text-right text-black/70 dark:text-white/70" title={name}>{name}</span>
      <div role="img" aria-label={label} className="flex h-7 gap-[2px]">
        {parts.length === 0 && <div className="h-full w-full rounded bg-[var(--viz-track)]" title={label} />}
        {parts.map((p) => (
          <div
            key={p.key}
            className="flex h-full items-center rounded px-1.5 text-xs font-medium text-white"
            style={{ width: `${p.share * 100}%`, background: p.color }}
            title={`${name}: ${p.name} ${pct(p.share)}`}
          >
            {p.share >= 0.12 ? pct(p.share) : ""}
          </div>
        ))}
      </div>
      <span className="text-xs tabular-nums text-black/60 dark:text-white/60" title="Code-mixing index (0 = one language only)">CMI {comp.cmi.toFixed(1)}</span>
    </div>
  );
}
