interface Props {
  percent: number;
  okbFormatted: string;
  isRefuelNeeded: boolean;
  compact?: boolean;
}

export function FuelBar({ percent, okbFormatted, isRefuelNeeded, compact }: Props) {
  const color = isRefuelNeeded
    ? 'bg-red-500'
    : percent < 40
    ? 'bg-amber-500'
    : 'bg-emerald-500';

  const textColor = isRefuelNeeded
    ? 'text-red-400'
    : percent < 40
    ? 'text-amber-400'
    : 'text-emerald-400';

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative h-1 flex-1 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${color} ${isRefuelNeeded ? 'animate-pulse' : ''}`}
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
        <span className={`font-mono text-[10px] tabular-nums ${textColor}`}>{percent}%</span>
      </div>
    );
  }

  const label = isRefuelNeeded ? 'CRITICAL' : percent < 40 ? 'DEGRADED' : 'NOMINAL';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">Gas Vitality</span>
        <span className={`font-mono font-semibold ${textColor}`}>{label}</span>
      </div>

      <div className="relative h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${color}`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
        {isRefuelNeeded && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-red-400/40 animate-pulse"
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-400">{okbFormatted} OKB</span>
        <span className="font-mono text-xs text-zinc-600">{percent}%</span>
      </div>
    </div>
  );
}
