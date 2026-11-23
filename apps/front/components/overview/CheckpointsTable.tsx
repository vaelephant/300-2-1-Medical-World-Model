"use client";

import type { CheckpointsResponse } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel, StatusBadge } from "@/components/overview/primitives";
import { formatBytes, formatDateTime } from "@/components/overview/types";

/** Checkpoints：列出模型目录下所有 .pt 的文件大小 / 修改时间 / 是否为当前服务权重。 */
export function CheckpointsTable({
  checkpoints,
  checkpointsError,
  loading,
}: {
  checkpoints: CheckpointsResponse | null;
  checkpointsError: string | null;
  loading: boolean;
}) {
  const description =
    "来自 artifacts/models/**/*.pt；文件大小与修改时间由磁盘读取，不加载权重。";

  if (checkpointsError) {
    return (
      <Panel title="Checkpoints" description={description}>
        <Alert variant="destructive">
          <AlertTitle>Checkpoint 列表读取失败</AlertTitle>
          <AlertDescription>{checkpointsError}</AlertDescription>
        </Alert>
      </Panel>
    );
  }

  if (!checkpoints) {
    return (
      <Panel title="Checkpoints" description={description}>
        <p role="status" className="text-sm text-muted-foreground">
          {loading ? "正在读取 checkpoint 目录…" : "暂无 checkpoint 信息。"}
        </p>
      </Panel>
    );
  }

  const entries = checkpoints.checkpoints ?? [];

  return (
    <Panel
      title="Checkpoints"
      description={description}
      actions={
        <span className="text-xs text-muted-foreground">
          共 {entries.length} 个 .pt
        </span>
      }
    >
      {entries.length === 0 ? (
        <Alert>
          <AlertTitle>没有可用 checkpoint</AlertTitle>
          <AlertDescription>
            模型目录下未发现 .pt 文件：{checkpoints.models_dir ?? "—"}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Table>
            <TableCaption>
              当前服务权重：{checkpoints.current_checkpoint ?? "—"}
              {checkpoints.models_dir ? ` · 模型目录：${checkpoints.models_dir}` : ""}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>文件</TableHead>
                <TableHead>相对路径</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>修改时间</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={`${entry.relative_path}-${entry.name}`}
                  data-state={entry.is_current ? "selected" : undefined}
                >
                  <TableCell>
                    <span className="font-medium">{entry.name}</span>
                    {entry.exists === false ? (
                      <span className="ml-2 text-[10px] text-error">文件不存在</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {entry.relative_path || "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBytes(entry.size_bytes)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(entry.modified_at)}
                  </TableCell>
                  <TableCell>
                    {entry.is_current ? (
                      <StatusBadge tone="ok" label="当前权重" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            数据来自 /api/v1/models/checkpoints（本地产物只读）；is_current 表示该文件是当前
            推理服务加载的权重。修改时间按浏览器本地时区显示。
          </p>
        </>
      )}
    </Panel>
  );
}
