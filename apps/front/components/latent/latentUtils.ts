// /latent 潜在空间页的纯函数与格式化工具。
// 注意：这些二维坐标是 encoder latent 的 PCA 投影，没有临床含义。

import type { LatentCohortPoint } from "@/lib/types";

export const LATENT_BCLC_ORDER = ["0", "A", "B", "C", "D"] as const;

/** 与 cohort 页一致的 BCLC 配色（复用现有 chart 变量，不新增 CSS）。 */
export const LATENT_BCLC_COLORS: Record<string, string> = {
  "0": "var(--chart-scenario-one)",
  A: "var(--chart-history)",
  B: "var(--chart-forecast)",
  C: "var(--chart-scenario-two)",
  D: "var(--chart-baseline)",
};

export function latentStageColor(stage?: string | null): string {
  return (stage && LATENT_BCLC_COLORS[stage]) || "var(--chart-observed)";
}

export function formatNumber(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function formatPercent(value?: number | null, digits = 1): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDays(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 天`;
}

export function formatSex(sex?: string | null): string {
  if (sex === "male") return "男";
  if (sex === "female") return "女";
  return "性别未知";
}

export function findCohortPoint(
  cohort: LatentCohortPoint[] | undefined,
  patientId?: string | null,
): LatentCohortPoint | null {
  if (!cohort || !patientId) return null;
  return cohort.find((point) => point.patient_id === patientId) ?? null;
}
