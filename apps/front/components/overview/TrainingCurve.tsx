"use client";

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

import type { TrainingInfo } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Panel } from "@/components/overview/primitives";
import { baseName, formatDateTime, formatMetric } from "@/components/overview/types";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-low px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

/**
 * 训练曲线：读取 checkpoint 同目录 train_meta.json 的 history（由后端
 * /api/v1/training 返回）。available=false 或 history 为空时不画空图。
 */
export function TrainingCurve({
  training,
  trainingError,
  loading,
}: {
  training: TrainingInfo | null;
  trainingError: string | null;
  loading: boolean;
}) {
  if (trainingError) {
    return (
      <Panel
        title="训练曲线"
        description="读取 checkpoint 同目录 train_meta.json；不加载模型、不伪造曲线。"
      >
        <Alert variant="destructive">
          <AlertTitle>训练历史读取失败</AlertTitle>
          <AlertDescription>{trainingError}</AlertDescription>
        </Alert>
      </Panel>
    );
  }

  if (!training) {
    return (
      <Panel
        title="训练曲线"
        description="读取 checkpoint 同目录 train_meta.json；不加载模型、不伪造曲线。"
      >
        <p role="status" className="text-sm text-muted-foreground">
          {loading ? "正在读取训练历史…" : "暂无训练历史。"}
        </p>
      </Panel>
    );
  }

  const history = (training.history ?? []).filter(
    (point) =>
      Number.isFinite(point.epoch) &&
      Number.isFinite(point.train_loss) &&
      Number.isFinite(point.val_loss),
  );
  const epochs = training.epochs_trained ?? history.length;
  const bestEpoch =
    typeof training.best_epoch === "number" && Number.isFinite(training.best_epoch)
      ? training.best_epoch
      : null;
  const trainMetaPath = training.train_meta?.path;
  const checkpointPath = training.checkpoint_path ?? training.checkpoint?.path;

  if (training.available === false || history.length === 0) {
    return (
      <Panel
        title="训练曲线"
        description="读取 checkpoint 同目录 train_meta.json；不加载模型、不伪造曲线。"
      >
        <Alert>
          <AlertTitle>训练历史不可用</AlertTitle>
          <AlertDescription>
            {training.reason ??
              "train_meta.json 中没有可绘制的 history 数组；页面不会用占位曲线代替。"}
          </AlertDescription>
        </Alert>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">checkpoint</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">{checkpointPath ?? "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">train_meta.json</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">
              {trainMetaPath ?? "—"}
              {training.train_meta?.exists === false ? "（文件不存在）" : ""}
            </dd>
          </div>
        </dl>
      </Panel>
    );
  }

  const reportedBestVal = training.reported_best_val;
  const historyBestVal = training.best_val;
  const bestValMismatch =
    typeof reportedBestVal === "number" &&
    typeof historyBestVal === "number" &&
    Math.abs(reportedBestVal - historyBestVal) > 1e-9;

  return (
    <Panel
      title="训练曲线"
      description="读取 checkpoint 同目录 train_meta.json；不加载模型、不伪造曲线。"
    >
      <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="训练 epoch 数" value={formatMetric(epochs, 0)} />
        <MetricTile
          label="best_epoch（val_loss 最低）"
          value={bestEpoch === null ? "—" : `第 ${bestEpoch} epoch`}
        />
        <MetricTile label="best_val（history 最小值）" value={formatMetric(historyBestVal, 4)} />
        <MetricTile
          label="数据切分 train / val / test"
          value={
            training.splits
              ? `${formatMetric(training.splits.n_train, 0)} / ${formatMetric(training.splits.n_val, 0)} / ${formatMetric(training.splits.n_test, 0)}`
              : "—"
          }
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        读取 checkpoint 同目录 train_meta.json（{baseName(trainMetaPath)}
        {training.train_meta?.modified_at
          ? `，修改于 ${formatDateTime(training.train_meta.modified_at)}`
          : ""}
        ）：共 {formatMetric(epochs, 0)} 个 epoch；val_loss 最低点 = 第{" "}
        {bestEpoch ?? "—"} epoch（best_val = {formatMetric(historyBestVal, 4)}）。
        {bestValMismatch
          ? ` train_meta 记录的 best_val = ${formatMetric(reportedBestVal, 4)}，与 history 最小值不一致，请以 history 为准。`
          : ""}
      </p>

      <div
        className="mt-4 h-72 w-full"
        role="img"
        aria-label={`训练损失曲线：共 ${formatMetric(epochs, 0)} 个 epoch，train_loss 与 val_loss 随 epoch 变化；val_loss 最低点为第 ${bestEpoch ?? "未知"} epoch。`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="epoch"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: number) => `第 ${value} 轮`}
            />
            <YAxis
              width={58}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: number) => formatMetric(value, 3)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(label) => `第 ${label} epoch`}
              formatter={(value, name) => [
                formatMetric(typeof value === "number" ? value : Number(value), 4),
                name === "train_loss" ? "训练损失 train_loss" : "验证损失 val_loss",
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) =>
                value === "train_loss" ? "训练损失 train_loss" : "验证损失 val_loss"
              }
            />
            {bestEpoch !== null ? (
              <ReferenceLine
                x={bestEpoch}
                stroke="var(--primary)"
                strokeDasharray="4 4"
                label={{
                  value: `best epoch ${bestEpoch}`,
                  fill: "var(--primary)",
                  fontSize: 11,
                  position: "insideTopRight",
                }}
              />
            ) : null}
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="train_loss"
              name="train_loss"
              stroke="var(--chart-history)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="val_loss"
              name="val_loss"
              stroke="var(--chart-forecast)"
              strokeWidth={2}
              dot={{ r: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        曲线数据来自 /api/v1/training（history 数组），loss 为训练时的归一化损失；
        checkpoint = {checkpointPath ?? "—"}
        {training.device ? ` · device = ${training.device}` : ""}
        {typeof training.patience === "number" ? ` · patience = ${training.patience}` : ""}。
      </p>
    </Panel>
  );
}
