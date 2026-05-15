from __future__ import annotations

import json
import os
import sqlite3
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


HOST = os.getenv("MCP_HOST", "127.0.0.1")
PORT = int(os.getenv("MCP_PORT", "4100"))
BOT_DB_PATH = Path(os.getenv("BOT_DB_PATH", Path(__file__).resolve().parent.parent / "bot.db"))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_mcp_settings() -> dict[str, Any]:
    if not BOT_DB_PATH.exists():
        return {}

    with sqlite3.connect(BOT_DB_PATH) as db:
        row = db.execute(
            "SELECT value FROM agent_settings WHERE key = ?",
            ("mcp_tools",),
        ).fetchone()

    if not row:
        return {}

    try:
        return json.loads(row[0])
    except json.JSONDecodeError:
        return {}


def _gif_settings() -> dict[str, Any]:
    settings = _read_mcp_settings()
    gif_search = settings.get("gifSearch")
    return gif_search if isinstance(gif_search, dict) else {}


def _search_gif(payload: dict[str, Any]) -> dict[str, Any]:
    settings = _gif_settings()

    if not settings.get("enabled"):
        raise RuntimeError("GIF search tool is disabled.")

    tenor_api_key = str(settings.get("tenorApiKey") or "").strip()
    if not tenor_api_key:
        raise RuntimeError("Tenor API key is not configured.")

    query = str(payload.get("query") or "").strip()
    if not query:
        raise ValueError("query is required")

    default_limit = int(settings.get("defaultLimit") or 8)
    raw_limit = payload.get("limit")
    limit = int(raw_limit) if isinstance(raw_limit, int) else default_limit
    limit = max(1, min(limit, 20))

    query_prefix = str(settings.get("queryPrefix") or "").strip()
    effective_query = f"{query_prefix} {query}".strip()
    params = urllib.parse.urlencode(
        {
            "q": effective_query,
            "media_format": "gif",
            "key": tenor_api_key,
            "client_key": "alshival",
            "limit": str(limit),
        }
    )
    request = urllib.request.Request(f"https://tenor.googleapis.com/v2/search?{params}")

    with urllib.request.urlopen(request, timeout=15) as response:
        response_payload = json.loads(response.read().decode("utf-8"))

    results = []
    for item in response_payload.get("results", []):
        if not isinstance(item, dict):
            continue
        media_formats = item.get("media_formats") if isinstance(item.get("media_formats"), dict) else {}
        gif = media_formats.get("gif") if isinstance(media_formats.get("gif"), dict) else {}
        url = gif.get("url")
        if not url:
            continue
        results.append(
            {
                "id": item.get("id"),
                "title": item.get("content_description") or item.get("title"),
                "url": url,
            }
        )

    return {
        "query": effective_query,
        "count": len(results),
        "results": results,
        "poweredBy": "Tenor",
        "ts": _utc_now(),
    }


class McpHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length") or "0")
        if content_length <= 0:
            return {}
        body = self.rfile.read(content_length).decode("utf-8")
        return json.loads(body) if body else {}

    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return

        if self.path == "/tools":
            gif_settings = _gif_settings()
            self._send_json(
                200,
                {
                    "tools": [
                        {
                            "name": "search_gif",
                            "enabled": bool(gif_settings.get("enabled")),
                            "description": "Search Tenor for GIFs.",
                        },
                        {
                            "name": "discord_guild_kb",
                            "enabled": True,
                            "description": "Search the active Discord guild's indexed ChromaDB knowledge collection.",
                        },
                        {
                            "name": "discord_guild_code",
                            "enabled": True,
                            "description": "Search cloned GitHub repositories configured as Discord guild knowledge sources.",
                        },
                        {
                            "name": "set_reminder",
                            "enabled": True,
                            "description": "Create a scheduled reminder in the active platform context.",
                        },
                        {
                            "name": "edit_reminder",
                            "enabled": True,
                            "description": "Edit an existing reminder.",
                        },
                        {
                            "name": "delete_reminder",
                            "enabled": True,
                            "description": "Cancel an existing reminder.",
                        },
                    ]
                },
            )
            return

        self._send_json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        try:
            if self.path == "/tools/search_gif":
                self._send_json(200, _search_gif(self._read_json()))
                return

            self._send_json(404, {"error": "Not found."})
        except Exception as exc:
            self._send_json(400, {"error": str(exc)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), McpHandler)
    print(f"Alshival MCP listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
