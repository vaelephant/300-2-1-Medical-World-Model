"use client";

import type { StageContext, StageDef } from "@/components/architecture/architectureData";

/** 选中阶段的详情：输入/输出、维度、代码文件、说明与相关边界。 */
export function StageDetail({
  stage,
  ctx,
}: {
  stage: StageDef;
  ctx: StageContext;
}) {
  return (
    <section
      aria-live="polite"
      aria-label={`阶段详情：${stage.title}`}
      className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">
            阶段 0{stage.index} · {stage.subtitle}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold">{stage.title}</h2>
        </div>
        <span className="rounded-sm bg-surface-low px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {stage.codeFiles[0]}
        </span>
      </div>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-surface-low px-3 py-2">
          <dt className="text-xs text-muted-foreground">输入</dt>
          <dd className="mt-0.5">{stage.input(ctx)}</dd>
        </div>
        <div className="rounded-md bg-surface-low px-3 py-2">
          <dt className="text-xs text-muted-foreground">输出</dt>
          <dd className="mt-0.5">{stage.output(ctx)}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <p className="text-xs font-medium text-on-surface-variant">关键维度 / 形状</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3 xl:grid-cols-5">
          {stage.dims(ctx).map((dim) => (
            <div key={dim.label} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{dim.label}</dt>
              <dd className="mt-0.5 truncate font-medium tabular-nums" title={dim.value}>
                {dim.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-3 text-sm text-on-surface-variant">{stage.description}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-on-surface-variant">代码 / 产物文件</p>
          <ul className="mt-1 space-y-0.5">
            {stage.codeFiles.map((file) => (
              <li key={file} className="break-all font-mono text-[11px] text-muted-foreground">
                {file}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-on-surface-variant">相关边界</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {stage.boundaries.map((boundary) => (
              <li key={boundary}>{boundary}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
