"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchPatient, fetchPatients } from "@/lib/api";
import type { PatientSummary, PatientTrajectory } from "@/lib/types";

export default function PatientsPage() {
  const [list, setList] = useState<PatientSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [traj, setTraj] = useState<PatientTrajectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const patients = await fetchPatients(40);
        if (cancelled) return;
        setList(patients);
        if (patients[0]) setSelected(patients[0].patient_id);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await fetchPatient(selected);
        if (!cancelled) setTraj(t);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载轨迹失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Patients</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          合成 HCC 队列。选择患者查看随访时间轴，再进入 World Model 做预测。
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <ul className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border border-outline-variant/50 bg-surface-lowest p-2">
            {list.map((p) => (
              <li key={p.patient_id}>
                <button
                  type="button"
                  onClick={() => setSelected(p.patient_id)}
                  className={
                    selected === p.patient_id
                      ? "w-full rounded-md bg-primary-container px-3 py-2 text-left text-sm text-primary"
                      : "w-full rounded-md px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-low"
                  }
                >
                  <span className="font-medium">{p.patient_id}</span>
                  <span className="mt-0.5 block text-xs text-on-surface-variant">
                    BCLC {p.bclc_stage} · CP {p.child_pugh} · {p.n_visits} visits
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="space-y-4">
            {traj ? (
              <>
                <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium">{traj.patient.patient_id}</h2>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        {traj.patient.sex} · age {traj.patient.age_at_index} ·{" "}
                        {traj.patient.etiology} · index {traj.patient.diagnosis_date}
                      </p>
                    </div>
                    <Link
                      href={`/world-model?patient=${traj.patient.patient_id}`}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary"
                    >
                      Forecast
                    </Link>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Badge>BCLC {traj.patient.bclc_stage}</Badge>
                    <Badge>Child-Pugh {traj.patient.child_pugh}</Badge>
                    <Badge>synthetic</Badge>
                    <Badge>research_only</Badge>
                  </div>
                </div>

                <div className="overflow-auto rounded-lg border border-outline-variant/50 bg-surface-lowest">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-surface-low text-xs text-on-surface-variant">
                      <tr>
                        <th className="px-3 py-2 font-medium">Day</th>
                        <th className="px-3 py-2 font-medium">AFP</th>
                        <th className="px-3 py-2 font-medium">Tumor cm</th>
                        <th className="px-3 py-2 font-medium">Albumin</th>
                        <th className="px-3 py-2 font-medium">Treatment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traj.visits.map((v) => (
                        <tr
                          key={v.observation.visit_index}
                          className="border-t border-outline-variant/40"
                        >
                          <td className="px-3 py-2">
                            {v.observation.days_from_index}
                          </td>
                          <td className="px-3 py-2">
                            {v.observation.features.afp?.toFixed(1)}
                          </td>
                          <td className="px-3 py-2">
                            {v.observation.features.tumor_size_cm?.toFixed(2)}
                          </td>
                          <td className="px-3 py-2">
                            {v.observation.features.albumin?.toFixed(1)}
                          </td>
                          <td className="px-3 py-2 text-on-surface-variant">
                            {v.treatments[0]?.modality ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-on-surface-variant">选择左侧患者</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-surface-low px-1.5 py-0.5 text-on-surface-variant">
      {children}
    </span>
  );
}
