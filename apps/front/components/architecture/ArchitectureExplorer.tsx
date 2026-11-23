"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchModelMeta, fetchModelSchema, fetchTraining } from "@/lib/api";
import type { ModelMeta, ModelSchema, TrainingInfo } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ArchitectureFlow } from "@/components/architecture/ArchitectureFlow";
import { BranchDiagram } from "@/components/architecture/BranchDiagram";
import { StageDetail } from "@/components/architecture/StageDetail";
import {
  NOT_IMPLEMENTED,
  STAGES,
  type StageContext,
} from "@/components/architecture/architectureData";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settle<T>(promise: Promise<T>) {
  return promise
    .then((data) => ({ data, error: null as string | null }))
    .catch((cause) => ({ data: null, error: toMessage(cause) }));
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "mt-0.5 truncate font-mono text-xs text-on-surface"
            : "mt-0.5 truncate text-sm font-medium tabular-nums text-on-surface"
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

/** /architecture 模型结构与数据流：按当前 checkpoint schema/config 渲染。 */
export function ArchitectureExplorer() {
  const [schema, setSchema] = useState<ModelSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ModelMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [training, setTraining] = useState<TrainingInfo | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string>(STAGES[0].id);
  const requestRef = useRef(0);

  useEffect(() => {
    const token = requestRef.current + 1;
    requestRef.current = token;
    // schema / models / training 三路独立降级；任一失败不阻塞其它内容。
    Promise.all([settle(fetchModelSchema()), settle(fetchModelMeta()), settle(fetchTraining())])
      .then(([schemaResult, metaResult, trainingResult]) => {
        if (token !== requestRef.current) return;
        setSchema(schemaResult.data);
        setSchemaError(schemaResult.error);
        setMeta(metaResult.data);
        setMetaError(metaResult.error);
        setTraining(trainingResult.data);
        setTrainingError(trainingResult.error);
      })
      .finally(() => {
        if (token === requestRef.current) setLoading(false);
      });
    return () => {
      requestRef.current += 1;
    };
  }, [version]);

  const refresh = useCallback(() => {
    setLoading(true);
    setSchemaError(null);
    setMetaError(null);
    setTrainingError(null);
    setVersion((value) => value + 1);
  }, []);

  const ctx = useMemo<StageContext>(() => ({ schema, training }), [schema, training]);
  const selectedStage = useMemo(
    () => STAGES.find((stage) => stage.id === selectedId) ?? STAGES[0],
    [selectedId],
  );

  const schemaValue = (value?: string | number | boolean | null): string => {
    if (value === undefined || value === null) return "—";
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
    return value;
  };

  const schemaUnavailable = Boolean(schemaError) || schema?.available === false;
  const anyError = Boolean(
    schemaUnavailable || metaError || trainingError,
  );
  const allEmpty = !schema && !meta && !training && !loading;
  const researchOnly = schema?.research_only ?? meta?.research_only;
  const researchOnlyValue = researchOnly === true ? "true（非临床）" : "—";

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Architecture · 模型结构与数据流
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            按当前 checkpoint 的 schema / config 渲染：合成轨迹 → Tensor → GRU encoder → MLP dynamics
            → residual decoder。研究原型，不是临床系统；只展示真实存在的模块，未完成部分明确标注。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/training" className={buttonVariants({ variant: "outline", size: "sm" })}>
            训练监控
          </Link>
          <Link href="/evaluation" className={buttonVariants({ variant: "outline", size: "sm" })}>
            模型评估
          </Link>
          <Link href="/world-model" className={buttonVariants({ variant: "outline", size: "sm" })}>
            病程预测
          </Link>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </header>

      {anyError ? (
        <Alert>
          <AlertTitle>
            {schemaUnavailable ? "schema 不可用（部分维度显示为 —）" : "部分数据不可用"}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {schemaError ? <li>schema: {schemaError}</li> : null}
              {!schemaError && schema?.available === false ? (
                <li>schema: {schema.message ?? "API 未返回可用 schema。"}</li>
              ) : null}
              {metaError ? <li>models: {metaError}</li> : null}
              {trainingError ? <li>training: {trainingError}</li> : null}
            </ul>
            <span className="mt-1 block text-xs">
              对应字段显示为 —，页面不会用占位数字代替；链路文字仍按真实代码结构展示。
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {!schema && !meta && !training && loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取 schema 与模型信息…
        </p>
      ) : null}
      {allEmpty ? (
        <Alert>
          <AlertTitle>无法读取模型结构信息</AlertTitle>
          <AlertDescription>
            请确认本地 API 已启动（scripts/serve_api.py）；本页只用 API 返回的 schema/config，
            不会伪造维度。
          </AlertDescription>
        </Alert>
      ) : null}

      <ArchitectureFlow
        stages={STAGES}
        ctx={ctx}
        selectedId={selectedStage.id}
        onSelect={setSelectedId}
      />

      <StageDetail stage={selectedStage} ctx={ctx} />

      <BranchDiagram />

      <section
        aria-label="当前模型卡"
        className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">当前模型卡</h2>
          <p className="text-xs text-muted-foreground">
            模型版本 / 维度来自 /api/v1/schema；checkpoint 等来自 /api/v1/models。
          </p>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 xl:grid-cols-5">
          <Field
            label="模型版本"
            value={schemaValue(schema?.model_version ?? meta?.model_version)}
          />
          <Field label="Checkpoint" value={schemaValue(meta?.checkpoint)} mono />
          <Field
            label="推理设备"
            value={schemaValue(meta?.device ?? schema?.device)}
          />
          <Field
            label="数据来源"
            value={schemaValue(schema?.data_source ?? meta?.data_source)}
          />
          <Field
            label="research_only"
            value={researchOnlyValue}
          />
          <Field label="feature_dim" value={schemaValue(schema?.feature_dim)} />
          <Field label="hidden_dim" value={schemaValue(schema?.hidden_dim)} />
          <Field label="latent_dim" value={schemaValue(schema?.latent_dim)} />
          <Field label="dropout" value={schemaValue(schema?.dropout)} />
          <Field label="residual" value={schemaValue(schema?.residual)} />
          <Field label="multi_step" value={schemaValue(schema?.multi_step)} />
          <Field label="multi_step_weight" value={schemaValue(schema?.multi_step_weight)} />
          <Field label="max_visits" value={schemaValue(schema?.max_visits)} />
          <Field
            label="n_patients_loaded（推理加载）"
            value={schemaValue(meta?.n_patients_loaded)}
          />
          <Field
            label="training_max_patients（训练上限）"
            value={schemaValue(schema?.training_max_patients)}
          />
        </dl>
        <p className="mt-3 rounded-md bg-surface-low px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-on-surface">注意：</span>
          training_max_patients 是训练子集上限，不是推理端加载的患者数；推理端加载数见
          n_patients_loaded（当前 {schemaValue(meta?.n_patients_loaded)}）。
        </p>
      </section>

      <section aria-label="未完成与占位模块">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">未完成 / 占位模块</h2>
          <p className="text-xs text-muted-foreground">
            这些能力当前不存在或未接入，页面不展示假的置信区间、风险评分或影像流程。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {NOT_IMPLEMENTED.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-warning-border/60 bg-warning-surface/40 p-4"
            >
              <h3 className="text-sm font-semibold text-warning">{item.title}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-label="数据与边界"
        className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
      >
        <h2 className="text-sm font-medium">数据与边界</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>
            本页结构与维度来自当前 checkpoint 的 schema/config（/api/v1/schema、/api/v1/models），
            不是手写示意图；缺失字段显示 —。
          </li>
          <li>
            数据为合成队列（data_source 以 API 为准），标注 research_only；不是已验证的临床决策系统。
          </li>
          <li>
            不确定性 / 校准、risk head、影像均为未完成项，所以本页不画置信区间、风险评分或 CT 流程；
            也不存在未列出的隐藏模块。
          </li>
          <li>
            训练 / 评估 / 推理三条链路的实时数据分别在
            <Link href="/training" className="mx-1 text-primary underline-offset-4 hover:underline">
              训练监控
            </Link>
            、
            <Link href="/evaluation" className="mx-1 text-primary underline-offset-4 hover:underline">
              模型评估
            </Link>
            、
            <Link href="/world-model" className="mx-1 text-primary underline-offset-4 hover:underline">
              病程预测
            </Link>
            查看。
          </li>
        </ul>
      </section>
    </div>
  );
}
