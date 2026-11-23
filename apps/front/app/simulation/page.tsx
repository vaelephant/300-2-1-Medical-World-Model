import { Suspense } from "react";
import { ForecastWorkbench } from "@/components/ForecastWorkbench";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">加载治疗情景工作台…</p>}>
      <ForecastWorkbench mode="simulation" />
    </Suspense>
  );
}
