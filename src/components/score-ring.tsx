import { cn } from "@/lib/utils";
import { scoreStrokeClass, scoreTextClass } from "@/lib/score-style";

export function ScoreRing({ score }: { score: number }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 112 112" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="56"
          cy="56"
          r={radius}
          className="stroke-muted"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx="56"
          cy="56"
          r={radius}
          className={scoreStrokeClass(score)}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className={cn("text-3xl font-semibold tracking-tight tabular-nums", scoreTextClass(score))}>
            {score}
            <span className="text-base font-medium text-muted-foreground">%</span>
          </div>
          <div className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Fit
          </div>
        </div>
      </div>
    </div>
  );
}

export function Meter({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className={cn("h-full rounded-full", value >= 80 ? "bg-emerald-600 dark:bg-emerald-400" : value >= 65 ? "bg-amber-500 dark:bg-amber-400" : "bg-rose-600 dark:bg-rose-400")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
