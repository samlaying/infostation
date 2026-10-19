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
| `add <content> [--line trial/media --category --priority --note]` | 录入 URL/文本/想法 → Agent 处理 → 卡片+TODO（URL 自动抓取正文；重复返回 409）。v2 起 Agent 自动识别主题绑定 topic_id，识别不到可提新主题名自动建档 |
| `url <url>` | URL 抓取预览（不落库） |

```bash
cli-anything-infostation process add "https://mp.weixin.qq.com/s/xxx"
cli-anything-infostation process add "建议每天写500字锻炼表达" --category media
# 双线：trial=TODO线(值得试的东西→行动，默认) | media=自媒体线(话题素材→内容工序)
cli-anything-infostation process add "选题｜AI副业过程透明化" --line media
```

### items — 知识卡片

| Command | Description |
|---------|-------------|
| `list [--q --category --type --priority --platform --tag --todo --line --topic --item-type --sort --page --size]` | 列表：筛选/全文搜索/排序/分页；`--topic` 按主题、`--item-type` 按角色(material素材/idea选题/bundle发布包) |
| `get <id>` | 详情（含 TODO、tag_overlap 自动关联） |
| `update <id> [--title --summary --category --type --priority --tags --line --topic --item-type --parent]` | 编辑；`--topic ""` 解除归属、`--parent` 设血缘（bundle→idea→material）；改 line/topic 会经触发器自动同步名下 todos |
| `delete <id>` | 删除（级联删 TODO/资产/帖子/关联） |

### todos — TODO 面板

| Command | Description |
|---------|-------------|
| `list [--view today/pending/done] [--category --priority --status --source-item --line --topic --executor]` | 今日待办/全部/完成记录；`--line trial` 行动项、`--line media` 内容工序、`--topic` 按主题；v2.3 `--executor user(本人的)/agent(任一Agent)/search_agent/local_agent/content_agent` 按承接人过滤 |
| `create <title> [--category --priority --deadline --source-item --line --desc --executor --acceptance]` | 手动创建（line 缺省继承来源卡片；v2.3 可指定承接人，agent 类就绪即自动派工） |
| `update <id> [--status done/in_progress/pending/archived --deadline ... --assigned-agent ...]` | 完成/归档/改期/编辑（`--deadline ""` 清除）；v2.3 手动置 done 会触发放行下一条 agent-TODO + 续推复盘 |
| `delete <id>` | 删除 |

### topics — 主题（v2：主题=目标，一等公民）

| Command | Description |
|---------|-------------|
| `list [--status active/archived]` | 列表，含每主题的卡片数/任务数/最近活跃时间（支撑「7 天荒废」提醒） |
| `create <name> [--icon 🔧 --line trial/media --desc --color --sort]` | 新建主题（name 唯一，重名 409）；`--desc` 是给 Agent 的主题提示词 |
| `update <id> [--name --icon --color --line --desc --status --sort]` | 改名/归档(`--status archived`)/排序/换默认线 |
| `delete <id>` | 删除主题（**卡片保留**，仅解除归属） |

```bash
cli-anything-infostation topics list
cli-anything-infostation topics create "智能家居" --icon 🏠 --line trial --desc "ESP32/传感器/自动化设备"
# 把已有卡片挂到主题（名下 todos 经触发器自动跟随）
cli-anything-infostation items update <item_id> --topic <topic_id>
```

### assets — 媒体资产（v2：Agent 截图/生图/上传）

| Command | Description |
|---------|-------------|
| `list [--item --todo --type screenshot/ai_image/upload/video]` | 按卡片/工序/类型过滤 |
| `add --item <id> --type <t> [--local 路径 --url 图床URL --source 源网页 --prompt 生图提示词 --todo 工序id --metadata JSON]` | 登记资产（local/url 至少一个） |
| `update <id> [--local --url --prompt --metadata]` | 更新（典型：上传图床后回填 `--url`） |
| `delete <id>` | 删除记录 |

### posts — 帖子（v2：多平台发布产出与回执）

| Command | Description |
|---------|-------------|
| `list [--source --topic --platform xiaohongshu/wechat/x/bilibili/zhihu --status draft/ready/publishing/published/failed]` | 列表 |
| `create --source <卡片id> <title> [--platform --body --assets 3,1,5 --topic]` | 创建草稿；`--assets` 决定配图顺序（引用 assets 表 id） |
| `update <id> [--title --body --platform --status --url --assets]` | 状态机 draft→ready→publishing→published/failed；发布成功回填 `--url`（回执链接） |
| `delete <id>` | 删除 |

```bash
# 完整发布链：登记截图 → 组装小红书帖子 → (人工/Agent 发布后) 回填写实
cli-anything-infostation assets add --item <item_id> --type screenshot --local /abs/shot.png --source https://example.com
cli-anything-infostation posts create --source <item_id> "300元周末搞定墨水屏天气站" --platform xiaohongshu --assets 1
cli-anything-infostation posts update 1 --status published --url https://xhs.example/note/123
```

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

### worker — 本地预处理 Worker（v2.2）

服务器在卡片入库后会生成预处理任务（`agent_jobs`：GitHub 检查+Clone / ego 浏览器截图 / Tavily 调研），
其中重型技能需要本机的浏览器登录态与 gh，由本命令认领执行、产物回传服务器落库（截图入 `assets`）。

| Command | Description |
|---------|-------------|
| `worker --once` | 认领并执行一个任务即退出（适合挂在 Agent 会话里） |
| `worker --loop [--interval 8]` | 常驻轮询（适合 `launchd`/tmux 挂后台） |
| `worker --caps browser,gh` | 强制声明能力（默认自动探测 PATH 里的 ego-browser/gh） |

- 能力来源：`ego-browser`（真实登录态浏览器截图）、`gh`（repo 元信息 + README 安装命令 + Clone 到 `~/Workspace/trials/`，可用 `INFOSTATION_TRIALS_DIR` 改目录）
- 网络注意：`gh` 走 shell 环境代理，按项目启动前 `export HTTPS_PROXY=...` 即可；ego 浏览器走自身代理设置
- 前端会实时显示任务进度（呼吸灯），完成后卡片自动挂上截图/Clone 路径/调研简报徽章

### jobs — Agent 任务面板（v2.3：确认门 + 委派执行）

一句话录入后，「私秘」会把内容拆成**带承接人**的步骤链（`assigned_agent`）：
`search_agent`（只读调研，自动执行）→ `local_agent` / `content_agent`（动手/内容，**卡确认门等你批准**）→ `user`（本人做）。
动手类步骤会在 `awaiting_user` 状态等你决定，批准后由本地 Agent 执行，完成后系统**续推**下一步自动进 TODO。

| Command | Description |
|---------|-------------|
| `jobs list [--status --item --todo --limit]` | 任务列表（status 含 `awaiting_user`） |
| `jobs awaiting` | 列出等你确认的任务 |
| `jobs approve <id>` | 批准执行（放行给 Agent） |
| `jobs skip <id>` | 跳过该步骤，继续推进 |
| `jobs claim [--caps agent]` | **AI Agent 会话**认领委派任务（agent_task）；返回 `step.params` 含 title/description/acceptance 执行指令 |
| `jobs complete <job> <step> --result "报告" [--title t] [--asset 任意文件] [--result-file 报告.md] [--fail]` | 回传执行结果（报告写进卡片 agent_note；**产物务必 --asset 上传**——图片/文档任意类型，落卡片资产区可在线查看；--result-file 把整份文本文件内容作为报告正文；--result 作为失败原因配 --fail） |

```bash
# 确认门工作流（网页 Inspector 也可以点按钮，两入口等价）
cli-anything-infostation jobs awaiting
cli-anything-infostation jobs approve 12

# AI Agent 会话执行委派任务
cli-anything-infostation jobs claim                 # → {job, step, step_index}，step.params 是指令
# ……用自身技能（ego-browser / ego-lite 等）完成任务，产物文件必须上传……
cli-anything-infostation jobs complete 12 0 \
  --result-file /path/to/初稿.md --asset /path/to/初稿.md   # 报告=文件全文 + 文件落卡片资产区
cli-anything-infostation jobs complete 12 0 --result "已注册并跑通 demo" --asset /tmp/demo.png  # 截图场景
```

> **产物纪律**：agent_task 的交付物必须 `--asset` 上传（用户在网站上直接查看），本地路径只作留档；纯结论性报告可只 `--result`。

## 典型 Agent 工作流

```bash
# 1. 探测能力（v2.0：31 个端点，含 topics/assets/posts）
cli-anything-infostation agent capabilities

# 2. 录入今天刷到的内容（Agent 自动分类+提取TODO+绑主题）
cli-anything-infostation process add "副业案例：帮本地商家做AI代运营，单条文案50-200元，先注册小红书企业号接单"

# 3. 查看今日待办并完成一条
cli-anything-infostation todos list --view today
cli-anything-infostation todos update <todo_id> --status done

# 4. 按主题看推进（v2）
cli-anything-infostation topics list
cli-anything-infostation items list --topic <topic_id>

# 5. 周日生成周报
cli-anything-infostation weekly show --refresh

# 6. 备份
cli-anything-infostation backup export --out backup.json
```

## v2.0 Data Model（速览）

```
topics 主题(=目标) ──1:N──▶ items 卡片(topic_id) ──1:N──▶ todos(topic_id 经触发器随母卡同步)
                             │ ├── parent_item_id 自关联血缘：bundle(发布包)→idea(选题)→material(素材)
                             │ ├──1:N──▶ assets 资产(screenshot/ai_image/upload/video)
                             │ └──1:N──▶ posts 帖子(平台文案+asset_ids 配图顺序+发布回执)
                             └── item_relations：同主题 ≥2 共同标签自动双向关联(tag_overlap)
```

## Notes

- 服务端未配置 `API_TOKEN` 时接口开放（仅建议本地）；线上实例已启用鉴权
- Agent 引擎未配 LLM Key 时自动降级规则引擎（mock），`settings show` 可查当前模式
- `process add` 处理耗时取决于 LLM 响应（默认超时 90s，可用 `INFOSTATION_TIMEOUT` 调整）
