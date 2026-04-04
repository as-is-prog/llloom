interface ContextMeterProps {
  used: number;
  max: number;
}

export function ContextMeter({ used, max }: ContextMeterProps) {
  const ratio = Math.min(used / max, 1);
  const percent = Math.round(ratio * 100);
  const color =
    ratio < 0.5 ? 'bg-emerald-500' : ratio < 0.8 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="tabular-nums whitespace-nowrap">
        {used.toLocaleString()} / {max.toLocaleString()}
      </span>
    </div>
  );
}
