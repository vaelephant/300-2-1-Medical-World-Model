"use client";

import { useState } from "react";
import type { PatientTrajectory, Visit } from "@/lib/types";
import { demoFeatures, treatmentLabels } from "@/lib/demo-cases";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableCaption } from "@/components/ui/table";

/** 时间轴中用于趋势线的指标。 */
const TREND_FEATURE = "tumor_size_cm";
/** 相邻节点的最小像素间距，保证 12 次随访的标签不重叠（不足时横向滚动）。 */
const NODE_MIN_GAP = 92;
/** 时间轴左右留白，需大于“预测起点”标签宽度的一半。 */
const TIMELINE_PAD = 48;
/** 随访次数较少时的时间轴最小绘图宽度。 */
const BASE_PLOT_WIDTH = 520;
/** 时间轴固定高度（px），纵向不做缩放，保证 HTML 标签与 SVG 坐标对齐。 */
const TIMELINE_HEIGHT = 300;
/** 肿瘤直径趋势线所在的纵向绘图区间。 */
const TREND_TOP = 40;
const TREND_BOTTOM = 142;
/** 随访节点圆点中心所在的纵向位置。 */
const AXIS_Y = 166;
const NODE_TOP = AXIS_Y - 12;

type Point = { x: number; y: number };

function formatNumber(value: number) {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatIntensity(value: number) {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
}

function treatmentText(treatment: Visit["treatments"][number]) {
  return `${treatmentLabels[treatment.modality] ?? treatment.modality} · 强度 ${formatIntensity(treatment.dose_intensity)}`;
}

/** 缺失或未采集的指标返回 null（不当作 0 处理）。 */
function featureValue(visit: Visit, key: string): number | null {
  const value: number | undefined = visit.observation.features[key];
  if (visit.observation.missing_mask[key] === true) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/** 按 days_from_index 比例定位节点，并强制最小间距，避免随访日期集中时标签重叠。 */
function buildGeometry(days: number[]): { xs: number[]; canvasWidth: number } {
  const n = days.length;
  const basePlot = Math.max(BASE_PLOT_WIDTH, (n - 1) * NODE_MIN_GAP);
  if (n === 0) return { xs: [], canvasWidth: basePlot + TIMELINE_PAD * 2 };
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const daySpan = maxDay - minDay;
  let proportional: number[];
  if (n === 1) proportional = [basePlot / 2];
  else if (daySpan <= 0) proportional = days.map((_, index) => (index / (n - 1)) * basePlot);
  else proportional = days.map(day => ((day - minDay) / daySpan) * basePlot);
  const xs: number[] = [];
  proportional.forEach((position, index) => {
    const x = TIMELINE_PAD + position;
    xs.push(index === 0 ? x : Math.max(x, xs[index - 1] + NODE_MIN_GAP));
  });
  const canvasWidth = Math.max(basePlot + TIMELINE_PAD * 2, xs[n - 1] + TIMELINE_PAD);
  return { xs, canvasWidth };
}

/** 把带空值的点序列切成多段折线，缺失点处断开。 */
function toSegments(points: Array<Point | null>): string[] {
  const segments: string[][] = [];
  let current: string[] = [];
  for (const point of points) {
    if (!point) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }
    current.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  if (current.length > 1) segments.push(current);
  return segments.map(segment => segment.join(" "));
}

export function PatientTimeline({ trajectory, context, maxContext, revealed, onSelect }: {
  trajectory: PatientTrajectory; context: number; maxContext: number; revealed: boolean; onSelect: (context: number) => void;
}) {
  const visits = trajectory.visits;
  const n = visits.length;
  // world-model（revealed=false）默认只显示输入随访，隐藏随访折叠成一行占位；patients 页 revealed=true 照旧全显示。
  const [showHidden, setShowHidden] = useState(false);

  if (n === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-3" aria-label="病程时间轴">
        <div>
          <h2 className="text-lg font-semibold">02 · 病程时间轴</h2>
          <p className="text-sm text-muted-foreground">该患者暂无随访记录。</p>
        </div>
      </section>
    );
  }

  const days = visits.map(visit => visit.observation.days_from_index);
  const safeContext = Number.isFinite(context) ? Math.trunc(context) : 1;
  const activeContext = Math.min(Math.max(safeContext, 1), n);
  const selectedIndex = activeContext - 1;
  const safeMaxContext = Number.isFinite(maxContext) ? Math.min(Math.max(Math.trunc(maxContext), 0), n) : n;
  const remaining = n - activeContext;
  // 未揭示时后续随访在表格中折叠；展开后仍只显示“待揭示”占位，不泄露数值/治疗。
  const hiddenCount = revealed ? 0 : Math.max(n - activeContext, 0);
  const showHiddenRows = revealed || showHidden;
  const { xs, canvasWidth } = buildGeometry(days);
  const originX = xs[selectedIndex];
  const selectedDay = days[selectedIndex];

  const tumorValues = visits.map(visit => featureValue(visit, TREND_FEATURE));
  const visibleTumorValues = tumorValues.filter((value, index): value is number =>
    value !== null && (index < activeContext || revealed));
  const trendMin = visibleTumorValues.length > 0 ? Math.min(...visibleTumorValues) : 0;
  const trendMax = visibleTumorValues.length > 0 ? Math.max(...visibleTumorValues) : 0;
  const trendRange = trendMax - trendMin;
  const trendY = (value: number) =>
    trendRange > 1e-9 ? TREND_BOTTOM - ((value - trendMin) / trendRange) * (TREND_BOTTOM - TREND_TOP) : (TREND_TOP + TREND_BOTTOM) / 2;
  const pointAt = (index: number): Point | null => {
    const value = tumorValues[index];
    return value === null ? null : { x: xs[index], y: trendY(value) };
  };
  const historyPoints = visits.map((_, index) => index < activeContext ? pointAt(index) : null);
  const observedPoints = revealed ? visits.map((_, index) => index >= activeContext - 1 ? pointAt(index) : null) : [];
  const historySegments = toSegments(historyPoints);
  const observedSegments = toSegments(observedPoints);
  const futureWidth = Math.max(canvasWidth - TIMELINE_PAD - originX, 0);
  const percent = (x: number) => `${(x / canvasWidth) * 100}%`;
  const chartSummary = `病程时间轴趋势图：共 ${n} 次随访，Day ${days[0]} 至 Day ${days[n - 1]}。实线为肿瘤直径的输入历史，${revealed ? "虚线为已揭示的后续观测（未输入）" : `起点之后的 ${remaining} 次随访观测当前隐藏`}。预测起点为第 ${activeContext} 次随访（Day ${selectedDay}）。`;

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="病程时间轴">
      <div>
        <h2 className="text-lg font-semibold">02 · 病程时间轴</h2>
        <p className="text-sm text-muted-foreground">
          按相对诊断日排列每次随访、当次治疗与该时点的肿瘤直径。点击节点选择预测起点；起点之后的观测在揭示前保持隐藏。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-5 rounded-full" style={{ backgroundColor: "var(--chart-history)" }} />
          肿瘤直径 · 输入历史
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: "var(--chart-observed)" }} />
          肿瘤直径 · 后续观测（未输入）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-4 border-l-2 border-dashed" style={{ borderColor: "var(--primary)" }} />
          预测起点分界
        </span>
        <span>
          节点下方为该次访视记录的治疗（名称 · 相对强度），不代表持续用药；肿瘤直径缺失时趋势线断开。
          节点间距为保证标签可读做过最小间距处理，非严格时间比例；真实间隔见节点下方 Day 值。
        </span>
      </div>

      <div
        role="group"
        aria-label="随访时间轴，可横向滚动查看；节点可点击选择预测起点"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-outline-variant/50 bg-surface-lowest px-1 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <div className="relative" style={{ width: `max(${canvasWidth}px, 100%)`, height: TIMELINE_HEIGHT }}>
          <svg
            className="absolute inset-0 block h-full w-full"
            viewBox={`0 0 ${canvasWidth} ${TIMELINE_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={chartSummary}
          >
            <title>病程时间轴趋势图</title>
            <desc>{chartSummary}</desc>

            {/* 预测起点之后（未输入）的区域底色 */}
            {futureWidth > 0 ? (
              <rect x={originX} y={18} width={futureWidth} height={TIMELINE_HEIGHT - 26} fill="var(--primary)" opacity={0.05} />
            ) : null}

            {/* 肿瘤直径趋势：输入历史（实线） */}
            {historySegments.map((points, index) => (
              <polyline
                key={`history-${index}`}
                points={points}
                fill="none"
                stroke="var(--chart-history)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {historyPoints.map((point, index) => point ? (
              <line
                key={`history-mark-${index}`}
                x1={point.x} x2={point.x} y1={point.y - 3} y2={point.y + 3}
                stroke="var(--chart-history)" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
              />
            ) : null)}

            {/* 肿瘤直径趋势：已揭示的后续观测（虚线，仅 revealed 时出现） */}
            {observedSegments.map((points, index) => (
              <polyline
                key={`observed-${index}`}
                points={points}
                fill="none"
                stroke="var(--chart-observed)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {observedPoints.map((point, index) => point ? (
              <line
                key={`observed-mark-${index}`}
                x1={point.x} x2={point.x} y1={point.y - 3} y2={point.y + 3}
                stroke="var(--chart-observed)" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
              />
            ) : null)}

            {/* 随访时间轴 */}
            <line
              x1={xs[0]} x2={xs[n - 1]} y1={AXIS_Y} y2={AXIS_Y}
              stroke="var(--outline-variant)" strokeWidth={2} vectorEffect="non-scaling-stroke"
            />

            {/* 预测起点分界线 */}
            <line
              x1={originX} x2={originX} y1={20} y2={TIMELINE_HEIGHT - 14}
              stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* 预测起点标签 */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-medium shadow-xs"
            style={{ left: percent(originX), backgroundColor: "var(--primary)", color: "var(--on-primary)" }}
          >
            预测起点
          </span>

          {/* 随访节点：HTML 按钮，点击即设为预测起点 */}
          {visits.map((visit, index) => {
            const isInput = index < activeContext;
            const isHidden = !isInput && !revealed;
            const isObserved = !isInput && revealed;
            const isSelected = index === selectedIndex;
            const disabled = index >= safeMaxContext;
            const treatments = visit.treatments;
            const dotBorderColor = isSelected
              ? "var(--primary)"
              : isHidden
                ? "var(--outline)"
                : isInput
                  ? "var(--chart-history)"
                  : "var(--chart-observed)";
            const dotFill = isSelected
              ? "var(--primary)"
              : isHidden || isObserved
                ? "transparent"
                : "var(--chart-history)";
            const label = `第 ${index + 1} 次随访，Day ${days[index]}${isSelected ? "，当前预测起点" : "，设为预测起点"}，${isHidden ? "后续观测待揭示" : isObserved ? "后续观测（未输入）" : "模型输入"}${!isHidden && treatments.length > 0 ? `，该次访视记录治疗：${treatments.map(treatmentText).join("、")}` : ""}${disabled ? "，超出模型可输入随访上限" : ""}`;
            return (
              <button
                key={index}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={label}
                title={label}
                onClick={() => onSelect(index + 1)}
                className="pointer-events-auto absolute flex w-[84px] -translate-x-1/2 flex-col items-center rounded-md px-0.5 pb-1 text-center outline-none transition-colors hover:bg-surface-low focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-lowest disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                style={{ left: percent(xs[index]), top: NODE_TOP }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 bg-surface-lowest"
                  style={{ borderColor: dotBorderColor, borderStyle: isHidden ? "dashed" : "solid" }}
                >
                  <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotFill }} />
                </span>
                <span
                  className={isSelected ? "mt-1 text-[11px] font-semibold" : "mt-1 text-[11px] font-medium"}
                  style={isSelected ? { color: "var(--primary)" } : undefined}
                >
                  第 {index + 1} 次
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">Day {days[index]}</span>
                {isSelected ? <span className="text-[10px] font-medium leading-tight" style={{ color: "var(--primary)" }}>预测起点</span> : null}
                {isInput && !isSelected ? <span className="text-[10px] leading-tight text-muted-foreground">模型输入</span> : null}
                {isHidden ? <span className="text-[10px] leading-tight text-muted-foreground">待揭示</span> : null}
                {isObserved ? <span className="text-[10px] leading-tight text-muted-foreground">后续观测<br />（未输入）</span> : null}
                {!isHidden && treatments.length > 0 ? (
                  <span className="mt-0.5 flex flex-col gap-0.5">
                    {treatments.slice(0, 2).map((treatment, treatmentIndex) => (
                      <span key={treatmentIndex} className="flex flex-col leading-tight">
                        <span className="text-[10px] text-on-surface">{treatmentLabels[treatment.modality] ?? treatment.modality}</span>
                        <span className="text-[10px] text-muted-foreground">强度 {formatIntensity(treatment.dose_intensity)}</span>
                      </span>
                    ))}
                    {treatments.length > 2 ? <span className="text-[10px] leading-tight text-muted-foreground">等 {treatments.length} 项</span> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <Table>
        <TableCaption>
          缺失指标显示“未采集”。治疗记录为该次访视记录，不表示持续用药；模型基线延续输入末次治疗向量。预测起点之后的观测默认隐藏（“待揭示”），揭示后仅作回顾对照。
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>随访 / 起点</TableHead>
            <TableHead>相对诊断日</TableHead>
            <TableHead>治疗事件</TableHead>
            {demoFeatures.map(feature => (
              <TableHead key={feature.key}>
                {feature.title}
                <span className="font-normal text-muted-foreground"> ({feature.unit})</span>
              </TableHead>
            ))}
            <TableHead>数据用途</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visits.map((visit, index) => {
            const visible = index < activeContext || revealed;
            if (!showHiddenRows && !visible) return null;
            const isSelected = index === selectedIndex;
            const value = (key: string) => {
              if (!visible) return "待揭示";
              const parsed = featureValue(visit, key);
              return parsed === null ? "未采集" : formatNumber(parsed);
            };
            return (
              <TableRow
                key={index}
                data-state={isSelected ? "selected" : undefined}
                style={isSelected ? { backgroundColor: "color-mix(in oklab, var(--primary-container) 65%, transparent)" } : undefined}
              >
                <TableCell>
                  <Button
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    disabled={index >= safeMaxContext}
                    aria-pressed={isSelected}
                    aria-label={`以第 ${index + 1} 次随访（Day ${days[index]}）为预测起点`}
                    onClick={() => onSelect(index + 1)}
                  >
                    第 {index + 1} 次{isSelected ? " · 起点" : ""}
                  </Button>
                </TableCell>
                <TableCell>Day {days[index]}</TableCell>
                <TableCell>
                  {!visible
                    ? "待揭示"
                    : visit.treatments.length > 0
                      ? visit.treatments.map((treatment, treatmentIndex) => (
                          <div key={treatmentIndex}>
                            {treatmentLabels[treatment.modality] ?? treatment.modality} · Day {treatment.days_from_index} · 强度 {formatIntensity(treatment.dose_intensity)}
                          </div>
                        ))
                      : "无治疗记录"}
                </TableCell>
                {demoFeatures.map(feature => <TableCell key={feature.key}>{value(feature.key)}</TableCell>)}
                <TableCell>
                  {isSelected ? "模型输入 · 预测起点" : index < activeContext ? "模型输入" : revealed ? "后续观测（未输入）" : "隐藏观测"}
                </TableCell>
              </TableRow>
            );
          })}
          {hiddenCount > 0 ? (
            <TableRow className="bg-surface-low/60">
              <TableCell colSpan={4 + demoFeatures.length}>
                <button
                  type="button"
                  onClick={() => setShowHidden(value => !value)}
                  aria-expanded={showHidden}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span aria-hidden="true" className="text-xs">{showHidden ? "▾" : "▸"}</span>
                  <span>
                    {showHidden
                      ? `收起 ${hiddenCount} 次后续观测占位行（仍显示“待揭示”）`
                      : `已隐藏 ${hiddenCount} 次后续观测（点击展开占位行，仍显示“待揭示”）`}
                  </span>
                </button>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  );
}
