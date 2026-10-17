"""InfoStation HTTP 客户端 — 纯标准库实现（零依赖）。"""

import json
import os
import urllib.request
import urllib.error
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(
    os.environ.get("INFOSTATION_CLI_CONFIG", Path.home() / ".config" / "infostation-cli" / "config.json")
)


@dataclass
class Cfg:
    """连接配置 — 所有 cmd_* 处理函数的 cfg 参数类型。

    键名与磁盘配置文件（CONFIG_PATH）及 INFOSTATION_URL/TOKEN/TIMEOUT 环境变量一一对应。
    """

    url: str
    token: str
    timeout: float = 90.0

# 默认直连：macOS 系统代理（如 FlClash）会被 urllib 自动继承，
# 导致 localhost/内网 IP 请求被代理拦成 502。需要走代理时显式设 INFOSTATION_PROXY。
_PROXY = os.environ.get("INFOSTATION_PROXY")
_OPENER = (
    urllib.request.build_opener(urllib.request.ProxyHandler({"http": _PROXY, "https": _PROXY}))
    if _PROXY
    else urllib.request.build_opener(urllib.request.ProxyHandler({}))
)


class ApiError(Exception):
    def __init__(self, message, status=None, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


def load_config() -> Cfg:
    """优先级：显式参数 > 环境变量 > 配置文件"""
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            cfg = {}
    return Cfg(
        url=os.environ.get("INFOSTATION_URL") or cfg.get("url") or "http://localhost:3000",
        token=os.environ.get("INFOSTATION_TOKEN") or cfg.get("token") or "",
        timeout=float(os.environ.get("INFOSTATION_TIMEOUT") or cfg.get("timeout") or 90),
    )


def save_config(url=None, token=None, timeout=None) -> Cfg:
    cfg: dict = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            cfg = {}
    if url is not None:
        cfg["url"] = url
    if token is not None:
        cfg["token"] = token
    if timeout is not None:
        cfg["timeout"] = timeout
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return load_config()


def request(method, path, base_url, token, body=None, timeout=90, raw=False) -> Any:
    """执行 API 请求。raw=True 时返回 (status, bytes)（用于 Markdown 导出等非 JSON 响应）。"""
    url = base_url.rstrip("/") + path
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _OPENER.open(req, timeout=timeout) as resp:
            payload = resp.read()
            if raw:
                return resp.status, payload
            return _parse_json(payload)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            parsed = _parse_json(payload)
            msg = parsed.get("error") or json.dumps(parsed, ensure_ascii=False)
        except Exception:
            msg = payload.decode("utf-8", "replace")[:300]
        raise ApiError(f"HTTP {e.code}: {msg}", status=e.code, body=payload[:2000]) from None
    except urllib.error.URLError as e:
        raise ApiError(f"连接失败 {url}: {e.reason}") from None


def _parse_json(payload) -> Any:
    return json.loads(payload.decode("utf-8"))


def get(path, cfg: Cfg, **params) -> Any:
    from urllib.parse import urlencode

    qs = urlencode({k: v for k, v in params.items() if v not in (None, "", [])})
    return request("GET", path + (f"?{qs}" if qs else ""), cfg.url, cfg.token, timeout=cfg.timeout)


def post(path, cfg: Cfg, body=None) -> Any:
    return request("POST", path, cfg.url, cfg.token, body=body or {}, timeout=cfg.timeout)


def patch(path, cfg: Cfg, body=None) -> Any:
    return request("PATCH", path, cfg.url, cfg.token, body=body or {}, timeout=cfg.timeout)


def put(path, cfg: Cfg, body=None) -> Any:
    return request("PUT", path, cfg.url, cfg.token, body=body or {}, timeout=cfg.timeout)


def delete(path, cfg: Cfg) -> Any:
    return request("DELETE", path, cfg.url, cfg.token, timeout=cfg.timeout)
