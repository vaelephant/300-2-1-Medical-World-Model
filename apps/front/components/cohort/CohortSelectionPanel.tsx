"use client";

import Link from "next/link";

import type { CohortPatient } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import {
  formatDays,
  formatNumber,
  patientTreatmentEntries,
  stageColor,
  treatmentLabel,
  type SimilarPatient,
} from "@/components/cohort/cohortUtils";

const METRICS = [
  { key: "tumor_size_cm", label: "肿瘤直径", unit: "cm" },
  { key: "afp", label: "AFP", unit: "ng/mL" },
  { key: "albumin", label: "白蛋白", unit: "g/L" },
  { key: "tbil", label: "总胆红素", unit: "μmol/L" },
] as const;

function snapshotValue(
  patient: CohortPatient,
  which: "baseline" | "last",
  key: (typeof METRICS)[number]["key"],
): string {
  const value = patient[which]?.[key];
  return formatNumber(value, key === "afp" ? 1 : 2);
}

function sexLabel(sex?: string): string {
  if (sex === "male") return "男";
  if (sex === "female") return "女";
  return "性别未知";
}

function StageChip({ stage }: { stage?: string }) {
  const label = stage ? `BCLC ${stage}` : "BCLC 未知";
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, ${stageColor(stage)} 18%, transparent)`,
        color: stageColor(stage),
      }}
    >
      {label}
    </span>
  );
}

/** 选中患者详情 + 全队列 kNN 相似病例。 */
export function CohortSelectionPanel({
  patient,
  similar,
  onSelect,
  scopeCount,
}: {
  patient: CohortPatient | null;
  similar: SimilarPatient[];
  onSelect: (patientId: string) => void;
  scopeCount: number;
}) {
  if (!patient) {
    return (
      <section className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-lowest p-4">
        <h2 className="text-sm font-medium">患者详情</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          当前筛选下没有患者；请在散点图中点击一个点，或调整筛选条件。
        </p>
      </section>
    );
  }

  const treatmentEntries = patientTreatmentEntries(patient);
  const progression = patient.progression;
  const hasProgression = Boolean(progression && progression.occurred === true);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section
        aria-label="选中患者详情"
        className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">当前选中患者</p>
            <h2 className="truncate font-mono text-lg font-semibold">{patient.patient_id}</h2>
          </div>
          <StageChip stage={patient.bclc_stage} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {sexLabel(patient.sex)} · {patient.age_at_index ?? "—"} 岁 · Child-Pugh{" "}
          {patient.child_pugh ?? "—"} · {patient.etiology ?? "—"} · 诊断日{" "}
          {patient.diagnosis_date ?? "—"}
        </p>

        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-surface-low p-2 text-xs">
          <div>
            <dt className="text-muted-foreground">随访次数</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums">{patient.n_visits ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">随访跨度</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums">
              {formatDays(patient.follow_up_days)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">治疗记录</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums">
              {patient.n_treatments ?? treatmentEntries.reduce((sum, [, count]) => sum + count, 0)} 次
            </dd>
          </div>
        </dl>

        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">
            选中患者的基线指标与末次观测指标对比
          </caption>
          <thead>
            <tr className="border-b border-outline-variant/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-2 font-normal">指标</th>
              <th scope="col" className="py-1 pr-2 font-normal">基线</th>
              <th scope="col" className="py-1 font-normal">末次观测</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric) => (
              <tr key={metric.key} className="border-b border-outline-variant/30 last:border-0">
                <th scope="row" className="py-1 pr-2 text-left font-normal text-on-surface-variant">
                  {metric.label}
                  <span className="ml-1 text-[10px] text-muted-foreground">{metric.unit}</span>
                </th>
                <td className="py-1 pr-2 tabular-nums">
                  {snapshotValue(patient, "baseline", metric.key)}
                </td>
                <td className="py-1 tabular-nums">{snapshotValue(patient, "last", metric.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 space-y-1.5 text-xs">
          <p>
            <span className="text-muted-foreground">Progression：</span>
            {hasProgression ? (
              <span>
                {progression?.event ?? "progression"} · Day{" "}
                {formatNumber(progression?.days_from_index, 0)}
              </span>
            ) : (
              <span className="text-muted-foreground">无 progression 记录（或未发生）</span>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">治疗记录：</span>
            {treatmentEntries.length > 0 ? (
              treatmentEntries.map(([modality, count]) => (
                <span
                  key={modality}
                  className="rounded-sm bg-surface-low px-1.5 py-0.5"
                >
                  {treatmentLabel(modality)} × {count}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">无</span>
            )}
          </p>
          <p className="text-muted-foreground">治疗记录是访视中的记录次数，不表示持续用药或疗效。</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/world-model?patient=${encodeURIComponent(patient.patient_id)}`}
            className={buttonVariants({ size: "sm" })}
          >
            用此患者做预测
          </Link>
          <Link href="/patients" className={buttonVariants({ variant: "outline", size: "sm" })}>
            去患者病程
          </Link>
        </div>
      </section>

      <section
        aria-label="相似病例"
        className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
      >
        <h2 className="text-sm font-medium">相似病例（kNN）</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          口径：在「当前筛选结果」（{scopeCount} 位；默认 = 全队列）内，用基线肿瘤直径 /
          log1p(AFP) / 白蛋白 / 总胆红素 / 年龄做 z-score 距离，只用双方都有效的维度求均方根，
          取最近 3 个（排除自己）。仅辅助选例，不是相似疗效或预后判断。
        </p>
        {similar.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {similar.map(({ patient: neighbor, distance, sharedDims }) => (
              <li key={neighbor.patient_id}>
                <button
                  type="button"
                  onClick={() => onSelect(neighbor.patient_id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-outline-variant/60 bg-surface-lowest px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-surface-low focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`选中相似病例 ${neighbor.patient_id}，z-score 距离 ${distance.toFixed(3)}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs font-medium">
                      {neighbor.patient_id}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      BCLC {neighbor.bclc_stage ?? "—"} · Child-Pugh {neighbor.child_pugh ?? "—"} ·{" "}
                      {neighbor.age_at_index ?? "—"} 岁
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                    <span className="block tabular-nums">d = {distance.toFixed(3)}</span>
                    <span className="block">{sharedDims} 维共同有效</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {scopeCount <= 1
              ? `当前筛选结果只有 ${scopeCount} 位患者，无法计算相似病例。`
              : "当前选中患者缺少可比较的基线特征，或筛选结果中没有足够近邻，未计算相似病例。"}
          </p>
        )}
      </section>
    </div>
  );
}
