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
  beats_persistence_mae_ex_afp?: boolean;
  world_model?: Metrics;
  persistence?: Metrics;
  model_version?: string;
  note?: string;
  message?: string;
};

export type Metrics = { mae_mean?: number; mae_ex_afp?: number; mae_macro?: number; mae_per_feature?: Record<string, number>; rmse_per_feature?: Record<string, number> };
