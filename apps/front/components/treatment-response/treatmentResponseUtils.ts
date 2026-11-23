// /treatment-response 治疗响应矩阵的纯函数与格式化工具。
// 注意：这是治疗事件前后相邻随访的描述性变化，治疗非随机，不能解释为因果疗效。

import type {
  TreatmentResponseFeatureStat,
  TreatmentResponseModality,
} from "@/lib/types";
import { treatmentLabels } from "@/lib/demo-cases";

export const FEATURE_META: Record<string, { label: string; unit: string }> = {
  tumor_size_cm: { label: "肿瘤直径", unit: "cm" },
  afp: { label: "AFP", unit: "ng/mL" },
  albumin: { label: "白蛋白", unit: "g/L" },
  tbil: { label: "总胆红素", unit: "μmol/L" },
};

export function featureMeta(key: string): { label: string; unit: string } {
  return FEATURE_META[key] ?? { label: key, unit: "" };
}

export function modalityLabel(modality: string): string {
  return treatmentLabels[modality] ?? modality;
}

export function formatNumber(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function formatSignedNumber(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value), digits)}`;
}

export function formatSignedPct(value?: number | null, digits = 0): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value), digits)}%`;
}

export function formatDeltaWithUnit(
  value: number | null | undefined,
  unit?: string,
  digits = 2,
): string {
  const number = formatSignedNumber(value, digits);
  if (number === "—") return "—";
  return unit ? `${number} ${unit}` : number;
}

export function formatIqr(
  stat: TreatmentResponseFeatureStat | undefined,
  digits = 2,
): string {
  if (!stat) return "—";
  const q25 = stat.q25_delta;
  const q75 = stat.q75_delta;
  if (
    typeof q25 !== "number" ||
    typeof q75 !== "number" ||
    !Number.isFinite(q25) ||
    !Number.isFinite(q75)
  ) {
    return "—";
  }
  return `${formatNumber(q25, digits)} ~ ${formatNumber(q75, digits)}`;
}

export type SortedModality = { key: string; data: TreatmentResponseModality };

/** 治疗类别按 n_events 降序（缺失排最后）。 */
export function sortedModalities(
  modalities?: Record<string, TreatmentResponseModality>,
): SortedModality[] {
  return Object.entries(modalities ?? {})
    .map(([key, data]) => ({ key, data }))
    .sort((a, b) => (b.data.n_events ?? 0) - (a.data.n_events ?? 0));
}

/** 某特征列内 |median_pct| 最大值，用于热图列内归一化（0 表示无可比较值）。 */
export function featureMaxAbsPct(
  modalities: SortedModality[],
  featureKey: string,
): number {
  let max = 0;
  for (const { data } of modalities) {
    const pct = data.features?.[featureKey]?.median_pct;
    if (typeof pct === "number" && Number.isFinite(pct)) {
      max = Math.max(max, Math.abs(pct));
    }
  }
  return max;
}

const NEGATIVE_COLOR = "var(--chart-scenario-one)";
const POSITIVE_COLOR = "var(--error)";

/**
 * 热图单元格底色：负值=蓝、正值=红，透明度按该列 |median_pct| 最大值归一。
 * 颜色只表示变化方向/幅度，不代表好/坏。
 */
export function heatCellStyle(
  pct?: number | null,
  maxAbsPct = 0,
): { backgroundColor?: string } {
  if (pct === undefined || pct === null || !Number.isFinite(pct)) return {};
  if (maxAbsPct <= 0 || pct === 0) return { backgroundColor: "var(--surface-low)" };
  const ratio = Math.min(1, Math.abs(pct) / maxAbsPct);
  const strength = Math.round(12 + ratio * 55);
  const color = pct < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR;
  return {
    backgroundColor: `color-mix(in oklab, ${color} ${strength}%, var(--surface-lowest))`,
  };
}
