# DR.SEEK HCC World Model V1.0

肝癌疾病演化 **研究原型（Research Prototype）**。  
30 天计划：合成患者训练 + 公开数据独立验证 + 真实模型推理 + Digital Twin 可视化。  
**不是**已验证的临床决策系统；预测输出须标注 `research_only=true`。

> 旧版 ICU vitals MVP 已归档至 [`v-1/`](v-1/)，本仓库主线不再依赖其代码。

详细说明见 [`项目文档/2-项目说明.md`](项目文档/2-项目说明.md)。  
脚手架设计见 [`docs/plans/2026-11-23-hcc-world-model-scaffold-design.md`](docs/plans/2026-11-23-hcc-world-model-scaffold-design.md)。

## 仓库结构

```
apps/front/              # Next.js 演示平台（自行脚手架）
apps/back/               # FastAPI 推理服务
packages/data/           # Schema、合成数据、Dataset
packages/world_model/    # Encoder / Dynamics / Decoder / Risk
packages/training/       # 训练、评估、rollout、基线
packages/imaging/        # 影像实验占位（可延后）
configs/                 # data.yaml / model.yaml / train.yaml
scripts/                 # CLI 入口占位
tests/
artifacts/               # 模型与导出（本地生成，勿提交大文件）
reports/                 # 评估与数据报告
v-1/                     # 归档：旧 Medical World Model MVP
项目文档/
```

当前为 **空模块占位**：各 `.py` 仅有职责说明 docstring，业务代码自行编写。

## 建议开发顺序

1. `packages/data/schemas.py` — 患者 / 观察 / 治疗 / 结局 Schema  
2. `synthetic_generator.py` + `disease_simulator.py` — 合成轨迹  
3. `dataset.py` + `scripts/train_world_model.py` — 端到端训练链路  
4. `apps/back` API（`/health` → forecast / simulate）  
5. `apps/front` 五页：Overview / Patients / World Model / Simulation / Evaluation  

## 环境（自行安装）

```bash
cd /path/to/300-2-1-Medical-World-Model
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=.
```

前端（在 `apps/front` 为空时）：

```bash
cd apps
npx create-next-app@latest front \
  --typescript --tailwind --eslint --app --src-dir --use-npm
```

## 配置

初始超参见 `configs/*.yaml`，需按验证集调整，勿用测试集反复调参。

## 许可与范围

研究用途。合成指标 ≠ 临床证据。公开数据勿与合成轨迹随意拼接成「连续病程」。
