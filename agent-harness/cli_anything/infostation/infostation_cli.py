#!/usr/bin/env python3
"""cli-anything-infostation — InfoStation 的 Agent 原生 CLI。

覆盖网页端全部操作：录入处理、知识卡片、TODO 面板、主题（v2）、资产（v2）、
帖子（v2）、数据看板、周报、设置、备份。
输出恒为 JSON（面向 Agent 消费）；错误输出到 stderr 并以非零码退出。

用法示例：
  cli-anything-infostation config save --url http://<服务器IP>:3000 --token <TOKEN>
  cli-anything-infostation process add "一段文字或URL"
  cli-anything-infostation items list --q 标题公式
  cli-anything-infostation todos list --view today
  cli-anything-infostation topics list
  cli-anything-infostation topics create "新主题" --icon 🔧 --line trial
"""

import argparse
import json
import sys
from dataclasses import asdict
from types import SimpleNamespace
from typing import Any

from .core import client
from .core.client import Cfg


def out(data: Any, pretty: bool = False) -> None:
    if pretty:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(data, ensure_ascii=False))


# ---------- 参数 → API 查询串 ----------

def clean(**kw: Any) -> dict:
    return {k: v for k, v in kw.items() if v not in (None, "")}


# ---------- 子命令实现 ----------
# 约定：每个 cmd_* 接收 (args: SimpleNamespace, cfg: Cfg)，
# 返回值恒为 dict | None —— dict 交给 out() 打印为 JSON，None 表示已自行输出。

def cmd_config(args: SimpleNamespace, cfg: Cfg) -> dict:
    if args.config_cmd == "show":
        shown = asdict(cfg)
        if shown.get("token"):
            t = shown["token"]
            shown["token"] = t[:6] + "…" + t[-4:] + f" (长度 {len(t)})"
        return shown
    if args.config_cmd == "save":
        saved = asdict(client.save_config(url=args.url, token=args.token, timeout=args.timeout))
        if saved.get("token"):
            t = saved["token"]
            saved["token"] = t[:6] + "…" + t[-4:] + f" (长度 {len(t)})"
        return {"ok": True, "saved": saved, "path": str(client.CONFIG_PATH)}


def cmd_agent(args: SimpleNamespace, cfg: Cfg) -> Any:
    return client.get("/api/v1/agent/capabilities", cfg)


def cmd_process(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.process_cmd == "add":
        return client.post("/api/v1/process", cfg, clean(
            content=args.content,
            source_type=args.source_type,
            preferred_category=args.category,
            preferred_priority=args.priority,
            user_note=args.note,
            line=args.line,
        ))
    if args.process_cmd == "url":
        return client.post("/api/v1/extract", cfg, {"url": args.url})


def cmd_items(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.items_cmd == "list":
        return client.get("/api/v1/items", cfg, **clean(
            q=args.q, category=args.category, content_type=args.type,
            priority=args.priority, platform=args.platform, tag=args.tag,
            has_todo=args.todo, line=args.line, topic_id=args.topic,
            item_type=args.item_type, sort=args.sort, page=args.page, page_size=args.size,
        ))
    if args.items_cmd == "get":
        return client.get(f"/api/v1/items/{args.id}", cfg)
    if args.items_cmd == "update":
        body = clean(
            title=args.title, summary=args.summary,
            primary_category=args.category, content_type=args.type,
            priority=args.priority, line=args.line,
            item_type=args.item_type, parent_item_id=args.parent,
        )
        if args.topic is not None:
            body["topic_id"] = None if args.topic == "" else int(args.topic)
        if args.parent is not None and args.parent == "":
            body["parent_item_id"] = None
        if args.tags is not None:
            body["tags"] = [t.strip() for t in args.tags.split(",") if t.strip()]
        return client.patch(f"/api/v1/items/{args.id}", cfg, body)
    if args.items_cmd == "delete":
        return client.delete(f"/api/v1/items/{args.id}", cfg)


def cmd_todos(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.todos_cmd == "list":
        return client.get("/api/v1/todos", cfg, **clean(
            view=args.view, category=args.category, priority=args.priority,
            status=args.status, source_item_id=args.source_item, line=args.line,
            topic_id=args.topic,
        ))
    if args.todos_cmd == "create":
        return client.post("/api/v1/todos", cfg, clean(
            title=args.title, description=args.desc, category=args.category,
            priority=args.priority, actual_deadline=args.deadline,
            source_item_id=args.source_item, line=args.line,
        ))
    if args.todos_cmd == "update":
        body = clean(
            status=args.status, title=args.title, priority=args.priority,
            category=args.category, actual_deadline=args.deadline, line=args.line,
        )
        if args.deadline is not None and args.deadline == "":
            body["actual_deadline"] = None  # 空串表示清除截止日期
        return client.patch(f"/api/v1/todos/{args.id}", cfg, body)
    if args.todos_cmd == "delete":
        return client.delete(f"/api/v1/todos/{args.id}", cfg)


def cmd_stats(args: SimpleNamespace, cfg: Cfg) -> Any:
    return client.get("/api/v1/stats", cfg)


# ---------- v2.0：主题 / 资产 / 帖子 ----------

def cmd_topics(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.topics_cmd == "list":
        return client.get("/api/v1/topics", cfg, **clean(status=args.status))
    if args.topics_cmd == "create":
        return client.post("/api/v1/topics", cfg, clean(
            name=args.name, icon=args.icon, color=args.color,
            default_line=args.line, description=args.desc, sort_order=args.sort,
        ))
    if args.topics_cmd == "update":
        body = clean(
            name=args.name, icon=args.icon, color=args.color,
            default_line=args.line, description=args.desc, status=args.status,
        )
        if args.sort is not None:
            body["sort_order"] = args.sort
        return client.patch(f"/api/v1/topics/{args.id}", cfg, body)
    if args.topics_cmd == "delete":
        return client.delete(f"/api/v1/topics/{args.id}", cfg)


def cmd_assets(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.assets_cmd == "list":
        return client.get("/api/v1/assets", cfg, **clean(
            item_id=args.item, todo_id=args.todo, type=args.type,
        ))
    if args.assets_cmd == "add":
        return client.post("/api/v1/assets", cfg, clean(
            item_id=args.item, todo_id=args.todo, asset_type=args.type,
            local_path=args.local, remote_url=args.url, source_url=args.source,
            prompt=args.prompt,
            metadata=json.loads(args.metadata) if args.metadata else None,
        ))
    if args.assets_cmd == "update":
        body = clean(local_path=args.local, remote_url=args.url, prompt=args.prompt)
        if args.metadata:
            body["metadata"] = json.loads(args.metadata)
        return client.patch(f"/api/v1/assets/{args.id}", cfg, body)
    if args.assets_cmd == "delete":
        return client.delete(f"/api/v1/assets/{args.id}", cfg)


def cmd_posts(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.posts_cmd == "list":
        return client.get("/api/v1/posts", cfg, **clean(
            source_item_id=args.source, topic_id=args.topic,
            platform=args.platform, status=args.status,
        ))
    if args.posts_cmd == "create":
        return client.post("/api/v1/posts", cfg, clean(
            source_item_id=args.source, topic_id=args.topic, platform=args.platform,
            title=args.title, content_body=args.body,
            asset_ids=_parse_ids(args.assets),
        ))
    if args.posts_cmd == "update":
        body = clean(
            title=args.title, content_body=args.body, platform=args.platform,
            status=args.status, published_url=args.url,
        )
        if args.assets is not None:
            body["asset_ids"] = _parse_ids(args.assets)
        return client.patch(f"/api/v1/posts/{args.id}", cfg, body)
    if args.posts_cmd == "delete":
        return client.delete(f"/api/v1/posts/{args.id}", cfg)


def _parse_ids(s: str | None) -> list[int] | None:
    return [int(x) for x in s.split(",") if x.strip()] if s else None


def cmd_weekly(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.weekly_cmd == "show":
        return client.get("/api/v1/weekly-report", cfg, **({"refresh": 1} if args.refresh else {}))
    if args.weekly_cmd == "history":
        return client.get("/api/v1/weekly-reports", cfg)


def cmd_settings(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.settings_cmd == "show":
        return client.get("/api/v1/settings", cfg)
    if args.settings_cmd == "goals":
        goals = [g.strip() for g in args.goals.split(",") if g.strip()]
        return client.put("/api/v1/settings", cfg, {"user_goals": goals})


def cmd_backup(args: SimpleNamespace, cfg: Cfg) -> Any:
    if args.backup_cmd == "export":
        data = client.get("/api/v1/export", cfg)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return {"ok": True, "file": args.out, "items": len(data.get("items", [])), "todos": len(data.get("todos", []))}
        return data
    if args.backup_cmd == "markdown":
        status, payload = client.request(
            "GET", "/api/v1/export/markdown", cfg.url, cfg.token,
            timeout=cfg.timeout, raw=True,
        )
        if args.out:
            with open(args.out, "wb") as f:
                f.write(payload)
            return {"ok": True, "file": args.out, "bytes": len(payload)}
        sys.stdout.write(payload.decode("utf-8"))
        return None
    if args.backup_cmd == "import":
        with open(args.file, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return client.post("/api/v1/import", cfg, payload)
    if args.backup_cmd == "clear":
        if not args.yes:
            return {"error": "清空为危险操作，需加 --yes 确认"}
        return client.delete("/api/v1/data", cfg)


# ---------- argparse 组装 ----------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="cli-anything-infostation", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", help="InfoStation 地址（默认取 config/环境变量）")
    p.add_argument("--token", help="API Token（默认取 config/环境变量）")
    p.add_argument("--pretty", action="store_true", help="美化 JSON 输出")
    sub = p.add_subparsers(dest="group", required=True)

    # config
    sp = sub.add_parser("config", help="连接配置")
    spp = sp.add_subparsers(dest="config_cmd", required=True)
    spp.add_parser("show", help="查看当前配置")
    s = spp.add_parser("save", help="保存连接配置到 ~/.config/infostation-cli/config.json")
    s.add_argument("--url")
    s.add_argument("--token")
    s.add_argument("--timeout", type=float)

    # agent
    sub.add_parser("agent", help="Agent 能力自发现").add_argument("agent_cmd", choices=["capabilities"], help=argparse.SUPPRESS)

    # process
    sp = sub.add_parser("process", help="信息录入与处理")
    spp = sp.add_subparsers(dest="process_cmd", required=True)
    s = spp.add_parser("add", help="录入并交给 Agent 处理（URL 自动抓取）")
    s.add_argument("content", help="URL / 文本 / 想法")
    s.add_argument("--category", help="预设分类")
    s.add_argument("--priority", choices=["high", "medium", "low"], help="预设优先级")
    s.add_argument("--source-type", choices=["url", "text", "manual"])
    s.add_argument("--note", help="用户备注")
    s.add_argument("--line", choices=["trial", "media"],
                   help="产品线：trial=TODO线(值得试的东西→行动，默认) | media=自媒体线(话题素材→内容工序)")
    s = spp.add_parser("url", help="URL 抓取预览（不落库）")
    s.add_argument("url")

    # items
    sp = sub.add_parser("items", help="知识卡片")
    spp = sp.add_subparsers(dest="items_cmd", required=True)
    s = spp.add_parser("list", help="列表（筛选/搜索/排序/分页）")
    s.add_argument("--q", help="全文搜索")
    s.add_argument("--category")
    s.add_argument("--type", dest="type", help="内容类型 tutorial/insight/case/data/tool/template")
    s.add_argument("--priority", choices=["high", "medium", "low"])
    s.add_argument("--platform")
    s.add_argument("--tag")
    s.add_argument("--todo", choices=["yes", "no"], help="是否有 TODO")
    s.add_argument("--line", choices=["trial", "media"], help="按产品线过滤")
    s.add_argument("--topic", type=int, help="按主题 id 过滤（v2）")
    s.add_argument("--item-type", choices=["material", "idea", "bundle"], help="按卡片角色过滤（v2）")
    s.add_argument("--sort", choices=["time", "priority", "related"])
    s.add_argument("--page", type=int)
    s.add_argument("--size", type=int, help="每页条数（默认 24）")
    s = spp.add_parser("get", help="详情（含 TODO 与关联）")
    s.add_argument("id")
    s = spp.add_parser("update", help="编辑")
    s.add_argument("id")
    s.add_argument("--title")
    s.add_argument("--summary")
    s.add_argument("--category")
    s.add_argument("--type", dest="type")
    s.add_argument("--priority", choices=["high", "medium", "low"])
    s.add_argument("--tags", help="逗号分隔，如：副业,变现")
    s.add_argument("--line", choices=["trial", "media"], help="切换产品线")
    s.add_argument("--topic", help="主题 id（v2）；传空串解除归属")
    s.add_argument("--item-type", choices=["material", "idea", "bundle"], help="卡片角色（v2）")
    s.add_argument("--parent", help="父卡片 id（v2 血缘：bundle→idea→material）；传空串清除")
    s = spp.add_parser("delete", help="删除")
    s.add_argument("id")

    # todos
    sp = sub.add_parser("todos", help="TODO 面板")
    spp = sp.add_subparsers(dest="todos_cmd", required=True)
    s = spp.add_parser("list", help="列表（视图筛选）")
    s.add_argument("--view", choices=["today", "pending", "done"], help="today=今日+到期，pending=全部待办，done=完成记录")
    s.add_argument("--category")
    s.add_argument("--priority", choices=["high", "medium", "low"])
    s.add_argument("--status", choices=["pending", "in_progress", "done", "archived"])
    s.add_argument("--source-item", help="按来源卡片过滤")
    s.add_argument("--line", choices=["trial", "media"], help="按产品线过滤：trial=行动项 | media=内容工序")
    s.add_argument("--topic", type=int, help="按主题 id 过滤（v2）")
    s = spp.add_parser("create", help="手动创建")
    s.add_argument("title")
    s.add_argument("--desc")
    s.add_argument("--category")
    s.add_argument("--priority", choices=["high", "medium", "low"])
    s.add_argument("--deadline", help="YYYY-MM-DD")
    s.add_argument("--source-item")
    s.add_argument("--line", choices=["trial", "media"], help="产品线；缺省继承来源卡片，再缺省 trial")
    s = spp.add_parser("update", help="更新（完成/归档/改期等）")
    s.add_argument("id")
    s.add_argument("--status", choices=["pending", "in_progress", "done", "archived"])
    s.add_argument("--title")
    s.add_argument("--priority", choices=["high", "medium", "low"])
    s.add_argument("--category")
    s.add_argument("--deadline", help="YYYY-MM-DD；传空串清除")
    s.add_argument("--line", choices=["trial", "media"], help="切换产品线")
    s = spp.add_parser("delete", help="删除")
    s.add_argument("id")

    # stats / weekly
    sub.add_parser("stats", help="数据看板").add_argument("stats_cmd", choices=["overview"], help=argparse.SUPPRESS)
    sp = sub.add_parser("weekly", help="周报")
    spp = sp.add_subparsers(dest="weekly_cmd", required=True)
    s = spp.add_parser("show", help="本周周报")
    s.add_argument("--refresh", action="store_true", help="强制重新生成")
    spp.add_parser("history", help="历史周报")

    # topics（v2）
    sp = sub.add_parser("topics", help="主题（v2：主题=目标，一等公民）")
    spp = sp.add_subparsers(dest="topics_cmd", required=True)
    s = spp.add_parser("list", help="列表（含卡片/任务计数与最近活跃）")
    s.add_argument("--status", choices=["active", "archived"])
    s = spp.add_parser("create", help="新建主题")
    s.add_argument("name", help="主题名（唯一）")
    s.add_argument("--icon", help="emoji 图标，默认 📁")
    s.add_argument("--color", help="十六进制色值")
    s.add_argument("--line", choices=["trial", "media"], help="默认产品线，默认 trial")
    s.add_argument("--desc", help="描述（给 Agent 的主题提示）")
    s.add_argument("--sort", type=int, help="排序权重")
    s = spp.add_parser("update", help="更新（改名/图标/状态/排序/默认线）")
    s.add_argument("id", type=int)
    s.add_argument("--name")
    s.add_argument("--icon")
    s.add_argument("--color")
    s.add_argument("--line", choices=["trial", "media"])
    s.add_argument("--desc")
    s.add_argument("--status", choices=["active", "archived"])
    s.add_argument("--sort", type=int)
    s = spp.add_parser("delete", help="删除主题（卡片保留，仅解除归属）")
    s.add_argument("id", type=int)

    # assets（v2）
    sp = sub.add_parser("assets", help="媒体资产（v2：截图/生图/上传）")
    spp = sp.add_subparsers(dest="assets_cmd", required=True)
    s = spp.add_parser("list", help="列表")
    s.add_argument("--item", help="按卡片 id 过滤")
    s.add_argument("--todo", help="按工序 id 过滤")
    s.add_argument("--type", choices=["screenshot", "ai_image", "upload", "video"])
    s = spp.add_parser("add", help="登记资产")
    s.add_argument("--item", required=True, help="所属卡片 id")
    s.add_argument("--type", required=True, choices=["screenshot", "ai_image", "upload", "video"])
    s.add_argument("--todo", help="产出该资产的工序 id")
    s.add_argument("--local", help="本地文件路径（与 --url 至少一个）")
    s.add_argument("--url", help="图床/平台 URL")
    s.add_argument("--source", help="截图源网页 URL")
    s.add_argument("--prompt", help="AI 生图 Prompt")
    s.add_argument("--metadata", help='JSON 字符串，如 \'{"w":1080}\'')
    s = spp.add_parser("update", help="更新（如上传后回填 --url）")
    s.add_argument("id", type=int)
    s.add_argument("--local")
    s.add_argument("--url")
    s.add_argument("--prompt")
    s.add_argument("--metadata")
    s = spp.add_parser("delete", help="删除资产记录")
    s.add_argument("id", type=int)

    # posts（v2）
    sp = sub.add_parser("posts", help="帖子（v2：多平台发布产出与回执）")
    spp = sp.add_subparsers(dest="posts_cmd", required=True)
    s = spp.add_parser("list", help="列表")
    s.add_argument("--source", help="按来源卡片 id 过滤")
    s.add_argument("--topic", type=int, help="按主题 id 过滤")
    s.add_argument("--platform", choices=["xiaohongshu", "wechat", "x", "bilibili", "zhihu"])
    s.add_argument("--status", choices=["draft", "ready", "publishing", "published", "failed"])
    s = spp.add_parser("create", help="创建帖子草稿")
    s.add_argument("--source", required=True, help="来源卡片 id（选题或素材）")
    s.add_argument("title")
    s.add_argument("--body", help="发布正文")
    s.add_argument("--topic", type=int, help="主题 id")
    s.add_argument("--platform", choices=["xiaohongshu", "wechat", "x", "bilibili", "zhihu"], help="默认 xiaohongshu")
    s.add_argument("--assets", help="资产 id 逗号分隔（决定配图顺序），如 3,1,5")
    s = spp.add_parser("update", help="更新（状态机/回执）")
    s.add_argument("id", type=int)
    s.add_argument("--title")
    s.add_argument("--body", dest="body", help="正文")
    s.add_argument("--platform", choices=["xiaohongshu", "wechat", "x", "bilibili", "zhihu"])
    s.add_argument("--status", choices=["draft", "ready", "publishing", "published", "failed"])
    s.add_argument("--url", help="发布成功后的回执链接")
    s.add_argument("--assets", help="资产 id 逗号分隔")
    s = spp.add_parser("delete", help="删除帖子")
    s.add_argument("id", type=int)

    # settings
    sp = sub.add_parser("settings", help="设置")
    spp = sp.add_subparsers(dest="settings_cmd", required=True)
    spp.add_parser("show", help="查看（Agent 状态/目标偏好/数据量）")
    s = spp.add_parser("goals", help="保存目标领域偏好（逗号分隔）")
    s.add_argument("goals", help="如：career,media,sidehustle")

    # backup
    sp = sub.add_parser("backup", help="数据管理")
    spp = sp.add_subparsers(dest="backup_cmd", required=True)
    s = spp.add_parser("export", help="JSON 全量导出")
    s.add_argument("--out", help="写入文件（不给则打印 JSON）")
    s = spp.add_parser("markdown", help="Markdown 知识归档导出")
    s.add_argument("--out", help="写入文件（不给则打印）")
    s = spp.add_parser("import", help="JSON 备份导入")
    s.add_argument("file")
    s = spp.add_parser("clear", help="清空全部数据（危险）")
    s.add_argument("--yes", action="store_true")

    return p


HANDLERS = {
    "config": cmd_config, "agent": cmd_agent, "process": cmd_process,
    "items": cmd_items, "todos": cmd_todos, "stats": cmd_stats,
    "weekly": cmd_weekly, "settings": cmd_settings, "backup": cmd_backup,
    "topics": cmd_topics, "assets": cmd_assets, "posts": cmd_posts,
}


def main(argv: list[str] | None = None) -> None:
    args: SimpleNamespace = build_parser().parse_args(argv)
    cfg = client.load_config()
    if args.url:
        cfg.url = args.url
    if args.token:
        cfg.token = args.token
    try:
        result = HANDLERS[args.group](args, cfg)
        if result is not None:
            out(result, pretty=args.pretty)
    except client.ApiError as e:
        out({"error": str(e), "status": e.status}, pretty=False)
        sys.stderr.write(str(e) + "\n")
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
