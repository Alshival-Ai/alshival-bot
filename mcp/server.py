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


def _connect_db() -> sqlite3.Connection:
    db = sqlite3.connect(BOT_DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode = WAL")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          platform TEXT NOT NULL,
          guild_id TEXT,
          channel_id TEXT,
          author_id TEXT,
          author_mention TEXT,
          title TEXT NOT NULL,
          message TEXT,
          remind_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          sent_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_reminders_due
        ON reminders(status, remind_at);
        """
    )
    return db


def _to_reminder(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "platform": row["platform"],
        "guildId": row["guild_id"],
        "channelId": row["channel_id"],
        "authorId": row["author_id"],
        "authorMention": row["author_mention"],
        "title": row["title"],
        "message": row["message"],
        "remindAt": row["remind_at"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "sentAt": row["sent_at"],
    }


def _get_reminder(db: sqlite3.Connection, reminder_id: int) -> dict[str, Any] | None:
    row = db.execute(
        """
        SELECT id, platform, guild_id, channel_id, author_id, author_mention, title, message, remind_at, status, created_at, updated_at, sent_at
        FROM reminders
        WHERE id = ?
        """,
        (reminder_id,),
    ).fetchone()

    return _to_reminder(row) if row else None


def _positive_int(value: Any, name: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer.")
    return value


def _optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _required_string(payload: dict[str, Any], name: str) -> str:
    value = _optional_string(payload.get(name))
    if not value:
        raise ValueError(f"{name} is required.")
    return value


def _parse_remind_at(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("remindAt must be an absolute ISO-8601 timestamp.")

    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("remindAt must be an absolute ISO-8601 timestamp.") from exc

    if parsed.tzinfo is None:
        raise ValueError("remindAt must include a timezone.")

    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _set_reminder(payload: dict[str, Any]) -> dict[str, Any]:
    platform = _required_string(payload, "platform")
    title = _required_string(payload, "title")
    remind_at = _parse_remind_at(payload.get("remindAt"))
    now = _utc_now()

    with _connect_db() as db:
        result = db.execute(
            """
            INSERT INTO reminders (
              platform,
              guild_id,
              channel_id,
              author_id,
              author_mention,
              title,
              message,
              remind_at,
              status,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                platform,
                _optional_string(payload.get("guildId")),
                _optional_string(payload.get("channelId")),
                _optional_string(payload.get("authorId")),
                _optional_string(payload.get("authorMention")),
                title,
                _optional_string(payload.get("message")),
                remind_at,
                "pending",
                now,
                now,
            ),
        )
        reminder = _get_reminder(db, int(result.lastrowid))

    return {"reminder": reminder, "ts": _utc_now()}


def _edit_reminder(payload: dict[str, Any]) -> dict[str, Any]:
    reminder_id = _positive_int(payload.get("id") or payload.get("reminderId"), "reminderId")

    with _connect_db() as db:
        existing = _get_reminder(db, reminder_id)
        if not existing:
            raise ValueError(f"Reminder {reminder_id} not found.")

        title = _optional_string(payload.get("title")) or existing["title"]
        message = (
            _optional_string(payload.get("message"))
            if "message" in payload
            else existing["message"]
        )
        has_remind_at = (
            "remindAt" in payload
            and isinstance(payload.get("remindAt"), str)
            and payload.get("remindAt").strip()
        )
        remind_at = (
            _parse_remind_at(payload.get("remindAt"))
            if has_remind_at
            else existing["remindAt"]
        )
        now = _utc_now()

        db.execute(
            """
            UPDATE reminders
            SET title = ?, message = ?, remind_at = ?, status = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, message, remind_at, existing["status"], now, reminder_id),
        )
        reminder = _get_reminder(db, reminder_id)

    return {"reminder": reminder, "ts": _utc_now()}


def _delete_reminder(payload: dict[str, Any]) -> dict[str, Any]:
    reminder_id = _positive_int(payload.get("id") or payload.get("reminderId"), "reminderId")

    with _connect_db() as db:
        existing = _get_reminder(db, reminder_id)
        if not existing:
            raise ValueError(f"Reminder {reminder_id} not found.")

        db.execute(
            """
            UPDATE reminders
            SET status = ?, updated_at = ?
            WHERE id = ?
            """,
            ("cancelled", _utc_now(), reminder_id),
        )
        reminder = _get_reminder(db, reminder_id)

    return {"reminder": reminder, "ts": _utc_now()}


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

            if self.path == "/tools/set_reminder":
                self._send_json(200, _set_reminder(self._read_json()))
                return

            if self.path == "/tools/edit_reminder":
                self._send_json(200, _edit_reminder(self._read_json()))
                return

            if self.path == "/tools/delete_reminder":
                self._send_json(200, _delete_reminder(self._read_json()))
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
