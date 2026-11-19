import { SUFFICIENCY_LABEL, SUFFICIENCY_TONE, type Sufficiency } from "@/lib/candidates";
import { Badge } from "./ui";

const BAR = { none: "bg-black/20", insufficient: "bg-red-600", limited: "bg-amber-500", good: "bg-green-600" };
const nf = new Intl.NumberFormat("en-GB");

export function SufficiencyMeter({ s, compact = false }: { s: Sufficiency; compact?: boolean }) {
  return (
    <div className={compact ? "min-w-40" : ""}>
      <div className="mb-1 flex items-center gap-2">
        <Badge tone={SUFFICIENCY_TONE[s.level]}>{SUFFICIENCY_LABEL[s.level]}</Badge>
        <span className="text-xs text-black/60 dark:text-white/60">
          {nf.format(s.words)} words · {s.documents} {s.documents === 1 ? "document" : "documents"}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded bg-black/10 dark:bg-white/10"
        role="meter"
        aria-label="Known writing collected"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={s.percent}
      >
        <div className={`h-full ${BAR[s.level]}`} style={{ width: `${s.percent}%` }} />
      </div>
      {!compact && <p className="mt-1 text-xs text-black/60 dark:text-white/60">{s.message}</p>}
    </div>
  );
}
