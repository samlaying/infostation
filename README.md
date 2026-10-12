# InfoStation · 信息处理站

> AI 驱动的个人信息处理中枢 —— 喂给它碎片信息，它还给你行动清单。
>
> 基于 `prd.md`（产品需求）与 `guide.md`（Dark Glassmorphism 设计规范）实现的**前后端分离**应用。

## 架构

```
WUGENG/
├── guide.md / prd.md        # 设计规范与产品需求
├── server/                  # 后端 API（Node.js + Express + SQLite）
│   ├── src/
│   │   ├── routes/          # process / items / todos / extract / stats / weekly / settings / backup
│   │   ├── services/        # agent(LLM) / mock-agent / extractor(URL抓取) / dedup(判重) / weekly
│   │   └── prompts/simi.js  # 「私秘」Agent 系统提示词
│   ├── scripts/seed.js      # 示例数据
│   └── data/                # SQLite 数据文件（自动创建，gitignore）
└── client/                  # 前端 SPA（Vue 3 + Vite + Pinia + Vue Router）
    └── src/views/           # 工作台 / 信息库 / TODO面板 / 数据看板 / 周报 / 设置
```

- **后端**：`http://localhost:3000/api/v1`，SQLite 使用 Node 内置 `node:sqlite`（需 **Node ≥ 22.5**，零原生编译依赖）
- **前端**：`http://localhost:5173`，Vite 代理 `/api` → 后端

## 快速开始

```bash
# 1. 安装依赖（前后端一起装）
npm run setup

# 2. 配置环境变量（可选——不配也能跑，走规则引擎 Mock 模式）
cp server/.env.example server/.env
# 编辑 server/.env，填入 LLM_API_KEY

# 3. 灌入示例数据（可选，让看板/周报开箱即有内容）
npm run seed

# 4. 一键启动前后端
npm run dev
```

打开 http://localhost:5173

## LLM 配置（OpenAI 兼容接口）

在 `server/.env` 中配置，**API Key 只存在后端，前端不可见**：

```env
LLM_BASE_URL=https://api.deepseek.com   # DeepSeek
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-chat
```

| 提供商 | LLM_BASE_URL | LLM_MODEL |
|--------|-------------|-----------|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

- **配了 Key** → 「私秘」Agent 全量能力：精准摘要、语义分类、智能 TODO 提取、关联建议
- **没配 Key** → 自动降级为内置规则引擎（关键词分类 + 行动动词 TODO 提取），全流程照常可用，顶栏显示「Mock 模式」
- LLM 调用失败时也会自动降级到规则引擎，不阻断录入

## Agent API（让本机 Agent 操作网页端的一切）

线上实例已启用鉴权。任意 OpenAI 兼容 Agent / CLI / 脚本均可通过 REST API 完成网页全部操作：

```bash
# 1. 能力自发现（推荐 Agent 首先调用）：返回全部端点+参数+枚举
curl -H "Authorization: Bearer $TOKEN" http://<服务器IP>:3000/api/v1/agent/capabilities

# 2. 例如录入处理
curl -X POST http://<服务器IP>:3000/api/v1/process \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"一段文字或URL"}'
```

**配套 CLI**（[CLI-Anything](https://github.com/HKUDS/CLI-Anything) 规范，零依赖 Python）：`agent-harness/` 目录，
`cli-anything-infostation` 命令，输出恒为 JSON。本机已安装并注册 skill（`~/.claude/skills/cli-anything-infostation`），
连接配置存于 `~/.config/infostation-cli/config.json`。

```bash
cli-anything-infostation agent capabilities            # 能力自发现
cli-anything-infostation process add "内容或URL"        # 录入 → 卡片+TODO
cli-anything-infostation todos list --view today       # 今日待办
cli-anything-infostation todos update <id> --status done
```

鉴权：服务端 `.env` 的 `API_TOKEN`（`openssl rand -hex 24` 生成）；未配置则接口开放（仅限本地开发）。

## 功能清单（PRD P0 + P1）

- **M1 信息采集**：URL 自动抓取（通用网页 / 公众号；小红书、推特等登录墙平台优雅降级提示手动粘贴）、文本/想法录入、可选预设分类与优先级
- **M2 Agent 处理**：清洗 → 摘要（≤100字）→ 分类（6 领域）→ 打标（3-5 个）→ TODO 提取 → 判重（bigram 相似度 >85% 拦截）
- **M3 TODO 面板**：今日待办 / 目标看板（职场·自媒体·副业三列）/ 全部 / 完成记录；完成、归档、手动新建、超期标红
- **M4 知识卡片**：卡片网格 + 七维筛选（分类/类型/优先级/来源/有TODO/排序）+ 全文搜索 + 详情编辑 + 340px 数据侧栏
- **M5 数据看板**：总量/完成率统计卡、7/30 天趋势折线（纯 SVG）、分类与来源分布、标签 TOP10、三领域目标进度
- **M6 周报**：本周数据 KPI、高频标签、完成清单、下周待执行、规则化 Agent 建议；快照落库可回看历史
- **M7 智能搜索**：标题/摘要/全文/标签全文检索
- **导入导出**：JSON 全量备份/恢复、Markdown 知识归档导出、清空数据

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/process` | 核心处理入口（URL/文本 → 卡片 + TODO） |
| POST | `/api/v1/extract` | URL 抓取预览 |
| GET/PATCH/DELETE | `/api/v1/items[/:id]` | 知识卡片列表/详情/编辑/删除 |
| GET/POST/PATCH/DELETE | `/api/v1/todos[/:id]` | TODO 管理 |
| GET | `/api/v1/stats` | 看板数据 |
| GET | `/api/v1/weekly-report` | 本周周报（?refresh=1 重新生成） |
| GET | `/api/v1/weekly-reports` | 历史周报 |
| GET/PUT | `/api/v1/settings` | 目标偏好 / Agent 状态 |
| GET | `/api/v1/export` · `/export/markdown` | JSON / Markdown 导出 |
| POST | `/api/v1/import` | JSON 导入 |
| DELETE | `/api/v1/data` | 清空数据 |

## 设计规范落地

`client/src/styles/tokens.css` 完整收录 guide.md 设计令牌（色彩/渐变/圆角/阴影/字阶/动效）。

- 玻璃拟态主风格：`rgba(255,255,255,0.05)` + `blur(16px)` + `1px/10%` 边框，hover 上浮 3px
- 深色模式基底 `#0a0e1a`，三光晕球体背景（蓝右上/紫左下/青中央，呼吸动画）
- 优先级红/橙/绿发光圆点；6 分类映射 6 功能色；统计卡渐变顶线
- 响应式：>1024 双栏 / 768–1024 单栏 / <768 移动端竖排

## 重置数据

```bash
rm -rf server/data        # 删除 SQLite 后重启即全新
npm run seed              # 重新灌示例数据
```

## 生产部署（RackNerd）

已部署至 **http://<服务器IP>:3000**（`racknerd-7f2ba7a`，Node v22.22.2）：

- 目录：`/root/infostation/`（server + client/dist）
- 进程：systemd 单元 `infostation.service`（开机自启，`systemctl restart infostation` 重启）
- 形态：Express 同时伺服 API 与前端静态文件（SPA 回退），单端口 3000
- LLM：本机代理 `http://127.0.0.1:7863/v1` · 模型 `cn:glm-5.3-flash`（Key 在服务器 `server/.env`，源于 `/root/workbuddy2api/config.json` 的 `api_key`）

更新部署：本地 `npm --prefix client run build` 后

```bash
rsync -az --delete --exclude node_modules --exclude data --exclude .env server/ racknerd:/root/infostation/server/
rsync -az --delete client/dist/ racknerd:/root/infostation/client/dist/
ssh racknerd 'systemctl restart infostation'
```

> ⚠️ 本机 SSH 到 racknerd 需绕过 FlClash TUN（代理节点封出站 22）：`sudo route add -host <服务器IP> <物理网关>`，详见记忆 `flclash-blocks-port-22`。
