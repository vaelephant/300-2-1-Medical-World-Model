// Overview 状态页使用的本地类型与格式化工具。
// 说明：/api/v1/evaluations 的字段比 lib/types.ts 里的 EvalReport 更全，
// 且 task-7 不允许改 lib/*，因此这里用本地类型描述并做展示计算。

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
  beats_persistence_mae?: boolean;
  beats_persistence_mae_macro?: boolean;
  beats_persistence_mae_ex_afp?: boolean;
  mae_improvement?: number;
  mae_macro_improvement?: number;
};

export type HealthResponse = {
  status?: string;
  research_only?: boolean;
  model_version?: string;
  checkpoint?: string;
};

export function formatMetric(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

/** 带符号差值（如「模型 − 基线」），避免把绝对差误当百分比。 */
export function formatSigned(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatMetric(Math.abs(value), digits)}`;
}

/** 模型 − 基线；任一侧缺失返回 null。 */
export function difference(model?: number | null, base?: number | null): number | null {
  if (
    model === undefined ||
    model === null ||
    base === undefined ||
    base === null ||
    !Number.isFinite(model) ||
    !Number.isFinite(base)
  ) {
    return null;
  }
  return model - base;
}

/** 读取 checkpoint config 子集字段，缺失时显示 —。 */
export function configValue(
  config: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = config?.[key];
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return formatMetric(value, 0);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
