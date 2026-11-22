# HCC World Model V1.0 — 脚手架设计（仅结构）

**日期：** 2026-11-23  
**范围：** Monorepo 目录 + 空模块占位 + 说明文档。**不含业务实现**（由开发者自行编写）。  
**归档：** `v-1/` 为旧 ICU MVP，本仓库新主线为肝癌（HCC）世界模型研究原型。

## 目标

在 30 天计划（2026.11.22—12.21）下，先固定工程边界，使后续可按日填充：

1. 合成患者轨迹与数据校验  
2. 概率世界模型训练与对照实验  
3. FastAPI 推理 + Next.js Digital Twin Studio  

## 架构（占位级）

```
apps/front     → Next.js 演示（自行 create-next-app）
apps/back      → FastAPI 推理服务（自行实现 routes/services）
packages/data          → Schema、合成生成、模拟器、Dataset
packages/world_model   → Encoder / Dynamics / Decoder / Risk
packages/training      → train / evaluate / rollout / baselines
packages/imaging       → 影像实验占位（P0 可空）
configs/               → data / model / train YAML
scripts/               → CLI 入口占位
tests/                 → 测试占位
artifacts/ / reports/  → 运行产物与报告（gitignore）
```

命名采用 `项目文档/1-项目结构.md`：`apps/front` + `apps/back`。

## 非目标（本脚手架）

- 不实现合成数据、训练循环、API 业务、前端页面逻辑  
- 不调用 `create-next-app`、不安装依赖、不提交训练权重  
- 不修改 `v-1/` 内容  

## 验收

- 目录与空模块文件存在且路径与 `项目文档/1-项目结构.md` 一致  
- `README.md` 说明如何自行填充与启动  
- `v-1/` 保持归档不动  

## 建议实现顺序（供自行编码）

1. D02 `packages/data/schemas.py`  
2. D03–D04 合成生成器与疾病模拟器  
3. D06 基线 + 世界模型训练脚本  
4. API `/health` → forecast/simulate  
5. 前端五页 Studio  
