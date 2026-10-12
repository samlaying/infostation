# cli-anything-infostation

[CLI-Anything](https://github.com/HKUDS/CLI-Anything) 规范的 InfoStation Agent CLI。让本机任意 Agent（Claude Code / Codex / OpenAI 兼容客户端）通过命令行完成 InfoStation 网页端的全部操作。

- **零依赖**：纯 Python 标准库（urllib + argparse），`pip install -e .` 即用
- **全操作覆盖**：录入处理 / 知识卡片 / TODO 面板 / 看板 / 周报 / 设置 / 备份
- **Agent 优先**：输出恒为 JSON；`agent capabilities` 端点自发现全部能力
- **鉴权**：支持服务端 `API_TOKEN`（Bearer / X-API-Key）

## 安装

```bash
cd agent-harness
pip install -e .
cli-anything-infostation config save --url http://localhost:3000        # 本地
cli-anything-infostation config save --url http://<服务器IP>:3000 --token <API_TOKEN>  # 线上
```

## 快速验证

```bash
cli-anything-infostation agent capabilities   # 能力自发现
cli-anything-infostation process add "测试一条"  # 录入处理
cli-anything-infostation todos list --view today
```

完整命令表见 [skills/SKILL.md](skills/SKILL.md)。

## 注册到 CLI-Anything（可选）

本目录遵循 CLI-Anything 的 `agent-harness` 布局。若要提交上游注册表，把 [registry-entry.json](registry-entry.json) 的内容并入 CLI-Anything 仓库的 `registry.json` `clis` 数组，并把 `skills/SKILL.md` 复制为其 `skills/cli-anything-infostation/SKILL.md`。
