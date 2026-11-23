"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { BRANCHES } from "@/components/architecture/architectureData";

/** 训练 / 评估 / 推理三条分支链路（静态卡片，内容来自真实代码路径与 API 能力）。 */
export function BranchDiagram() {
  return (
    <section
      aria-label="训练、评估与推理分支链路"
      className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">分支链路：训练 → 评估 → 推理</h2>
        <p className="text-xs text-muted-foreground">
          三条链路共用同一个 checkpoint；训练覆盖 best.pt 后，推理服务需 reload 或重启才使用新权重。
        </p>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {BRANCHES.map((branch, index) => (
          <div
            key={branch.id}
            className="flex min-w-0 flex-col rounded-lg border border-outline-variant/50 bg-surface-low p-3"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
                0{index + 1}
              </span>
              <h3 className="text-sm font-semibold">{branch.title}</h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{branch.subtitle}</p>

            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-on-surface-variant">
              {branch.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <ul className="mt-2 space-y-0.5">
              {branch.codeFiles.map((file) => (
                <li
                  key={file}
                  className="break-all font-mono text-[10px] text-muted-foreground"
                >
                  {file}
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-3">
              <Link
                href={branch.href}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {branch.hrefLabel}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        推理链路只暴露 /forecast 与 /simulate；/simulate 用未来治疗条件覆盖当前条件，仍然是合成模型响应，
        不是疗效预测。
      </p>
    </section>
  );
}
