export function ResearchBanner() {
  return (
    <div className="border-b border-amber-500/30 bg-amber-50 text-amber-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs sm:px-6 sm:text-sm">
        <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 font-medium tracking-wide">
          RESEARCH ONLY
        </span>
        <span className="text-amber-900/90">
          合成数据 · 非临床决策工具 · 输出须标注 research_only / data_source=synthetic
        </span>
      </div>
    </div>
  );
}
