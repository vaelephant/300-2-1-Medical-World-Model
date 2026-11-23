"use client";

import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StageContext, StageDef } from "@/components/architecture/architectureData";

/** 5 阶段可点击数据流；移动端纵向、桌面横向，阶段间用箭头连接。 */
export function ArchitectureFlow({
  stages,
  ctx,
  selectedId,
  onSelect,
}: {
  stages: StageDef[];
  ctx: StageContext;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="模型结构数据流（5 个阶段，可点击查看详情）">
      <div
        role="group"
        aria-label={`模型数据流：${stages.map((stage) => stage.title).join(" → ")}`}
        className="flex flex-col gap-1 lg:flex-row lg:items-stretch"
      >
        {stages.map((stage, index) => {
          const selected = stage.id === selectedId;
          return (
            <Fragment key={stage.id}>
              <button
                type="button"
                onClick={() => onSelect(stage.id)}
                aria-pressed={selected}
                aria-label={`阶段 ${stage.index} ${stage.title}：${stage.input(ctx)} → ${stage.output(ctx)}。点击查看详情。`}
                className={cn(
                  "min-w-0 flex-1 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                  selected
                    ? "border-primary bg-primary-container/50 shadow-xs"
                    : "border-outline-variant/60 bg-surface-lowest hover:bg-surface-low",
                )}
              >
                <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
                  阶段 0{stage.index}
                </span>
                <span className="mt-0.5 block text-sm font-semibold text-on-surface">
                  {stage.title}
                </span>
                <span className="block text-xs text-muted-foreground">{stage.subtitle}</span>
                <span className="mt-2 block text-[11px] leading-snug">
                  <span className="text-muted-foreground">输入：</span>
                  {stage.input(ctx)}
                </span>
                <span className="block text-[11px] leading-snug">
                  <span className="text-muted-foreground">输出：</span>
                  {stage.output(ctx)}
                </span>
                <span
                  className="mt-2 block truncate font-mono text-[10px] text-muted-foreground"
                  title={stage.codeFiles[0]}
                >
                  {stage.codeFiles[0]}
                </span>
              </button>
              {index < stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="flex shrink-0 items-center justify-center py-0.5 text-muted-foreground lg:px-0.5 lg:py-0"
                >
                  <ChevronDown className="size-4 lg:hidden" />
                  <ChevronRight className="hidden size-4 lg:block" />
                </span>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        点击任一阶段查看输入 / 输出、维度、代码文件与边界说明。维度来自 /api/v1/schema；
        schema 不可用时显示 —。
      </p>
    </section>
  );
}
