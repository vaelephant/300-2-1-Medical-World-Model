"use client";

import type { TreatmentResponseResponse } from "@/lib/types";
import {
  featureMaxAbsPct,
  featureMeta,
  formatDeltaWithUnit,
  formatIqr,
  formatSignedPct,
  heatCellStyle,
  modalityLabel,
  sortedModalities,
} from "@/components/treatment-response/treatmentResponseUtils";

/** 治疗响应热图：行=治疗类别（n_events 降序），列=特征；格内显示 median_pct 与 n_pairs。 */
export function TreatmentResponseHeatmap({
  response,
}: {
  response: TreatmentResponseResponse;
}) {
  const modalities = sortedModalities(response.modalities);
  const features = response.features ?? [];
  const maxAbs = Object.fromEntries(
    features.map((feature) => [feature, featureMaxAbsPct(modalities, feature)]),
  );

  return (
    <figure className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
      <figcaption className="mb-3">
        <span className="block text-sm font-medium">变化方向与幅度 · 热图</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          格内为治疗事件前后相邻随访的 median Δ%（上行）与可配对样本数 n_pairs（下行）。
          颜色只表示变化方向 / 幅度（负=蓝、正=红），不代表好 / 坏或治疗优劣：
          肿瘤直径下降与白蛋白上升的临床含义不同。缺失 / 0 样本显示 —。
        </span>
      </figcaption>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-1 text-sm">
          <caption className="sr-only">
            治疗类别 × 特征的治疗前后 median 变化百分比热图，含样本对数；颜色仅表示方向与幅度。
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left text-xs font-normal text-muted-foreground">
                治疗类别
              </th>
              {features.map((feature) => {
                const meta = featureMeta(feature);
                return (
                  <th
                    key={feature}
                    scope="col"
                    className="px-2 py-1 text-center text-xs font-normal text-muted-foreground"
                  >
                    {meta.label}
                    {meta.unit ? (
                      <span className="ml-1 text-[10px] text-muted-foreground/80">({meta.unit})</span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {modalities.map(({ key, data }) => (
              <tr key={key}>
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left text-sm font-medium">
                  <span className="block">{modalityLabel(key)}</span>
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {data.n_events ?? "—"} events · {data.n_patients ?? "—"} 人
                  </span>
                </th>
                {features.map((feature) => {
                  const stat = data.features?.[feature];
                  const meta = featureMeta(feature);
                  const pct = stat?.median_pct;
                  const title = `${modalityLabel(key)} · ${meta.label}：median Δ ${formatDeltaWithUnit(
                    stat?.median_delta,
                    stat?.unit ?? meta.unit,
                  )}；IQR ${formatIqr(stat)}；n_pairs ${stat?.n_pairs ?? "—"}；median ${formatSignedPct(pct, 1)}`;
                  return (
                    <td
                      key={feature}
                      style={heatCellStyle(pct, maxAbs[feature] ?? 0)}
                      className="rounded-md px-2 py-1.5 text-center align-middle"
                      title={title}
                    >
                      <span className="block text-sm font-medium tabular-nums">
                        {stat?.n_pairs ? formatSignedPct(pct, 0) : "—"}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        n={stat?.n_pairs ?? "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-sm"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--chart-scenario-one) 55%, var(--surface-lowest))",
            }}
          />
          负向变化（如 median_pct &lt; 0）
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-sm"
            style={{ backgroundColor: "var(--surface-low)" }}
          />
          无变化 / 无样本
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-sm"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--error) 55%, var(--surface-lowest))",
            }}
          />
          正向变化（如 median_pct &gt; 0）
        </li>
        <li>每列按该特征最大 |median_pct| 归一化透明度；颜色不代表好 / 坏。</li>
      </ul>
    </figure>
  );
}
