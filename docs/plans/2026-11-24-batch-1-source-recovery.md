# 第一批开发任务：补齐数据源码并验证干净检出

2026-11-24 · HCC 研究原型 · 单人开发

**完成标准：** 对同一个候选提交，从干净检出安装依赖，运行现有测试，生成合成数据，完成短训练与评估，并用新权重启动推理。最小 CI 检查复用同一验证流程。构建全部使用合成数据。

本批只处理源码完整性、实际命中的忽略规则和验证入口。配置重构、病种模块拆分、患者切分升级及预测时间语义留在后续批次。背景见[目录结构优化建议](2026-11-24-repository-structure-review.md)。

## 1. 确认缺失范围和源码来源

在日常开发仓库根目录执行：

```bash
git status --short
git fetch origin main
git ls-tree -r --name-only origin/main -- packages/data
git ls-files -- packages/data
git status --short --ignored -- packages/data
git check-ignore -v --no-index -- packages/data/schemas.py packages/data/dataset.py packages/data/synthetic_generator.py packages/data/disease_simulator.py
rg -n 'packages\.data|from \.' packages/data packages/training packages/world_model apps/back scripts tests
```

如果本地也没有 `packages/data/`，从最后一条命令的参数中移除这个路径。若 `git check-ignore` 没有输出且返回 1，表示这些路径没有命中规则。

- 已确认 GitHub `main` 上 `packages/data/dataset.py` 仍返回 404。此前审阅还发现 Schema 和模拟器路径不可读。根 `.gitignore` 中的 `data/` 是优先核查的原因，以上命令用于确认现在的实际状态。
- 本地有文件时，核对它们与生成、训练、评估和推理调用方的导入及接口一致。以 import 链为准补齐实际使用的源码和包初始化文件。
- 本地缺失时，可用 `git log --all -- packages/data` 查找已有实现，再检查其他开发分支或同版本工作副本。如果找不到兼容源码，记录缺失文件与调用方，将源码恢复列为阻塞项。

## 2. 修正规则并检查暂存范围

如果实际命中根 `.gitignore` 的 `data/`，核实数据输出目录。若原规则只需覆盖根目录下的 `data/`，将它锚定为 `/data/`。若还有其他目录存放产物，用明确的产物路径覆盖它们。重复运行上节的忽略检查，并确认实际落盘的轨迹和权重仍被忽略。

仅暂存改动过的忽略规则和核对过的源码文件。提交前运行：

```bash
git diff --cached --name-status
git diff --cached --check
```

**验收：** 数据包的必需源码都进入候选提交，患者数据、本地环境文件、生成的轨迹和训练产物都在暂存清单之外。

## 3. 从候选提交做干净检出验收

在日常开发仓库提交本批修复后，创建独立工作树。下面的命令假设当前目录是开发仓库根目录，`python3.12` 已安装且目标工作树路径尚未占用。使用对应候选提交的 SHA 记录结果。

```bash
git worktree add --detach ../mwm-batch1-smoke HEAD
cd ../mwm-batch1-smoke
git rev-parse HEAD
git status --short --untracked-files=all
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install -e .
python -c 'import packages.data.schemas, packages.data.dataset, packages.data.synthetic_generator, packages.training.train, apps.back.main'
python -m pytest -q
```

空的 Git 状态表示起点干净。任何步骤失败先停止并记录失败点。以下命令在第一次运行时使用全新的产物目录。重跑时使用新的目录或新的工作树，以免旧产物掩盖失败。

```bash
export PYTHONPATH=.
python scripts/generate_data.py --n 100 --seed 42 --out artifacts/batch1-smoke/data
python scripts/train_world_model.py --data artifacts/batch1-smoke/data --out artifacts/batch1-smoke/model --max-patients 100 --epochs 2 --seed 42 --device cpu --no-eval
python scripts/evaluate_model.py --checkpoint artifacts/batch1-smoke/model/best.pt --data artifacts/batch1-smoke/data --split test --device cpu --report reports/batch1-smoke.json
MWM_CHECKPOINT=artifacts/batch1-smoke/model/best.pt MWM_DATA_DIR=artifacts/batch1-smoke/data MWM_DEVICE=cpu python -m uvicorn apps.back.main:app --host 127.0.0.1 --port 8000
```

在另一个终端运行 `curl -fsS http://127.0.0.1:8000/health`。通过服务的 OpenAPI 页面从患者列表选一个实际存在的合成患者，调用一次预测。验证完后停止服务。

| 检查 | 通过条件 |
| --- | --- |
| 导入与测试 | 依赖安装成功，关键模块可导入，仓库现有测试通过 |
| 数据生成 | 生成清单，包含 100 个合成患者标识 |
| 训练与评估 | 新生成 `best.pt`，评估读取同一批数据和权重，产生测试集报告 |
| 推理 | 健康检查和一次预测成功，返回研究用途与合成数据标记 |
| 版本控制 | 合成数据、权重和评估产物未进入提交 |

两轮训练用于验证链路，指标只记录，不设超越基线的门槛。

## 4. 最小 CI 检查

将已通过的干净检出流程接入 GitHub CI。使用 Python 3.12、CPU 和新检出，依次运行依赖安装、模块导入、现有测试、合成数据生成、短训练和独立评估。随后启动推理服务，用有超时上限的健康检查等待就绪，并用本次生成的患者完成一次预测，结束时停止服务。任何检查失败都应以非零状态结束；排查时查看首个失败步骤及服务日志。工作流从当前分支生成产物，避免跨次运行复用模型权重。

首次验收时记录候选 SHA、Python 版本、测试通过数量、评估报告路径、健康检查和预测结果，以及 CI 运行链接。只有修复和上述检查均完成，才关闭第一批任务。
