#!/usr/bin/env python3
"""cli-anything-infostation — InfoStation 的 Agent 原生 CLI。

覆盖网页端全部操作：录入处理、知识卡片、TODO 面板、数据看板、周报、设置、备份。
输出恒为 JSON（面向 Agent 消费）；错误输出到 stderr 并以非零码退出。

用法示例：
  cli-anything-infostation config save --url http://<服务器IP>:3000 --token <TOKEN>
  cli-anything-infostation process add "一段文字或URL"
  cli-anything-infostation items list --q 标题公式
  cli-anything-infostation todos list --view today
"""

import argparse
import json
import sys

from .core import client


def out(data, pretty=False):
    if pretty:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(data, ensure_ascii=False))


# ---------- 参数 → API 查询串 ----------

def clean(**kw):
    return {k: v for k, v in kw.items() if v not in (None, "")}


# ---------- 子命令实现 ----------

def cmd_config(args, cfg):
    if args.config_cmd == "show":
        shown = dict(cfg)
        if shown.get("token"):
            t = shown["token"]
            shown["token"] = t[:6] + "…" + t[-4:] + f" (长度 {len(t)})"
        return shown
    if args.config_cmd == "save":
        saved = client.save_config(url=args.url, token=args.token, timeout=args.timeout)
        saved = dict(saved)
        if saved.get("token"):
            t = saved["token"]
            saved["token"] = t[:6] + "…" + t[-4:] + f" (长度 {len(t)})"
        return {"ok": True, "saved": saved, "path": str(client.CONFIG_PATH)}


def cmd_agent(args, cfg):
    return client.get("/api/v1/agent/capabilities", cfg)


def cmd_process(args, cfg):
    if args.process_cmd == "add":
        return client.post("/api/v1/process", cfg, clean(
            content=args.content,
            source_type=args.source_type,
            preferred_category=args.category,
            preferred_priority=args.priority,
            user_note=args.note,
        ))
    if args.process_cmd == "url":
        return client.post("/api/v1/extract", cfg, {"url": args.url})


def cmd_items(args, cfg):
    if args.items_cmd == "list":
        return client.get("/api/v1/items", cfg, **clean(
            q=args.q, category=args.category, content_type=args.type,
            priority=args.priority, platform=args.platform, tag=args.tag,
            has_todo=args.todo, sort=args.sort, page=args.page, page_size=args.size,
        ))
    if args.items_cmd == "get":
        return client.get(f"/api/v1/items/{args.id}", cfg)
    if args.items_cmd == "update":
        body = clean(
            title=args.title, summary=args.summary,
            primary_category=args.category, content_type=args.type,
            priority=args.priority,
        )
        if args.tags is not None:
            body["tags"] = [t.strip() for t in args.tags.split(",") if t.strip()]
        return client.patch(f"/api/v1/items/{args.id}", cfg, body)
    if args.items_cmd == "delete":
        return client.delete(f"/api/v1/items/{args.id}", cfg)


def cmd_todos(args, cfg):
    if args.todos_cmd == "list":
        return client.get("/api/v1/todos", cfg, **clean(
            view=args.view, category=args.category, priority=args.priority,
            status=args.status, source_item_id=args.source_item,
        ))
    if args.todos_cmd == "create":
        return client.post("/api/v1/todos", cfg, clean(
            title=args.title, description=args.desc, category=args.category,
            priority=args.priority, actual_deadline=args.deadline,
            source_item_id=args.source_item,
        ))
    if args.todos_cmd == "update":
        body = clean(
            status=args.status, title=args.title, priority=args.priority,
            category=args.category, actual_deadline=args.deadline,
        )
        if args.deadline is not None and args.deadline == "":
            body["actual_deadline"] = None  # 空串表示清除截止日期
        return client.patch(f"/api/v1/todos/{args.id}", cfg, body)
    if args.todos_cmd == "delete":
        return client.delete(f"/api/v1/todos/{args.id}", cfg)


def cmd_stats(args, cfg):
    return client.get("/api/v1/stats", cfg)


def cmd_weekly(args, cfg):
    if args.weekly_cmd == "show":
        return client.get("/api/v1/weekly-report", cfg, **({"refresh": 1} if args.refresh else {}))
    if args.weekly_cmd == "history":
        return client.get("/api/v1/weekly-reports", cfg)


def cmd_settings(args, cfg):
    if args.settings_cmd == "show":
        return client.get("/api/v1/settings", cfg)
    if args.settings_cmd == "goals":
        goals = [g.strip() for g in args.goals.split(",") if g.strip()]
        return client.put("/api/v1/settings", cfg, {"user_goals": goals})


def cmd_backup(args, cfg):
    if args.backup_cmd == "export":
        data = client.get("/api/v1/export", cfg)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return {"ok": True, "file": args.out, "items": len(data.get("items", [])), "todos": len(data.get("todos", []))}
        return data
    if args.backup_cmd == "markdown":
        status, payload = client.request(
            "GET", "/api/v1/export/markdown", cfg["url"], cfg["token"],
            timeout=cfg["timeout"], raw=True,
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

def build_parser():
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
    s = spp.add_parser("create", help="手动创建")
    s.add_argument("title")
    s.add_argument("--desc")
    s.add_argument("--category")
    s.add_argument("--priority", choices=["high", "medium", "low"])
    s.add_argument("--deadline", help="YYYY-MM-DD")
    s.add_argument("--source-item")
    s = spp.add_parser("update", help="更新（完成/归档/改期等）")
    s.add_argument("id")
    s.add_argument("--status", choices=["pending", "in_progress", "done", "archived"])
    s.add_argument("--title")
    s.add_argument("--priority", choices=["high", "medium", "low"])
    s.add_argument("--category")
    s.add_argument("--deadline", help="YYYY-MM-DD；传空串清除")
    s = spp.add_parser("delete", help="删除")
    s.add_argument("id")

    # stats / weekly
    sub.add_parser("stats", help="数据看板").add_argument("stats_cmd", choices=["overview"], help=argparse.SUPPRESS)
    sp = sub.add_parser("weekly", help="周报")
    spp = sp.add_subparsers(dest="weekly_cmd", required=True)
    s = spp.add_parser("show", help="本周周报")
    s.add_argument("--refresh", action="store_true", help="强制重新生成")
    spp.add_parser("history", help="历史周报")

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
}


def main(argv=None):
    args = build_parser().parse_args(argv)
    cfg = client.load_config()
    if args.url:
        cfg["url"] = args.url
    if args.token:
        cfg["token"] = args.token
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
