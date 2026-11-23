import { Suspense } from "react";
import { ForecastWorkbench } from "@/components/ForecastWorkbench";
export default function Page() { return <Suspense fallback={<p>加载工作台…</p>}><ForecastWorkbench simulation /></Suspense>; }
