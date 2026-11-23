// /cohort 队列探索的纯函数与格式化工具（不依赖 React）。

import type { CohortPatient } from "@/lib/types";
import { treatmentLabels } from "@/lib/demo-cases";

export const BCLC_STAGES = ["0", "A", "B", "C", "D"] as const;
export const CHILD_PUGH_STAGES = ["A", "B", "C"] as const;

/** BCLC 分期颜色（复用现有 chart 变量，避免新增 CSS）。 */
export const BCLC_COLORS: Record<string, string> = {
  "0": "var(--chart-scenario-one)",
  A: "var(--chart-history)",
  B: "var(--chart-forecast)",
  C: "var(--chart-scenario-two)",
  D: "var(--chart-baseline)",
};

export function stageColor(stage?: string | null): string {
  return (stage && BCLC_COLORS[stage]) || "var(--chart-observed)";
}

export function treatmentLabel(modality?: string | null): string {
  if (!modality) return "—";
  return treatmentLabels[modality] ?? modality;
}

export type CohortFilters = {
  /** 空数组 = 全部。 */
  stages: string[];
  childPughs: string[];
  /** "all" 或具体治疗 modality。 */
  treatment: string;
  query: string;
  ageMin: string;
  ageMax: string;
};

export const DEFAULT_FILTERS: CohortFilters = {
  stages: [],
  childPughs: [],
  treatment: "all",
  query: "",
  ageMin: "",
  ageMax: "",
};

export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function formatNumber(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function formatDays(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 天`;
}

export function treatmentEventCount(patient: CohortPatient): number {
  const counts = patient.treatments ?? {};
  return Object.values(counts).reduce(
    (sum, count) => sum + (Number.isFinite(count) ? count : 0),
    0,
  );
}

export function patientHasProgression(patient: CohortPatient): boolean {
  const progression = patient.progression;
  if (!progression) return false;
  return progression.occurred === true || typeof progression.days_from_index === "number";
}

export function patientTreatmentEntries(patient: CohortPatient): Array<[string, number]> {
  return Object.entries(patient.treatments ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1]);
}

export function log10Afp(afp?: number | null): number | null {
  if (typeof afp !== "number" || !Number.isFinite(afp) || afp <= 0) return null;
  return Math.log10(afp);
}

function parseAge(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 客户端筛选：BCLC / Child-Pugh / 治疗 / ID 搜索 / 年龄范围（未填写的条件忽略）。 */
export function filterPatients(
  patients: CohortPatient[],
  filters: CohortFilters,
): CohortPatient[] {
  const query = filters.query.trim().toLowerCase();
  const ageMin = parseAge(filters.ageMin);
  const ageMax = parseAge(filters.ageMax);
  return patients.filter((patient) => {
    if (filters.stages.length > 0 && !filters.stages.includes(patient.bclc_stage ?? "")) {
      return false;
    }
    if (
      filters.childPughs.length > 0 &&
      !filters.childPughs.includes(patient.child_pugh ?? "")
    ) {
      return false;
    }
    if (filters.treatment !== "all") {
      const count = patient.treatments?.[filters.treatment] ?? 0;
      if (!Number.isFinite(count) || count <= 0) return false;
    }
    if (query && !patient.patient_id.toLowerCase().includes(query)) return false;
    if (ageMin !== null && !(typeof patient.age_at_index === "number" && patient.age_at_index >= ageMin)) {
      return false;
    }
    if (ageMax !== null && !(typeof patient.age_at_index === "number" && patient.age_at_index <= ageMax)) {
      return false;
    }
    return true;
  });
}

export type StageCount = { stage: string; count: number };

export function countStages(patients: CohortPatient[]): StageCount[] {
  const counts = new Map<string, number>();
  for (const patient of patients) {
    const stage = patient.bclc_stage ?? "未知";
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  const known: readonly string[] = BCLC_STAGES;
  const knownRows = BCLC_STAGES.filter((stage) => counts.has(stage)).map((stage) => ({
    stage,
    count: counts.get(stage) ?? 0,
  }));
  const otherRows = [...counts.entries()]
    .filter(([stage]) => !known.includes(stage))
    .map(([stage, count]) => ({ stage, count }));
  return [...knownRows, ...otherRows];
}

export type ScatterDatum = {
  id: string;
  x: number;
  y: number;
  afp: number;
  stage: string;
  childPugh: string;
};

/** 散点数据：x=基线肿瘤直径、y=log10(基线 AFP)；AFP<=0/缺失或肿瘤直径缺失不展示。 */
export function buildScatterData(patients: CohortPatient[]): ScatterDatum[] {
  const out: ScatterDatum[] = [];
  for (const patient of patients) {
    const tumor = patient.baseline?.tumor_size_cm;
    const afp = patient.baseline?.afp;
    if (typeof tumor !== "number" || !Number.isFinite(tumor)) continue;
    const y = log10Afp(afp);
    if (y === null || typeof afp !== "number") continue;
    out.push({
      id: patient.patient_id,
      x: tumor,
      y,
      afp,
      stage: patient.bclc_stage ?? "未知",
      childPugh: patient.child_pugh ?? "—",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 相似病例（kNN）：基线特征 z-score 距离，共同有效维度参与平均。
// ---------------------------------------------------------------------------

const KNN_FEATURES = [
  "tumor_size_cm",
  "afp_log1p",
  "albumin",
  "tbil",
  "age_at_index",
] as const;

type KnnFeature = (typeof KNN_FEATURES)[number];

function knnValue(patient: CohortPatient, feature: KnnFeature): number | null {
  if (feature === "age_at_index") {
    return typeof patient.age_at_index === "number" && Number.isFinite(patient.age_at_index)
      ? patient.age_at_index
      : null;
  }
  if (feature === "afp_log1p") {
    const afp = patient.baseline?.afp;
    return typeof afp === "number" && Number.isFinite(afp) && afp > 0
      ? Math.log1p(afp)
      : null;
  }
  const raw = patient.baseline?.[feature];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export type SimilarPatient = {
  patient: CohortPatient;
  /** 共同有效维度上的 z-score 均方根距离（越小越相似）。 */
  distance: number;
  sharedDims: number;
};

/**
 * 在「全队列」中按基线特征找相似病例（不是筛选子集，避免筛选后近邻不足）。
 * 每个特征在全队列上做 z-score；只对两位患者都有效的维度计算距离。
 */
export function findSimilarPatients(
  allPatients: CohortPatient[],
  targetId: string,
  limit = 3,
): SimilarPatient[] {
  const target = allPatients.find((patient) => patient.patient_id === targetId);
  if (!target) return [];

  const stats = new Map<KnnFeature, { mean: number; std: number }>();
  for (const feature of KNN_FEATURES) {
    const values = allPatients
      .map((patient) => knnValue(patient, feature))
      .filter((value): value is number => value !== null);
    if (values.length === 0) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    stats.set(feature, { mean, std: Math.sqrt(variance) || 1 });
  }

  const targetZ = new Map<KnnFeature, number>();
  for (const feature of KNN_FEATURES) {
    const stat = stats.get(feature);
    const value = knnValue(target, feature);
    if (stat && value !== null) targetZ.set(feature, (value - stat.mean) / stat.std);
  }

  const scored: SimilarPatient[] = [];
  for (const patient of allPatients) {
    if (patient.patient_id === targetId) continue;
    let sum = 0;
    let sharedDims = 0;
    for (const feature of KNN_FEATURES) {
      const stat = stats.get(feature);
      const targetValue = targetZ.get(feature);
      const value = knnValue(patient, feature);
      if (!stat || targetValue === undefined || value === null) continue;
      const z = (value - stat.mean) / stat.std;
      sum += (z - targetValue) ** 2;
      sharedDims += 1;
    }
    if (sharedDims < 2) continue;
    scored.push({ patient, distance: Math.sqrt(sum / sharedDims), sharedDims });
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, limit);
}

export type ProgressionBin = { label: string; count: number };

/** progression days 直方图（0–90 / 90–180 / 180–365 / 365+ 天）。 */
export function buildProgressionBins(days: number[]): ProgressionBin[] {
  const bins: Array<{ label: string; min: number; max: number; count: number }> = [
    { label: "0–90 天", min: 0, max: 90, count: 0 },
    { label: "90–180 天", min: 90, max: 180, count: 0 },
    { label: "180–365 天", min: 180, max: 365, count: 0 },
    { label: "365 天以上", min: 365, max: Infinity, count: 0 },
  ];
  for (const day of days) {
    if (!Number.isFinite(day)) continue;
    const bin = bins.find((item) => day >= item.min && day < item.max);
    if (bin) bin.count += 1;
  }
  return bins.map(({ label, count }) => ({ label, count }));
}
