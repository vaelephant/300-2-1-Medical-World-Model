"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = {
  day: number;
  history?: number | null;
  forecast?: number | null;
  observed?: number | null;
  baseline?: number | null;
};

type Props = {
  title: string;
  data: ChartPoint[];
  unit?: string;
  comparison?: boolean;
};

export function FeatureChart({ title, data, unit, comparison }: Props) {
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4 shadow-xs">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-on-surface">{title}</h3>
        {unit ? (
          <span className="text-xs text-on-surface-variant">{unit}</span>
        ) : null}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              type="number" domain={["dataMin", "dataMax"]}
              tick={{ fill: "#64748b", fontSize: 11 }}
              label={{
                value: "days from index",
                position: "insideBottom",
                offset: -2,
                fill: "#64748b",
                fontSize: 11,
              }}
            />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} width={48} />
            <Tooltip
              contentStyle={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line isAnimationActive={false} type="linear" dataKey="observed" name="后续观测（未输入）" stroke="#64748b" strokeDasharray="2 4" connectNulls dot={{ r: 2 }} />
            {comparison && <Line isAnimationActive={false} type="linear" dataKey="baseline" name="延续原条件" stroke="#d97706" connectNulls dot={{ r: 2 }} />}
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              isAnimationActive={false}
              type="linear"
              dataKey="history"
              name="输入历史"
              stroke="#0f766e"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={true}
            />
            <Line
              isAnimationActive={false}
              type="linear"
              dataKey="forecast"
              name={comparison ? "所选情景" : "模型预测"}
              stroke="#5445de"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3 }}
              connectNulls={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
