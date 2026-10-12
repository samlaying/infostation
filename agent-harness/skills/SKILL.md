---
name: "cli-anything-infostation"
description: >-
  Agent-native CLI for InfoStation — an AI-driven personal information hub. Capture URLs/text/ideas,
  let the SiMi agent clean/summarize/categorize them into knowledge cards with extracted TODOs, then
  manage everything (cards, TODO board, analytics, weekly reports, backups) through the REST API.
  Covers every web UI operation. Zero Python dependencies.
---

# cli-anything-infostation

InfoStation（AI 驱动的个人信息处理中枢）的 Agent 原生 CLI。录入 → Agent 清洗/分类/TODO 提取 → 知识卡片与行动清单，网页端所有操作均可通过本 CLI 完成。纯 Python 标准库实现，零依赖。

## Installation

```bash
# 从 InfoStation 仓库安装
pip install -e /path/to/WUGENG/agent-harness

# 或从 Git
pip install git+https://github.com/samlaying/infostation.git#subdirectory=agent-harness
```

**Prerequisites:**
- Python 3.8+
- InfoStation 服务运行中（本地 `npm run dev` 或线上 http://<服务器IP>:3000）
- 服务端配置了 `API_TOKEN` 时需要 token（见下）

## Configuration

```bash
# 保存连接（一次即可，存 ~/.config/infostation-cli/config.json）
cli-anything-infostation config save --url http://<服务器IP>:3000 --token <API_TOKEN>

# 也可用环境变量：INFOSTATION_URL / INFOSTATION_TOKEN
# 查看当前配置
cli-anything-infostation config show
```

## 能力自发现

Agent 优先调用此命令，可拿到全部端点、参数枚举与当前 Agent 引擎状态，无需读文档：

```bash
cli-anything-infostation agent capabilities
```

## Command Groups

输出恒为 JSON（stdout）；错误输出 JSON 到 stdout+stderr 并退出码 1。

### process — 信息录入（核心）

| Command | Description |
|---------|-------------|
| `add <content> [--category --priority --note]` | 录入 URL/文本/想法 → Agent 处理 → 卡片+TODO（URL 自动抓取正文；重复内容返回 409） |
| `url <url>` | URL 抓取预览（不落库） |

```bash
cli-anything-infostation process add "https://mp.weixin.qq.com/s/xxx"
cli-anything-infostation process add "建议每天写500字锻炼表达" --category media
```

### items — 知识卡片

| Command | Description |
|---------|-------------|
| `list [--q --category --type --priority --platform --tag --todo --sort --page --size]` | 列表：筛选/全文搜索/排序/分页 |
| `get <id>` | 详情（含提取的 TODO 与关联内容） |
| `update <id> [--title --summary --category --type --priority --tags a,b]` | 编辑 |
| `delete <id>` | 删除（级联删 TODO） |

### todos — TODO 面板

| Command | Description |
|---------|-------------|
| `list [--view today/pending/done] [--category --priority --status --source-item]` | 今日待办/全部/完成记录 |
| `create <title> [--category --priority --deadline --source-item --desc]` | 手动创建 |
| `update <id> [--status done/in_progress/pending/archived --deadline ...]` | 完成/归档/改期/编辑（`--deadline ""` 清除） |
| `delete <id>` | 删除 |

### stats / weekly — 看板与周报

| Command | Description |
|---------|-------------|
| `stats overview` | 总量/趋势(7&30天)/分类与平台分布/标签TOP10/完成率/目标进度 |
| `weekly show [--refresh]` | 本周周报（KPI/高频标签/完成清单/下周待执行/Agent 建议） |
| `weekly history` | 历史周报 |

### settings — 设置

| Command | Description |
|---------|-------------|
| `show` | Agent 引擎状态（llm/mock+模型）、目标偏好、数据量 |
| `goals <career,media,sidehustle>` | 保存目标领域偏好（影响 Agent 分类与 TODO 匹配） |

### backup — 数据管理

| Command | Description |
|---------|-------------|
| `export [--out file.json]` | JSON 全量备份 |
| `markdown [--out file.md]` | Markdown 知识归档 |
| `import <file.json>` | 备份导入 |
| `clear --yes` | 清空全部数据（危险） |

### config — 连接配置

| Command | Description |
|---------|-------------|
| `show` | 当前连接配置（token 掩码显示） |
| `save --url --token` | 保存到 `~/.config/infostation-cli/config.json` |

## 典型 Agent 工作流

```bash
# 1. 探测能力
cli-anything-infostation agent capabilities

# 2. 录入今天刷到的内容（Agent 自动分类+提取TODO）
cli-anything-infostation process add "副业案例：帮本地商家做AI代运营，单条文案50-200元，先注册小红书企业号接单"

# 3. 查看今日待办并完成一条
cli-anything-infostation todos list --view today
cli-anything-infostation todos update <todo_id> --status done

# 4. 周日生成周报
cli-anything-infostation weekly show --refresh

# 5. 备份
cli-anything-infostation backup export --out backup.json
```

## Notes

- 服务端未配置 `API_TOKEN` 时接口开放（仅建议本地）；线上实例已启用鉴权
- Agent 引擎未配 LLM Key 时自动降级规则引擎（mock），`settings show` 可查当前模式
- `process add` 处理耗时取决于 LLM 响应（默认超时 90s，可用 `INFOSTATION_TIMEOUT` 调整）
