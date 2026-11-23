"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchEvaluations,
  fetchHealth,
  fetchModelMeta,
  getApiBase,
} from "@/lib/api";
import type { EvalReport, ModelMeta } from "@/lib/types";

export default function OverviewPage() {
  const [health, setHealth] = useState<string>("checking…");
  const [meta, setMeta] = useState<ModelMeta | null>(null);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await fetchHealth();
        if (cancelled) return;
        setHealth(h.status);
        const [m, e] = await Promise.all([fetchModelMeta(), fetchEvaluations()]);
        if (cancelled) return;
        setMeta(m);
        setEvalReport(e);
      } catch (err) {
        if (cancelled) return;
        setHealth("unreachable");
        setError(
          err instanceof Error
            ? err.message
            : "无法连接 API。请先启动 scripts/serve_api.py",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const beat = evalReport?.beats_persistence_mae_ex_afp;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-on-surface">
          Overview
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
          连接本地推理服务，查看模型版本与相对 Persistence 的合成数据评估。
          API：<code className="rounded bg-surface-low px-1">{getApiBase()}</code>
        </p>
      </section>

      {error ? (
        <div className="rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="API"
          value={health}
          tone={health === "ok" ? "ok" : "warn"}
        />
        <Stat
          label="Model version"
          value={meta?.model_version ?? "—"}
          tone="neutral"
        />
        <Stat
          label="Patients loaded"
          value={meta ? String(meta.n_patients_loaded) : "—"}
          tone="neutral"
        />
      </div>

      <section className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-5">
        <h2 className="text-sm font-medium text-on-surface">Evaluation snapshot</h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          主看 mae_ex_afp（去掉 AFP 原始尺度）；合成指标 ≠ 临床性能。
        </p>
        {evalReport?.available === false ? (
          <p className="mt-4 text-sm text-on-surface-variant">
            {evalReport.message ?? "无评估报告"}
          </p>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Metric
              name="beats_persistence_mae_ex_afp"
              value={beat == null ? "—" : beat ? "true" : "false"}
              ok={beat === true}
            />
            <Metric
              name="mae_ex_afp (WM / Persistence)"
              value={
                evalReport?.world_model?.mae_ex_afp != null
                  ? `${evalReport.world_model.mae_ex_afp.toFixed(2)} / ${evalReport.persistence?.mae_ex_afp?.toFixed(2) ?? "—"}`
                  : "—"
              }
            />
          </dl>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/patients"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary"
        >
          浏览患者
        </Link>
        <Link
          href="/world-model"
          className="rounded-md border border-outline-variant bg-surface-lowest px-4 py-2 text-sm font-medium text-on-surface"
        >
          打开 World Model
        </Link>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const valueClass =
    tone === "ok"
      ? "text-tertiary"
      : tone === "warn"
        ? "text-amber-700"
        : "text-on-surface";
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest px-4 py-3">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className={`mt-1 truncate font-medium ${valueClass}`}>{value}</p>
    </div>
  );
}

function Metric({
  name,
  value,
  ok,
}: {
  name: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="rounded-md bg-surface-low px-3 py-2">
      <dt className="text-xs text-on-surface-variant">{name}</dt>
      <dd
        className={`mt-0.5 text-sm font-medium ${ok ? "text-tertiary" : "text-on-surface"}`}
      >
        {value}
      </dd>
    </div>
  );
}
