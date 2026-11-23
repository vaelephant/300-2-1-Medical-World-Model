"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CohortAggregate } from "@/lib/types";
import {
  BCLC_STAGES,
  buildProgressionBins,
  formatNumber,
  stageColor,
  treatmentLabel,
} from "@/components/cohort/cohortUtils";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

function ChartCard({
  title,
  caption,
  ariaLabel,
  children,
}: {
  title: string;
  caption: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
      <figcaption className="mb-2">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{caption}</span>
      </figcaption>
      <div className="w-full" role="img" aria-label={ariaLabel}>
        {children}
      </div>
    </figure>
  );
}

/** 全队列分布：BCLC 分期、治疗事件、progression days；均来自 aggregate（不随筛选变化）。 */
export function CohortDistributions({ aggregate }: { aggregate?: CohortAggregate }) {
  const stageCounts = BCLC_STAGES.map((stage) => ({
    stage,
    count: aggregate?.stage_counts?.[stage] ?? 0,
  })).filter((row) => row.count > 0);

  const treatmentRows = Object.entries(aggregate?.treatment_event_counts ?? {})
    .map(([modality, count]) => ({
      modality,
      label: treatmentLabel(modality),
      count: Number.isFinite(count) ? count : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const progressionBins = buildProgressionBins(aggregate?.progression_days ?? []);
  const progressionTotal = progressionBins.reduce((sum, bin) => sum + bin.count, 0);

  return (
    <section className="flex flex-col gap-3" aria-label="队列分布">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">队列分布</h2>
        <p className="text-xs text-muted-foreground">
          数据来自 /api/v1/cohort/summary 的 aggregate（全队列），不随上方筛选变化。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="BCLC 分期分布"
          caption="全队列各 BCLC 分期的患者数；颜色仅用于区分分期。"
          ariaLabel="BCLC 分期患者数柱状图。"
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stageCounts} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="stage" tick={AXIS_TICK} tickFormatter={(value: string) => `BCLC ${value}`} />
              <YAxis tick={AXIS_TICK} width={48} tickFormatter={(value: number) => formatNumber(value, 0)} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(label) => `BCLC ${label}`}
                formatter={(value) => [formatNumber(Number(value), 0), "患者数"]}
              />
              <Bar dataKey="count" name="患者数" radius={[4, 4, 0, 0]}>
                {stageCounts.map((row) => (
                  <Cell key={row.stage} fill={stageColor(row.stage)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="治疗事件计数"
          caption="各治疗类别的记录次数（计数为单位，不是患者数）；不排序治疗优劣。"
          ariaLabel="各治疗类别事件计数横向条形图。"
        >
          <ResponsiveContainer width="100%" height={Math.max(240, treatmentRows.length * 30 + 30)}>
            <BarChart
              data={treatmentRows}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
            >
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} tickFormatter={(value: number) => formatNumber(value, 0)} />
              <YAxis type="category" dataKey="label" width={88} tick={AXIS_TICK} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(label) => String(label)}
                formatter={(value) => [formatNumber(Number(value), 0), "事件数"]}
              />
              <Bar dataKey="count" name="事件数" fill="var(--chart-observed)" radius={[0, 4, 4, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Progression days 分布"
          caption={`全队列 ${formatNumber(progressionTotal, 0)} 条 progression 记录的首次发生时间分箱；仅描述统计。`}
          ariaLabel="progression 首次发生天数分箱柱状图。"
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={progressionBins} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} width={48} tickFormatter={(value: number) => formatNumber(value, 0)} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value) => [formatNumber(Number(value), 0), "患者数"]}
              />
              <Bar dataKey="count" name="患者数" fill="var(--chart-forecast)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <figure className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-lowest p-4">
          <figcaption className="text-sm font-medium">怎么读这些分布</figcaption>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>这是合成队列的描述统计，不是风险模型输出，不能用于个体风险预测。</li>
            <li>治疗事件计数表示「记录次数」，不等于患者数，也不能据此排序治疗优劣。</li>
            <li>
              progression days 是数据中已记录的进展时间分箱，受随访长度与记录方式影响，
              不能解读为「无治疗时的自然病程」。
            </li>
            <li>筛选条件只影响上方 KPI / 散点 / 相似病例；本节分布始终展示全队列。</li>
          </ul>
        </figure>
      </div>
    </section>
  );
}
