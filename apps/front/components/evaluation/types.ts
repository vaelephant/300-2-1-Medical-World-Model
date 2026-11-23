// 评估报告与模型元数据的本地类型/计算工具。
// 说明：/api/v1/evaluations 返回的字段比 lib/types.ts 的 EvalReport 更全，
// 为避免修改 lib 并与 Lead 的其它改动冲突，这里用本地 FullEvalReport 描述。

export type FullMetrics = {
  mae_mean?: number;
  rmse_mean?: number;
  mae_macro?: number;
  mae_ex_afp?: number;
  mae_per_feature?: Record<string, number>;
  rmse_per_feature?: Record<string, number>;
  n_valid?: number;
};

export type FullEvalReport = {
  available?: boolean;
  message?: string;
  note?: string;
  research_only?: boolean;
  data_source?: string;
  model_version?: string;
  checkpoint?: string;
  split?: string;
  n_patients?: number;
  world_model?: FullMetrics;
  persistence?: FullMetrics;
  rollout?: {
    context_len?: number;
    horizons?: Record<string, FullMetrics>;
  };
  beats_persistence_mae?: boolean;
  beats_persistence_mae_macro?: boolean;
  beats_persistence_mae_ex_afp?: boolean;
  mae_improvement?: number;
  mae_macro_improvement?: number;
};

/** 报告中的特征 key → 中文名（与后端 FEATURE_KEYS 对齐）。 */
export const FEATURE_LABELS: Record<string, string> = {
  afp: "AFP",
  alt: "ALT",
  ast: "AST",
  tbil: "总胆红素",
  albumin: "白蛋白",
  inr: "INR",
  platelet: "血小板",
  creatinine: "肌酐",
  tumor_size_cm: "肿瘤直径",
  tumor_number: "肿瘤数目",
};

export function formatMetric(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

/** 带符号的差值：用于「模型 − 基线」等绝对差展示，避免把绝对差误当成百分比。 */
export function formatSigned(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  const text = formatMetric(Math.abs(value), digits);
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${text}`;
}

export type FeatureErrorRow = {
  key: string;
  label: string;
  model: number;
  base: number;
  ratio: number;
};

/** 从报告构建逐特征「模型 / Persistence MAE 比值」行；缺任一侧数据则跳过。 */
export function buildFeatureErrorRows(report: FullEvalReport): FeatureErrorRow[] {
  const modelPerFeature = report.world_model?.mae_per_feature ?? {};
  const basePerFeature = report.persistence?.mae_per_feature ?? {};
  return Object.entries(modelPerFeature)
    .map(([key, modelMae]) => {
      const baseMae = basePerFeature[key];
      if (!Number.isFinite(modelMae) || !Number.isFinite(baseMae) || baseMae <= 0) return null;
      return {
        key,
        label: FEATURE_LABELS[key] ?? key,
        model: modelMae,
        base: baseMae,
        ratio: modelMae / baseMae,
      } satisfies FeatureErrorRow;
    })
    .filter((row): row is FeatureErrorRow => row !== null);
}

export type RolloutPoint = {
  step: number;
  /** 该步报告中的 mae_mean（含 AFP）。 */
  maeMean: number | null;
  /** 由该步逐特征 MAE 中除 AFP 外的特征取均值重算（与汇总 mae_ex_afp 口径一致）。 */
  maeExAfp: number | null;
};

export function meanExcludingAfp(metrics?: FullMetrics): number | null {
  const perFeature = metrics?.mae_per_feature;
  if (!perFeature) return null;
  const values = Object.entries(perFeature)
    .filter(([key, value]) => key !== "afp" && Number.isFinite(value))
    .map(([, value]) => value);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildRolloutPoints(report: FullEvalReport): RolloutPoint[] {
  const horizons = report.rollout?.horizons ?? {};
  return Object.entries(horizons)
    .map(([step, metrics]) => ({
      step: Number(step),
      maeMean: Number.isFinite(metrics.mae_mean) ? metrics.mae_mean! : null,
      maeExAfp: meanExcludingAfp(metrics),
    }))
    .sort((a, b) => a.step - b.step);
}
