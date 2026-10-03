"use client";

interface Props {
  cashTotal: number;
  mpesaTotal: number;
}

/**
 * Two-segment donut: cash and M-Pesa as arcs of a single ring, total
 * revenue in the center. Standard SVG multi-segment donut technique —
 * each segment is its own circle, same circumference, offset by the
 * previous segment's length via strokeDashoffset.
 */
export default function PaymentSplitDonut({ cashTotal, mpesaTotal }: Props) {
  const total = cashTotal + mpesaTotal;
  const size = 168;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const cashFraction = total > 0 ? cashTotal / total : 0;
  const mpesaFraction = total > 0 ? mpesaTotal / total : 0;
  const cashLength = cashFraction * circumference;
  const mpesaLength = mpesaFraction * circumference;

  return (
    <div className="rounded-xl2 bg-white p-4 shadow-soft">
      <h3 className="mb-3 font-display text-sm font-semibold text-depth-900">Payment split today</h3>
      <div className="flex items-center gap-5">
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={center} cy={center} r={radius} strokeWidth={strokeWidth} className="fill-none stroke-depth-100" />
            {total > 0 && (
              <>
                <circle
                  cx={center}
                  cy={center}
                  r={radius}
                  strokeWidth={strokeWidth}
                  className="fill-none stroke-cash-500 transition-all duration-700 ease-out"
                  strokeDasharray={`${cashLength} ${circumference - cashLength}`}
                  strokeDashoffset={0}
                />
                <circle
                  cx={center}
                  cy={center}
                  r={radius}
                  strokeWidth={strokeWidth}
                  className="fill-none stroke-confirm-500 transition-all duration-700 ease-out"
                  strokeDasharray={`${mpesaLength} ${circumference - mpesaLength}`}
                  strokeDashoffset={-cashLength}
                />
              </>
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-[11px] text-depth-500">Total</span>
            <span className="font-display text-base font-bold text-depth-900">
              {total >= 1000 ? (total / 1000).toFixed(1) + "k" : total.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-depth-700">
              <span className="h-2.5 w-2.5 rounded-full bg-cash-500" />
              Cash
            </div>
            <p className="font-mono text-sm text-depth-900">KES {cashTotal.toLocaleString()}</p>
            <p className="text-xs text-depth-400">{Math.round(cashFraction * 100)}%</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-depth-700">
              <span className="h-2.5 w-2.5 rounded-full bg-confirm-500" />
              M-Pesa
            </div>
            <p className="font-mono text-sm text-depth-900">KES {mpesaTotal.toLocaleString()}</p>
            <p className="text-xs text-depth-400">{Math.round(mpesaFraction * 100)}%</p>
          </div>
        </div>
      </div>
      {total === 0 && <p className="mt-2 text-center text-xs text-depth-400">No sales recorded yet today.</p>}
    </div>
  );
}
