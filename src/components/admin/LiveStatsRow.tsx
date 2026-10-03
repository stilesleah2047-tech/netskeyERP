"use client";

import RadialGauge from "@/components/admin/RadialGauge";
import { ReconciliationRow } from "@/lib/types";

interface Props {
  reconciliation: ReconciliationRow[];
  totalSales: number;
  pendingMpesa: number;
}

/**
 * Three at-a-glance radial stats, recomputed on every poll cycle (the
 * dashboard re-fetches reconciliation + summary every few seconds), so
 * these rings genuinely animate toward new values as the day progresses
 * rather than being a static snapshot.
 */
export default function LiveStatsRow({ reconciliation, totalSales, pendingMpesa }: Props) {
  const countedRows = reconciliation.filter((r) => r.eveningPhysicalCount != null);
  const reconciledCount = countedRows.filter((r) => r.reconciledOk).length;
  const reconciliationRate = countedRows.length > 0 ? (reconciledCount / countedRows.length) * 100 : 0;

  const totalDispatched = reconciliation.reduce((s, r) => s + r.morningDispatched, 0);
  const totalSold = reconciliation.reduce((s, r) => s + r.totalSold, 0);
  const stockSoldRate = totalDispatched > 0 ? (totalSold / totalDispatched) * 100 : 0;

  const mpesaSuccessRate =
    totalSales + pendingMpesa > 0 ? (totalSales / (totalSales + pendingMpesa)) * 100 : 100;

  return (
    <div className="grid grid-cols-3 gap-3 rounded-xl2 bg-white p-4 shadow-soft">
      <RadialGauge
        value={reconciliationRate}
        label="Reconciled"
        sublabel={reconciledCount + "/" + countedRows.length + " branches"}
        color="stroke-confirm-500"
        size={104}
        strokeWidth={9}
      />
      <RadialGauge
        value={stockSoldRate}
        label="Stock sold"
        sublabel={totalSold + " of " + totalDispatched}
        color="stroke-flow-500"
        size={104}
        strokeWidth={9}
      />
      <RadialGauge
        value={mpesaSuccessRate}
        label="Payments cleared"
        sublabel={pendingMpesa + " pending"}
        color="stroke-cash-500"
        size={104}
        strokeWidth={9}
      />
    </div>
  );
}
