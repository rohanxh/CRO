import type { Issue, Platform, Severity } from "@/lib/types";

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-critical/12 text-critical border-critical/35",
  high: "bg-high/12 text-high border-high/35",
  medium: "bg-medium/12 text-medium border-medium/35",
  low: "bg-low/12 text-low border-low/35",
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return <span className={`chip ${SEVERITY_STYLE[severity]}`}>{severity}</span>;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  both: "Desktop + Mobile",
};

export function PlatformChip({ platform }: { platform: Platform }) {
  return (
    <span className="chip border-ink-600 bg-ink-800 text-ink-300">
      {platform === "mobile" ? <MobileIcon /> : platform === "desktop" ? <DesktopIcon /> : <BothIcon />}
      {PLATFORM_LABEL[platform]}
    </span>
  );
}

export function MetaChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const tones = {
    neutral: "border-ink-600 bg-ink-800 text-ink-300",
    good: "border-good/30 bg-good/10 text-good",
    warn: "border-high/30 bg-high/10 text-high",
  };
  return (
    <span className={`chip ${tones[tone]}`}>
      <span className="text-ink-400 font-normal normal-case">{label}</span>
      {value}
    </span>
  );
}

export function EffortChip({ effort }: { effort: Issue["effort"] }) {
  const label = effort === "quick-win" ? "Quick win" : effort === "moderate" ? "Moderate" : "Significant";
  const tone =
    effort === "quick-win"
      ? "border-good/30 bg-good/10 text-good"
      : "border-ink-600 bg-ink-800 text-ink-300";
  return <span className={`chip ${tone}`}>{label}</span>;
}

function scoreColor(score: number) {
  if (score < 40) return "var(--color-critical)";
  if (score < 60) return "var(--color-high)";
  if (score < 80) return "var(--color-medium)";
  return "var(--color-good)";
}

export function ScoreDial({
  score,
  size = 132,
  label,
  sublabel,
}: {
  score: number;
  size?: number;
  label: string;
  sublabel?: string;
}) {
  const stroke = size >= 120 ? 10 : 7;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (score / 100) * circumference;
  const color = scoreColor(score);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-ink-700)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: "stroke-dasharray 900ms cubic-bezier(0.16,1,0.3,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-semibold tabular-nums leading-none"
            style={{ color, fontSize: size * 0.3 }}
          >
            {score}
          </span>
          {size >= 120 && <span className="text-[10px] uppercase tracking-widest text-ink-500 mt-1">/ 100</span>}
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs font-medium text-ink-200">{label}</div>
        {sublabel && <div className="text-[11px] text-ink-500">{sublabel}</div>}
      </div>
    </div>
  );
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--color-critical)",
  high: "var(--color-high)",
  medium: "var(--color-medium)",
  low: "var(--color-low)",
};

/** Bars show where the conversion damage concentrates, not a per-area grade. */
export function DamageBar({
  label,
  weight,
  count,
  worstSeverity,
}: {
  label: string;
  weight: number;
  count: number;
  worstSeverity: Severity | null;
}) {
  const color = worstSeverity ? SEVERITY_COLOR[worstSeverity] : "var(--color-good)";
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-xs text-ink-300">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${Math.max(weight, count > 0 ? 4 : 0)}%`, background: color }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-ink-400">
        {count === 0 ? "clear" : `${count} issue${count === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

export function DesktopIcon({ className = "size-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

export function MobileIcon({ className = "size-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

function BothIcon({ className = "size-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="1" y="5" width="14" height="10" rx="2" />
      <rect x="17" y="9" width="6" height="11" rx="2" />
    </svg>
  );
}
