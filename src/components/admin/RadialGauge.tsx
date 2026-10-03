"use client";

interface Props {
  value: number; // 0-100
  label: string;
  sublabel?: string;
  color?: string; // tailwind stroke class, e.g. "stroke-flow-500"
  size?: number;
  strokeWidth?: number;
}

/**
 * A single circular progress ring with a value in the center. Pure SVG —
 * no charting library needed for this. The stroke-dashoffset transition
 * is what gives it the "live" animated feel as polled data updates the
 * value prop every few seconds.
 */
export default function RadialGauge({
  value,
  label,
  sublabel,
  color = "stroke-flow-500",
  size = 128,
  strokeWidth = 10,
}: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const center = size / 2;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={strokeWidth}
            className="fill-none stroke-depth-100"
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className={"fill-none transition-all duration-700 ease-out " + color}
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: offset,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-xl font-bold text-depth-900">{Math.round(clamped)}%</span>
        </div>
      </div>
      <p className="mt-2 text-center text-xs font-medium text-depth-600">{label}</p>
      {sublabel && <p className="text-center text-[11px] text-depth-400">{sublabel}</p>}
    </div>
  );
}
