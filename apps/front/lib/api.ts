import type {
  EvalReport,
  ForecastResponse,
  ModelMeta,
  PatientSummary,
  PatientTrajectory,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://127.0.0.1:8000";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function getApiBase() {
  return API_BASE;
}

export async function fetchHealth() {
  return getJson<{
    status: string;
    research_only: boolean;
    model_version: string;
    checkpoint: string;
  }>("/health");
}

export async function fetchPatients(limit = 500) {
  const data = await getJson<{ patients: PatientSummary[] }>(
    `/api/v1/patients?limit=${limit}`,
  );
  return data.patients;
}

export async function fetchPatient(id: string) {
  return getJson<PatientTrajectory>(`/api/v1/patients/${id}`);
}

export async function fetchForecast(patientId: string, horizon = 4, contextLen = 3) {
  return postJson<ForecastResponse>("/api/v1/forecast", {
    patient_id: patientId,
    horizon,
    context_len: contextLen,
  });
}

export async function fetchModelMeta() {
  return getJson<ModelMeta>("/api/v1/models");
}

export async function fetchEvaluations() {
  return getJson<EvalReport>("/api/v1/evaluations");
}

export async function fetchSimulation(patientId: string, horizon: number, contextLen: number, modality: string, dose: number) {
  return postJson<ForecastResponse>("/api/v1/simulate", {
    patient_id: patientId, horizon, context_len: contextLen,
    treatment_modality: modality, dose_intensity: dose,
  });
}
