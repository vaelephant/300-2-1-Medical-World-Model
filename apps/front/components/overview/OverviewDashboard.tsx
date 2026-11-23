"use client";

import Link from "next/link";

import type { ModelMeta } from "@/lib/types";
import { demoCases } from "@/lib/demo-cases";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  configValue,
  difference,
  formatMetric,
  formatSigned,
  type FullEvalReport,
  type HealthResponse,
} from "@/components/overview/types";

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-on-surface">{title}</h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm text-on-surface",
          mono && "break-all font-mono text-xs",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function StatusBadge({
  tone,
  label,
}: {
  tone: "ok" | "bad" | "neutral";
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone === "ok" && "border-tertiary/40 bg-tertiary-container/60 text-tertiary",
        tone === "bad" && "border-error/40 bg-error-container/50 text-error",
        tone === "neutral" &&
          "border-outline-variant bg-surface-low text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-1.5 rounded-full",
          tone === "ok" ? "bg-tertiary" : tone === "bad" ? "bg-error" : "bg-outline",
        )}
      />
      {label}
    </span>
  );
}

function BeatBadge({ label, beats }: { label: string; beats?: boolean }) {
  const state = beats === true ? "ok" : beats === false ? "bad" : "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        state === "ok" && "border-tertiary/40 bg-tertiary-container/60 text-tertiary",
        state === "bad" && "border-error/40 bg-error-container/50 text-error",
        state === "neutral" &&
          "border-outline-variant bg-surface-low text-muted-foreground",
      )}
    >
      <span aria-hidden="true">
        {beats === true ? "✓" : beats === false ? "✕" : "?"}
      </span>
      <span className="font-medium">{label}</span>
      <span className="text-[0.65rem]">
        {beats === true ? "优于" : beats === false ? "未优于" : "未提供"}
      </span>
    </span>
  );
}

function ModelCardSection({
  meta,
  metaError,
  report,
}: {
  meta: ModelMeta | null;
  metaError: string | null;
  report: FullEvalReport | null;
}) {
  const modelVersion = meta?.model_version ?? report?.model_version ?? "—";
  const checkpoint = meta?.checkpoint ?? report?.checkpoint;
  const versionMismatch = Boolean(
    meta?.model_version &&
      report?.model_version &&
      meta.model_version !== report.model_version,
  );
  const researchOnly = report?.research_only ?? meta?.research_only;

  return (
    <Panel
      title="模型卡"
      description="checkpoint、推理设备与模型配置；字段来自 /api/v1/models 与评估报告。"
    >
      {metaError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>模型元数据不可用</AlertTitle>
          <AlertDescription>
            {metaError}。下方 provenance 字段显示为 —，但不影响推理服务与评估快照的展示。
          </AlertDescription>
        </Alert>
      ) : null}
      {versionMismatch ? (
        <Alert className="mb-4">
          <AlertTitle>评估报告版本与当前服务不一致</AlertTitle>
          <AlertDescription>
            报告版本 {report?.model_version} ≠ 推理服务版本 {meta?.model_version}
            ，报告可能对应旧权重；请以同一次训练 / 评估产物为准。
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <Field label="模型版本">{modelVersion}</Field>
        <Field label="Checkpoint" mono>
          <span title={checkpoint ?? undefined}>{checkpoint ?? "—"}</span>
        </Field>
        <Field label="推理设备">{meta?.device ?? "—"}</Field>
        <Field label="已加载队列患者数（非测试集）">
          {formatMetric(meta?.n_patients_loaded, 0)}
        </Field>
        <Field label="数据来源">
          {report?.data_source ?? meta?.data_source ?? "—"}
        </Field>
        <Field label="研究用途标记">
          {researchOnly === false ? "—" : "research_only（非临床）"}
        </Field>
      </dl>

      <div className="mt-4 border-t border-outline-variant/50 pt-4">
        <p className="text-xs text-muted-foreground">
          训练 / 模型配置（来自 checkpoint config 子集）
        </p>
        <dl className="mt-2 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <Field label="hidden_dim">{configValue(meta?.config, "hidden_dim")}</Field>
          <Field label="latent_dim">{configValue(meta?.config, "latent_dim")}</Field>
          <Field label="residual">{configValue(meta?.config, "residual")}</Field>
          <Field label="max_visits">{configValue(meta?.config, "max_visits")}</Field>
        </dl>
      </div>
    </Panel>
  );
}

function EvaluationSection({
  report,
  reportError,
  loading,
}: {
  report: FullEvalReport | null;
  reportError: string | null;
  loading: boolean;
}) {
  const evaluationLink = (
    <Link href="/evaluation" className={buttonVariants({ variant: "outline" })}>
      查看完整训练结果与图表
    </Link>
  );

  if (reportError) {
    return (
      <Panel title="评估快照" description="单份评估报告（reports/*.json）的摘要。">
        <Alert variant="destructive">
          <AlertTitle>评估报告读取失败</AlertTitle>
          <AlertDescription>{reportError}</AlertDescription>
        </Alert>
        <div className="mt-4">{evaluationLink}</div>
      </Panel>
    );
  }

  if (!report) {
    return (
      <Panel title="评估快照" description="单份评估报告（reports/*.json）的摘要。">
        <p role="status" className="text-sm text-muted-foreground">
          {loading ? "正在读取评估报告…" : "暂无评估报告。"}
        </p>
      </Panel>
    );
  }

  if (report.available === false) {
    return (
      <Panel title="评估快照" description="单份评估报告（reports/*.json）的摘要。">
        <Alert>
          <AlertTitle>暂无评估报告</AlertTitle>
          <AlertDescription>
            {report.message ??
              "推理服务未返回可用评估报告（reports/*.json）。页面不会用占位数字代替。"}
          </AlertDescription>
        </Alert>
        <div className="mt-4">{evaluationLink}</div>
      </Panel>
    );
  }

  const worldModel = report.world_model;
  const persistence = report.persistence;
  const maeDelta = difference(worldModel?.mae_mean, persistence?.mae_mean);
  const macroDelta = difference(worldModel?.mae_macro, persistence?.mae_macro);
  const exAfpDelta = difference(worldModel?.mae_ex_afp, persistence?.mae_ex_afp);

  return (
    <Panel title="评估快照" description="单份评估报告（reports/*.json）的摘要。">
      <p className="text-sm text-muted-foreground">
        {report.split ?? "—"} · 测试集 {report.n_patients ?? "—"} 位患者 ·{" "}
        {report.data_source ?? "—"}
        <span className="ml-1 text-xs">
          （测试集患者数与上方「已加载队列患者数」含义不同）
        </span>
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="相对 Persistence 的三项判定">
        <BeatBadge label="含 AFP" beats={report.beats_persistence_mae} />
        <BeatBadge label="宏平均" beats={report.beats_persistence_mae_macro} />
        <BeatBadge label="排除 AFP" beats={report.beats_persistence_mae_ex_afp} />
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-surface-low px-3 py-2">
          <dt className="text-xs text-muted-foreground">MAE（排除 AFP）</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            世界模型 {formatMetric(worldModel?.mae_ex_afp)} / Persistence{" "}
            {formatMetric(persistence?.mae_ex_afp)}
          </dd>
          <dd className="mt-0.5 text-xs text-muted-foreground">
            模型 − 基线：{formatSigned(exAfpDelta)}（负数表示模型误差更小）
          </dd>
        </div>
        <div className="rounded-md bg-surface-low px-3 py-2">
          <dt className="text-xs text-muted-foreground">MAE 绝对差（模型 − 基线）</dt>
          <dd className="mt-0.5 tabular-nums">
            含 AFP：<span className="font-medium">{formatSigned(maeDelta)}</span>
          </dd>
          <dd className="mt-0.5 tabular-nums">
            宏平均：<span className="font-medium">{formatSigned(macroDelta)}</span>
          </dd>
          <dd className="mt-0.5 text-xs text-muted-foreground">
            正数表示模型误差更大；这是原始 MAE 单位的绝对差，不是百分比。
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {evaluationLink}
        <p className="text-xs text-muted-foreground">
          技术指标仅作工程诊断；数据来源与 research_only 以 API 为准，合成指标 ≠ 临床性能。
        </p>
      </div>
    </Panel>
  );
}

function ServiceSection({
  health,
  healthError,
  apiBase,
  loading,
}: {
  health: HealthResponse | null;
  healthError: string | null;
  apiBase: string;
  loading: boolean;
}) {
  const ok = health?.status?.toLowerCase() === "ok";
  const badgeLabel = ok
    ? `运行中 · ${health?.status}`
    : healthError
      ? "不可达"
      : loading
        ? "检查中…"
        : "未知";

  return (
    <Panel title="推理服务" description="/health 健康检查与 API 接入信息。">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={ok ? "ok" : healthError ? "bad" : "neutral"} label={badgeLabel} />
        {health?.research_only ? (
          <span className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-warning">
            RESEARCH ONLY
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Field label="API base" mono>
          <span title={apiBase}>{apiBase}</span>
        </Field>
        <Field label="健康检查模型版本">{health?.model_version ?? "—"}</Field>
        <Field label="服务加载的 checkpoint" mono>
          <span title={health?.checkpoint ?? undefined}>
            {health?.checkpoint ?? "—"}
          </span>
        </Field>
        <Field label="research_only">
          {health?.research_only === false ? "—" : health ? "true（非临床）" : "—"}
        </Field>
      </dl>

      {healthError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>连接本地推理服务失败</AlertTitle>
          <AlertDescription>
            <p>
              确认 API 已启动、端口一致，且前端 `.env.local` 的
              `NEXT_PUBLIC_API_BASE` 指向该地址（当前 {apiBase}）。
            </p>
            <code className="mt-2 block break-all rounded bg-surface-low px-2 py-1.5 font-mono text-xs">
              PYTHONPATH=. python scripts/serve_api.py --device cpu --port 8000
            </code>
            <p className="mt-2">错误：{healthError}</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </Panel>
  );
}

const QUICK_LINKS = [
  {
    href: "/world-model",
    label: "病程预测",
    hint: "选病例 → 定起点 → 运行模型 → 看指标图",
  },
  {
    href: "/patients",
    label: "患者病程",
    hint: "浏览数据集轨迹、治疗时间轴与随访",
  },
  {
    href: "/simulation",
    label: "治疗情景",
    hint: "同起点比较 2–3 个未来治疗条件",
  },
  {
    href: "/evaluation",
    label: "模型评估",
    hint: "完整训练结果、逐特征误差与 rollout",
  },
];

function QuickLinksSection() {
  return (
    <Panel
      title="快速入口"
      description="次要入口：先看状态，再按需进入具体功能页。"
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md border border-outline-variant/60 bg-surface-lowest px-3 py-2 outline-none transition-colors hover:bg-surface-low focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="block text-sm font-medium text-on-surface">
              {link.label}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {link.hint}
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        精选病例：{demoCases.map((item) => item.patientId).join(" · ")}
        （详见项目文档/4-演示流程.md）
      </p>
    </Panel>
  );
}

function BoundarySection() {
  return (
    <Panel title="数据与边界" description="不伪造缺失的数据。">
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          训练历史、checkpoint 列表、外部验证数据目前没有 API（仅单份评估报告）：
          <span className="text-on-surface">「训练历史 / 外部验证接口待补」</span>
          ，本页不会用占位曲线或虚构数字填充。
        </li>
        <li>
          推理与评估的数据来源、research_only 标记均以 API 返回为准；本系统是研究原型，
          不是已验证的临床决策工具。
        </li>
        <li>
          评估报告与当前推理服务版本不一致时，模型卡会显示警告；请以同一次训练 /
          评估产物为准。
        </li>
      </ul>
    </Panel>
  );
}

export function OverviewDashboard({
  meta,
  metaError,
  health,
  healthError,
  report,
  reportError,
  loading,
  apiBase,
}: {
  meta: ModelMeta | null;
  metaError: string | null;
  health: HealthResponse | null;
  healthError: string | null;
  report: FullEvalReport | null;
  reportError: string | null;
  loading: boolean;
  apiBase: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModelCardSection meta={meta} metaError={metaError} report={report} />
      <div className="grid gap-6 xl:grid-cols-2">
        <EvaluationSection
          report={report}
          reportError={reportError}
          loading={loading}
        />
        <ServiceSection
          health={health}
          healthError={healthError}
          apiBase={apiBase}
          loading={loading}
        />
      </div>
      <QuickLinksSection />
      <BoundarySection />
    </div>
  );
}
