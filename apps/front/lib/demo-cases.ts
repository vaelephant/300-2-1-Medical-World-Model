// Curated demo cases. Source of truth: ./demo-cases.json (validated by tests/test_demo_cases.py).
// Selected from the local synthetic cohort by baseline stage, recorded treatment and trajectory
// shape, not by prediction quality. See 项目文档/4-演示流程.md for provenance and the demo script.
import raw from "./demo-cases.json";

export type DemoCase = {
  patientId: string;
  title: string;
  stage: string;
  reason: string;
  focus: string;
  context: number;
  horizon: number;
  treatments: string[];
};

export type DemoCaseSource = {
  cohort: string;
  n_patients: number;
  selection: string;
  validation: string;
  doc: string;
};

export const demoCaseSource: DemoCaseSource = raw.source;
export const demoCases: DemoCase[] = raw.cases;

export const treatmentLabels: Record<string, string> = {
  none: "无治疗", ablation: "消融", resection: "切除", tace: "TACE", tare: "TARE",
  systemic: "系统治疗", transplant: "移植", palliative: "支持治疗", other: "其他",
};

export const demoFeatures = [
  { key: "tumor_size_cm", title: "肿瘤直径", unit: "cm" },
  { key: "afp", title: "AFP", unit: "ng/mL" },
  { key: "albumin", title: "白蛋白", unit: "g/L" },
  { key: "tbil", title: "总胆红素", unit: "μmol/L" },
] as const;
