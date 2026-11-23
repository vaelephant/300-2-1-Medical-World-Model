"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fetchTrainingLive, reloadModelCheckpoint } from "@/lib/api";
import type { ModelReloadResponse, TrainingLiveResponse } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_MS = 2500;

const STATUS_META: Record<string, { label: string; className: string }> = {
  running: { label: "训练中", className: "bg-tertiary-container/60 text-tertiary" },
  evaluating: { label: "评估中", className: "bg-primary-container/60 text-primary" },
  finished: { label: "已完成", className: "bg-surface-low text-on-surface-variant" },
  idle: { label: "无记录", className: "bg-surface-low text-on-surface-variant" },
};

function formatMetric(value?: number | null, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return value;
  }
}

function sourceLabel(source?: string | null): string {
  if (source === "progress") return "progress 文件（训练中实时）";
  if (source === "train_meta") return "train_meta（最近一次完成记录）";
  return "—";
}

export function TrainingMonitor() {
  const [live, setLive] = useState<TrainingLiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<ModelReloadResponse | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const token = ++requestId.current;
    try {
      const data = await fetchTrainingLive();
      if (cancelled.current || token !== requestId.current) return;
      setLive(data);
      setError(null);
      setLastFetched(new Date());
    } catch (err) {
      if (cancelled.current || token !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!cancelled.current && token === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    // 放到 setTimeout 里避免在 effect body 同步触发 setState（react-hooks/set-state-in-effect）。
    const kickoff = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      // 页面不可见时暂停轮询，回到前台会继续。
      if (document.visibilityState === "hidden") return;
      void load();
    }, POLL_MS);
    return () => {
      cancelled.current = true;
      requestId.current += 1;
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [load]);

  async function reloadWeights() {
    setReloading(true);
    setReloadResult(null);
    setReloadError(null);
    try {
      const result = await reloadModelCheckpoint(true);
      setReloadResult(result);
      await load();
    } catch (err) {
      setReloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  }

  const history = live?.history ?? [];
  const status = live?.status ?? "idle";
  const statusMeta = STATUS_META[status] ?? STATUS_META.idle;
  const stalled = Boolean(live?.stalled);
  const checkpointChanged = Boolean(live?.checkpoint_changed_on_disk);
  const bestEpoch = live?.best_epoch ?? null;
  const configEntries = Object.entries(live?.config ?? {});
  const manifest = live?.data_manifest;

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Training · 训练监控</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            读取 `/api/v1/training/live` 并每 {POLL_MS / 1000}s 刷新：训练中每个 epoch 原子更新一次
            `train_progress.json`；完成后回退读取 `train_meta.json`。这是本地训练观测，不是 W&B 云端。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading && !live}>
            刷新
          </Button>
          <Button onClick={() => void reloadWeights()} disabled={reloading}>
            {reloading ? "重载中…" : "重新加载权重"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>训练进度读取失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {reloadError ? (
        <Alert variant="destructive">
          <AlertTitle>重新加载权重失败</AlertTitle>
          <AlertDescription>{reloadError}</AlertDescription>
        </Alert>
      ) : null}
      {reloadResult ? (
        <Alert>
          <AlertTitle>{reloadResult.reloaded ? "权重已重新加载" : "权重未变化"}</AlertTitle>
          <AlertDescription>
            {reloadResult.previous_model_version
              ? `${reloadResult.previous_model_version} → ${reloadResult.model_version}；`
              : `${reloadResult.model_version}；`}
            {reloadResult.checkpoint}。{reloadResult.message}
          </AlertDescription>
        </Alert>
      ) : null}
      {stalled ? (
        <Alert>
          <AlertTitle>训练进度超过 {live?.stale_after_seconds ?? 120}s 未更新</AlertTitle>
          <AlertDescription>
            {live?.message ?? "训练可能变慢或已中断；请检查训练进程与 train_progress.json。"}
          </AlertDescription>
        </Alert>
      ) : null}
      {checkpointChanged ? (
        <Alert>
          <AlertTitle>磁盘上的 best.pt 已更新</AlertTitle>
          <AlertDescription>
            预测服务仍在使用内存中的旧权重；点「重新加载权重」即可让 forecast / 模型卡使用新 checkpoint，无需重启 API。
          </AlertDescription>
        </Alert>
      ) : null}

      {!live && loading ? <p role="status" className="text-sm text-muted-foreground">正在读取训练进度…</p> : null}

      {live ? (
        <>
          <section aria-label="训练状态" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
              <p className="text-xs text-on-surface-variant">状态</p>
              <span className={cn("mt-1 inline-flex rounded-sm px-2 py-0.5 text-sm font-medium", statusMeta.className)}>
                {statusMeta.label}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">{sourceLabel(live.source)}</p>
            </div>
            <Stat label="Epoch" value={`${live.epochs_trained ?? 0} / ${live.epochs_configured ?? "?"}`} hint={bestEpoch ? `best epoch ${bestEpoch}` : undefined} />
            <Stat label="Best val_loss" value={formatMetric(live.best_val)} hint={bestEpoch ? `第 ${bestEpoch} 个 epoch` : undefined} />
            <Stat label="耗时" value={formatDuration(live.duration_sec)} hint={`更新于 ${formatDateTime(live.updated_at ?? live.finished_at)}`} />
          </section>

          <section className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4" aria-label="实时训练曲线">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Train / Val Loss</h2>
                <p className="text-xs text-muted-foreground">
                  来源：{sourceLabel(live.source)}；自动刷新 {lastFetched ? formatDateTime(lastFetched.toISOString()) : "—"}
                </p>
              </div>
              {bestEpoch ? <span className="text-xs text-muted-foreground">best epoch = {bestEpoch}</span> : null}
            </div>
            {history.length > 0 ? (
              <div
                className="h-80 w-full"
                role="img"
                aria-label={`训练/验证损失曲线，共 ${history.length} 个 epoch${bestEpoch ? `，最佳 epoch 为 ${bestEpoch}` : ""}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="epoch"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      label={{ value: "epoch", position: "insideBottom", offset: -2, fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} width={64} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        color: "var(--popover-foreground)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    {bestEpoch ? (
                      <ReferenceLine
                        x={bestEpoch}
                        stroke="var(--primary)"
                        strokeDasharray="4 4"
                        label={{ value: "best", fill: "var(--primary)", fontSize: 11, position: "insideTopRight" }}
                      />
                    ) : null}
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line isAnimationActive={false} type="linear" dataKey="train_loss" name="train_loss" stroke="var(--chart-history)" strokeWidth={2} dot={false} connectNulls />
                    <Line isAnimationActive={false} type="linear" dataKey="val_loss" name="val_loss" stroke="var(--chart-forecast)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-outline-variant/60 px-4 py-8 text-sm text-muted-foreground">
                {live.available ? "当前没有 epoch 记录。" : live.message ?? "没有训练记录；请先运行训练脚本。"}
              </p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4" aria-label="训练配置">
              <h2 className="text-base font-semibold">训练配置</h2>
              {configEntries.length > 0 ? (
                <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {configEntries.map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd className="truncate text-sm" title={String(value)}>
                        {Array.isArray(value) ? value.join(", ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "—")}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">当前进度中没有 config。</p>
              )}
            </section>

            <section className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4" aria-label="数据与产物 provenance">
              <h2 className="text-base font-semibold">数据与产物</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">device / data_source</dt>
                  <dd className="font-mono text-xs">{live.device ?? "—"} / {manifest?.data_source ?? "—"}</dd>
                </div>
                {manifest ? (
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-muted-foreground">manifest</dt>
                    <dd className="max-w-[70%] truncate font-mono text-xs" title={manifest.path}>
                      n={manifest.n ?? "—"} · seed={manifest.seed ?? "—"} · max_visits={manifest.max_visits ?? "—"}
                    </dd>
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">checkpoint</dt>
                  <dd className="max-w-[70%] truncate font-mono text-xs" title={live.checkpoint ?? undefined}>{live.checkpoint ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">last checkpoint</dt>
                  <dd className="max-w-[70%] truncate font-mono text-xs" title={live.last_checkpoint ?? undefined}>{live.last_checkpoint ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">eval report</dt>
                  <dd className="max-w-[70%] truncate font-mono text-xs" title={live.eval_report ?? undefined}>{live.eval_report ?? "—"}</dd>
                </div>
                {live.message ? <p className="text-xs text-muted-foreground">{live.message}</p> : null}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/evaluation" className={buttonVariants({ variant: "outline", size: "sm" })}>查看评估</Link>
                <Link href="/world-model" className={buttonVariants({ variant: "outline", size: "sm" })}>去病程预测</Link>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
