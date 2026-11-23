"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Overview 各 section 共用的卡片外壳。 */
export function Panel({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-on-surface">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 卡片内字段（dt/dd 需放在 dl 中）。 */
export function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
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

export function StatusBadge({
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

/** 相对 Persistence 的单项判定徽标：true/false 都显示，缺数据标“未提供”。 */
export function BeatBadge({ label, beats }: { label: string; beats?: boolean }) {
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
