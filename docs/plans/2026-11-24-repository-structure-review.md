# 多病种医疗世界模型目录结构优化建议

2026-11-24 · 基于 GitHub `main` 静态审阅

保留现有前端、后端、数据、模型和训练的顶层划分。执行顺序为 **恢复干净检出的 HCC 链路 → 明确配置与运行产物 → 用第二病种验证模块边界 → 收敛推理依赖**。本文件是开发任务与验收清单，实际运行结果由实施时记录。

## P0 · 补齐数据源码，恢复可运行基线

训练、数据生成和推理均导入 `packages.data`。审阅时 GitHub 对 `packages/data/schemas.py`、`dataset.py`、`disease_simulator.py` 返回 404。根 [忽略规则](../../.gitignore) 中的 `data/` 会匹配任意层级同名目录，可能导致本地源码漏提交。先在保存有完整源码的开发机核实实际原因。

```bash
git ls-files -- packages/data
git check-ignore -v --no-index -- packages/data/schemas.py packages/data/dataset.py
git status --short --ignored -- packages/data
```

- 如果缺失文件仍在本地，清点该包中生成、训练和推理实际导入的源码。若规则命中，将 `data/` 缩到真实的数据输出路径。例如在确认产物只落根目录 `data/` 后，使用锚定根目录的 `/data/`。
- 若本地仍找不到文件，从有完整实现的分支或工作副本找回，并核对调用方使用的接口。将数据源码与忽略规则一起提交，提交前检查暂存清单中的文件确实是源码。患者数据、合成轨迹、模型权重和本地配置继续放在对应的忽略范围。
- **验收**：新检出中可直接导入 dataset、schemas、synthetic_generator。安装、测试、数据生成、短训练、评估和权重启动均可在新检出完成。

在已激活的 Python 3.12 环境中，从新检出的仓库根目录运行下列冒烟步骤。短训练检查链路及产物，完整模型表现按研发规划另行评估。

```bash
python -m pip install -r requirements.txt
python -m pip install -e .
python -m pytest -q
PYTHONPATH=. python scripts/generate_data.py --n 100 --seed 42 --out artifacts/structure-smoke/data
PYTHONPATH=. python scripts/train_world_model.py --data artifacts/structure-smoke/data --out artifacts/structure-smoke/model --max-patients 100 --epochs 2 --device cpu
PYTHONPATH=. python scripts/evaluate_model.py --checkpoint artifacts/structure-smoke/model/best.pt --data artifacts/structure-smoke/data --split test --device cpu
MWM_CHECKPOINT=artifacts/structure-smoke/model/best.pt MWM_DATA_DIR=artifacts/structure-smoke/data MWM_DEVICE=cpu PYTHONPATH=. python -m uvicorn apps.back.main:app --host 127.0.0.1 --port 8000
```

服务启动后，检查 `/health` 和 OpenAPI 文档，从患者列表取一个实际患者 ID，分别调用预测和模拟。检查权重加载、预测输出、研究标记、数据来源和模型版本。固定输入重复运行时，检查结果落在约定数值容差内。

## P1 · 明确配置来源和产物契约

当前 [训练 CLI](../../scripts/train_world_model.py) 直接消费参数与默认值，而 [训练 YAML](../../configs/train.yaml) 的批大小为 64，CLI 默认值为 32。生成、训练和评估入口应记录各自的生效参数。

- 最小方案是保留 CLI 为运行入口，把未接线 YAML 标为设计参考。若后续引入 YAML 作为运行配置，统一优先级为显式 CLI 参数、所选配置文件、程序默认值，并对未知字段报错。
- 每次训练记录实际配置、数据及特征字典版本、固定患者切分标识、随机种子与预处理信息。checkpoint 与评估报告记录相同产物标识，推理加载时检查元数据与输入契约是否匹配。
- **验收**：给定一份训练产物，可以查到最终批大小、数据切分和输入特征顺序。遇到模型和特征契约不匹配，服务给出明确错误。

## P1 · 从 HCC 工作流提取病种边界

当前 [模型](../../packages/world_model/model.py) 从 dataset 导入固定特征和治疗维度，[训练](../../packages/training/train.py) 内设 AFP 变换，[评估](../../packages/training/evaluate.py) 直接查找 AFP。单病种阶段这些耦合可以工作。第二病种接入前，将口径集中管理，并由实际接入需求决定公共接口。

| 目录 | 职责 | 实施边界 |
| --- | --- | --- |
| `packages/data/` | 通用患者时间轴、校验、切分和批处理 | 读取病种提供的特征顺序、单位、缺失规则及张量维度 |
| `packages/diseases/hcc/`（拟新增） | HCC 特征与变换、治疗字典、预测目标、合成规则和评估口径 | 普通训练、评估与推理从同一病种定义取值，重点核对 AFP 变换和排除 AFP 的指标 |
| `packages/world_model/` | Encoder、Dynamics、Decoder 及可复用预测逻辑 | 在构造时接收输入和治疗维度。保留当前 HCC 模型及权重加载入口 |
| `packages/training/` | 训练循环、基线比较、评估、报告 | 使用公共指标计算及病种声明的指标口径 |
| `apps/back/`、`apps/front/` | 推理编排和时间轴展示 | 发布结果携带病种和模型版本，界面根据病种元数据显示字段和单位 |

先固定一套可复现的 HCC 数据及权重作为回归样本，再迁移 HCC 口径。旧 checkpoint 需要在兼容加载与显式迁移之间明确选择，避免按新顺序解释旧权重。

**验收**：固定 HCC 案例的特征顺序、变换与评估输出一致。第二病种接入后，以独立数据切分和权重复用训练、预测与展示入口，HCC 同时通过回归。第二病种的队列和数据准入沿用[开发规划](2026-11-24-medical-world-model-development-roadmap.md)。

## P2 · 将推理公共能力移出训练入口

[推理服务](../../apps/back/services/inference.py) 当前依赖训练模块中的设备选择、checkpoint 加载和 rollout。HCC 基线稳定后，将模型加载、设备选择与 rollout 归入 `packages/world_model/` 的推理相关模块，供离线评估和在线 API 共用。迁移后原训练、评估和 API 入口继续使用同一预测实现。

**验收**：固定 checkpoint 与输入在离线评估和 API 上的预测结果一致。能清楚区分缺失权重与版本不匹配。在线服务的导入路径无需加载训练循环。

## 合并顺序

1. **第一批**修复忽略规则与缺失源码，附干净检出的冒烟记录。
2. **第二批**明确配置入口和产物元数据，附一份从配置到预测结果的可追溯记录。
3. **第三批**在第二病种接入时完成口径提取和 HCC 回归。推理依赖整理可单独提交。
4. 每批更新[目录说明](../../项目文档/1-项目结构.md)及[快速启动](../../项目文档/0-快速启动.md)中受影响的路径和命令。

以上调整服务于现有 Monorepo。病种注册服务、独立部署和联合训练留待第二病种验证之后评估。
