export type PatientSummary = {
  patient_id: string;
  sex: string;
  age_at_index: number;
  bclc_stage: string;
  child_pugh: string;
  n_visits: number;
  data_source: string;
  research_only: boolean;
};

export type Visit = {
  observation: {
    visit_index: number;
    days_from_index: number;
    delta_t_days: number;
    features: Record<string, number>;
    missing_mask: Record<string, boolean>;
  };
  treatments: Array<{
    days_from_index: number;
    modality: string;
    dose_intensity: number;
  }>;
  delta_t_days: number;
};

export type PatientTrajectory = {
  patient: {
    patient_id: string;
    sex: string;
    age_at_index: number;
    diagnosis_date: string;
    bclc_stage: string;
    child_pugh: string;
    etiology: string;
    data_source: string;
    research_only: boolean;
  };
  visits: Visit[];
  outcomes: unknown[];
  research_only?: boolean;
  data_source?: string;
};

export type ForecastResponse = {
  patient_id: string;
  model_version: string;
  data_source: string;
  research_only: boolean;
  prediction_horizon: number;
  context_len: number;
  uncertainty: null | unknown;
  history_days: number[];
  forecast_origin_day: number;
  step_days: number;
  simulation?: { applied: string; note: string };
  predictions: Array<{
    step: number;
    days_from_index: number;
    features: Record<string, number>;
  }>;
  note: string;
};

export type ModelMeta = {
  model_version: string;
  checkpoint: string;
  data_source: string;
  research_only: boolean;
  device: string;
  n_patients_loaded: number;
  config: Record<string, unknown>;
};

export type EvalReport = {
  n_patients?: number;
  data_source?: string;
  split?: string;
  rollout?: { context_len: number; horizons: Record<string, Metrics> };
  available?: boolean;
  research_only?: boolean;
  beats_persistence_mae?: boolean;
  beats_persistence_mae_macro?: boolean;
  beats_persistence_mae_ex_afp?: boolean;
  world_model?: Metrics;
  persistence?: Metrics;
  model_version?: string;
  checkpoint?: string;
  report_file?: string;
  mae_improvement?: number;
  mae_macro_improvement?: number;
  note?: string;
  message?: string;
};

export type Metrics = { mae_mean?: number; mae_ex_afp?: number; mae_macro?: number; rmse_mean?: number; n_valid?: number; mae_per_feature?: Record<string, number>; rmse_per_feature?: Record<string, number> };

/** 磁盘产物的存在性 / 大小 / 修改时间（/api/v1/training 内的 artifact_file）。 */
export type ArtifactFile = {
  path?: string | null;
  exists?: boolean;
  size_bytes?: number;
  modified_at?: string;
};

export type TrainingHistoryPoint = {
  epoch: number;
  train_loss: number;
  val_loss: number;
  /** 方向准确率（标准化空间，|真实变化| > direction_eps 的有效点上）。旧 train_meta 可能没有。 */
  train_acc?: number | null;
  val_acc?: number | null;
};

export type TrainingSplits = {
  n_train?: number | null;
  n_val?: number | null;
  n_test?: number | null;
};

export type TrainingInfo = {
  available: boolean;
  reason?: string;
  model_version?: string;
  checkpoint_path?: string;
  checkpoint?: ArtifactFile;
  train_meta?: ArtifactFile;
  best_val?: number | null;
  /** train_meta.json 里记录的 best_val，用于与 history 最小值核对。 */
  reported_best_val?: number | null;
  best_epoch?: number | null;
  epochs_trained?: number | null;
  splits?: TrainingSplits;
  device?: string | null;
  patience?: number | null;
  eval_report?: string | null;
  research_only?: boolean;
  beats_persistence?: { mae?: boolean | null; mae_macro?: boolean | null };
  test_mae?: {
    world_model?: number | null;
    persistence?: number | null;
    mae_macro_world_model?: number | null;
    mae_macro_persistence?: number | null;
  };
  note?: string;
  config?: Record<string, unknown>;
  data_manifest?: Record<string, unknown>;
  epochs_configured?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_sec?: number | null;
  num_workers?: number | null;
  torch_version?: string | null;
  history?: TrainingHistoryPoint[];
};

export type CheckpointEntry = {
  name: string;
  relative_path: string;
  path?: string;
  exists?: boolean;
  size_bytes?: number;
  modified_at?: string;
  is_current?: boolean;
};

export type CheckpointsResponse = {
  checkpoints: CheckpointEntry[];
  current_checkpoint?: string;
  models_dir?: string;
  research_only?: boolean;
};

export type ReportMetricsSummary = {
  mae_mean?: number;
  mae_macro?: number;
  mae_ex_afp?: number;
  n_valid?: number;
};

export type EvaluationReportSummary = {
  available?: boolean;
  reason?: string;
  report?: ArtifactFile;
  model_version?: string;
  checkpoint?: string;
  split?: string;
  n_patients?: number;
  data_source?: string;
  research_only?: boolean;
  beats_persistence_mae?: boolean;
  beats_persistence_mae_macro?: boolean;
  beats_persistence_mae_ex_afp?: boolean;
  world_model?: ReportMetricsSummary;
  persistence?: ReportMetricsSummary;
  note?: string;
};

export type EvaluationReportsResponse = {
  reports: EvaluationReportSummary[];
  reports_dir?: string;
  research_only?: boolean;
};

/** 训练中每 epoch 原子写出的 train_progress.json；无 progress 时由后端回退 train_meta。 */
export type TrainingLiveResponse = {
  available: boolean;
  source?: "progress" | "train_meta" | "none" | string;
  status?: "running" | "evaluating" | "finished" | "idle" | string;
  stalled?: boolean;
  stale_seconds?: number | null;
  stale_after_seconds?: number | null;
  history?: TrainingHistoryPoint[];
  epochs_configured?: number | null;
  epochs_trained?: number | null;
  best_val?: number | null;
  best_epoch?: number | null;
  config?: Record<string, unknown>;
  data_manifest?: {
    path?: string;
    exists?: boolean;
    n?: number | null;
    seed?: number | null;
    max_visits?: number | null;
    data_source?: string | null;
  };
  device?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_sec?: number | null;
  updated_at?: string | null;
  eval_report?: string | null;
  checkpoint?: string | null;
  last_checkpoint?: string | null;
  model_version?: string | null;
  checkpoint_changed_on_disk?: boolean;
  beats_persistence_mae?: boolean | null;
  beats_persistence_mae_macro?: boolean | null;
  beats_persistence_mae_ex_afp?: boolean | null;
  test_mae_ex_afp_wm?: number | null;
  test_mae_ex_afp_persistence?: number | null;
  progress_file?: ArtifactFile;
  train_meta?: TrainingInfo;
  message?: string;
};

export type ModelReloadResponse = {
  reloaded: boolean;
  changed?: boolean;
  previous_model_version?: string;
  model_version: string;
  checkpoint: string;
  message: string;
};

// ---------------------------------------------------------------------------
// Cohort exploration（/api/v1/cohort/summary）：全队列描述统计，不是风险模型输出。
// ---------------------------------------------------------------------------

export type CohortFeatureSnapshot = {
  tumor_size_cm?: number | null;
  afp?: number | null;
  albumin?: number | null;
  tbil?: number | null;
  tumor_number?: number | null;
};

export type CohortTreatmentEvent = {
  day?: number | null;
  modality?: string;
  dose_intensity?: number | null;
};

export type CohortOutcome = {
  event?: string;
  occurred?: boolean;
  days_from_index?: number | null;
};

export type CohortProgression = {
  event?: string;
  occurred?: boolean;
  days_from_index?: number | null;
};

export type CohortPatient = {
  patient_id: string;
  sex?: string;
  age_at_index?: number;
  bclc_stage?: string;
  child_pugh?: string;
  etiology?: string;
  diagnosis_date?: string;
  n_visits?: number;
  follow_up_days?: number | null;
  baseline?: CohortFeatureSnapshot;
  last?: CohortFeatureSnapshot;
  treatments?: Record<string, number>;
  n_treatments?: number;
  treatment_events?: CohortTreatmentEvent[];
  outcomes?: CohortOutcome[];
  progression?: CohortProgression | null;
};

export type CohortAggregate = {
  stage_counts?: Record<string, number>;
  child_pugh_counts?: Record<string, number>;
  treatment_event_counts?: Record<string, number>;
  outcome_event_counts?: Record<string, number>;
  n_with_progression?: number;
  progression_days?: number[];
};

export type CohortSummaryResponse = {
  available?: boolean;
  n_patients?: number;
  data_source?: string;
  research_only?: boolean;
  patients: CohortPatient[];
  aggregate?: CohortAggregate;
  note?: string;
  message?: string;
};

// ---------------------------------------------------------------------------
// Latent 潜在空间（/api/v1/latent/{patient_id}）：encoder latent 的 PCA 投影。
// 坐标为模型内部状态，无临床含义，不是生物标志物/风险预测。
// ---------------------------------------------------------------------------

export type LatentPca = {
  n_components?: number;
  /** 每个主成分的解释方差比例，例如 [0.285, 0.128]。 */
  explained_variance?: number[];
  n_patients?: number;
  note?: string;
};

export type LatentCohortPoint = {
  patient_id: string;
  bclc_stage?: string;
  child_pugh?: string;
  sex?: string;
  age_at_index?: number;
  n_visits?: number;
  last_day?: number | null;
  x: number;
  y: number;
};

export type LatentPoint = {
  step: number;
  day: number;
  x: number;
  y: number;
};

export type LatentResponse = {
  available?: boolean;
  patient_id?: string;
  research_only?: boolean;
  data_source?: string;
  horizon?: number;
  step_days?: number | null;
  pca?: LatentPca;
  cohort?: LatentCohortPoint[];
  observed?: LatentPoint[];
  forecast?: LatentPoint[];
  note?: string;
  message?: string;
};

// ---------------------------------------------------------------------------
// 治疗响应矩阵（/api/v1/treatment-response）：治疗事件前后相邻随访的描述性变化。
// 治疗非随机，前后差异不是因果疗效，不能用于排序治疗。
// ---------------------------------------------------------------------------

export type TreatmentResponseFeatureStat = {
  unit?: string;
  n_pairs?: number;
  median_delta?: number | null;
  q25_delta?: number | null;
  q75_delta?: number | null;
  median_pct?: number | null;
};

export type TreatmentResponseModality = {
  n_events?: number;
  n_patients?: number;
  median_interval_days?: number | null;
  features?: Record<string, TreatmentResponseFeatureStat>;
};

export type TreatmentResponseResponse = {
  available?: boolean;
  research_only?: boolean;
  data_source?: string;
  n_patients?: number;
  n_events?: number;
  features?: string[];
  modalities?: Record<string, TreatmentResponseModality>;
  note?: string;
  message?: string;
};
