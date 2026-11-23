export function ResearchBanner() {
  return (
    <div className="border-b border-warning-border bg-warning-surface text-warning">
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs sm:px-5 sm:text-sm lg:px-6 xl:px-8">
        <span className="rounded-sm bg-warning/15 px-1.5 py-0.5 font-medium tracking-wide">
          RESEARCH ONLY
        </span>
        <span className="text-warning">
          合成数据 · 非临床决策工具 · 输出须标注 research_only / data_source=synthetic
        </span>
      </div>
    </div>
  );
}
