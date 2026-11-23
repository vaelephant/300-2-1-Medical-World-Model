# HCC World Model Studio（Next.js）

DR.SEEK 研究原型前端：Overview / Patients / World Model / Simulation / Evaluation。

## 前置

1. 后端已启动并加载权重：

```bash
# 仓库根目录
PYTHONPATH=. python scripts/serve_api.py --device cpu --port 8000
```

2. 本目录依赖已安装（含 `recharts`）。

## 启动

```bash
cd apps/front
cp .env.local.example .env.local   # 如尚未配置
npm run dev
```

打开 http://localhost:3000

| 页面 | 作用 |
|------|------|
| `/` | API 状态、模型版本、mae_ex_afp 评估摘要 |
| `/patients` | 合成患者列表与随访表 |
| `/world-model` | 输入历史、未输入的后续观测与预测曲线；起点按实际 context 对齐 |
| `/simulation` | 固定未来治疗条件，与延续上下文末次治疗对比 |
| `/evaluation` | 已有测试集报告、逐特征误差和多步 rollout |

顶栏始终显示 **RESEARCH ONLY** 条。

UI 使用 Shadcn Base UI 组件，保留原有主题。模拟仅展示合成模型响应，不提供临床方案推荐。
