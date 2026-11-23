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
  /** 服务端返回的默认报告路径（/api/v1/evaluations 的 report_file）。 */
  report_file?: string;
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

/** 文件大小：B / KB / MB / GB，缺失显示 —。 */
export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 本地化日期时间（产物 modified_at 是 UTC ISO 字符串）；非法/缺失显示 —。 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 从绝对/相对路径取文件名（报告列表用）。 */
export function baseName(path?: string | null): string {
  if (!path) return "—";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * 比较两个产物路径是否指向同一文件：允许「相对 vs 绝对」路径表示同一产物，
 * 但只接受完整的路径后缀匹配（避免仅 basename 相同造成误判）。
 */
export function samePath(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return true;
  return left.endsWith(right) || right.endsWith(left);
}
