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
scripts/                 # 数据生成、训练、评估及 API 启动入口
tests/
artifacts/               # 模型与导出（本地生成，勿提交大文件）
reports/                 # 评估与数据报告
v-1/                     # 归档：旧 Medical World Model MVP
项目文档/
```

当前已实现合成病程、模型训练与评估、权重推理 API，以及「左侧边栏功能分区 + 右侧全宽功能区」的五个前端页面。治疗模拟支持固定未来治疗条件，属于合成数据模型响应实验；影像、风险头训练和不确定性校准尚未完成。

快速启动见 [项目文档/0-快速启动.md](项目文档/0-快速启动.md)。

## 主链路

1. `packages/data/schemas.py` — 患者 / 观察 / 治疗 / 结局 Schema  
2. `synthetic_generator.py` + `disease_simulator.py` — 合成轨迹  
3. `dataset.py` + `scripts/train_world_model.py` — 端到端训练链路  
4. `apps/back` API（`/health` → forecast / simulate；`/api/v1/provenance` / `training` / `models/checkpoints` / `evaluations/reports` 暴露训练与评估产物 metadata）  
5. `apps/front` 五页：Overview / Patients / World Model / Simulation / Evaluation（侧边栏分组：演示工作台 / 世界模型 / 模型证据）  

## 环境（自行安装）

```bash
cd /path/to/300-2-1-Medical-World-Model
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=.
```

前端：

```bash
cd apps/front
npm install
cp .env.local.example .env.local # 首次配置
npm run dev
```

页面：英文路由 Overview / Patients / World Model / Simulation / Evaluation，侧边栏对应中文功能项「演示总览 / 患者病程 / 队列探索 / 病程预测 / 治疗情景 / 训练监控 / 模型评估」；`/world-model` 定起点并预测，`/simulation` 做同起点情景比较与回顾对照。  
3–5 分钟演示脚本（5 个精选病例、参数解释、边界话术）见 [项目文档/4-演示流程.md](项目文档/4-演示流程.md)。

预测使用前 `context_len` 次随访，从最后一个输入观测日开始；超过可用长度时按实际长度截断。后续观测仅供回顾比较。`/simulate` 接收 `treatment_modality` 与 `[0,1]` 的 `dose_intensity`，覆盖每个未来步的治疗向量，不修改历史。省略治疗类别时与 forecast 相同。该接口不验证因果疗效。

## 配置

初始超参见 `configs/*.yaml`，需按验证集调整，勿用测试集反复调参。

## 许可与范围

研究用途。合成指标 ≠ 临床证据。公开数据勿与合成轨迹随意拼接成「连续病程」。
