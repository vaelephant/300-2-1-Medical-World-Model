// /architecture 页的静态结构定义（文字/文件路径）。
// 所有数字来自 /api/v1/schema、/api/v1/models、/api/v1/training；缺失时显示 —。

import type { ModelSchema, TrainingInfo } from "@/lib/types";

export type StageContext = {
  schema: ModelSchema | null;
  training: TrainingInfo | null;
};

export type StageDef = {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  input: (ctx: StageContext) => string;
  output: (ctx: StageContext) => string;
  dims: (ctx: StageContext) => Array<{ label: string; value: string }>;
  codeFiles: string[];
  description: string;
  boundaries: string[];
};

function num(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

function splitsText(training: TrainingInfo | null): string {
  const splits = training?.splits;
  if (!splits) return "—";
  const values = [splits.n_train, splits.n_val, splits.n_test];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return "—";
  }
  return `${values[0]} / ${values[1]} / ${values[2]}`;
}

export const STAGES: StageDef[] = [
  {
    id: "synthetic",
    index: 1,
    title: "合成轨迹",
    subtitle: "患者 × 随访",
    input: () => "患者 × 随访（合成队列）",
    output: (ctx) =>
      `${num(ctx.schema?.feature_dim)} 临床特征 + ${num(ctx.schema?.feature_dim)} 维 missing mask + 治疗事件 + Δt`,
    dims: (ctx) => [
      { label: "临床特征 dim", value: num(ctx.schema?.feature_dim) },
      { label: "missing mask dim", value: num(ctx.schema?.feature_dim) },
      { label: "治疗类别", value: num(ctx.schema?.treatment_modalities?.length) },
      { label: "随访上限", value: num(ctx.schema?.max_visits) },
    ],
    codeFiles: [
      "packages/data/synthetic_generator.py",
      "packages/data/disease_simulator.py",
      "artifacts/synthetic/manifest.json",
    ],
    description:
      "由合成数据生成器按疾病模拟器生成患者轨迹；包含每次随访的临床特征、缺失掩码、治疗事件与结局。",
    boundaries: [
      "合成数据，不是真实患者；不得当作临床证据。",
      "manifest.json 记录 seed / n / data_source，provenance 可在 /training、/evaluation 查看。",
    ],
  },
  {
    id: "tensor",
    index: 2,
    title: "Tensor / DataLoader",
    subtitle: "batch 化与切分",
    input: (ctx) =>
      `x_t(${num(ctx.schema?.feature_dim)}) + m_t(${num(ctx.schema?.feature_dim)}) + a_t(${num(
        ctx.schema?.treatment_dim,
      )}) + Δt(1)`,
    output: (ctx) => `encoder_input_dim = ${num(ctx.schema?.encoder_input_dim)}`,
    dims: (ctx) => [
      { label: "x_t（临床特征）", value: num(ctx.schema?.feature_dim) },
      { label: "m_t（missing mask）", value: num(ctx.schema?.feature_dim) },
      { label: "a_t（治疗向量）", value: num(ctx.schema?.treatment_dim) },
      { label: "Δt", value: "1" },
      { label: "train / val / test", value: splitsText(ctx.training) },
    ],
    codeFiles: ["packages/data/dataset.py", "packages/data/splits.py", "packages/data/schemas.py"],
    description:
      "把每位患者的轨迹转换成张量 batch；治疗维度由 one-hot 类别 + dose_intensity 组成（见 schema.treatment_dim_note）。normalizer 仅在 train split 上拟合，避免泄漏。",
    boundaries: [
      "缺失值用 mask 标记，不当作 0 参与 loss。",
      "train / val / test 人数取自 /api/v1/training；不可用时显示 —。",
    ],
  },
  {
    id: "encoder",
    index: 3,
    title: "Encoder · GRU",
    subtitle: "逐随访编码",
    input: (ctx) => `encoder_input_dim = ${num(ctx.schema?.encoder_input_dim)}`,
    output: (ctx) =>
      `hidden ${num(ctx.schema?.hidden_dim)} → latent z_t ${num(ctx.schema?.latent_dim)}`,
    dims: (ctx) => [
      { label: "hidden_dim", value: num(ctx.schema?.hidden_dim) },
      { label: "latent_dim", value: num(ctx.schema?.latent_dim) },
      { label: "dropout", value: num(ctx.schema?.dropout) },
      { label: "结构", value: "GRU（config.encoder）" },
    ],
    codeFiles: ["packages/world_model/encoder.py", "packages/world_model/model.py"],
    description:
      "GRU encoder 按时间顺序读取每次随访，输出 latent z_t；dropout 与 hidden/latent 维度来自当前 checkpoint 的 config。",
    boundaries: [
      "latent 不可直接解释为临床状态；/latent 页只是它的 PCA 投影，坐标轴无临床含义。",
      "维度来自 /api/v1/schema；schema 不可用时显示 —。",
    ],
  },
  {
    id: "dynamics",
    index: 4,
    title: "Dynamics · MLP",
    subtitle: "latent 状态转移",
    input: (ctx) =>
      `z_t(${num(ctx.schema?.latent_dim)}) + a_t(${num(ctx.schema?.treatment_dim)}) + Δt(1)`,
    output: (ctx) => `z_{t+1} (${num(ctx.schema?.latent_dim)})`,
    dims: (ctx) => [
      { label: "实现", value: "MLP 均值动力学" },
      { label: "multi_step", value: num(ctx.schema?.multi_step) },
      { label: "multi_step_weight", value: num(ctx.schema?.multi_step_weight) },
      { label: "分布输出", value: "无（确定性均值）" },
    ],
    codeFiles: ["packages/world_model/dynamics.py", "packages/world_model/losses.py"],
    description:
      "当前实现用 MLP 预测 latent 下一步状态（确定性均值），不使用概率分布；multi_step 与权重来自 config。",
    boundaries: [
      "不确定性 / 校准未完成：forecast 的 uncertainty 为 null，不能画置信区间。",
      "本页不展示任何未实现的概率模块。",
    ],
  },
  {
    id: "decoder",
    index: 5,
    title: "Decoder · residual",
    subtitle: "回到临床特征空间",
    input: (ctx) => `z_{t+1} (${num(ctx.schema?.latent_dim)})`,
    output: (ctx) =>
      `Δx̂(${num(ctx.schema?.feature_dim)}) → x̂_{t+1} = x_t + Δx̂（${num(
        ctx.schema?.feature_dim,
      )} 特征）`,
    dims: (ctx) => [
      { label: "输出特征数", value: num(ctx.schema?.feature_dim) },
      { label: "residual", value: ctx.schema ? (ctx.schema.residual ? "是" : "否") : "—" },
      { label: "反归一化", value: "normalizer.inverse_transform" },
      { label: "推理入口", value: "/forecast · /simulate" },
    ],
    codeFiles: ["packages/world_model/decoder.py", "packages/training/rollout.py"],
    description:
      "residual decoder 预测相对上一随访的变化量，再与上一随访相加得到下一步特征；residual 开关来自 schema。",
    boundaries: [
      "输出是合成特征空间的预测，不代表真实临床轨迹。",
      "residual 关闭时解码器输出绝对特征；本页按当前 schema 显示。",
    ],
  },
];

export type BranchDef = {
  id: "training" | "evaluation" | "inference";
  title: string;
  subtitle: string;
  steps: string[];
  codeFiles: string[];
  href: string;
  hrefLabel: string;
};

export const BRANCHES: BranchDef[] = [
  {
    id: "training",
    title: "训练链路",
    subtitle: "同一个模型如何被训练出来",
    steps: [
      "normalizer 仅用 train split 拟合",
      "masked MSE + multi-step loss（multi_step / multi_step_weight 来自 schema）",
      "AdamW + early stopping（patience 见 train_meta.json）",
      "产出 best.pt / last.pt / train_meta.json（history、splits）",
    ],
    codeFiles: ["packages/training/train.py", "packages/world_model/losses.py"],
    href: "/training",
    hrefLabel: "去训练监控",
  },
  {
    id: "evaluation",
    title: "评估链路",
    subtitle: "如何判断模型误差",
    steps: [
      "与 Persistence baseline 对照",
      "MAE / RMSE：含 AFP、排除 AFP、宏平均",
      "多步 rollout（context_len 来自报告）",
      "产出 reports/*.json；/evaluation 支持 A/B 报告对比",
    ],
    codeFiles: ["packages/training/evaluate.py", "packages/training/baselines.py"],
    href: "/evaluation",
    hrefLabel: "去模型评估",
  },
  {
    id: "inference",
    title: "推理链路",
    subtitle: "前端预测与情景比较",
    steps: [
      "POST /api/v1/forecast：patient_id + context_len + horizon",
      "POST /api/v1/simulate：未来治疗条件覆盖（modality + dose）",
      "latent rollout → residual decoder → 特征序列",
      "uncertainty unavailable（null），不展示置信区间",
    ],
    codeFiles: ["apps/back/services/inference.py", "apps/back/routes/forecast.py", "apps/back/routes/simulate.py"],
    href: "/world-model",
    hrefLabel: "去病程预测",
  },
];

export const NOT_IMPLEMENTED = [
  {
    title: "预测不确定性 / 校准",
    detail:
      "forecast 返回的 uncertainty 为 null；MVP 动力学是确定性均值模型，未输出预测分布。本页与预测页都不展示置信区间。",
  },
  {
    title: "Risk head",
    detail:
      "packages/world_model/risk_head.py 存在，但当前未训练、未接入 API，因此页面不展示风险评分。",
  },
  {
    title: "影像 / Imaging",
    detail:
      "packages/imaging 是占位，没有 CT / 影像输入或输出；本页不画影像流程，也不把影像当作输入。",
  },
];
