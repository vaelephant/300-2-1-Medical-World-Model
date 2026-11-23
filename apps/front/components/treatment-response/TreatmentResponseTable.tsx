"use client";

import type { TreatmentResponseResponse } from "@/lib/types";
import {
  featureMeta,
  formatDeltaWithUnit,
  formatIqr,
  formatNumber,
  formatSignedPct,
  modalityLabel,
  sortedModalities,
} from "@/components/treatment-response/treatmentResponseUtils";

/** 明细表：治疗类别样本量、中位间隔，以及逐特征 median Δ + IQR + median_pct。 */
export function TreatmentResponseTable({
  response,
}: {
  response: TreatmentResponseResponse;
}) {
  const modalities = sortedModalities(response.modalities);
  const features = response.features ?? [];

  return (
    <section aria-label="治疗响应明细表" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">明细表</h2>
        <p className="text-xs text-muted-foreground">
          median Δ = 治疗事件前后相邻随访的变化；IQR = q25 ~ q75；小数位 2 位。
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-outline-variant/50 bg-surface-lowest">
        <table className="w-full min-w-[1080px] text-sm">
          <caption className="border-b border-outline-variant/50 px-3 py-2 text-left text-xs text-muted-foreground">
            事件前后各取相邻随访计算配对变化；缺失特征不参与该特征统计。治疗非随机，
            前后变化不能解释为因果疗效，也不用于排序治疗。
          </caption>
          <thead>
            <tr className="border-b border-outline-variant/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-normal">
                治疗类别
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                事件数
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                患者数
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                中位间隔（天）
              </th>
              {features.map((feature) => {
                const meta = featureMeta(feature);
                return (
                  <th key={feature} scope="col" className="px-3 py-2 font-normal">
                    {meta.label}
                    {meta.unit ? (
                      <span className="ml-1 text-[10px] text-muted-foreground/80">
                        ({meta.unit})
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {modalities.map(({ key, data }) => (
              <tr key={key} className="border-b border-outline-variant/30 last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {modalityLabel(key)}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(data.n_events, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(data.n_patients, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(data.median_interval_days, 1)}
                </td>
                {features.map((feature) => {
                  const stat = data.features?.[feature];
                  const meta = featureMeta(feature);
                  return (
                    <td key={feature} className="px-3 py-2 align-top">
                      <span className="block font-medium tabular-nums">
                        {formatDeltaWithUnit(
                          stat?.median_delta,
                          stat?.unit ?? meta.unit,
                        )}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        IQR {formatIqr(stat)}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        中位 {formatSignedPct(stat?.median_pct, 0)} · n={stat?.n_pairs ?? "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
