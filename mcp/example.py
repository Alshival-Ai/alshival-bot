"""
Standalone Model Context Protocol server for the Alshival chatbot stack.

Usage:
    uvicorn alshival_mcp.app:app --reload --host 0.0.0.0 --port 8080
    # or
    python -m alshival_mcp.app

Dependencies:
    fastapi
    uvicorn
    mcp (model context protocol python sdk)
    python-dotenv
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import html
import ipaddress
import hashlib
import json
import logging
import os
import re
import sqlite3
import sys
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from dotenv import load_dotenv
from asgiref.sync import sync_to_async
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse
from mcp.server.fastmcp import FastMCP
import requests
from bs4 import BeautifulSoup
from chromadb import PersistentClient
from openai import OpenAI
from twilio.rest import Client as TwilioClient
import random
import websockets
from client_portal.api_auth import authenticate_api_key, extract_api_key_from_headers, parse_static_api_keys

logger = logging.getLogger("alshival.mcp")
logging.basicConfig(level=logging.INFO)

# --------------------------------------------------------------------------- #
# Environment / configuration
# --------------------------------------------------------------------------- #
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

env_path = PROJECT_ROOT / ".env"
if env_path.exists():
    load_dotenv(env_path)

RAW_STATIC_KEYS = os.getenv("MCP_STATIC_API_KEYS", "")
API_KEY_HEADER = os.getenv("MCP_API_KEY_HEADER", "x-api-key")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER")


def _env_first(*names: str, default: Optional[str] = None) -> Optional[str]:
    """Return the first non-empty env var from `names` (in order)."""
    for name in names:
        val = os.getenv(name)
        if val:
            return val
    return default


# Prefer AZURE_* (new), but keep legacy MSGRAPH_* compatible.
MSGRAPH_TENANT_ID = _env_first("AZURE_TENANT_ID", "MSGRAPH_TENANT_ID")
MSGRAPH_CLIENT_ID = _env_first("AZURE_CLIENT_ID", "MSGRAPH_CLIENT_ID")
MSGRAPH_CLIENT_SECRET = _env_first("AZURE_CLIENT_SECRET", "MSGRAPH_CLIENT_SECRET")
MSGRAPH_EVENT_TIMEZONE = os.getenv("MSGRAPH_EVENT_TIMEZONE", "UTC")
MSGRAPH_DELEGATED_SCOPES = os.getenv(
    "MSGRAPH_DELEGATED_SCOPES",
    "offline_access Mail.Read Mail.Send Calendars.Read",
)
AUTH_DB_PATH = Path(os.getenv("DJANGO_DB_PATH", PROJECT_ROOT / "db.sqlite3"))
TENOR_API_KEY = os.getenv("TENOR_API_KEY")
SITE_KB_PATH = os.getenv(
    "SITE_KB_PATH",
    str((Path(__file__).resolve().parent / "knowledge" / "chroma")),
)
SUPPORT_INBOX_KB_PATH = os.getenv(
    "SUPPORT_INBOX_KB_PATH",
    str((Path(__file__).resolve().parent / "knowledge" / "staff")),
)
SITE_KB_COLLECTION = os.getenv("SITE_KB_COLLECTION", "alshival-site")
DIRECTORY_KB_COLLECTION = os.getenv("DEVTOOLS_DIRECTORY_COLLECTION", "alshival-directory")
STAFF_KB_COLLECTION = os.getenv("STAFF_KB_COLLECTION", "alshival-staff")
SITE_KB_EMBEDDING_MODEL = os.getenv("CHROMA_EMBEDDING_MODEL", "text-embedding-3-small")
SUPPORT_INBOX_COLLECTION = os.getenv("SUPPORT_INBOX_COLLECTION", "support-inbox")
CLIENT_KB_COLLECTION = os.getenv("CLIENT_KB_COLLECTION", "user-resources")
REMINDERS_DB_PATH = Path(os.getenv("REMINDERS_DB_PATH", PROJECT_ROOT / "db.sqlite3"))
_SITE_KB_COLLECTION = None
_DIRECTORY_KB_COLLECTION = None
_STAFF_KB_COLLECTION = None
_SUPPORT_INBOX_COLLECTIONS: Dict[str, Any] = {}
_REQUEST_IP = ContextVar("mcp_request_ip", default=None)
_REQUEST_USER_EMAIL = ContextVar("mcp_request_user_email", default=None)
_REQUEST_USER_NAME = ContextVar("mcp_request_user_name", default=None)
_REQUEST_USER_PHONE = ContextVar("mcp_request_user_phone", default=None)
_REQUEST_AUTH_PAYLOAD = ContextVar("mcp_request_auth_payload", default=None)
_DJANGO_READY = False
ACCESS_ROLE_PUBLIC = "public"
ACCESS_ROLE_SUBSCRIBER = "subscriber"
ACCESS_ROLE_STAFF = "staff"
CAPABILITY_STAFF_INTERNAL = "staff.internal"
VOICE_TOOL_ALLOWLIST = {
    "read_inbox",
    "read_email",
    "search_inbox",
    "get_calendar_events",
    "search_kb",
}
RAW_INTERNAL_API_KEY_LABELS = os.getenv("MCP_INTERNAL_API_KEY_LABELS", "internal")
RAW_INTERNAL_TOOL_NAMES = os.getenv(
    "MCP_INTERNAL_TOOL_NAMES",
    "read_inbox,read_email,ingest_inbox,search_inbox,send_email,reply_email,forward_email,get_calendar_events,edit_calendar_event",
)
RAW_PUBLIC_CAPABILITIES = os.getenv(
    "MCP_PUBLIC_CAPABILITIES",
    "kb.search,directory.search,gif.search,spam.flag",
)
RAW_SUBSCRIBER_CAPABILITIES = os.getenv(
    "MCP_SUBSCRIBER_CAPABILITIES",
    "devtools.resources.read,devtools.resources.write,devtools.resources.logs.read,devtools.resources.logs.write,devtools.resources.share,devtools.social.manage,devtools.settings.read,devtools.settings.write,devtools.images.generate,reminders.manage",
)
RAW_STAFF_CAPABILITIES = os.getenv(
    "MCP_STAFF_CAPABILITIES",
    "staff.internal,staff.sms.send,reminders.manage,calendar.events.read,calendar.events.write,inbox.read,inbox.ingest,inbox.search,email.send,devtools.images.generate",
)
RAW_SUBSCRIPTION_TIER_CAPABILITIES_JSON = os.getenv("MCP_SUBSCRIPTION_TIER_CAPABILITIES_JSON", "")
ALSHIVAL_AGENT_USERNAME = (os.getenv("ALSHIVAL_AGENT_USERNAME", "alshival") or "").strip().lower()
ALSHIVAL_AGENT_API_KEY_SHA256 = (os.getenv("MCP_ALSHIVAL_AGENT_API_KEY_SHA256", "") or "").strip().lower()
RAW_AGENT_ONLY_TOOL_NAMES = os.getenv(
    "MCP_AGENT_ONLY_TOOL_NAMES",
    "autonomous_create_blog_post,autonomous_create_quick_post",
)
RAW_EMAIL_AGENT_BASE_CAPABILITIES = os.getenv(
    "MCP_EMAIL_AGENT_BASE_CAPABILITIES",
    "email.send,staff.sms.send,reminders.manage",
)


def _parse_csv_set(raw: str) -> set[str]:
    values: set[str] = set()
    for item in (raw or "").split(","):
        value = item.strip().lower()
        if value:
            values.add(value)
    return values


INTERNAL_API_KEY_LABELS = _parse_csv_set(RAW_INTERNAL_API_KEY_LABELS)
INTERNAL_TOOL_NAMES = _parse_csv_set(RAW_INTERNAL_TOOL_NAMES)
PUBLIC_CAPABILITIES = _parse_csv_set(RAW_PUBLIC_CAPABILITIES)
SUBSCRIBER_CAPABILITIES = _parse_csv_set(RAW_SUBSCRIBER_CAPABILITIES)
STAFF_CAPABILITIES = _parse_csv_set(RAW_STAFF_CAPABILITIES)
AGENT_ONLY_TOOL_NAMES = _parse_csv_set(RAW_AGENT_ONLY_TOOL_NAMES)
HARD_AGENT_ONLY_TOOL_NAMES = {"autonomous_create_blog_post", "autonomous_create_quick_post"}
EMAIL_AGENT_BASE_CAPABILITIES = _parse_csv_set(RAW_EMAIL_AGENT_BASE_CAPABILITIES)
# Backward-compatible rollout guard: reminder tools are part of DevTools subscriber scope.
SUBSCRIBER_CAPABILITIES.add("reminders.manage")
SUBSCRIBER_CAPABILITIES.add("devtools.images.generate")
STAFF_CAPABILITIES.add("devtools.images.generate")


def _parse_subscription_tier_capability_map(raw: str) -> Dict[str, set[str]]:
    payload = (raw or "").strip()
    if not payload:
        return {}
    try:
        data = json.loads(payload)
    except Exception:
        logger.warning("Invalid MCP_SUBSCRIPTION_TIER_CAPABILITIES_JSON (expected object).")
        return {}
    if not isinstance(data, dict):
        logger.warning("Ignoring MCP_SUBSCRIPTION_TIER_CAPABILITIES_JSON: top-level JSON must be an object.")
        return {}
    mapping: Dict[str, set[str]] = {}
    for tier_key, raw_caps in data.items():
        tier = str(tier_key or "").strip().lower()
        if not tier:
            continue
        caps: set[str] = set()
        if isinstance(raw_caps, str):
            caps = _parse_csv_set(raw_caps.replace("|", ","))
        elif isinstance(raw_caps, (list, tuple, set)):
            for value in raw_caps:
                cap = str(value or "").strip().lower()
                if cap:
                    caps.add(cap)
        if caps:
            mapping[tier] = caps
    return mapping


SUBSCRIPTION_TIER_CAPABILITIES = _parse_subscription_tier_capability_map(RAW_SUBSCRIPTION_TIER_CAPABILITIES_JSON)
TOOL_CAPABILITY_REQUIREMENTS: Dict[str, set[str]] = {
    "search_kb": {"kb.search"},
    "search_users": {"directory.search"},
    "search_gif": {"gif.search"},
    "resource_upsert": {"devtools.resources.write"},
    "resource_list": {"devtools.resources.read"},
    "resource_get": {"devtools.resources.read"},
    "resource_logs": {"devtools.resources.logs.read"},
    "resource_log_ingest": {"devtools.resources.logs.write"},
    "resource_share": {"devtools.resources.share"},
    "social_interaction": {"devtools.social.manage"},
    "get_account_settings": {"devtools.settings.read"},
    "update_account_settings": {"devtools.settings.write"},
    "generate_image": {"devtools.images.generate"},
    "sms": {"staff.sms.send"},
    "email": {"email.send"},
    "set_reminder": {"reminders.manage"},
    "edit_reminder": {"reminders.manage"},
    "delete_reminder": {"reminders.manage"},
    "spam_flag": {"spam.flag"},
    "get_calendar_events": {"calendar.events.read"},
    "edit_calendar_event": {"calendar.events.write"},
    "read_inbox": {"inbox.read"},
    "read_email": {"inbox.read"},
    "ingest_inbox": {"inbox.ingest"},
    "search_inbox": {"inbox.search"},
    "send_email": {"email.send"},
    "reply_email": {"email.send"},
    "forward_email": {"email.send"},
}


def _get_site_kb_collection():
    """Return a cached Chroma collection for site knowledge base lookups."""
    global _SITE_KB_COLLECTION
    if _SITE_KB_COLLECTION is not None:
        return _SITE_KB_COLLECTION
    if SITE_KB_COLLECTION.lower().startswith(SUPPORT_INBOX_COLLECTION.lower()):
        raise RuntimeError("SITE_KB_COLLECTION cannot point at inbox collections.")
    client = PersistentClient(path=SITE_KB_PATH)
    try:
        _SITE_KB_COLLECTION = client.get_collection(name=SITE_KB_COLLECTION)
    except Exception as exc:  # pragma: no cover - missing collection
        raise RuntimeError(f"Site KB collection '{SITE_KB_COLLECTION}' not found: {exc}") from exc
    return _SITE_KB_COLLECTION


def _get_directory_kb_collection():
    """Return a cached Chroma collection for DevTools directory profile lookups."""
    global _DIRECTORY_KB_COLLECTION
    if _DIRECTORY_KB_COLLECTION is not None:
        return _DIRECTORY_KB_COLLECTION
    if DIRECTORY_KB_COLLECTION.lower().startswith(SUPPORT_INBOX_COLLECTION.lower()):
        raise RuntimeError("DIRECTORY_KB_COLLECTION cannot point at inbox collections.")
    client = PersistentClient(path=SITE_KB_PATH)
    try:
        _DIRECTORY_KB_COLLECTION = client.get_or_create_collection(name=DIRECTORY_KB_COLLECTION)
    except Exception as exc:  # pragma: no cover - missing collection
        raise RuntimeError(
            f"Directory KB collection '{DIRECTORY_KB_COLLECTION}' not found: {exc}"
        ) from exc
    return _DIRECTORY_KB_COLLECTION


def _get_staff_kb_collection():
    """Return a cached Chroma collection for staff-only knowledge lookups."""
    global _STAFF_KB_COLLECTION
    if _STAFF_KB_COLLECTION is not None:
        return _STAFF_KB_COLLECTION
    if STAFF_KB_COLLECTION.lower().startswith(SUPPORT_INBOX_COLLECTION.lower()):
        raise RuntimeError("STAFF_KB_COLLECTION cannot point at inbox collections.")
    client = PersistentClient(path=SUPPORT_INBOX_KB_PATH)
    try:
        _STAFF_KB_COLLECTION = client.get_or_create_collection(name=STAFF_KB_COLLECTION)
    except Exception as exc:  # pragma: no cover - missing collection
        raise RuntimeError(f"Staff KB collection '{STAFF_KB_COLLECTION}' not found: {exc}") from exc
    return _STAFF_KB_COLLECTION


def _support_inbox_collection_name(user_email: Optional[str]) -> str:
    if not user_email:
        return SUPPORT_INBOX_COLLECTION
    normalized = user_email.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    if not slug:
        slug = "user"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:8]
    slug = slug[:32].strip("-")
    return f"{SUPPORT_INBOX_COLLECTION}-{slug}-{digest}"


def _get_support_inbox_collection(user_email: Optional[str] = None):
    name = _support_inbox_collection_name(user_email)
    cached = _SUPPORT_INBOX_COLLECTIONS.get(name)
    if cached is not None:
        return cached
    client = PersistentClient(path=SUPPORT_INBOX_KB_PATH)
    collection = client.get_or_create_collection(name=name)
    _SUPPORT_INBOX_COLLECTIONS[name] = collection
    return collection


def _get_support_mailbox() -> Optional[str]:
    mailbox = (os.getenv("SUPPORT_EMAIL") or "support@alshival.ai").strip()
    return mailbox if "@" in mailbox else None


def _ensure_django() -> None:
    global _DJANGO_READY
    if _DJANGO_READY:
        return
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        import django  # type: ignore
    except Exception:
        return
    django.setup()
    _DJANGO_READY = True


def _get_request_user_email() -> Optional[str]:
    email = _REQUEST_USER_EMAIL.get()
    if not email:
        return None
    email = email.strip()
    return email if "@" in email else None


def _get_request_user_name() -> Optional[str]:
    username = _REQUEST_USER_NAME.get()
    if not username:
        return None
    username = username.strip()
    return username or None


def _get_request_user_phone() -> Optional[str]:
    phone = _REQUEST_USER_PHONE.get()
    if not phone:
        return None
    phone = str(phone).strip()
    return phone or None


def _resolve_user_for_api_key_sync(user_email: Optional[str], username: Optional[str]):
    _ensure_django()
    try:
        from auth.models import Profile  # type: ignore
        from django.contrib.auth.models import User  # type: ignore
    except Exception:
        return None
    # Keep identity resolution aligned with centralized auth: username takes priority.
    if username:
        user = User.objects.filter(username__iexact=username).first()
        if user:
            return user
    if user_email:
        profile = (
            Profile.objects.select_related("user")
            .filter(email__iexact=user_email)
            .first()
        )
        if profile:
            return profile.user
        user = User.objects.filter(email__iexact=user_email).first()
        if user:
            return user
    return None


def _get_user_kb_collection_sync(user_email: Optional[str], username: Optional[str] = None) -> Optional[Any]:
    if not ((user_email or "").strip() or (username or "").strip()):
        return None
    _ensure_django()
    try:
        from auth.utils import ensure_client_kb_dir  # type: ignore
    except Exception:
        return None
    user = _resolve_user_for_api_key_sync(user_email, username)
    if not user:
        return None
    kb_dir = ensure_client_kb_dir(user)
    if not kb_dir:
        return None
    chroma_path = Path(kb_dir) / "chroma"
    try:
        client = PersistentClient(path=str(chroma_path))
        return client.get_or_create_collection(name=CLIENT_KB_COLLECTION)
    except Exception as exc:  # pragma: no cover - chroma failure
        logger.warning("Failed to access client KB collection for %s/%s: %s", user_email, username, exc)
        return None


def _get_client_user_by_email_sync(user_email: Optional[str]):
    if not user_email:
        return None
    _ensure_django()
    try:
        from auth.models import Profile  # type: ignore
    except Exception:
        return None
    profile = (
        Profile.objects.select_related("user")
        .filter(email__iexact=user_email)
        .first()
    )
    if not profile:
        return None
    user = profile.user
    if user.is_staff or user.is_superuser or not profile.is_subscribed:
        return None
    return user


async def _get_client_user_by_email(user_email: Optional[str]):
    return await sync_to_async(_get_client_user_by_email_sync, thread_sensitive=True)(user_email)


def _user_has_devtools_access_sync(user) -> bool:
    if not user:
        return False
    if bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)):
        return True
    try:
        from auth.models import Profile  # type: ignore
    except Exception:
        return False
    profile = (
        Profile.objects.select_related("user")
        .filter(user=user)
        .first()
    )
    return bool(profile and profile.is_subscribed)


def _resolve_devtools_user_sync(
    *,
    user_id: Optional[int] = None,
    user_email: Optional[str] = None,
    username: Optional[str] = None,
):
    _ensure_django()
    try:
        from django.contrib.auth.models import User  # type: ignore
    except Exception:
        return None
    user = None
    if user_id:
        user = User.objects.filter(id=int(user_id)).first()
    if not user:
        user = _resolve_user_for_api_key_sync(user_email, username)
    if not user:
        return None
    if not _user_has_devtools_access_sync(user):
        return None
    return user


def _resolve_authenticated_user_sync(
    *,
    user_id: Optional[int] = None,
    user_email: Optional[str] = None,
    username: Optional[str] = None,
):
    _ensure_django()
    try:
        from django.contrib.auth.models import User  # type: ignore
    except Exception:
        return None
    user = None
    if user_id:
        user = User.objects.filter(id=int(user_id)).first()
    if not user:
        user = _resolve_user_for_api_key_sync(user_email, username)
    return user


async def _get_request_devtools_user():
    payload = _request_auth_payload()
    user_id_raw = payload.get("user_id")
    user_id: Optional[int]
    try:
        user_id = int(user_id_raw) if user_id_raw is not None else None
    except (TypeError, ValueError):
        user_id = None
    user_email = (str(payload.get("user_email") or "").strip() or _get_request_user_email() or "").strip()
    username = (str(payload.get("username") or "").strip() or _get_request_user_name() or "").strip()
    return await sync_to_async(_resolve_devtools_user_sync, thread_sensitive=True)(
        user_id=user_id,
        user_email=user_email,
        username=username,
    )


async def _get_request_authenticated_user():
    payload = _request_auth_payload()
    user_id_raw = payload.get("user_id")
    user_id: Optional[int]
    try:
        user_id = int(user_id_raw) if user_id_raw is not None else None
    except (TypeError, ValueError):
        user_id = None
    user_email = (str(payload.get("user_email") or "").strip() or _get_request_user_email() or "").strip()
    username = (str(payload.get("username") or "").strip() or _get_request_user_name() or "").strip()
    return await sync_to_async(_resolve_authenticated_user_sync, thread_sensitive=True)(
        user_id=user_id,
        user_email=user_email,
        username=username,
    )


def _refresh_user_kb_safe_sync(user) -> None:
    if not user:
        return
    try:
        from client_portal.user_resources import refresh_user_kb  # type: ignore

        refresh_user_kb(user)
    except Exception:
        logger.warning("Failed to refresh client KB for user %s", getattr(user, "id", None), exc_info=True)


ACCOUNT_SETTINGS_TEXT_FIELDS = {
    "alshival_model",
    "devtools_profile_visibility",
    "first_name",
    "last_name",
    "title",
    "location",
    "bio",
    "avatar_url",
    "website_url",
    "linkedin_url",
    "twitter_url",
    "github_url",
    "spotify_url",
}
ACCOUNT_SETTINGS_BOOL_FIELDS = {
    "notify_social_new_follower_app_enabled",
    "notify_social_new_follower_sms_enabled",
    "notify_social_new_follower_email_enabled",
}
ACCOUNT_SETTINGS_WRITABLE_FIELDS = ACCOUNT_SETTINGS_TEXT_FIELDS.union(ACCOUNT_SETTINGS_BOOL_FIELDS)
NOTIFICATION_SETTINGS_FIELD_MAP = {
    "new_follower": {
        "APP": "notify_social_new_follower_app_enabled",
        "SMS": "notify_social_new_follower_sms_enabled",
        "EMAIL": "notify_social_new_follower_email_enabled",
    },
}
NOTIFICATION_SETTINGS_EVENT_ALIASES = {
    "new_follower": "new_follower",
    "social_new_follower": "new_follower",
}


def _coerce_optional_bool(value: Any, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise ValueError(f"{field_name} must be a boolean.")


def _sanitize_account_settings_updates(updates: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in (updates or {}).items():
        if key not in ACCOUNT_SETTINGS_WRITABLE_FIELDS or value is None:
            continue
        if key in ACCOUNT_SETTINGS_BOOL_FIELDS:
            normalized[key] = _coerce_optional_bool(value, key)
        else:
            normalized[key] = str(value).strip()
    return normalized


def _normalize_notification_event_key(value: Any) -> str:
    key = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    return NOTIFICATION_SETTINGS_EVENT_ALIASES.get(key, key)


def _notification_updates_from_payload(notification_settings: Any) -> dict[str, Any]:
    if notification_settings is None:
        return {}
    if not isinstance(notification_settings, dict):
        raise ValueError("notification_settings must be an object.")

    updates: dict[str, Any] = {}
    for raw_event_key, raw_event_config in notification_settings.items():
        event_key = _normalize_notification_event_key(raw_event_key)
        channel_map = NOTIFICATION_SETTINGS_FIELD_MAP.get(event_key)
        if not channel_map:
            valid_events = ", ".join(sorted(NOTIFICATION_SETTINGS_FIELD_MAP.keys()))
            raise ValueError(f"Unsupported notification settings key '{raw_event_key}'. Valid keys: {valid_events}.")
        if not isinstance(raw_event_config, dict):
            raise ValueError(f"notification_settings.{event_key} must be an object.")

        normalized_channel_map = {channel_name.upper(): field for channel_name, field in channel_map.items()}
        for raw_channel, raw_enabled in raw_event_config.items():
            channel_name = str(raw_channel or "").strip().upper()
            field_name = normalized_channel_map.get(channel_name)
            if not field_name:
                valid_channels = ", ".join(sorted(normalized_channel_map.keys()))
                raise ValueError(
                    f"Unsupported notification channel '{raw_channel}' for '{event_key}'. "
                    f"Valid channels: {valid_channels}."
                )
            updates[field_name] = _coerce_optional_bool(raw_enabled, f"notification_settings.{event_key}.{channel_name}")
    return updates


def _notification_settings_payload(account_settings: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for event_key, channel_map in NOTIFICATION_SETTINGS_FIELD_MAP.items():
        event_payload: dict[str, Any] = {}
        for channel_name, field_name in channel_map.items():
            event_payload[channel_name] = bool(account_settings.get(field_name))
        payload[event_key] = event_payload
    return payload


def _account_settings_response_payload(user, account_settings: dict[str, Any]) -> dict[str, Any]:
    first_name = (account_settings.get("first_name") or getattr(user, "first_name", "") or "").strip()
    last_name = (account_settings.get("last_name") or getattr(user, "last_name", "") or "").strip()
    full_name = " ".join(part for part in [first_name, last_name] if part).strip()
    return {
        "username": (getattr(user, "username", "") or "").strip(),
        "email": (getattr(user, "email", "") or "").strip(),
        "full_name": full_name,
        "phone_number": (account_settings.get("phone_number") or "").strip(),
        "is_verified": bool(account_settings.get("is_verified")),
        "alshival_model": (account_settings.get("alshival_model") or "").strip(),
        "devtools_profile_visibility": (account_settings.get("devtools_profile_visibility") or "").strip(),
        "first_name": first_name,
        "last_name": last_name,
        "title": (account_settings.get("title") or "").strip(),
        "location": (account_settings.get("location") or "").strip(),
        "bio": (account_settings.get("bio") or "").strip(),
        "avatar_url": (account_settings.get("avatar_url") or "").strip(),
        "website_url": (account_settings.get("website_url") or "").strip(),
        "linkedin_url": (account_settings.get("linkedin_url") or "").strip(),
        "twitter_url": (account_settings.get("twitter_url") or "").strip(),
        "github_url": (account_settings.get("github_url") or "").strip(),
        "spotify_url": (account_settings.get("spotify_url") or "").strip(),
        "notification_settings": _notification_settings_payload(account_settings),
    }


def _get_account_settings_sync(user) -> dict[str, Any]:
    _ensure_django()
    from auth.models import Profile  # type: ignore
    from client_portal.user_resources import get_user_account_settings  # type: ignore

    profile = Profile.objects.filter(user=user).first()
    account_settings = get_user_account_settings(user, profile=profile)
    return _account_settings_response_payload(user, account_settings)


def _update_account_settings_sync(user, updates: dict[str, Any]) -> dict[str, Any]:
    _ensure_django()
    from auth.models import Profile  # type: ignore
    from client_portal.user_resources import update_user_account_settings  # type: ignore

    normalized_updates = _sanitize_account_settings_updates(updates)
    if not normalized_updates:
        raise ValueError("No valid account settings updates were provided.")

    profile, _ = Profile.objects.get_or_create(user=user, defaults={"email": user.email})
    account_settings = update_user_account_settings(user, normalized_updates, profile=profile)

    user_update_fields: list[str] = []
    if "first_name" in normalized_updates:
        new_first_name = (account_settings.get("first_name") or "").strip()
        if (user.first_name or "") != new_first_name:
            user.first_name = new_first_name
            user_update_fields.append("first_name")
    if "last_name" in normalized_updates:
        new_last_name = (account_settings.get("last_name") or "").strip()
        if (user.last_name or "") != new_last_name:
            user.last_name = new_last_name
            user_update_fields.append("last_name")
    if user_update_fields:
        user.save(update_fields=user_update_fields)

    profile_update_fields: list[str] = []
    profile_field_map = {
        "devtools_profile_visibility": "devtools_profile_visibility",
        "title": "title",
        "location": "location",
        "bio": "bio",
        "avatar_url": "photo_url",
        "website_url": "website_url",
        "linkedin_url": "linkedin_url",
        "twitter_url": "twitter_url",
        "github_url": "github_url",
        "spotify_url": "spotify_url",
        "notify_social_new_follower_app_enabled": "notify_social_new_follower_app_enabled",
        "notify_social_new_follower_sms_enabled": "notify_social_new_follower_sms_enabled",
        "notify_social_new_follower_email_enabled": "notify_social_new_follower_email_enabled",
    }
    for settings_key, profile_field in profile_field_map.items():
        if settings_key not in normalized_updates:
            continue
        new_value = account_settings.get(settings_key)
        if settings_key in ACCOUNT_SETTINGS_BOOL_FIELDS:
            new_value = bool(new_value)
            old_value = bool(getattr(profile, profile_field, False))
        else:
            new_value = (new_value or "").strip()
            old_value = (getattr(profile, profile_field, "") or "").strip()
        if old_value != new_value:
            setattr(profile, profile_field, new_value)
            profile_update_fields.append(profile_field)
    if profile_update_fields:
        profile.save(update_fields=profile_update_fields)

    return _account_settings_response_payload(user, account_settings)


def _resolve_social_target_user_sync(actor_user, username: str):
    _ensure_django()
    candidate = (username or "").strip()
    if not candidate:
        raise ValueError("username is required")
    try:
        from django.contrib.auth.models import User  # type: ignore
    except Exception as exc:
        raise RuntimeError("Unable to load Django user model.") from exc
    target = User.objects.filter(username__iexact=candidate).first()
    if not target:
        raise ValueError(f"User '@{candidate}' was not found.")
    if actor_user and getattr(actor_user, "id", None) == getattr(target, "id", None):
        raise ValueError("Cannot perform social interaction with your own profile.")
    if not _user_has_devtools_access_sync(target):
        raise ValueError(f"User '@{target.username}' does not have DevTools access.")
    return target


def _social_collaboration_snapshot(collaboration, actor_user, target_user) -> dict[str, Any]:
    return {
        "collaboration_id": int(getattr(collaboration, "id", 0) or 0),
        "is_established": bool(collaboration.is_established),
        "mode_active": bool(collaboration.is_active),
        "activated": bool(collaboration.collaborators_enabled),
        "accepted_by_actor": bool(collaboration.accepted_by(actor_user)),
        "accepted_by_target": bool(collaboration.accepted_by(target_user)),
    }


def _social_staff_pair_locked(actor_user, target_user) -> bool:
    return bool(
        actor_user
        and target_user
        and (getattr(actor_user, "is_staff", False) or getattr(actor_user, "is_superuser", False))
        and (getattr(target_user, "is_staff", False) or getattr(target_user, "is_superuser", False))
    )


def _social_follow_sync(actor_user, target_user) -> dict[str, Any]:
    _ensure_django()
    from auth.models import Profile  # type: ignore
    from client_portal import user_sms  # type: ignore
    from client_portal.models import ProfileCollaboration, ProfileFollow  # type: ignore
    from client_portal.phone_verification import send_verification_sms  # type: ignore
    from client_portal.portal_urls import devtools_absolute, devtools_reverse  # type: ignore
    from client_portal.user_resources import get_user_account_settings  # type: ignore

    if _social_staff_pair_locked(actor_user, target_user):
        collaboration = ProfileCollaboration.ensure_staff_pair_locked_for_users(actor_user, target_user)
        payload = {
            "follow_created": False,
            "already_following": True,
            "is_following": True,
            "mutual_follow": True,
            "collaboration_state": "activated",
            "staff_pair_locked": True,
            "message": "Staff collaborators are always active.",
        }
        if collaboration:
            payload["collaboration"] = _social_collaboration_snapshot(collaboration, actor_user, target_user)
        return payload

    _, created = ProfileFollow.objects.get_or_create(follower=actor_user, following=target_user)
    payload: dict[str, Any] = {
        "follow_created": bool(created),
        "already_following": not bool(created),
        "is_following": True,
    }
    if not created:
        return payload

    target_profile, _ = Profile.objects.get_or_create(user=target_user, defaults={"email": target_user.email})
    try:
        target_settings = get_user_account_settings(target_user, profile=target_profile)
    except Exception:
        target_settings = {}

    legacy_follow_app_enabled = bool(
        getattr(target_profile, "notify_app_enabled", True)
        and getattr(target_profile, "notify_social_new_follower", True)
    )
    send_app_notification = bool(
        target_settings.get(
            "notify_social_new_follower_app_enabled",
            getattr(
                target_profile,
                "notify_social_new_follower_app_enabled",
                legacy_follow_app_enabled,
            ),
        )
    )
    follow_sms_enabled = bool(
        target_settings.get(
            "notify_social_new_follower_sms_enabled",
            getattr(
                target_profile,
                "notify_social_new_follower_sms_enabled",
                getattr(target_profile, "notify_sms_enabled", False),
            ),
        )
    )
    follow_email_enabled = bool(
        target_settings.get(
            "notify_social_new_follower_email_enabled",
            getattr(
                target_profile,
                "notify_social_new_follower_email_enabled",
                getattr(target_profile, "notify_email_enabled", False),
            ),
        )
    )
    actor_display = (actor_user.get_full_name() or "").strip() or f"@{actor_user.username}"
    app_notification_id = None
    sms_attempted = False
    sms_sent = False
    sms_error = ""
    phone_target = (
        target_settings.get("phone_number")
        or (getattr(target_profile, "phone_number", "") or "")
    ).strip()
    phone_verified = bool(
        target_settings.get(
            "is_verified",
            getattr(target_profile, "is_verified", False),
        )
    )

    actor_profile_path = devtools_reverse(
        "client_portal_profile_public",
        kwargs={"username": actor_user.username},
    )
    actor_profile_url = devtools_absolute(actor_profile_path)

    if send_app_notification:
        app_notification_id = user_sms.create_notification(
            target_user,
            notification_type="profile_follow",
            actor_user_id=actor_user.id,
            actor_username=actor_user.username,
            title=f"{actor_display} followed you",
            body=f"@{actor_user.username} started following your DevTools profile.",
            target_url=actor_profile_path,
            channels={"app": True, "sms": follow_sms_enabled, "email": follow_email_enabled},
            metadata={
                "actor_user_id": actor_user.id,
                "actor_username": actor_user.username,
                "recipient_user_id": target_user.id,
            },
        )

    if follow_sms_enabled and phone_verified and phone_target:
        sms_attempted = True
        sms_body = (
            f"{actor_display} (@{actor_user.username}) followed your DevTools profile. "
            f"View: {actor_profile_url}"
        )
        try:
            sms_sent = bool(send_verification_sms(phone_target, sms_body))
        except Exception as exc:
            sms_error = str(exc)
            sms_sent = False
        if sms_sent:
            try:
                conversation_id = user_sms.get_or_create_conversation(
                    target_user,
                    f"user:{target_user.id}",
                    "social_notifications",
                )
                if conversation_id:
                    user_sms.record_message(
                        target_user,
                        conversation_id,
                        direction="outbound",
                        body=sms_body,
                        from_number=(os.getenv("TWILIO_FROM_NUMBER") or "").strip(),
                        to_number=phone_target,
                        channel="sms",
                        provider="twilio",
                    )
            except Exception:
                logger.warning(
                    "Failed to persist social follower SMS message for user %s",
                    target_user.id,
                    exc_info=True,
                )

    try:
        user_sms.record_context_event(
            target_user,
            event_type="social_follow_notification_created",
            summary=f"New follower notification from @{actor_user.username}",
            payload={
                "notification_id": app_notification_id,
                "actor_user_id": actor_user.id,
                "actor_username": actor_user.username,
                "recipient_user_id": target_user.id,
                "notification_type": "profile_follow",
                "channels": {
                    "app": bool(send_app_notification),
                    "sms": bool(follow_sms_enabled),
                    "email": bool(follow_email_enabled),
                },
                "delivery": {
                    "app_notification_created": bool(app_notification_id),
                    "sms_attempted": bool(sms_attempted),
                    "sms_sent": bool(sms_sent),
                    "sms_phone_verified": bool(phone_verified),
                    "sms_phone_present": bool(phone_target),
                    "sms_error": sms_error,
                },
            },
        )
    except Exception:
        logger.warning("Failed to persist social follow notification context for user %s", target_user.id, exc_info=True)

    refresh_actor = False
    prompt_created = False
    target_prompt_notification_id = None
    actor_prompt_notification_id = None
    mutual_follow = ProfileFollow.objects.filter(follower=target_user, following=actor_user).exists()
    payload["mutual_follow"] = bool(mutual_follow)
    if mutual_follow:
        try:
            collaboration, _ = ProfileCollaboration.get_or_create_for_users(actor_user, target_user)
            payload["collaboration"] = _social_collaboration_snapshot(collaboration, actor_user, target_user)
            if not collaboration.is_established:
                target_profile_path = devtools_reverse(
                    "client_portal_profile_public",
                    kwargs={"username": target_user.username},
                )
                if not collaboration.accepted_by(target_user):
                    target_prompt_notification_id = user_sms.create_notification(
                        target_user,
                        notification_type="collaboration_prompt",
                        actor_user_id=actor_user.id,
                        actor_username=actor_user.username,
                        title=f"Mutual follow with @{actor_user.username}",
                        body=f"Both you and @{actor_user.username} follow each other. Want to become collaborators?",
                        target_url=actor_profile_path,
                        channels={"app": True},
                        metadata={
                            "collaboration_id": collaboration.id,
                            "counterpart_user_id": actor_user.id,
                            "counterpart_username": actor_user.username,
                            "action_type": "collaboration_accept",
                        },
                    )
                    prompt_created = True

                if not collaboration.accepted_by(actor_user):
                    actor_prompt_notification_id = user_sms.create_notification(
                        actor_user,
                        notification_type="collaboration_prompt",
                        actor_user_id=target_user.id,
                        actor_username=target_user.username,
                        title=f"Mutual follow with @{target_user.username}",
                        body=f"Both you and @{target_user.username} follow each other. Want to become collaborators?",
                        target_url=target_profile_path,
                        channels={"app": True},
                        metadata={
                            "collaboration_id": collaboration.id,
                            "counterpart_user_id": target_user.id,
                            "counterpart_username": target_user.username,
                            "action_type": "collaboration_accept",
                        },
                    )
                    prompt_created = True
                    refresh_actor = True

                user_sms.record_context_event(
                    target_user,
                    event_type="collaboration_prompt_created",
                    summary=f"Collaborator prompt created with @{actor_user.username}",
                    payload={
                        "collaboration_id": collaboration.id,
                        "counterpart_user_id": actor_user.id,
                        "counterpart_username": actor_user.username,
                        "notification_id": target_prompt_notification_id,
                    },
                )
                user_sms.record_context_event(
                    actor_user,
                    event_type="collaboration_prompt_created",
                    summary=f"Collaborator prompt created with @{target_user.username}",
                    payload={
                        "collaboration_id": collaboration.id,
                        "counterpart_user_id": target_user.id,
                        "counterpart_username": target_user.username,
                        "notification_id": actor_prompt_notification_id,
                    },
                )
                payload["collaboration_state"] = "waiting_approval"
        except Exception:
            logger.warning(
                "Failed to process mutual-follow collaborator prompt for users %s and %s",
                actor_user.id,
                target_user.id,
                exc_info=True,
            )

    payload["prompt_created"] = bool(prompt_created)
    _refresh_user_kb_safe_sync(target_user)
    if refresh_actor:
        _refresh_user_kb_safe_sync(actor_user)
    return payload


def _social_unfollow_sync(actor_user, target_user) -> dict[str, Any]:
    _ensure_django()
    from client_portal.models import ProfileCollaboration, ProfileFollow  # type: ignore

    if _social_staff_pair_locked(actor_user, target_user):
        collaboration = ProfileCollaboration.ensure_staff_pair_locked_for_users(actor_user, target_user)
        payload: dict[str, Any] = {
            "unfollowed": False,
            "was_following": False,
            "is_following": True,
            "staff_pair_locked": True,
            "message": "Staff collaborators are always active.",
        }
        if collaboration:
            payload["collaboration"] = _social_collaboration_snapshot(collaboration, actor_user, target_user)
        return payload

    deleted, _ = ProfileFollow.objects.filter(follower=actor_user, following=target_user).delete()
    payload: dict[str, Any] = {
        "unfollowed": bool(deleted),
        "was_following": bool(deleted),
        "is_following": False,
    }
    low_user_id, high_user_id = sorted([actor_user.id, target_user.id])
    collaboration = ProfileCollaboration.objects.filter(
        user_low_id=low_user_id,
        user_high_id=high_user_id,
    ).first()
    if collaboration:
        payload["collaboration"] = _social_collaboration_snapshot(collaboration, actor_user, target_user)
    return payload


def _social_collaborate_sync(actor_user, target_user) -> dict[str, Any]:
    _ensure_django()
    from client_portal import user_sms  # type: ignore
    from client_portal.models import ProfileCollaboration, ProfileFollow  # type: ignore
    from client_portal.portal_urls import devtools_reverse  # type: ignore

    if _social_staff_pair_locked(actor_user, target_user):
        collaboration = ProfileCollaboration.ensure_staff_pair_locked_for_users(actor_user, target_user)
        payload = _social_collaboration_snapshot(collaboration, actor_user, target_user) if collaboration else {}
        payload.update(
            {
                "state": "activated",
                "activated": True,
                "is_established": True,
                "mode_active": True,
                "actor_follows_target": True,
                "target_follows_actor": True,
                "staff_pair_locked": True,
                "message": "Staff collaborators are always active.",
            }
        )
        return payload

    actor_follows_target = ProfileFollow.objects.filter(follower=actor_user, following=target_user).exists()
    target_follows_actor = ProfileFollow.objects.filter(follower=target_user, following=actor_user).exists()

    if not (actor_follows_target and target_follows_actor):
        return {
            "state": "waiting_mutual_follow",
            "activated": False,
            "is_established": False,
            "mode_active": False,
            "actor_follows_target": bool(actor_follows_target),
            "target_follows_actor": bool(target_follows_actor),
            "message": "Both users must follow each other before collaborator mode can be activated.",
        }

    collaboration, _ = ProfileCollaboration.get_or_create_for_users(actor_user, target_user)

    if not collaboration.is_established:
        result = collaboration.mark_accepted(actor_user)
        try:
            user_sms.record_context_event(
                actor_user,
                event_type="collaboration_acceptance_submitted",
                summary=f"Accepted collaborator prompt with @{target_user.username}",
                payload={
                    "collaboration_id": collaboration.id,
                    "counterpart_user_id": target_user.id,
                    "counterpart_username": target_user.username,
                    "accepted_now": bool(result.get("accepted_now")),
                    "already_accepted": bool(result.get("already_accepted")),
                },
            )
        except Exception:
            logger.warning(
                "Failed to persist collaboration acceptance context for user %s",
                actor_user.id,
                exc_info=True,
            )

        counterpart_needs_refresh = False
        if bool(result.get("accepted_now")) and not bool(result.get("established_now")):
            actor_profile_path = devtools_reverse(
                "client_portal_profile_public",
                kwargs={"username": actor_user.username},
            )
            try:
                user_sms.create_notification(
                    target_user,
                    notification_type="collaboration_acceptance_received",
                    actor_user_id=actor_user.id,
                    actor_username=actor_user.username,
                    title=f"@{actor_user.username} accepted your collaborator request",
                    body="Accept to enable collaborator mode for both of you.",
                    target_url=actor_profile_path,
                    channels={"app": True},
                    metadata={
                        "collaboration_id": collaboration.id,
                        "counterpart_user_id": actor_user.id,
                        "counterpart_username": actor_user.username,
                    },
                )
                user_sms.record_context_event(
                    target_user,
                    event_type="collaboration_acceptance_received",
                    summary=f"@{actor_user.username} accepted collaborator mode",
                    payload={
                        "collaboration_id": collaboration.id,
                        "counterpart_user_id": actor_user.id,
                        "counterpart_username": actor_user.username,
                        "established": False,
                    },
                )
                counterpart_needs_refresh = True
            except Exception:
                logger.warning(
                    "Failed to persist collaboration acceptance notification for users %s and %s",
                    actor_user.id,
                    target_user.id,
                    exc_info=True,
                )

        if bool(result.get("established_now")):
            target_profile_path = devtools_reverse(
                "client_portal_profile_public",
                kwargs={"username": target_user.username},
            )
            actor_profile_path = devtools_reverse(
                "client_portal_profile_public",
                kwargs={"username": actor_user.username},
            )
            user_sms.create_notification(
                actor_user,
                notification_type="collaboration_established",
                actor_user_id=target_user.id,
                actor_username=target_user.username,
                title=f"You and @{target_user.username} are now collaborators",
                body="Both of you accepted the collaborator request. Collaborator mode is now on.",
                target_url=target_profile_path,
                channels={"app": True},
                metadata={
                    "collaboration_id": collaboration.id,
                    "counterpart_user_id": target_user.id,
                    "counterpart_username": target_user.username,
                },
            )
            user_sms.create_notification(
                target_user,
                notification_type="collaboration_established",
                actor_user_id=actor_user.id,
                actor_username=actor_user.username,
                title=f"You and @{actor_user.username} are now collaborators",
                body="Both of you accepted the collaborator request. Collaborator mode is now on.",
                target_url=actor_profile_path,
                channels={"app": True},
                metadata={
                    "collaboration_id": collaboration.id,
                    "counterpart_user_id": actor_user.id,
                    "counterpart_username": actor_user.username,
                },
            )
            user_sms.record_context_event(
                actor_user,
                event_type="collaboration_established",
                summary=f"Collaborator relationship established with @{target_user.username}",
                payload={
                    "collaboration_id": collaboration.id,
                    "counterpart_user_id": target_user.id,
                    "counterpart_username": target_user.username,
                    "mode_active": bool(collaboration.is_active),
                },
            )
            user_sms.record_context_event(
                target_user,
                event_type="collaboration_established",
                summary=f"Collaborator relationship established with @{actor_user.username}",
                payload={
                    "collaboration_id": collaboration.id,
                    "counterpart_user_id": actor_user.id,
                    "counterpart_username": actor_user.username,
                    "mode_active": bool(collaboration.is_active),
                },
            )
            counterpart_needs_refresh = True

        _refresh_user_kb_safe_sync(actor_user)
        if counterpart_needs_refresh:
            _refresh_user_kb_safe_sync(target_user)

        collaboration.refresh_from_db()
        state = "activated" if collaboration.collaborators_enabled else "waiting_approval"
        message = (
            "Collaborator mode is activated."
            if state == "activated"
            else f"Waiting for @{target_user.username} to accept collaborator mode."
        )
        payload = _social_collaboration_snapshot(collaboration, actor_user, target_user)
        payload.update(
            {
                "state": state,
                "message": message,
            }
        )
        return payload

    collaboration.is_active = not bool(collaboration.is_active)
    collaboration.save(update_fields=["is_active", "updated_at"])
    mode_label = "on" if collaboration.is_active else "off"
    try:
        user_sms.record_context_event(
            actor_user,
            event_type="collaboration_mode_toggled",
            summary=f"Set collaborator mode {mode_label} with @{target_user.username}",
            payload={
                "collaboration_id": collaboration.id,
                "counterpart_user_id": target_user.id,
                "counterpart_username": target_user.username,
                "mode_active": bool(collaboration.is_active),
            },
        )
        user_sms.record_context_event(
            target_user,
            event_type="collaboration_mode_toggled",
            summary=f"@{actor_user.username} set collaborator mode {mode_label}",
            payload={
                "collaboration_id": collaboration.id,
                "counterpart_user_id": actor_user.id,
                "counterpart_username": actor_user.username,
                "mode_active": bool(collaboration.is_active),
            },
        )
        user_sms.create_notification(
            target_user,
            notification_type="collaboration_mode_updated",
            actor_user_id=actor_user.id,
            actor_username=actor_user.username,
            title=f"@{actor_user.username} turned collaborator mode {mode_label}",
            body=f"Collaborator mode between you and @{actor_user.username} is now {mode_label}.",
            target_url=devtools_reverse(
                "client_portal_profile_public",
                kwargs={"username": actor_user.username},
            ),
            channels={"app": True},
            metadata={
                "collaboration_id": collaboration.id,
                "counterpart_user_id": actor_user.id,
                "counterpart_username": actor_user.username,
                "mode_active": bool(collaboration.is_active),
            },
        )
    except Exception:
        logger.warning(
            "Failed to persist collaboration mode toggle artifacts for users %s and %s",
            actor_user.id,
            target_user.id,
            exc_info=True,
        )

    _refresh_user_kb_safe_sync(actor_user)
    _refresh_user_kb_safe_sync(target_user)
    payload = _social_collaboration_snapshot(collaboration, actor_user, target_user)
    payload.update(
        {
            "state": "activated" if collaboration.collaborators_enabled else "deactivated",
            "message": (
                "Collaborator mode is activated."
                if collaboration.collaborators_enabled
                else "Collaborator mode is off."
            ),
        }
    )
    return payload


def _social_interaction_sync(actor_user, target_user, action: str) -> dict[str, Any]:
    action_value = (action or "").strip().lower()
    if action_value == "follow":
        payload = _social_follow_sync(actor_user, target_user)
    elif action_value == "unfollow":
        payload = _social_unfollow_sync(actor_user, target_user)
    elif action_value == "collaborate":
        payload = _social_collaborate_sync(actor_user, target_user)
    else:
        raise ValueError("action must be one of: follow, unfollow, collaborate")
    payload.update(
        {
            "action": action_value,
            "actor_username": (getattr(actor_user, "username", "") or "").strip(),
            "target_username": (getattr(target_user, "username", "") or "").strip(),
        }
    )
    return payload


def _normalize_username(value: Any) -> str:
    return str(value or "").strip().lstrip("@").lower()


def _collaborator_status_for_pair(
    *,
    actor_user: Any,
    target_user: Any,
    collaboration: Any,
    actor_follows_target: bool,
    target_follows_actor: bool,
) -> str:
    if not target_user:
        return "not_found"
    if int(getattr(actor_user, "id", 0) or 0) == int(getattr(target_user, "id", 0) or 0):
        return "self"
    if _social_staff_pair_locked(actor_user, target_user):
        return "activated"
    if collaboration:
        if bool(collaboration.collaborators_enabled):
            return "activated"
        if bool(collaboration.is_established) and not bool(collaboration.is_active):
            return "deactivated"
        actor_accepted = bool(collaboration.accepted_by(actor_user))
        target_accepted = bool(collaboration.accepted_by(target_user))
        if actor_accepted and not target_accepted:
            return "awaiting_them"
        if target_accepted and not actor_accepted:
            return "awaiting_you"
        return "pending"
    if actor_follows_target and target_follows_actor:
        return "mutual_follow"
    return "not_collaborator"


def _social_status_map_sync(actor_user: Any, usernames: Sequence[str]) -> dict[str, dict[str, Any]]:
    _ensure_django()
    from django.contrib.auth.models import User  # type: ignore
    from django.db.models import Q  # type: ignore
    from client_portal.models import ProfileCollaboration, ProfileFollow  # type: ignore

    actor_id = int(getattr(actor_user, "id", 0) or 0)
    normalized_usernames: list[str] = []
    seen: set[str] = set()
    for raw in usernames:
        username = _normalize_username(raw)
        if not username or username in seen:
            continue
        seen.add(username)
        normalized_usernames.append(username)
    if not normalized_usernames or actor_id <= 0:
        return {}

    user_query = Q()
    for username in normalized_usernames:
        user_query |= Q(username__iexact=username)
    target_users = list(User.objects.filter(user_query))
    by_username = {_normalize_username(getattr(user, "username", "")): user for user in target_users}
    target_ids = [int(getattr(user, "id", 0) or 0) for user in target_users if int(getattr(user, "id", 0) or 0) > 0]

    follows_actor_ids: set[int] = set()
    actor_follows_ids: set[int] = set()
    collaborations_by_target_id: dict[int, Any] = {}
    if target_ids:
        actor_follows_ids = set(
            ProfileFollow.objects.filter(
                follower_id=actor_id,
                following_id__in=target_ids,
            ).values_list("following_id", flat=True)
        )
        follows_actor_ids = set(
            ProfileFollow.objects.filter(
                follower_id__in=target_ids,
                following_id=actor_id,
            ).values_list("follower_id", flat=True)
        )
        collaborations = ProfileCollaboration.objects.filter(
            Q(user_low_id=actor_id, user_high_id__in=target_ids) |
            Q(user_high_id=actor_id, user_low_id__in=target_ids)
        )
        for collaboration in collaborations:
            target_id = (
                int(collaboration.user_high_id)
                if int(collaboration.user_low_id) == actor_id
                else int(collaboration.user_low_id)
            )
            collaborations_by_target_id[target_id] = collaboration

    statuses: dict[str, dict[str, Any]] = {}
    for username in normalized_usernames:
        target_user = by_username.get(username)
        if not target_user:
            statuses[username] = {
                "status": "not_found",
                "actor_follows_target": False,
                "target_follows_actor": False,
                "collaborators_enabled": False,
                "target_user_id": None,
            }
            continue
        target_id = int(getattr(target_user, "id", 0) or 0)
        actor_follows_target = target_id in actor_follows_ids
        target_follows_actor = target_id in follows_actor_ids
        collaboration = collaborations_by_target_id.get(target_id)
        staff_pair_locked = _social_staff_pair_locked(actor_user, target_user)
        status = _collaborator_status_for_pair(
            actor_user=actor_user,
            target_user=target_user,
            collaboration=collaboration,
            actor_follows_target=actor_follows_target,
            target_follows_actor=target_follows_actor,
        )
        statuses[username] = {
            "status": status,
            "actor_follows_target": bool(actor_follows_target),
            "target_follows_actor": bool(target_follows_actor),
            "collaborators_enabled": bool((collaboration and collaboration.collaborators_enabled) or staff_pair_locked),
            "staff_pair_locked": bool(staff_pair_locked),
            "target_user_id": target_id,
        }
    return statuses


async def _get_user_kb_collection(user_email: Optional[str], username: Optional[str] = None) -> Optional[Any]:
    return await sync_to_async(_get_user_kb_collection_sync, thread_sensitive=True)(user_email, username)


def _normalize_kb_visibility(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"public", "devtools", "private", "staff"}:
        return normalized
    if normalized in {"subscriber", "subscribers"}:
        return "devtools"
    return "public"


def _allowed_kb_visibilities() -> set[str]:
    if _request_has_internal_access():
        return {"public", "devtools", "private"}
    if _request_can_access_devtools_resources():
        return {"public", "devtools"}
    return {"public"}


def _allowed_directory_visibilities() -> set[str]:
    if _request_has_internal_access() or _request_can_access_devtools_resources():
        return {"public", "devtools", "staff"}
    return {"public", "staff"}


def _kb_access_tier() -> str:
    if _request_has_internal_access():
        return "staff"
    if _request_can_access_devtools_resources():
        return "devtools"
    return "public"


def _normalize_directory_account_type(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"", "all", "any"}:
        return ""
    if normalized in {"staff", "team"}:
        return "staff"
    if normalized in {"member", "members", "user", "users"}:
        return "member"
    raise ValueError("account_type must be one of: staff, member, all")


def _filter_search_items_by_visibility(
    items: list[dict[str, Any]],
    allowed_visibilities: set[str],
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for item in items:
        metadata = item.get("metadata")
        meta = metadata if isinstance(metadata, dict) else {}
        visibility = _normalize_kb_visibility(meta.get("visibility"))
        if visibility not in allowed_visibilities:
            continue
        if (meta.get("visibility") or "").strip().lower() != visibility:
            updated_item = dict(item)
            updated_meta = dict(meta)
            updated_meta["visibility"] = visibility
            updated_item["metadata"] = updated_meta
            filtered.append(updated_item)
        else:
            filtered.append(item)
    return filtered


def _search_collection(
    *,
    collection: Any,
    query_embedding: list[float],
    n_results: int,
    scope: str,
    collection_name: str,
    where_filter: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    try:
        requested = int(n_results)
    except (TypeError, ValueError):
        requested = 5
    query_limit = max(1, min(requested, 100))
    query_params: dict[str, Any] = {
        "query_embeddings": [query_embedding],
        "n_results": query_limit,
    }
    if where_filter:
        query_params["where"] = where_filter
    try:
        results = collection.query(**query_params)
    except Exception:
        if where_filter:
            logger.warning(
                "Collection query with where filter failed for %s; retrying without filter.",
                collection_name,
                exc_info=True,
            )
            results = collection.query(query_embeddings=[query_embedding], n_results=query_limit)
        else:
            raise
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]
    for doc, meta, dist in zip(documents, metadatas, distances):
        items.append(
            {
                "text": doc,
                "metadata": meta or {},
                "score": dist,
                "scope": scope,
                "collection": collection_name,
            }
        )
    return items


def _store_voice_message_sync(
    *,
    mode: str,
    participant_number: str,
    service_number: str,
    direction: str,
    body: str,
) -> None:
    _ensure_django()
    try:
        from django.utils import timezone  # type: ignore
        from alshival.models import Conversation, InternalConversation, InternalMessage, Message
    except Exception:
        return

    conversation_model = InternalConversation if mode == "internal" else Conversation
    message_model = InternalMessage if mode == "internal" else Message
    conversation = (
        conversation_model.objects.filter(
            participant_number=participant_number,
            service_number=service_number,
        )
        .order_by("-updated_at")
        .first()
    )
    if not conversation:
        conversation = conversation_model.objects.create(
            participant_number=participant_number,
            service_number=service_number,
            last_message_at=timezone.now(),
            last_direction=direction,
        )
    message_model.objects.create(
        conversation=conversation,
        direction=direction,
        channel="voice",
        body=body,
        from_number=participant_number if direction == "inbound" else service_number,
        to_number=service_number if direction == "inbound" else participant_number,
        provider="twilio",
    )
    conversation.last_message_at = timezone.now()
    conversation.last_direction = direction
    conversation.save(update_fields=["last_message_at", "last_direction", "updated_at"])


def _fetch_voice_history_sync(
    *,
    mode: str,
    participant_number: str,
    service_number: str,
    limit: int = 12,
) -> str:
    _ensure_django()
    try:
        from alshival.models import Conversation, InternalConversation
    except Exception:
        return ""

    conversation_model = InternalConversation if mode == "internal" else Conversation
    conversation = (
        conversation_model.objects.filter(
            participant_number=participant_number,
        )
        .order_by("-updated_at")
        .first()
    )
    if not conversation and service_number:
        conversation = (
            conversation_model.objects.filter(
                service_number=service_number,
            )
            .order_by("-updated_at")
            .first()
        )
    if not conversation:
        return ""
    messages = list(conversation.messages.order_by("-created_at")[:limit])
    messages.reverse()
    lines = []
    for msg in messages:
        role = "Assistant" if msg.direction != "inbound" else "Caller"
        lines.append(f"{role} [{msg.channel}]: {msg.body}")
    return "\n".join(lines).strip()


def _build_voice_system_prompt(mode: str, staff: Optional[Dict[str, str]]) -> str:
    from alshival.chatbot.prompt import SYSTEM_PROMPT as PUBLIC_PROMPT

    now = datetime.now(ZoneInfo("America/Chicago"))
    now_label = f"{now.strftime('%A')} {now.isoformat()}"
    base_prompt = PUBLIC_PROMPT
    prompt = (
        base_prompt.replace("{{current_date}}", now_label)
        .replace("{{client_ip_address}}", "voice")
        .replace("{{user_name}}", (staff or {}).get("name") or "Unknown")
        .replace("{{user_email}}", (staff or {}).get("email") or "Unknown")
    )
    if mode == "internal":
        staff_details = (
            "\n\n## Staff context\n"
            f"- Name: {(staff or {}).get('name') or 'Unknown'}\n"
            f"- Email: {(staff or {}).get('email') or 'Unknown'}\n"
            f"- Phone: {(staff or {}).get('phone') or 'Unknown'}\n"
        )
        prompt += staff_details
    tool_guidance = (
        "\n\n## Voice tool usage\n"
        "- You can call tools to check inboxes and calendars.\n"
        "- Never say you cannot access inbox or calendar; use the tools when asked.\n"
        "- If you need a time range for calendar, ask a brief follow-up question.\n"
    )
    prompt += tool_guidance
    return prompt


def _build_voice_prompt_with_history(
    mode: str,
    staff: Optional[Dict[str, str]],
    participant_number: str,
    service_number: str,
) -> str:
    prompt = _build_voice_system_prompt(mode, staff)
    history = _fetch_voice_history_sync(
        mode=mode,
        participant_number=participant_number,
        service_number=service_number,
        limit=12,
    )
    if history:
        prompt += "\n\n## Recent conversation\n" + history
    return prompt


async def _connect_openai_realtime(api_key: str, realtime_model: str) -> websockets.WebSocketClientProtocol:
    url = f"wss://api.openai.com/v1/realtime?model={realtime_model}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "OpenAI-Beta": "realtime=v1",
    }
    max_attempts = int(os.getenv("OPENAI_REALTIME_CONNECT_RETRIES", "3"))
    open_timeout = float(os.getenv("OPENAI_REALTIME_OPEN_TIMEOUT", "20"))
    backoff = float(os.getenv("OPENAI_REALTIME_CONNECT_BACKOFF", "1.5"))

    for attempt in range(1, max_attempts + 1):
        try:
            return await websockets.connect(
                url,
                additional_headers=headers,
                open_timeout=open_timeout,
                close_timeout=10,
            )
        except (TimeoutError, asyncio.TimeoutError, OSError, websockets.exceptions.WebSocketException) as exc:
            if attempt == max_attempts:
                raise
            logger.warning(
                "OpenAI realtime connect failed (attempt %s/%s): %s",
                attempt,
                max_attempts,
                exc,
            )
            await asyncio.sleep(backoff)
            backoff *= 2


def _voice_tool_specs() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": "read_inbox",
            "description": "Fetch recent messages from a mailbox (read-only).",
            "parameters": {
                "type": "object",
                "properties": {
                    "mailbox": {"type": "string"},
                    "username": {"type": "string"},
                    "top": {"type": "integer"},
                    "since": {"type": "string"},
                    "include_body": {"type": "boolean"},
                    "thread": {"type": "boolean"},
                    "unread": {"type": "boolean"},
                    "folder": {"type": "string"},
                },
            },
        },
        {
            "type": "function",
            "name": "read_email",
            "description": "Fetch a single message by ID and optionally return the full thread.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {"type": "string"},
                    "mailbox": {"type": "string"},
                    "username": {"type": "string"},
                    "include_body": {"type": "boolean"},
                    "thread": {"type": "boolean"},
                },
                "required": ["message_id"],
            },
        },
        {
            "type": "function",
            "name": "search_inbox",
            "description": "Search inbox messages stored in ChromaDB.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer"},
                    "since": {"type": "string"},
                    "until": {"type": "string"},
                    "from_email": {"type": "string"},
                    "mailbox": {"type": "string"},
                    "username": {"type": "string"},
                },
            },
        },
        {
            "type": "function",
            "name": "get_calendar_events",
            "description": "List calendar events for a staff member within a date range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "start_local": {"type": "string"},
                    "end_local": {"type": "string"},
                    "time_zone": {"type": "string"},
                    "include_canceled": {"type": "boolean"},
                },
            },
        },
        {
            "type": "function",
            "name": "search_kb",
            "description": "Search site/public KB content (company pages, blog, docs, and personal/staff scopes when allowed).",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer"},
                },
            },
        },
    ]


def _run_voice_tool(
    name: str,
    args: Dict[str, Any],
    *,
    mode: str,
    staff_email: str = "",
) -> Dict[str, Any]:
    if name not in VOICE_TOOL_ALLOWLIST:
        return {"error": f"Tool '{name}' not allowed for voice."}
    if name == "get_calendar_events":
        if "start_time" not in args and "start_local" in args:
            args["start_time"] = args.pop("start_local")
        if "end_time" not in args and "end_local" in args:
            args["end_time"] = args.pop("end_local")
    target_module = sys.modules[__name__]
    func = getattr(target_module, name, None)
    if not callable(func):
        return {"error": f"Tool '{name}' is unavailable."}
    try:
        return func(**args)
    except Exception as exc:
        return {"error": str(exc)}


def _embed_query(text: str) -> List[float]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for site KB embeddings")
    client = OpenAI(api_key=api_key)
    response = client.embeddings.create(model=SITE_KB_EMBEDDING_MODEL, input=[text])
    return response.data[0].embedding


def _embed_texts(texts: Sequence[str]) -> List[List[float]]:
    items = [str(text or "").strip() for text in texts if str(text or "").strip()]
    if not items:
        return []
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for site KB embeddings")
    client = OpenAI(api_key=api_key)
    response = client.embeddings.create(model=SITE_KB_EMBEDDING_MODEL, input=items)
    return [row.embedding for row in response.data]


def _get_reminders_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(REMINDERS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _get_spam_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(AUTH_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _normalize_reminder_action(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"", "notify", "notify_user", "notify_collaborators"}:
        return "notify_user"
    raise ValueError("action must be one of: notify_user")


def _normalize_reminder_channels(value: Optional[dict[str, Any]]) -> Optional[dict[str, bool]]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("channels must be an object, e.g. {'APP': true, 'SMS': false, 'EMAIL': false}")
    normalized: dict[str, bool] = {}
    alias_map = {"app": "APP", "sms": "SMS", "email": "EMAIL"}
    for raw_key, raw_val in value.items():
        key = alias_map.get(str(raw_key or "").strip().lower())
        if not key:
            continue
        normalized[key] = bool(raw_val)
    if not normalized:
        raise ValueError("channels must include at least one of APP, SMS, EMAIL")
    return normalized


def _normalize_reminder_recipients(recipients: Optional[List[str]]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in recipients or []:
        username = _normalize_username(raw)
        if not username or username in seen:
            continue
        normalized.append(username)
        seen.add(username)
    return normalized


def _validate_reminder_recipients_sync(actor_user: Any, recipients: Optional[List[str]]) -> tuple[list[str], dict[str, Any]]:
    actor_username = _normalize_username(getattr(actor_user, "username", ""))
    if not actor_username:
        raise PermissionError("Authenticated username is required for reminders.")

    requested = _normalize_reminder_recipients(recipients)
    if not requested:
        requested = [actor_username]

    if _request_is_alshival_agent():
        usernames_to_check = [name for name in requested if name != actor_username]
        status_map: dict[str, dict[str, Any]] = {}
        if usernames_to_check:
            _ensure_django()
            from django.contrib.auth import get_user_model  # type: ignore
            from django.db.models import Q  # type: ignore

            User = get_user_model()
            query = Q()
            for username in usernames_to_check:
                query |= Q(username__iexact=username)
            matches = User.objects.filter(query, is_active=True, is_staff=True) if usernames_to_check else []
            allowed_usernames = {
                _normalize_username(getattr(user, "username", ""))
                for user in matches
                if _normalize_username(getattr(user, "username", ""))
            }
            invalid_recipients: list[dict[str, Any]] = []
            for username in usernames_to_check:
                if username in allowed_usernames:
                    status_map[username] = {"status": "activated", "is_staff": True}
                else:
                    status_map[username] = {"status": "not_staff_or_missing", "is_staff": False}
                    invalid_recipients.append({"username": username, "status": "not_staff_or_missing"})
            if invalid_recipients:
                invalid_text = ", ".join(
                    f"@{entry['username']}({entry['status']})" for entry in invalid_recipients
                )
                raise PermissionError(
                    "Alshival agent reminders may target only active staff users. "
                    f"Invalid recipients: {invalid_text}"
                )
        status_map[actor_username] = {"status": "activated", "is_staff": bool(getattr(actor_user, "is_staff", False))}
        return requested, status_map

    usernames_to_check = [name for name in requested if name != actor_username]
    status_map: dict[str, dict[str, Any]] = {}
    if usernames_to_check:
        status_map = _social_status_map_sync(actor_user, usernames_to_check)

    valid_recipients: list[str] = []
    invalid_recipients: list[dict[str, Any]] = []
    for username in requested:
        if username == actor_username:
            valid_recipients.append(username)
            continue
        status_payload = status_map.get(username) or {}
        status = str(status_payload.get("status") or "not_collaborator")
        if status == "activated":
            valid_recipients.append(username)
        else:
            invalid_recipients.append({"username": username, "status": status})

    if invalid_recipients:
        invalid_text = ", ".join(
            f"@{entry['username']}({entry['status']})" for entry in invalid_recipients
        )
        raise PermissionError(
            "Recipients must be active collaborators (or yourself). "
            f"Invalid recipients: {invalid_text}"
        )
    return valid_recipients, status_map


def _init_spam_db() -> None:
    with _get_spam_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS spam_ips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_address TEXT NOT NULL UNIQUE,
                reason TEXT,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                hit_count INTEGER NOT NULL DEFAULT 1,
                suspended_until TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS spam_ip_flags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_address TEXT NOT NULL,
                reason TEXT,
                flagged_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_spam_ips_ip ON spam_ips (ip_address)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_spam_ip_flags_ip_time ON spam_ip_flags (ip_address, flagged_at)")
        columns = {row[1] for row in conn.execute("PRAGMA table_info(spam_ips)").fetchall()}
        if "suspended_until" not in columns:
            conn.execute("ALTER TABLE spam_ips ADD COLUMN suspended_until TEXT")


def _ensure_spam_ready() -> None:
    if not AUTH_DB_PATH.exists():
        _init_spam_db()
        return
    _init_spam_db()


def _row_to_spam_entry(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "ip_address": row["ip_address"],
        "reason": row["reason"],
        "first_seen_at": row["first_seen_at"],
        "last_seen_at": row["last_seen_at"],
        "hit_count": row["hit_count"],
        "suspended_until": row["suspended_until"],
    }


MCP_HOST = os.getenv("MCP_HTTP_HOST", "0.0.0.0")

mcp = FastMCP("alshival-mcp", stateless_http=True, host=MCP_HOST)
STATIC_API_KEYS = parse_static_api_keys(RAW_STATIC_KEYS)
if not STATIC_API_KEYS:
    raise RuntimeError("At least one MCP_STATIC_API_KEYS entry is required.")
_twilio_client: Optional[TwilioClient] = None


def _get_twilio_client() -> TwilioClient:
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_FROM_NUMBER:
        raise RuntimeError("Twilio credentials (SID, token, from number) must be configured")
    global _twilio_client
    if _twilio_client is None:
        _twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    return _twilio_client


def _send_sms(recipient: str, body: str) -> str:
    client = _get_twilio_client()
    message = client.messages.create(
        body=body,
        from_=TWILIO_FROM_NUMBER,
        to=recipient,
    )
    return message.sid


def _normalize_sms_phone(value: str) -> str:
    """Normalize phone number to E.164-like format and validate basic length."""
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Phone number is required.")
    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        raise ValueError("Invalid phone number: no digits found.")
    if digits.startswith("1") and len(digits) == 11:
        normalized = f"+{digits}"
    elif len(digits) == 10:
        normalized = f"+1{digits}"
    else:
        normalized = f"+{digits}"
    if not re.fullmatch(r"\+[1-9]\d{7,14}", normalized):
        raise ValueError("Invalid phone number format. Use an E.164-compatible value.")
    return normalized


def _resolve_verified_sms_recipient_by_username_sync(username: str) -> Dict[str, Any]:
    _ensure_django()
    from django.contrib.auth import get_user_model  # type: ignore
    from auth.models import Profile  # type: ignore
    from client_portal.user_resources import get_user_account_settings  # type: ignore

    candidate = (username or "").strip()
    if candidate.startswith("@"):
        candidate = candidate[1:].strip()
    if not candidate:
        raise ValueError("username is required when to_phone is not provided.")

    User = get_user_model()
    user = User.objects.filter(username__iexact=candidate).first()
    if not user:
        raise ValueError(f"User '@{candidate}' was not found.")

    profile = Profile.objects.filter(user=user).first()
    account_settings = get_user_account_settings(user, profile=profile)
    phone_number = (account_settings.get("phone_number") or "").strip()
    if not phone_number:
        raise ValueError(f"User '@{user.username}' does not have a phone number on file.")
    if not bool(account_settings.get("is_verified")):
        raise ValueError(f"User '@{user.username}' does not have a verified phone number.")

    return {
        "user_id": int(getattr(user, "id", 0) or 0),
        "username": (getattr(user, "username", "") or "").strip(),
        "phone_number": _normalize_sms_phone(phone_number),
    }


def _resolve_email_recipient_by_username_sync(username: str) -> Dict[str, Any]:
    _ensure_django()
    from django.contrib.auth import get_user_model  # type: ignore

    candidate = (username or "").strip()
    if candidate.startswith("@"):
        candidate = candidate[1:].strip()
    if not candidate:
        raise ValueError("username is required when to_email is not provided.")

    User = get_user_model()
    user = User.objects.filter(username__iexact=candidate).first()
    if not user:
        raise ValueError(f"User '@{candidate}' was not found.")

    email = (getattr(user, "email", "") or "").strip()
    if not email or "@" not in email:
        raise ValueError(f"User '@{user.username}' does not have a valid email address.")

    return {
        "user_id": int(getattr(user, "id", 0) or 0),
        "username": (getattr(user, "username", "") or "").strip(),
        "email": email,
    }


def _is_support_mailbox_email(value: str) -> bool:
    email = str(value or "").strip().lower()
    if not email:
        return False
    support_mailbox = (_get_support_mailbox() or "").strip().lower()
    return bool(support_mailbox and email == support_mailbox)


def _is_alshival_agent_username(value: str) -> bool:
    username = str(value or "").strip().lstrip("@").lower()
    return bool(username and ALSHIVAL_AGENT_USERNAME and username == ALSHIVAL_AGENT_USERNAME)


def _exclude_support_alert_recipient(*, username: str = "", email: str = "") -> bool:
    return _is_alshival_agent_username(username) or _is_support_mailbox_email(email)


def _resolve_staff_sms_recipients_sync() -> List[Dict[str, Any]]:
    _ensure_django()
    from django.contrib.auth import get_user_model  # type: ignore
    from auth.models import Profile  # type: ignore
    from client_portal.user_resources import get_user_account_settings  # type: ignore

    User = get_user_model()
    users = User.objects.filter(is_active=True, is_staff=True).order_by("id")
    recipients: List[Dict[str, Any]] = []
    seen_phones: set[str] = set()
    for user in users:
        username = (getattr(user, "username", "") or "").strip()
        email = (getattr(user, "email", "") or "").strip()
        if _exclude_support_alert_recipient(username=username, email=email):
            continue
        profile = Profile.objects.filter(user=user).first()
        settings = get_user_account_settings(user, profile=profile)
        if not bool(settings.get("is_verified")):
            continue
        raw_phone = (settings.get("phone_number") or "").strip()
        if not raw_phone:
            continue
        try:
            phone_number = _normalize_sms_phone(raw_phone)
        except ValueError:
            continue
        if phone_number in seen_phones:
            continue
        seen_phones.add(phone_number)
        recipients.append(
            {
                "user_id": int(getattr(user, "id", 0) or 0),
                "username": username,
                "email": email,
                "phone_number": phone_number,
            }
        )
    return recipients


def _resolve_staff_email_recipients_sync() -> List[Dict[str, Any]]:
    _ensure_django()
    from django.contrib.auth import get_user_model  # type: ignore

    User = get_user_model()
    users = User.objects.filter(is_active=True, is_staff=True).order_by("id")
    recipients: List[Dict[str, Any]] = []
    seen_emails: set[str] = set()
    for user in users:
        username = (getattr(user, "username", "") or "").strip()
        email = (getattr(user, "email", "") or "").strip().lower()
        if _exclude_support_alert_recipient(username=username, email=email):
            continue
        if not email or "@" not in email:
            continue
        if email in seen_emails:
            continue
        seen_emails.add(email)
        recipients.append(
            {
                "user_id": int(getattr(user, "id", 0) or 0),
                "username": username,
                "email": email,
            }
        )
    return recipients


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def _is_subscribed_client_user_for_role_sync(user) -> bool:
    if not user:
        return False
    try:
        from client_portal.assistant.service import is_subscribed_client_user  # type: ignore

        return bool(is_subscribed_client_user(user))
    except Exception:
        try:
            profile = getattr(user, "profile", None)
        except Exception:
            profile = None
        status = (getattr(profile, "stripe_subscription_status", "") or "").strip().lower() if profile else ""
        return bool(
            profile
            and (
                bool(getattr(profile, "is_subscribed", False))
                or bool(getattr(profile, "free_portal_access", False))
                or status in {"active", "trialing"}
            )
        )


def _resolve_access_role_for_user(user) -> str:
    if not user:
        return ACCESS_ROLE_PUBLIC
    if bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)):
        return ACCESS_ROLE_STAFF
    if _is_subscribed_client_user_for_role_sync(user):
        return ACCESS_ROLE_SUBSCRIBER
    return ACCESS_ROLE_PUBLIC


def _merge_payload_capabilities(payload: Dict[str, Any], additions: set[str]) -> None:
    if not additions:
        return
    merged = {str(item or "").strip().lower() for item in additions if str(item or "").strip()}
    existing = payload.get("capabilities")
    if isinstance(existing, str):
        merged.update(_parse_csv_set(existing.replace("|", ",")))
    elif isinstance(existing, (list, tuple, set)):
        merged.update({str(item or "").strip().lower() for item in existing if str(item or "").strip()})
    payload["capabilities"] = sorted(merged)


def _apply_email_agent_sender_scope(payload: Dict[str, Any], *, requested_user_email: Optional[str]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    if str(payload.get("type") or "").strip().lower() != "user_api_key":
        return payload
    request_username = str(payload.get("username") or "").strip().lower()
    if not request_username or request_username != ALSHIVAL_AGENT_USERNAME:
        return payload

    sender_email = (requested_user_email or "").strip().lower()
    if not sender_email or "@" not in sender_email:
        return payload
    actor_email = str(payload.get("user_email") or "").strip().lower()
    if sender_email == actor_email:
        return payload

    scoped_payload = dict(payload)
    sender_user = _resolve_user_for_api_key_sync(sender_email, None)
    if sender_user and not bool(getattr(sender_user, "is_active", False)):
        sender_user = None
    sender_role = _resolve_access_role_for_user(sender_user)
    scoped_payload["email_sender_email"] = sender_email
    scoped_payload["email_sender_access_role"] = sender_role
    if sender_user:
        sender_is_staff = bool(getattr(sender_user, "is_staff", False) or getattr(sender_user, "is_superuser", False))
        sender_is_superuser = bool(getattr(sender_user, "is_superuser", False))
        sender_is_subscribed_client = _is_subscribed_client_user_for_role_sync(sender_user)
        scoped_payload["email_sender_user_id"] = int(getattr(sender_user, "id", 0) or 0)
        scoped_payload["email_sender_username"] = (getattr(sender_user, "username", "") or "").strip()
        scoped_payload["email_sender_user_email"] = (
            (getattr(sender_user, "email", "") or "").strip().lower() or sender_email
        )
        scoped_payload["email_sender_is_staff"] = sender_is_staff
        scoped_payload["email_sender_is_superuser"] = sender_is_superuser
        scoped_payload["email_sender_is_subscribed_client"] = sender_is_subscribed_client
    if EMAIL_AGENT_BASE_CAPABILITIES:
        _merge_payload_capabilities(scoped_payload, EMAIL_AGENT_BASE_CAPABILITIES)
    return scoped_payload


def _authorize_api_key(api_key: str, *, user_email: Optional[str] = None, username: Optional[str] = None) -> Dict[str, Any]:
    normalized_email = (user_email or "").strip().lower() or None
    normalized_username = (username or "").strip() or None
    normalized_key = (api_key or "").strip()
    try:
        result = authenticate_api_key(
            normalized_key,
            user_email=normalized_email,
            username=normalized_username,
            static_api_keys=STATIC_API_KEYS,
            internal_api_key_labels=INTERNAL_API_KEY_LABELS,
        )
    except PermissionError as exc:
        resolved_user = None
        verify_match = False
        # Safe diagnostics for intermittent auth mismatches across edge/connector flows.
        try:
            _ensure_django()
            from client_portal.user_resources import verify_api_key  # type: ignore
            from django.contrib.auth import get_user_model  # type: ignore
            from auth.models import Profile  # type: ignore

            User = get_user_model()
            if normalized_username:
                resolved_user = User.objects.filter(username__iexact=normalized_username).first()
            if not resolved_user and normalized_email:
                profile = (
                    Profile.objects.select_related("user")
                    .filter(email__iexact=normalized_email)
                    .first()
                )
                if profile:
                    resolved_user = profile.user
                if not resolved_user:
                    resolved_user = User.objects.filter(email__iexact=normalized_email).first()
            verify_match = bool(verify_api_key(resolved_user, normalized_key)) if resolved_user else False
            logger.warning(
                "MCP API auth failed reason=%s email=%s username=%s resolved_user_id=%s verify_match=%s key_prefix=%s key_len=%s",
                str(exc),
                normalized_email or "",
                normalized_username or "",
                int(getattr(resolved_user, "id", 0) or 0),
                verify_match,
                normalized_key[:10],
                len(normalized_key),
            )
            if verify_match and resolved_user:
                is_staff = bool(getattr(resolved_user, "is_staff", False))
                is_superuser = bool(getattr(resolved_user, "is_superuser", False))
                profile = getattr(resolved_user, "profile", None)
                is_subscribed_client = bool(profile and getattr(profile, "is_subscribed", False))
                if is_staff or is_superuser:
                    access_role = ACCESS_ROLE_STAFF
                elif is_subscribed_client:
                    access_role = ACCESS_ROLE_SUBSCRIBER
                else:
                    access_role = ACCESS_ROLE_PUBLIC
                logger.warning(
                    "MCP API auth fallback accepted resolved_user_id=%s role=%s key_prefix=%s",
                    int(getattr(resolved_user, "id", 0) or 0),
                    access_role,
                    normalized_key[:10],
                )
                payload = {
                    "sub": f"user-api-key:{int(getattr(resolved_user, 'id', 0) or 0)}",
                    "api_key": "user",
                    "type": "user_api_key",
                    "access_role": access_role,
                    "issued_at": datetime.utcnow().isoformat() + "Z",
                    "user_id": int(getattr(resolved_user, "id", 0) or 0),
                    "user_email": (getattr(resolved_user, "email", "") or "").strip().lower(),
                    "username": (getattr(resolved_user, "username", "") or "").strip(),
                    "is_staff": is_staff,
                    "is_superuser": is_superuser,
                    "is_subscribed_client": is_subscribed_client,
                    "api_key_sha256": hashlib.sha256(normalized_key.encode("utf-8")).hexdigest(),
                }
                return _apply_email_agent_sender_scope(payload, requested_user_email=normalized_email)
        except Exception:
            logger.warning(
                "MCP API auth failed reason=%s email=%s username=%s key_prefix=%s key_len=%s",
                str(exc),
                normalized_email or "",
                normalized_username or "",
                normalized_key[:10],
                len(normalized_key),
                exc_info=True,
            )
        raise
    payload = result.to_payload()
    payload["api_key_sha256"] = hashlib.sha256(normalized_key.encode("utf-8")).hexdigest()
    return _apply_email_agent_sender_scope(payload, requested_user_email=normalized_email)


def _request_auth_payload() -> Dict[str, Any]:
    payload = _REQUEST_AUTH_PAYLOAD.get()
    return payload if isinstance(payload, dict) else {}


def _request_api_key_label() -> str:
    payload = _request_auth_payload()
    return str(payload.get("api_key") or "").strip().lower()


def _normalize_tool_name(value: Any) -> str:
    return str(value or "").strip().lower()


def _request_has_internal_access() -> bool:
    payload = _request_auth_payload()
    if _request_is_alshival_agent():
        sender_role = str(payload.get("email_sender_access_role") or "").strip().lower()
        if sender_role in {ACCESS_ROLE_PUBLIC, ACCESS_ROLE_SUBSCRIBER}:
            return False
        if sender_role == ACCESS_ROLE_STAFF:
            return True
    role = str(payload.get("access_role") or "").strip().lower()
    if role == ACCESS_ROLE_STAFF:
        return True
    key_label = str(payload.get("api_key") or "").strip().lower()
    if key_label and key_label in INTERNAL_API_KEY_LABELS:
        return True
    if str(payload.get("type") or "") == "user_api_key":
        return bool(payload.get("is_staff") or payload.get("is_superuser"))
    return False


def _request_access_role() -> str:
    payload = _request_auth_payload()
    if _request_is_alshival_agent():
        sender_role = str(payload.get("email_sender_access_role") or "").strip().lower()
        if sender_role in {ACCESS_ROLE_PUBLIC, ACCESS_ROLE_SUBSCRIBER, ACCESS_ROLE_STAFF}:
            return sender_role
    role = str(payload.get("access_role") or "").strip().lower()
    if role in {ACCESS_ROLE_PUBLIC, ACCESS_ROLE_SUBSCRIBER, ACCESS_ROLE_STAFF}:
        return role
    if _request_has_internal_access():
        return ACCESS_ROLE_STAFF
    if str(payload.get("type") or "") == "user_api_key" and bool(payload.get("is_subscribed_client")):
        return ACCESS_ROLE_SUBSCRIBER
    return ACCESS_ROLE_PUBLIC


def _request_subscription_tier() -> str:
    payload = _request_auth_payload()
    for key in ("subscription_tier", "plan_code", "subscription_plan", "tier"):
        value = str(payload.get(key) or "").strip().lower()
        if value:
            return value
    return ""


def _request_capabilities() -> set[str]:
    capabilities = set(PUBLIC_CAPABILITIES)
    role = _request_access_role()
    if role in {ACCESS_ROLE_SUBSCRIBER, ACCESS_ROLE_STAFF}:
        capabilities.update(SUBSCRIBER_CAPABILITIES)
    if role == ACCESS_ROLE_STAFF:
        capabilities.update(STAFF_CAPABILITIES)
    tier = _request_subscription_tier()
    if tier:
        capabilities.update(SUBSCRIPTION_TIER_CAPABILITIES.get(tier, set()))

    payload = _request_auth_payload()
    extra_caps = payload.get("capabilities")
    if isinstance(extra_caps, str):
        capabilities.update(_parse_csv_set(extra_caps.replace("|", ",")))
    elif isinstance(extra_caps, (list, tuple, set)):
        for cap_value in extra_caps:
            cap = str(cap_value or "").strip().lower()
            if cap:
                capabilities.add(cap)
    return capabilities


def _request_has_capability(capability: str) -> bool:
    candidate = str(capability or "").strip().lower()
    if not candidate:
        return True
    return candidate in _request_capabilities()


def _request_personal_kb_identity() -> tuple[Optional[str], Optional[str]]:
    """Resolve user identity allowed for personal KB reads.

    Rules:
    - user_api_key callers can only read their own personal KB.
    - non-user_api_key callers cannot read personal KB unless they have
      explicit `kb.personal.read.any` capability, in which case header
      context can be used to target a user.
    """

    payload = _request_auth_payload()
    auth_type = str(payload.get("type") or "").strip().lower()
    if auth_type == "user_api_key":
        payload_email = str(payload.get("user_email") or "").strip().lower()
        payload_username = str(payload.get("username") or "").strip()
        user_email = payload_email if "@" in payload_email else None
        user_name = payload_username or None
        return user_email, user_name

    if _request_has_capability("kb.personal.read.any"):
        return _get_request_user_email(), _get_request_user_name()

    return None, None


def _request_has_all_capabilities(required: set[str]) -> bool:
    if not required:
        return True
    return required.issubset(_request_capabilities())


def _request_has_any_capability(required: set[str]) -> bool:
    if not required:
        return True
    capabilities = _request_capabilities()
    return any(cap in capabilities for cap in required)


def _tool_required_capabilities(tool_name: str) -> set[str]:
    name = _normalize_tool_name(tool_name)
    required = set(TOOL_CAPABILITY_REQUIREMENTS.get(name, set()))
    # Keep reply/forward email tools available under email.send for support email flows without broad internal access.
    if name and name in INTERNAL_TOOL_NAMES and name not in {"reply_email", "forward_email"}:
        required.add(CAPABILITY_STAFF_INTERNAL)
    return required


def _tool_allowed_for_request(tool_name: str) -> tuple[bool, Optional[str]]:
    name = _normalize_tool_name(tool_name)
    if not name:
        return False, "Tool name is required."
    if name == "resource_logs":
        # Access is enforced inside `resource_logs` itself to support alert-recipient reads.
        return True, None
    if name == "generate_image":
        if not (_request_access_role() == ACCESS_ROLE_STAFF or _request_is_alshival_agent()):
            return False, "Access denied for tool 'generate_image'. Staff or Alshival agent required."
    if name in HARD_AGENT_ONLY_TOOL_NAMES and not _request_is_alshival_agent():
        return False, f"Access denied for tool '{name}'. Alshival agent key required."
    if name in AGENT_ONLY_TOOL_NAMES and not _request_is_alshival_agent():
        return False, f"Access denied for tool '{name}'. Alshival agent key required."
    if name == "spam_flag" and _request_access_role() != ACCESS_ROLE_PUBLIC:
        return False, "Access denied for tool 'spam_flag'. Public role required."
    required = _tool_required_capabilities(name)
    if _request_has_all_capabilities(required):
        return True, None
    missing = sorted(required.difference(_request_capabilities()))
    missing_text = ", ".join(missing) if missing else "insufficient privileges"
    return False, f"Access denied for tool '{name}'. Missing capabilities: {missing_text}."


def _tool_denial_reason(tool_name: str) -> Optional[str]:
    _, reason = _tool_allowed_for_request(tool_name)
    return reason


def _request_is_alshival_agent() -> bool:
    payload = _request_auth_payload()
    if str(payload.get("type") or "").strip().lower() != "user_api_key":
        return False
    request_username = str(payload.get("username") or "").strip().lower()
    if not request_username or request_username != ALSHIVAL_AGENT_USERNAME:
        return False
    if ALSHIVAL_AGENT_API_KEY_SHA256:
        api_key_sha = str(payload.get("api_key_sha256") or "").strip().lower()
        return bool(api_key_sha and api_key_sha == ALSHIVAL_AGENT_API_KEY_SHA256)
    return True


def _request_can_access_devtools_resources() -> bool:
    return _request_has_any_capability(
        {
            "devtools.resources.read",
            "devtools.resources.write",
            "devtools.resources.logs.read",
            "devtools.resources.share",
            "devtools.social.manage",
        }
    )


def _filter_tools_for_scope(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for tool in tools:
        name = _normalize_tool_name(tool.get("name"))
        if name and not _tool_allowed_for_request(name)[0]:
            continue
        filtered.append(tool)
    return filtered


def _jsonrpc_error_response(request_id: Any, code: int, message: str, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        },
        status_code=status_code,
    )


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #
@mcp.tool()
async def search_kb(query: str, top_k: int = 5) -> Dict[str, Any]:
    """Search the site knowledge base content.

    Parameters:
    - query (str): Natural language question or keywords.
    - top_k (int, default 5): Number of passages to return.
    """

    if not query or not query.strip():
        raise ValueError("query is required")
    if top_k <= 0:
        raise ValueError("top_k must be positive")

    query_embedding = _embed_query(query.strip())
    items: list[dict[str, Any]] = []
    allowed_visibilities = _allowed_kb_visibilities()

    site_collection = _get_site_kb_collection()
    site_items = _search_collection(
        collection=site_collection,
        query_embedding=query_embedding,
        n_results=min(max(top_k * 8, 24), 120),
        scope="public",
        collection_name=SITE_KB_COLLECTION,
    )
    items.extend(_filter_search_items_by_visibility(site_items, allowed_visibilities))

    user_email, user_name = _request_personal_kb_identity()

    if _request_has_internal_access():
        staff_collection = _get_staff_kb_collection()
        items.extend(
            _search_collection(
                collection=staff_collection,
                query_embedding=query_embedding,
                n_results=min(max(top_k, 5), 20),
                scope="staff",
                collection_name=STAFF_KB_COLLECTION,
            )
        )

    user_collection = await _get_user_kb_collection(user_email, user_name)
    if user_collection:
        items.extend(
            _search_collection(
                collection=user_collection,
                query_embedding=query_embedding,
                n_results=min(max(top_k, 5), 20),
                scope="personal",
                collection_name=CLIENT_KB_COLLECTION,
            )
        )

    # Keep up to top_k per scope (public + personal + staff), then sort by relevance.
    scope_order = ("public", "personal", "staff")
    combined: list[dict[str, Any]] = []
    for scope in scope_order:
        scoped_items = [item for item in items if item.get("scope") == scope]
        combined.extend(scoped_items[: min(top_k, 10)])
    combined.sort(key=lambda item: item.get("score", 0))
    items = combined

    return {
        "query": query,
        "results": items,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def search_users(query: str, top_k: int = 8, account_type: str = "") -> Dict[str, Any]:
    """Search DevTools user directory profiles with visibility-aware access control.

    Optional filters:
    - account_type: "staff", "member", or "all"/empty.
    """

    if not query or not query.strip():
        raise ValueError("query is required")
    if top_k <= 0:
        raise ValueError("top_k must be positive")

    query_text = query.strip()
    query_embedding = _embed_query(query_text)
    allowed_visibilities = _allowed_directory_visibilities()
    normalized_account_type = _normalize_directory_account_type(account_type)
    include_phone_numbers = _request_has_internal_access()
    max_results = max(1, min(int(top_k), 50))
    directory_where: dict[str, Any] = {"visibility": {"$in": sorted(allowed_visibilities)}}
    if normalized_account_type:
        directory_where = {
            "$and": [
                directory_where,
                {"account_type": normalized_account_type},
            ]
        }

    directory_collection = _get_directory_kb_collection()
    directory_items = _search_collection(
        collection=directory_collection,
        query_embedding=query_embedding,
        n_results=min(max(top_k * 6, 24), 120),
        scope="directory",
        collection_name=DIRECTORY_KB_COLLECTION,
        where_filter=directory_where,
    )
    visible_items = _filter_search_items_by_visibility(directory_items, allowed_visibilities)
    visible_items.sort(key=lambda item: item.get("score", 0))

    results: list[dict[str, Any]] = []
    seen_usernames: set[str] = set()
    for item in visible_items:
        meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        username = str(meta.get("username") or "").strip()
        if not username or username in seen_usernames:
            continue
        seen_usernames.add(username)
        snippet = str(item.get("text") or "").strip()
        if len(snippet) > 320:
            snippet = snippet[:320].rstrip() + "..."
        result_item = {
            "username": username,
            "full_name": str(meta.get("full_name") or "").strip(),
            "title": str(meta.get("title") or "").strip(),
            "location": str(meta.get("location") or "").strip(),
            "avatar_url": str(meta.get("avatar_url") or "").strip(),
            "website_url": str(meta.get("website_url") or "").strip(),
            "linkedin_url": str(meta.get("linkedin_url") or "").strip(),
            "twitter_url": str(meta.get("twitter_url") or "").strip(),
            "github_url": str(meta.get("github_url") or "").strip(),
            "spotify_url": str(meta.get("spotify_url") or "").strip(),
            "visibility": _normalize_kb_visibility(meta.get("visibility")),
            "profile_url": str(meta.get("url") or "").strip(),
            "snippet": snippet,
            "score": item.get("score"),
        }
        result_account_type = str(meta.get("account_type") or "").strip().lower()
        if result_account_type not in {"staff", "member"}:
            result_account_type = "staff" if result_item["visibility"] == "staff" else "member"
        if normalized_account_type and result_account_type != normalized_account_type:
            continue
        result_item["account_type"] = result_account_type
        if include_phone_numbers:
            result_item["phone_number"] = str(meta.get("phone_number") or "").strip()
        results.append(result_item)
        if len(results) >= max_results:
            break

    include_collaborator_status = _request_can_access_devtools_resources()
    if include_collaborator_status and results:
        actor_user = await _get_request_devtools_user()
        if actor_user:
            usernames = [str(item.get("username") or "") for item in results]
            status_map = await sync_to_async(_social_status_map_sync, thread_sensitive=True)(actor_user, usernames)
            for item in results:
                normalized_username = _normalize_username(item.get("username"))
                status = status_map.get(normalized_username) or {}
                item["collaborator_status"] = str(status.get("status") or "not_collaborator")
                item["collaborator_mode_active"] = bool(status.get("collaborators_enabled"))

    return {
        "query": query_text,
        "count": len(results),
        "results": results,
        "account_type_filter": normalized_account_type or "all",
        "access_tier": _kb_access_tier(),
        "visibility_scope": sorted(allowed_visibilities),
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def resource_upsert(
    action: str,
    name: str,
    resource_type: str = "other",
    address: str | None = None,
    port: int | None = None,
    healthcheck_url: str | None = None,
    db_type: str | None = None,
    github_repo: str | None = None,
    notes: str | None = None,
    monitor_enabled: bool = True,
    ssh_username: str | None = None,
    resource_id: int | None = None,
) -> Dict[str, Any]:
    """Create or update a resource in the caller's DevTools database.

    Parameters:
    - action: "create" or "update"
    - name: Resource name
    - resource_type: vm, db, api, other, etc.
    - address, port, healthcheck_url, db_type, github_repo, notes, monitor_enabled, ssh_username
    - resource_id: required when action="update"
    """

    action = (action or "").strip().lower()
    if action not in {"create", "update"}:
        raise ValueError("action must be 'create' or 'update'")
    if not name or not name.strip():
        raise ValueError("name is required")
    if not _request_has_capability("devtools.resources.write"):
        raise PermissionError("DevTools write access required.")

    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated DevTools user context required.")

    from client_portal.user_resources import (
        create_user_resource,
        get_user_resource,
        update_user_resource,
        encode_user_resource_id,
        refresh_user_kb,
    )

    payload = {
        "name": name.strip(),
        "resource_type": (resource_type or "other").strip() or "other",
        "address": (address or "").strip(),
        "port": port,
        "healthcheck_url": (healthcheck_url or "").strip(),
        "db_type": (db_type or "").strip(),
        "github_repo": (github_repo or "").strip(),
        "notes": (notes or "").strip(),
        "monitor_enabled": bool(monitor_enabled),
        "ssh_username": (ssh_username or "").strip(),
    }

    if action == "create":
        new_id = await sync_to_async(create_user_resource, thread_sensitive=True)(user, payload)
        if not new_id:
            raise RuntimeError("Failed to create resource.")
        await sync_to_async(refresh_user_kb, thread_sensitive=False)(user)
        encoded_id = encode_user_resource_id(new_id)
        from client_portal.portal_urls import devtools_resource_url

        return {
            "action": "create",
            "resource_id": new_id,
            "encoded_resource_id": encoded_id,
            "resource_url": devtools_resource_url(encoded_resource_id=encoded_id),
        }

    if resource_id is None:
        raise ValueError("resource_id is required for update")
    resource = await sync_to_async(get_user_resource, thread_sensitive=True)(user, resource_id)
    if not resource:
        raise PermissionError("Resource not found.")
    await sync_to_async(update_user_resource, thread_sensitive=True)(user, resource_id, payload)
    await sync_to_async(refresh_user_kb, thread_sensitive=False)(user)
    encoded_id = encode_user_resource_id(resource_id)
    from client_portal.portal_urls import devtools_resource_url

    return {
        "action": "update",
        "resource_id": resource_id,
        "encoded_resource_id": encoded_id,
        "resource_url": devtools_resource_url(encoded_resource_id=encoded_id),
    }


def _parse_optional_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    text = (value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError("Invalid datetime. Use ISO format, e.g. 2026-02-16T12:34:56Z")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _resource_target(resource: Any) -> str:
    healthcheck = (getattr(resource, "healthcheck_url", "") or "").strip()
    address = (getattr(resource, "address", "") or "").strip()
    port = getattr(resource, "port", None)
    if healthcheck:
        return healthcheck
    if address and port:
        return f"{address}:{port}"
    if address:
        return address
    return ""


async def _resolve_client_resource_access(
    user: Any,
    *,
    resource_id: Optional[int] = None,
    resource_uuid: Optional[str] = None,
    owner_username: Optional[str] = None,
) -> tuple[Any, int, Any, str, str]:
    from client_portal.user_resources import (  # type: ignore
        decode_shared_resource_id,
        decode_user_resource_id,
        get_shared_resource,
        list_shared_resources,
        get_user_resource,
        get_user_resource_by_uuid,
    )

    if resource_id is not None:
        shared_id = decode_shared_resource_id(int(resource_id))
        if shared_id is not None:
            shared = await sync_to_async(get_shared_resource, thread_sensitive=True)(user, shared_id)
            if not shared:
                raise PermissionError("Shared resource not found.")
            resource, share = shared
            return share.owner, int(share.user_resource_id), resource, "shared", str(share.role or "view")

        user_resource_id = decode_user_resource_id(int(resource_id))
        if user_resource_id is not None:
            resource = await sync_to_async(get_user_resource, thread_sensitive=True)(user, user_resource_id)
            if not resource:
                raise PermissionError("Resource not found.")
            return user, int(user_resource_id), resource, "owned", "owner"

        if int(resource_id) > 0:
            resource = await sync_to_async(get_user_resource, thread_sensitive=True)(user, int(resource_id))
            if resource:
                return user, int(resource_id), resource, "owned", "owner"
        raise ValueError("Invalid resource_id.")

    uuid_value = (resource_uuid or "").strip()
    if uuid_value:
        found = await sync_to_async(get_user_resource_by_uuid, thread_sensitive=True)(user, uuid_value)
        if found:
            owner_resource_id, resource = found
            return user, int(owner_resource_id), resource, "owned", "owner"

        shared_resources = await sync_to_async(list_shared_resources, thread_sensitive=True)(user)
        target_owner = (owner_username or "").strip().lower()
        for shared_resource in shared_resources:
            shared_uuid = (getattr(shared_resource, "resource_uuid", "") or "").strip()
            if shared_uuid != uuid_value:
                continue
            owner = getattr(shared_resource, "shared_owner", None)
            owner_name = (getattr(owner, "username", "") or "").strip().lower()
            if target_owner and owner_name != target_owner:
                continue
            shared_id = int(getattr(shared_resource, "shared_id", 0) or 0)
            if shared_id <= 0 or not owner:
                continue
            return owner, int(getattr(shared_resource, "id", 0) or 0), shared_resource, "shared", str(
                getattr(shared_resource, "shared_role", "view")
            )

        raise PermissionError("Resource not found for this user.")

    raise ValueError("Provide either resource_id or resource_uuid.")


def _normalize_contact_email(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if "@" in text else ""


def _normalize_contact_username(value: Any) -> str:
    return str(value or "").strip().lstrip("@").lower()


def _normalize_contact_phone(value: Any) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if not digits:
        return ""
    if digits.startswith("1") and len(digits) == 11:
        return f"+{digits}"
    if len(digits) == 10:
        return f"+1{digits}"
    return f"+{digits}"


def _identity_sets_for_user_sync(user: Any) -> tuple[set[str], set[str], set[str]]:
    emails: set[str] = set()
    usernames: set[str] = set()
    phones: set[str] = set()
    if not user:
        return emails, usernames, phones

    email = _normalize_contact_email(getattr(user, "email", ""))
    if email:
        emails.add(email)
    username = _normalize_contact_username(getattr(user, "username", ""))
    if username:
        usernames.add(username)

    profile = getattr(user, "profile", None)
    profile_email = _normalize_contact_email(getattr(profile, "email", "") if profile else "")
    if profile_email:
        emails.add(profile_email)

    try:
        from client_portal.user_resources import get_user_account_settings  # type: ignore

        settings = get_user_account_settings(user, profile=profile)
        if bool(settings.get("is_verified")):
            phone = _normalize_contact_phone(settings.get("phone_number") or "")
            if phone:
                phones.add(phone)
    except Exception:
        if profile and bool(getattr(profile, "is_verified", False)):
            phone = _normalize_contact_phone(getattr(profile, "phone_number", ""))
            if phone:
                phones.add(phone)

    return emails, usernames, phones


def _owner_resource_by_username_uuid_sync(owner_username: str, resource_uuid: str):
    from client_portal.user_resources import get_user_resource_by_uuid  # type: ignore

    owner_lookup = (owner_username or "").strip()
    owner = _resolve_user_for_api_key_sync(
        owner_lookup if "@" in owner_lookup else None,
        owner_lookup if "@" not in owner_lookup else None,
    )
    if not owner:
        return None
    found = get_user_resource_by_uuid(owner, (resource_uuid or "").strip())
    if not found:
        return None
    owner_resource_id, resource = found
    return owner, int(owner_resource_id), resource


def _shared_role_for_user_sync(owner_user: Any, owner_resource_id: int, request_user: Any) -> str:
    if not owner_user or not request_user:
        return ""
    _ensure_django()
    try:
        from client_portal.models import ClientResourceShare  # type: ignore
        from django.db.models import Q  # type: ignore
    except Exception:
        return ""

    github_login = _user_github_login_sync(request_user)
    share_filter = Q(shared_with=request_user)
    if github_login:
        share_filter |= Q(github_login__iexact=github_login)
    share = (
        ClientResourceShare.objects.filter(
            owner=owner_user,
            user_resource_id=int(owner_resource_id),
        )
        .filter(share_filter)
        .order_by("-created_at", "-id")
        .first()
    )
    if not share:
        return ""
    return str(getattr(share, "role", "") or "")


def _request_is_alert_recipient_sync(
    owner_user: Any,
    owner_resource_id: int,
    *,
    identity_emails: set[str],
    identity_phones: set[str],
    include_inactive: bool = False,
) -> bool:
    _ensure_django()
    try:
        from client_portal.models import ClientResourceAlertRecipient  # type: ignore
    except Exception:
        return False
    recipients = ClientResourceAlertRecipient.objects.filter(
        owner=owner_user,
        user_resource_id=int(owner_resource_id),
    )
    if not include_inactive:
        recipients = recipients.filter(is_active=True)
    for recipient in recipients:
        recipient_email = _normalize_contact_email(getattr(recipient, "recipient_email", ""))
        if recipient_email and recipient_email in identity_emails:
            return True
        recipient_phone = _normalize_contact_phone(getattr(recipient, "recipient_phone", ""))
        if recipient_phone and recipient_phone in identity_phones:
            return True
    return False


def _authorize_resource_log_identity_access_sync(
    *,
    request_user: Any,
    owner_user: Any,
    owner_resource_id: int,
    identity_emails: set[str],
    identity_usernames: set[str],
    identity_phones: set[str],
    allow_inactive_alert_recipient: bool = False,
) -> tuple[str, str]:
    request_user_id = int(getattr(request_user, "id", 0) or 0)
    owner_user_id = int(getattr(owner_user, "id", 0) or 0)
    if request_user_id and owner_user_id and request_user_id == owner_user_id:
        return "owned", "owner"

    shared_role = _shared_role_for_user_sync(owner_user, owner_resource_id, request_user)
    if shared_role:
        return "shared", shared_role

    owner_emails, owner_usernames, owner_phones = _identity_sets_for_user_sync(owner_user)
    if identity_emails.intersection(owner_emails):
        return "owned", "owner"
    if identity_usernames.intersection(owner_usernames):
        return "owned", "owner"
    if identity_phones.intersection(owner_phones):
        return "owned", "owner"

    if _request_is_alert_recipient_sync(
        owner_user,
        owner_resource_id,
        identity_emails=identity_emails,
        identity_phones=identity_phones,
        include_inactive=bool(allow_inactive_alert_recipient),
    ):
        return "alert_recipient", "alert_recipient"

    raise PermissionError(
        "Resource log access requires owner/shared access or an active alert-recipient identity match."
    )


def _resource_notification_snapshot_sync(owner_user: Any, owner_resource_id: int, owner_resource: Any) -> dict[str, Any]:
    _ensure_django()
    from client_portal.models import (  # type: ignore
        ClientResourceAlertRecipient,
        ClientResourceAlertRecipientContextEvent,
        ClientResourceShare,
    )
    from client_portal.user_resources import get_resource_notification_settings_for_viewer  # type: ignore

    owner_settings = get_resource_notification_settings_for_viewer(
        owner_user,
        owner_user,
        int(owner_resource_id),
        owner_resource=owner_resource,
    ) or {}

    shared_users: list[dict[str, Any]] = []
    shares = (
        ClientResourceShare.objects.select_related("shared_with")
        .filter(owner=owner_user, user_resource_id=int(owner_resource_id))
        .order_by("id")
    )
    for share in shares:
        shared_with = getattr(share, "shared_with", None)
        if not shared_with:
            continue
        shared_settings = get_resource_notification_settings_for_viewer(
            shared_with,
            owner_user,
            int(owner_resource_id),
            owner_resource=owner_resource,
        ) or {}
        shared_users.append(
            {
                "share_id": int(getattr(share, "id", 0) or 0),
                "user_id": int(getattr(shared_with, "id", 0) or 0),
                "username": (getattr(shared_with, "username", "") or "").strip(),
                "email": (getattr(shared_with, "email", "") or "").strip(),
                "role": (getattr(share, "role", "") or "").strip(),
                "notification_settings": shared_settings,
            }
        )

    external_recipients: list[dict[str, Any]] = []
    recipients = (
        ClientResourceAlertRecipient.objects.filter(
            owner=owner_user,
            user_resource_id=int(owner_resource_id),
        )
        .order_by("-created_at", "-id")
    )
    for recipient in recipients:
        recent_events = (
            ClientResourceAlertRecipientContextEvent.objects.filter(recipient=recipient)
            .order_by("-created_at", "-id")[:5]
        )
        external_recipients.append(
            {
                "recipient_id": int(getattr(recipient, "id", 0) or 0),
                "name": str(getattr(recipient, "name", "") or "").strip(),
                "recipient_email": str(getattr(recipient, "recipient_email", "") or "").strip(),
                "recipient_phone": str(getattr(recipient, "recipient_phone", "") or "").strip(),
                "notify_healthcheck_failed": bool(getattr(recipient, "notify_healthcheck_failed", False)),
                "notify_log_error": bool(getattr(recipient, "notify_log_error", False)),
                "channel_sms": bool(getattr(recipient, "channel_sms", False)),
                "channel_email": bool(getattr(recipient, "channel_email", False)),
                "is_active": bool(getattr(recipient, "is_active", False)),
                "recent_context_events": [
                    {
                        "event_type": str(getattr(event, "event_type", "") or "").strip(),
                        "summary": str(getattr(event, "summary", "") or "").strip(),
                        "payload": getattr(event, "payload", {}) or {},
                        "created_at": (
                            getattr(event, "created_at", None).isoformat() if getattr(event, "created_at", None) else ""
                        ),
                    }
                    for event in recent_events
                ],
            }
        )

    return {
        "owner_settings": owner_settings,
        "shared_users": shared_users,
        "external_recipients": external_recipients,
    }


def _find_external_alert_recipient_sync(
    *,
    owner_user: Any,
    owner_resource_id: int,
    recipient_id: Optional[int] = None,
    recipient_email: str = "",
    recipient_phone: str = "",
) -> Any:
    _ensure_django()
    from client_portal.models import ClientResourceAlertRecipient  # type: ignore

    queryset = ClientResourceAlertRecipient.objects.filter(
        owner=owner_user,
        user_resource_id=int(owner_resource_id),
    ).order_by("-created_at", "-id")
    if recipient_id:
        return queryset.filter(id=int(recipient_id)).first()
    normalized_email = _normalize_contact_email(recipient_email)
    normalized_phone = _normalize_contact_phone(recipient_phone)
    for candidate in queryset:
        cand_email = _normalize_contact_email(getattr(candidate, "recipient_email", ""))
        cand_phone = _normalize_contact_phone(getattr(candidate, "recipient_phone", ""))
        if normalized_email and cand_email and normalized_email == cand_email:
            return candidate
        if normalized_phone and cand_phone and normalized_phone == cand_phone:
            return candidate
    return None


def _record_external_recipient_context_event_sync(
    *,
    recipient: Any,
    owner_user: Any,
    owner_resource_id: int,
    event_type: str,
    summary: str,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    _ensure_django()
    from client_portal.alert_recipient_context import record_external_alert_recipient_context_event  # type: ignore

    record_external_alert_recipient_context_event(
        recipient=recipient,
        owner_user=owner_user,
        owner_resource_id=int(owner_resource_id),
        event_type=event_type,
        summary=summary,
        payload=payload,
    )


def _build_user_notification_updates_from_self_action(
    *,
    action: str,
    notification_settings: Optional[Dict[str, Dict[str, Any]]],
    notify_healthcheck_failed: Optional[bool],
    notify_log_error: Optional[bool],
    channel_sms: Optional[bool],
    channel_email: Optional[bool],
    is_active: Optional[bool],
) -> Dict[str, Dict[str, Any]]:
    """Translate self-service flags into per-user resource notification updates.

    Internal DevTools users store per-resource notification settings in their own
    `client_resources/user-<id>/resources.db`. External recipients use Django
    model booleans. This helper maps the self-service flag surface to the
    per-user notification_settings payload.
    """

    updates: Dict[str, Dict[str, Any]] = {}
    if isinstance(notification_settings, dict):
        for event_key, event_payload in notification_settings.items():
            if not isinstance(event_payload, dict):
                continue
            updates[str(event_key)] = dict(event_payload)

    def _ensure_event(event_key: str) -> Dict[str, Any]:
        existing = updates.get(event_key)
        if not isinstance(existing, dict):
            existing = {}
            updates[event_key] = existing
        return existing

    # External-recipient channel flags apply to both resource alert events.
    if channel_sms is not None:
        _ensure_event("healthcheck_failed")["SMS"] = bool(channel_sms)
        _ensure_event("log_error")["SMS"] = bool(channel_sms)
    if channel_email is not None:
        _ensure_event("healthcheck_failed")["EMAIL"] = bool(channel_email)
        _ensure_event("log_error")["EMAIL"] = bool(channel_email)

    # Event booleans map to "all channels off" when disabled.
    # When enabled and no channel is set, keep APP enabled by default.
    event_toggles = {
        "healthcheck_failed": notify_healthcheck_failed,
        "log_error": notify_log_error,
    }
    for event_key, enabled in event_toggles.items():
        if enabled is None:
            continue
        event_updates = _ensure_event(event_key)
        if bool(enabled):
            event_updates.setdefault("APP", True)
        else:
            event_updates["APP"] = False
            event_updates["SMS"] = False
            event_updates["EMAIL"] = False

    # "Unsubscribe" semantics for internal users: disable all channels.
    if action == "unsubscribe_self" or is_active is False:
        for event_key in ("healthcheck_failed", "log_error"):
            event_updates = _ensure_event(event_key)
            event_updates["APP"] = False
            event_updates["SMS"] = False
            event_updates["EMAIL"] = False

    return updates


def _resolve_unsubscribe_self_target_from_identity_sync(
    *,
    identity_emails: set[str],
    identity_phones: set[str],
    owner_username: str = "",
) -> list[dict[str, Any]]:
    _ensure_django()
    from client_portal.models import (  # type: ignore
        ClientResourceAlertRecipient,
        ClientResourceAlertRecipientContextEvent,
    )
    from client_portal.user_resources import get_user_resource  # type: ignore

    if not identity_emails and not identity_phones:
        return []

    recipients = list(
        ClientResourceAlertRecipient.objects.select_related("owner")
        .filter(is_active=True)
        .order_by("-updated_at", "-id")
    )

    owner_filter = (owner_username or "").strip().lower()
    matches: list[dict[str, Any]] = []
    for recipient in recipients:
        owner = getattr(recipient, "owner", None)
        if not owner:
            continue
        owner_name = (getattr(owner, "username", "") or "").strip().lower()
        if owner_filter and owner_name != owner_filter:
            continue

        rec_email = _normalize_contact_email(getattr(recipient, "recipient_email", ""))
        rec_phone = _normalize_contact_phone(getattr(recipient, "recipient_phone", ""))
        if not ((rec_email and rec_email in identity_emails) or (rec_phone and rec_phone in identity_phones)):
            continue

        owner_resource_id = int(getattr(recipient, "user_resource_id", 0) or 0)
        if owner_resource_id <= 0:
            continue
        owner_resource = get_user_resource(owner, owner_resource_id)
        if not owner_resource:
            continue
        resource_uuid = (getattr(owner_resource, "resource_uuid", "") or "").strip()
        if not resource_uuid:
            continue

        last_event = (
            ClientResourceAlertRecipientContextEvent.objects.filter(
                recipient=recipient,
                owner=owner,
                user_resource_id=owner_resource_id,
            )
            .order_by("-created_at", "-id")
            .first()
        )
        last_event_at = getattr(last_event, "created_at", None)

        matches.append(
            {
                "recipient_id": int(getattr(recipient, "id", 0) or 0),
                "owner_username": (getattr(owner, "username", "") or "").strip(),
                "owner_resource_id": owner_resource_id,
                "resource_uuid": resource_uuid,
                "resource_name": (getattr(owner_resource, "name", "") or "").strip(),
                "recipient_email": str(getattr(recipient, "recipient_email", "") or "").strip(),
                "recipient_phone": str(getattr(recipient, "recipient_phone", "") or "").strip(),
                "last_event_at": last_event_at,
            }
        )

    matches.sort(key=lambda item: (item.get("last_event_at") or datetime.min), reverse=True)
    return matches


@mcp.tool()
async def resource_list(include_shared: bool = True) -> Dict[str, Any]:
    """List resources accessible to the authenticated DevTools user.

    Access:
    - DevTools subscribed users
    - Staff/superusers
    - Internal-scope API keys with user context
    """

    if not _request_can_access_devtools_resources():
        raise PermissionError("DevTools access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated user context required for listing resources.")

    from client_portal.user_resources import (  # type: ignore
        encode_shared_resource_id,
        encode_user_resource_id,
        list_shared_resources,
        list_user_resources,
    )

    owned_resources = await sync_to_async(list_user_resources, thread_sensitive=True)(user)
    shared_resources: list[Any] = []
    if include_shared:
        shared_resources = await sync_to_async(list_shared_resources, thread_sensitive=True)(user)

    items: list[dict[str, Any]] = []
    for resource in owned_resources:
        encoded_id = encode_user_resource_id(int(resource.id))
        items.append(
            {
                "scope": "owned",
                "resource_id": int(resource.id),
                "encoded_resource_id": encoded_id,
                "resource_uuid": getattr(resource, "resource_uuid", None),
                "name": resource.name,
                "resource_type": resource.resource_type,
                "target": _resource_target(resource),
                "last_status": resource.last_status,
                "monitor_enabled": bool(getattr(resource, "monitor_enabled", True)),
                "owner": (user.username or "").strip(),
            }
        )
    for resource in shared_resources:
        shared_id = int(getattr(resource, "shared_id", 0) or 0)
        if shared_id <= 0:
            continue
        encoded_id = encode_shared_resource_id(shared_id)
        owner = getattr(resource, "shared_owner", None)
        items.append(
            {
                "scope": "shared",
                "share_id": shared_id,
                "encoded_resource_id": encoded_id,
                "resource_uuid": getattr(resource, "resource_uuid", None),
                "name": resource.name,
                "resource_type": resource.resource_type,
                "target": _resource_target(resource),
                "last_status": resource.last_status,
                "monitor_enabled": bool(getattr(resource, "monitor_enabled", True)),
                "shared_role": getattr(resource, "shared_role", "view"),
                "owner": (getattr(owner, "username", "") or "").strip(),
            }
        )

    return {
        "count": len(items),
        "resources": items,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def resource_get(
    resource_id: Optional[int] = None,
    resource_uuid: Optional[str] = None,
    owner_username: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch details for one accessible resource."""

    if not _request_can_access_devtools_resources():
        raise PermissionError("DevTools access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated user context required.")

    owner, owner_resource_id, resource, scope, role = await _resolve_client_resource_access(
        user,
        resource_id=resource_id,
        resource_uuid=resource_uuid,
        owner_username=owner_username,
    )
    owner_username = (getattr(owner, "username", "") or "").strip()
    uuid_value = (getattr(resource, "resource_uuid", "") or "").strip()
    canonical_url = ""
    if owner_username and uuid_value:
        from client_portal.portal_urls import devtools_resource_canonical_url

        canonical_url = devtools_resource_canonical_url(owner_username=owner_username, resource_uuid=uuid_value)
    return {
        "scope": scope,
        "role": role,
        "owner": owner_username,
        "owner_resource_id": owner_resource_id,
        "resource_uuid": uuid_value or None,
        "name": resource.name,
        "resource_type": resource.resource_type,
        "db_type": getattr(resource, "db_type", None) or "",
        "target": _resource_target(resource),
        "address": getattr(resource, "address", None) or "",
        "port": getattr(resource, "port", None),
        "healthcheck_url": getattr(resource, "healthcheck_url", None) or "",
        "github_repo": getattr(resource, "github_repo", None) or "",
        "notes": getattr(resource, "notes", None) or "",
        "last_status": getattr(resource, "last_status", None) or "unknown",
        "monitor_enabled": bool(getattr(resource, "monitor_enabled", True)),
        "resource_url": canonical_url,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def resource_notification_settings(
    action: str = "get",
    resource_id: Optional[int] = None,
    resource_uuid: Optional[str] = None,
    owner_username: Optional[str] = None,
    target: str = "owner",
    shared_username: Optional[str] = None,
    shared_email: Optional[str] = None,
    recipient_id: Optional[int] = None,
    recipient_email: Optional[str] = None,
    recipient_phone: Optional[str] = None,
    notification_settings: Optional[Dict[str, Dict[str, Any]]] = None,
    notify_healthcheck_failed: Optional[bool] = None,
    notify_log_error: Optional[bool] = None,
    channel_sms: Optional[bool] = None,
    channel_email: Optional[bool] = None,
    is_active: Optional[bool] = None,
) -> Dict[str, Any]:
    """Manage resource notifications for owner, shared users, and external alert recipients.

    Actions:
    - get: return owner/shared/external notification snapshot.
    - update: update `target` notification settings.
      - target=owner or target=shared_user: requires `notification_settings`.
      - target=external_recipient: updates recipient booleans/channels/active.
    - update_self: update the caller's own settings for the resource.
      - If caller has owner/shared access, writes per-resource notification settings in caller user DB.
      - Otherwise updates matching external-recipient settings for the resource.
      Supports non-site recipients using identity headers (email/phone).
    - unsubscribe_external: deactivate one external recipient (target=external_recipient).
    - unsubscribe_self: stop the caller's own resource alerts.
      - If caller has owner/shared access, disables APP/SMS/EMAIL for healthcheck + log_error in caller user DB.
      - Otherwise deactivates matching external-recipient subscriptions for the resource.
      Supports non-site recipients using identity headers (email/phone).
    """

    action_value = (action or "").strip().lower()
    self_service_actions = {"update_self", "unsubscribe_self"}
    valid_actions = {"get", "update", "update_self", "unsubscribe_external", "unsubscribe_self"}
    if action_value not in valid_actions:
        raise ValueError(f"action must be one of: {', '.join(sorted(valid_actions))}")
    if action_value not in self_service_actions and not _request_has_capability("devtools.resources.share"):
        raise PermissionError("DevTools resource share capability required.")

    target_value = (target or "").strip().lower().replace("-", "_")
    if target_value not in {"owner", "shared_user", "external_recipient"}:
        raise ValueError("target must be one of: owner, shared_user, external_recipient")

    devtools_user = await _get_request_devtools_user()
    request_user = devtools_user or await _get_request_authenticated_user()

    owner = None
    owner_resource = None
    owner_resource_id = 0
    scope = ""
    role = ""

    if devtools_user:
        try:
            owner, owner_resource_id, owner_resource, scope, role = await _resolve_client_resource_access(
                devtools_user,
                resource_id=resource_id,
                resource_uuid=resource_uuid,
                owner_username=owner_username,
            )
        except Exception:
            owner = None
            owner_resource = None
            owner_resource_id = 0
            scope = ""
            role = ""

    if (not owner or not owner_resource or int(owner_resource_id) <= 0) and devtools_user and bool(
        getattr(devtools_user, "is_staff", False) or getattr(devtools_user, "is_superuser", False)
    ):
        owner_value = (owner_username or "").strip()
        uuid_value = (resource_uuid or "").strip()
        if owner_value and uuid_value:
            resolved = await sync_to_async(_owner_resource_by_username_uuid_sync, thread_sensitive=True)(
                owner_value,
                uuid_value,
            )
            if resolved:
                owner, owner_resource_id, owner_resource = resolved
                scope = "staff_override"
                role = "staff"

    if not owner or not owner_resource or int(owner_resource_id) <= 0:
        if action_value not in self_service_actions:
            raise PermissionError("Resource not found for notification management.")

        payload = _request_auth_payload()
        identity_emails: set[str] = set()
        identity_phones: set[str] = set()
        for candidate in (_get_request_user_email(), str(payload.get("user_email") or "")):
            normalized = _normalize_contact_email(candidate)
            if normalized:
                identity_emails.add(normalized)
        for candidate in (_get_request_user_phone(), str(payload.get("user_phone") or "")):
            normalized = _normalize_contact_phone(candidate)
            if normalized:
                identity_phones.add(normalized)
        if request_user:
            user_emails, _, user_phones = await sync_to_async(
                _identity_sets_for_user_sync,
                thread_sensitive=True,
            )(request_user)
            identity_emails.update(user_emails)
            identity_phones.update(user_phones)

        owner_value = (owner_username or "").strip()
        uuid_value = (resource_uuid or "").strip()
        if owner_value and uuid_value:
            resolved = await sync_to_async(_owner_resource_by_username_uuid_sync, thread_sensitive=True)(
                owner_value,
                uuid_value,
            )
            if not resolved:
                raise PermissionError("Resource not found.")
            owner, owner_resource_id, owner_resource = resolved
            scope = "alert_recipient"
            role = "alert_recipient"
        else:
            candidates = await sync_to_async(
                _resolve_unsubscribe_self_target_from_identity_sync,
                thread_sensitive=True,
            )(
                identity_emails=identity_emails,
                identity_phones=identity_phones,
                owner_username=(owner_username or ""),
            )
            if not candidates:
                raise PermissionError(
                    f"{action_value} could not resolve a resource from caller identity. Provide owner_username and resource_uuid."
                )
            if len(candidates) > 1:
                return {
                    "action": action_value,
                    "target": "external_recipient",
                    "resolved": False,
                    "reason": "multiple_candidate_resources",
                    "candidates": [
                        {
                            "owner_username": item["owner_username"],
                            "resource_uuid": item["resource_uuid"],
                            "resource_name": item["resource_name"],
                            "recipient_id": item["recipient_id"],
                            "recipient_email": item["recipient_email"],
                            "recipient_phone": item["recipient_phone"],
                            "last_event_at": item["last_event_at"].isoformat() if item.get("last_event_at") else "",
                        }
                        for item in candidates[:10]
                    ],
                    "message": "Multiple matching resource alert subscriptions found. Specify owner_username and resource_uuid.",
                    "ts": datetime.utcnow().isoformat() + "Z",
                }
            selected = candidates[0]
            resolved = await sync_to_async(_owner_resource_by_username_uuid_sync, thread_sensitive=True)(
                selected["owner_username"],
                selected["resource_uuid"],
            )
            if not resolved:
                raise PermissionError("Resolved resource could not be loaded.")
            owner, owner_resource_id, owner_resource = resolved
            scope = "alert_recipient"
            role = "alert_recipient"

    owner_resource_id = int(owner_resource_id)

    is_staff_manager = bool(
        devtools_user and (getattr(devtools_user, "is_staff", False) or getattr(devtools_user, "is_superuser", False))
    )
    can_manage_all = bool(
        devtools_user and (scope in {"owned", "staff_override"} or str(role or "").strip().lower() == "admin" or is_staff_manager)
    )

    from client_portal.models import ClientResourceShare  # type: ignore
    from client_portal.user_resources import (  # type: ignore
        get_resource_notification_settings_for_viewer,
        update_resource_notification_settings_for_viewer,
    )

    if action_value == "get":
        if not devtools_user and not is_staff_manager:
            raise PermissionError("Authenticated DevTools user context required.")
        snapshot = await sync_to_async(_resource_notification_snapshot_sync, thread_sensitive=True)(
            owner,
            owner_resource_id,
            owner_resource,
        )
        return {
            "action": action_value,
            "target": target_value,
            "scope": scope,
            "role": role,
            "owner": (getattr(owner, "username", "") or "").strip(),
            "owner_resource_id": owner_resource_id,
            "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
            "resource_name": (getattr(owner_resource, "name", "") or "").strip(),
            **snapshot,
            "ts": datetime.utcnow().isoformat() + "Z",
        }

    if action_value == "update":
        if not can_manage_all:
            raise PermissionError("Update requires owner/shared-admin/staff permissions.")

        if target_value in {"owner", "shared_user"}:
            if notification_settings is None:
                raise ValueError("notification_settings is required for owner/shared_user updates.")

        if target_value == "owner":
            updated = await sync_to_async(update_resource_notification_settings_for_viewer, thread_sensitive=True)(
                owner,
                owner,
                owner_resource_id,
                notification_settings,
            )
            return {
                "action": action_value,
                "target": target_value,
                "owner": (getattr(owner, "username", "") or "").strip(),
                "owner_resource_id": owner_resource_id,
                "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
                "notification_settings": updated,
                "ts": datetime.utcnow().isoformat() + "Z",
            }

        if target_value == "shared_user":
            shared_candidate = None
            if shared_username:
                shared_candidate = await sync_to_async(_resolve_user_for_api_key_sync, thread_sensitive=True)(
                    None,
                    str(shared_username).strip(),
                )
            if not shared_candidate and shared_email:
                shared_candidate = await sync_to_async(_resolve_user_for_api_key_sync, thread_sensitive=True)(
                    str(shared_email).strip(),
                    None,
                )
            if not shared_candidate:
                raise ValueError("shared_user target requires a valid shared_username or shared_email.")

            share = await sync_to_async(
                lambda: ClientResourceShare.objects.filter(
                    owner=owner,
                    user_resource_id=owner_resource_id,
                    shared_with=shared_candidate,
                )
                .order_by("-created_at", "-id")
                .first(),
                thread_sensitive=True,
            )()
            if not share:
                raise ValueError("Target user is not shared on this resource.")

            updated = await sync_to_async(update_resource_notification_settings_for_viewer, thread_sensitive=True)(
                shared_candidate,
                owner,
                owner_resource_id,
                notification_settings,
            )
            return {
                "action": action_value,
                "target": target_value,
                "owner": (getattr(owner, "username", "") or "").strip(),
                "owner_resource_id": owner_resource_id,
                "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
                "shared_user": {
                    "user_id": int(getattr(shared_candidate, "id", 0) or 0),
                    "username": (getattr(shared_candidate, "username", "") or "").strip(),
                    "email": (getattr(shared_candidate, "email", "") or "").strip(),
                    "role": str(getattr(share, "role", "") or "").strip(),
                },
                "notification_settings": updated,
                "ts": datetime.utcnow().isoformat() + "Z",
            }

        external_recipient = await sync_to_async(_find_external_alert_recipient_sync, thread_sensitive=True)(
            owner_user=owner,
            owner_resource_id=owner_resource_id,
            recipient_id=recipient_id,
            recipient_email=(recipient_email or ""),
            recipient_phone=(recipient_phone or ""),
        )
        if not external_recipient:
            raise ValueError("External recipient not found for this resource.")

        changed_fields: list[str] = []
        if notify_healthcheck_failed is not None:
            external_recipient.notify_healthcheck_failed = bool(notify_healthcheck_failed)
            changed_fields.append("notify_healthcheck_failed")
        if notify_log_error is not None:
            external_recipient.notify_log_error = bool(notify_log_error)
            changed_fields.append("notify_log_error")
        if channel_sms is not None:
            external_recipient.channel_sms = bool(channel_sms)
            changed_fields.append("channel_sms")
        if channel_email is not None:
            external_recipient.channel_email = bool(channel_email)
            changed_fields.append("channel_email")
        if is_active is not None:
            external_recipient.is_active = bool(is_active)
            changed_fields.append("is_active")
        if not changed_fields:
            raise ValueError("No external recipient updates were provided.")
        changed_fields.append("updated_at")
        try:
            await sync_to_async(external_recipient.save, thread_sensitive=True)(update_fields=changed_fields)
        except Exception as exc:
            raise ValueError(f"Failed to update external recipient settings: {exc}")

        await sync_to_async(_record_external_recipient_context_event_sync, thread_sensitive=True)(
            recipient=external_recipient,
            owner_user=owner,
            owner_resource_id=owner_resource_id,
            event_type="resource_alert_recipient_settings_updated",
            summary=f"External recipient settings updated for {getattr(owner_resource, 'name', 'resource')}",
            payload={
                "updated_fields": changed_fields,
                "updated_by_user_id": int(getattr(devtools_user, "id", 0) or 0),
                "updated_by_username": (getattr(devtools_user, "username", "") or "").strip(),
            },
        )

        return {
            "action": action_value,
            "target": target_value,
            "owner": (getattr(owner, "username", "") or "").strip(),
            "owner_resource_id": owner_resource_id,
            "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
            "external_recipient": {
                "recipient_id": int(getattr(external_recipient, "id", 0) or 0),
                "name": str(getattr(external_recipient, "name", "") or "").strip(),
                "recipient_email": str(getattr(external_recipient, "recipient_email", "") or "").strip(),
                "recipient_phone": str(getattr(external_recipient, "recipient_phone", "") or "").strip(),
                "notify_healthcheck_failed": bool(getattr(external_recipient, "notify_healthcheck_failed", False)),
                "notify_log_error": bool(getattr(external_recipient, "notify_log_error", False)),
                "channel_sms": bool(getattr(external_recipient, "channel_sms", False)),
                "channel_email": bool(getattr(external_recipient, "channel_email", False)),
                "is_active": bool(getattr(external_recipient, "is_active", False)),
            },
            "ts": datetime.utcnow().isoformat() + "Z",
        }

    if action_value == "unsubscribe_external":
        if not can_manage_all:
            raise PermissionError("unsubscribe_external requires owner/shared-admin/staff permissions.")
        external_recipient = await sync_to_async(_find_external_alert_recipient_sync, thread_sensitive=True)(
            owner_user=owner,
            owner_resource_id=owner_resource_id,
            recipient_id=recipient_id,
            recipient_email=(recipient_email or ""),
            recipient_phone=(recipient_phone or ""),
        )
        if not external_recipient:
            raise ValueError("External recipient not found for this resource.")
        external_recipient.is_active = False
        await sync_to_async(external_recipient.save, thread_sensitive=True)(update_fields=["is_active", "updated_at"])
        await sync_to_async(_record_external_recipient_context_event_sync, thread_sensitive=True)(
            recipient=external_recipient,
            owner_user=owner,
            owner_resource_id=owner_resource_id,
            event_type="resource_alert_recipient_unsubscribed",
            summary=f"External recipient unsubscribed from {getattr(owner_resource, 'name', 'resource')}",
            payload={
                "method": "managed_unsubscribe",
                "updated_by_user_id": int(getattr(devtools_user, "id", 0) or 0),
                "updated_by_username": (getattr(devtools_user, "username", "") or "").strip(),
            },
        )
        return {
            "action": action_value,
            "target": "external_recipient",
            "owner": (getattr(owner, "username", "") or "").strip(),
            "owner_resource_id": owner_resource_id,
            "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
            "recipient_id": int(getattr(external_recipient, "id", 0) or 0),
            "unsubscribed": True,
            "ts": datetime.utcnow().isoformat() + "Z",
        }

    identity_emails: set[str] = set()
    identity_usernames: set[str] = set()
    identity_phones: set[str] = set()
    payload = _request_auth_payload()
    for candidate in (_get_request_user_email(), str(payload.get("user_email") or "")):
        normalized = _normalize_contact_email(candidate)
        if normalized:
            identity_emails.add(normalized)
    for candidate in (_get_request_user_name(), str(payload.get("username") or "")):
        normalized = _normalize_contact_username(candidate)
        if normalized:
            identity_usernames.add(normalized)
    for candidate in (_get_request_user_phone(), str(payload.get("user_phone") or "")):
        normalized = _normalize_contact_phone(candidate)
        if normalized:
            identity_phones.add(normalized)
    if request_user:
        user_emails, user_usernames, user_phones = await sync_to_async(
            _identity_sets_for_user_sync,
            thread_sensitive=True,
        )(request_user)
        identity_emails.update(user_emails)
        identity_usernames.update(user_usernames)
        identity_phones.update(user_phones)
    if not identity_emails and not identity_phones and not request_user:
        raise PermissionError(f"{action_value} requires caller identity email or phone.")

    if action_value == "update_self":
        if (
            notification_settings is None
            and notify_healthcheck_failed is None
            and notify_log_error is None
            and channel_sms is None
            and channel_email is None
            and is_active is None
        ):
            raise ValueError("update_self requires at least one update field.")

    resolved_scope, resolved_role = await sync_to_async(
        _authorize_resource_log_identity_access_sync,
        thread_sensitive=True,
    )(
        request_user=request_user,
        owner_user=owner,
        owner_resource_id=owner_resource_id,
        identity_emails=identity_emails,
        identity_usernames=identity_usernames,
        identity_phones=identity_phones,
        allow_inactive_alert_recipient=bool(action_value == "update_self" and is_active is True),
    )

    # Prioritize per-user settings when the caller has direct owner/shared access.
    if resolved_scope in {"owned", "shared"}:
        if not request_user:
            raise PermissionError(f"{action_value} requires authenticated user context.")
        viewer_updates = _build_user_notification_updates_from_self_action(
            action=action_value,
            notification_settings=notification_settings,
            notify_healthcheck_failed=notify_healthcheck_failed,
            notify_log_error=notify_log_error,
            channel_sms=channel_sms,
            channel_email=channel_email,
            is_active=is_active,
        )
        current_settings = await sync_to_async(get_resource_notification_settings_for_viewer, thread_sensitive=True)(
            request_user,
            owner,
            owner_resource_id,
            owner_resource=owner_resource,
        )

        if action_value == "update_self" and not viewer_updates:
            return {
                "action": action_value,
                "target": "self_user",
                "scope": resolved_scope,
                "role": resolved_role,
                "owner": (getattr(owner, "username", "") or "").strip(),
                "owner_resource_id": owner_resource_id,
                "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
                "notification_settings": current_settings or {},
                "updated": False,
                "message": "No notification changes were provided.",
                "ts": datetime.utcnow().isoformat() + "Z",
            }

        updated_settings = await sync_to_async(update_resource_notification_settings_for_viewer, thread_sensitive=True)(
            request_user,
            owner,
            owner_resource_id,
            viewer_updates,
        )
        return {
            "action": action_value,
            "target": "self_user",
            "scope": resolved_scope,
            "role": resolved_role,
            "owner": (getattr(owner, "username", "") or "").strip(),
            "owner_resource_id": owner_resource_id,
            "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
            "notification_settings": updated_settings or current_settings or {},
            "updated": True,
            "unsubscribed": bool(action_value == "unsubscribe_self"),
            "ts": datetime.utcnow().isoformat() + "Z",
        }

    if resolved_scope != "alert_recipient":
        raise PermissionError(
            f"{action_value} requires owner/shared access or an alert-recipient identity match."
        )

    from client_portal.models import ClientResourceAlertRecipient  # type: ignore

    matched_recipients = await sync_to_async(
        lambda: list(
            ClientResourceAlertRecipient.objects.filter(
                owner=owner,
                user_resource_id=owner_resource_id,
            ).order_by("id")
        ),
        thread_sensitive=True,
    )()
    unsubscribed_recipient_ids: list[int] = []
    updated_recipient_ids: list[int] = []
    updated_recipient_payloads: list[dict[str, Any]] = []
    for recipient in matched_recipients:
        rec_email = _normalize_contact_email(getattr(recipient, "recipient_email", ""))
        rec_phone = _normalize_contact_phone(getattr(recipient, "recipient_phone", ""))
        matches_identity = bool((rec_email and rec_email in identity_emails) or (rec_phone and rec_phone in identity_phones))
        if not matches_identity:
            continue
        recipient_is_active = bool(getattr(recipient, "is_active", False))

        if action_value == "unsubscribe_self":
            if not recipient_is_active:
                continue
            recipient.is_active = False
            await sync_to_async(recipient.save, thread_sensitive=True)(update_fields=["is_active", "updated_at"])
            unsubscribed_recipient_ids.append(int(getattr(recipient, "id", 0) or 0))
            await sync_to_async(_record_external_recipient_context_event_sync, thread_sensitive=True)(
                recipient=recipient,
                owner_user=owner,
                owner_resource_id=owner_resource_id,
                event_type="resource_alert_recipient_unsubscribed",
                summary=f"External recipient self-unsubscribed from {getattr(owner_resource, 'name', 'resource')}",
                payload={
                    "method": "self_unsubscribe",
                    "identity_emails": sorted(identity_emails),
                    "identity_phones": sorted(identity_phones),
                },
            )
            continue

        if not recipient_is_active and is_active is not True:
            continue

        changed_fields: list[str] = []
        if notify_healthcheck_failed is not None:
            recipient.notify_healthcheck_failed = bool(notify_healthcheck_failed)
            changed_fields.append("notify_healthcheck_failed")
        if notify_log_error is not None:
            recipient.notify_log_error = bool(notify_log_error)
            changed_fields.append("notify_log_error")
        if channel_sms is not None:
            recipient.channel_sms = bool(channel_sms)
            changed_fields.append("channel_sms")
        if channel_email is not None:
            recipient.channel_email = bool(channel_email)
            changed_fields.append("channel_email")
        if is_active is not None:
            recipient.is_active = bool(is_active)
            changed_fields.append("is_active")
        changed_fields = [field for field in changed_fields if field]
        if not changed_fields:
            continue
        changed_fields.append("updated_at")
        await sync_to_async(recipient.save, thread_sensitive=True)(update_fields=changed_fields)
        recipient_id_value = int(getattr(recipient, "id", 0) or 0)
        updated_recipient_ids.append(recipient_id_value)
        updated_recipient_payloads.append(
            {
                "recipient_id": recipient_id_value,
                "name": str(getattr(recipient, "name", "") or "").strip(),
                "recipient_email": str(getattr(recipient, "recipient_email", "") or "").strip(),
                "recipient_phone": str(getattr(recipient, "recipient_phone", "") or "").strip(),
                "notify_healthcheck_failed": bool(getattr(recipient, "notify_healthcheck_failed", False)),
                "notify_log_error": bool(getattr(recipient, "notify_log_error", False)),
                "channel_sms": bool(getattr(recipient, "channel_sms", False)),
                "channel_email": bool(getattr(recipient, "channel_email", False)),
                "is_active": bool(getattr(recipient, "is_active", False)),
            }
        )
        await sync_to_async(_record_external_recipient_context_event_sync, thread_sensitive=True)(
            recipient=recipient,
            owner_user=owner,
            owner_resource_id=owner_resource_id,
            event_type="resource_alert_recipient_settings_updated",
            summary=f"External recipient self-updated alert settings for {getattr(owner_resource, 'name', 'resource')}",
            payload={
                "method": "self_update",
                "updated_fields": changed_fields,
                "identity_emails": sorted(identity_emails),
                "identity_phones": sorted(identity_phones),
            },
        )

    if action_value == "update_self":
        return {
            "action": action_value,
            "target": "external_recipient",
            "scope": resolved_scope,
            "role": resolved_role,
            "owner": (getattr(owner, "username", "") or "").strip(),
            "owner_resource_id": owner_resource_id,
            "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
            "updated_count": len(updated_recipient_ids),
            "recipient_ids": updated_recipient_ids,
            "external_recipients": updated_recipient_payloads,
            "ts": datetime.utcnow().isoformat() + "Z",
        }

    return {
        "action": action_value,
        "target": "external_recipient",
        "scope": resolved_scope,
        "role": resolved_role,
        "owner": (getattr(owner, "username", "") or "").strip(),
        "owner_resource_id": owner_resource_id,
        "resource_uuid": (getattr(owner_resource, "resource_uuid", "") or "").strip() or None,
        "unsubscribed_count": len(unsubscribed_recipient_ids),
        "recipient_ids": unsubscribed_recipient_ids,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def resource_logs(
    resource_id: Optional[int] = None,
    resource_uuid: Optional[str] = None,
    owner_username: Optional[str] = None,
    limit: int = 100,
    level: str = "",
    query: str = "",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, Any]:
    """Read resource logs from the owner's DevTools SQLite database (no KB).

    Access:
    - DevTools owner/shared users via regular resource access checks.
    - Non-DevTools callers when identity matches owner/shared access or an active
      `ClientResourceAlertRecipient` for the target resource.
    """

    bounded_limit = max(1, min(int(limit), 500))

    owner = None
    resource = None
    scope = ""
    role = ""
    owner_resource_id = 0

    devtools_user = None
    if _request_can_access_devtools_resources():
        devtools_user = await _get_request_devtools_user()
    if devtools_user:
        owner, owner_resource_id, resource, scope, role = await _resolve_client_resource_access(
            devtools_user,
            resource_id=resource_id,
            resource_uuid=resource_uuid,
            owner_username=owner_username,
        )
    else:
        request_user = await _get_request_authenticated_user()
        if request_user:
            try:
                owner, owner_resource_id, resource, scope, role = await _resolve_client_resource_access(
                    request_user,
                    resource_id=resource_id,
                    resource_uuid=resource_uuid,
                    owner_username=owner_username,
                )
            except (PermissionError, ValueError):
                owner = None
                resource = None
                owner_resource_id = 0
                scope = ""
                role = ""

        if not owner or not resource or int(owner_resource_id) <= 0:
            owner_value = (owner_username or "").strip()
            uuid_value = (resource_uuid or "").strip()
            if not owner_value or not uuid_value:
                raise PermissionError(
                    "Provide owner_username and resource_uuid for alert-recipient resource log access."
                )
            resolved = await sync_to_async(_owner_resource_by_username_uuid_sync, thread_sensitive=True)(
                owner_value,
                uuid_value,
            )
            if not resolved:
                raise PermissionError("Resource not found.")
            owner, owner_resource_id, resource = resolved

            payload = _request_auth_payload()
            identity_emails: set[str] = set()
            identity_usernames: set[str] = set()
            identity_phones: set[str] = set()

            for candidate in (
                _get_request_user_email(),
                str(payload.get("user_email") or ""),
            ):
                normalized = _normalize_contact_email(candidate)
                if normalized:
                    identity_emails.add(normalized)

            for candidate in (
                _get_request_user_name(),
                str(payload.get("username") or ""),
            ):
                normalized = _normalize_contact_username(candidate)
                if normalized:
                    identity_usernames.add(normalized)

            for candidate in (
                _get_request_user_phone(),
                str(payload.get("user_phone") or ""),
            ):
                normalized = _normalize_contact_phone(candidate)
                if normalized:
                    identity_phones.add(normalized)

            if request_user:
                user_emails, user_usernames, user_phones = await sync_to_async(
                    _identity_sets_for_user_sync,
                    thread_sensitive=True,
                )(request_user)
                identity_emails.update(user_emails)
                identity_usernames.update(user_usernames)
                identity_phones.update(user_phones)

            scope, role = await sync_to_async(_authorize_resource_log_identity_access_sync, thread_sensitive=True)(
                request_user=request_user,
                owner_user=owner,
                owner_resource_id=int(owner_resource_id),
                identity_emails=identity_emails,
                identity_usernames=identity_usernames,
                identity_phones=identity_phones,
            )

    from client_portal.user_resources import list_resource_logs, resolve_resource_identifier  # type: ignore

    identifier = (getattr(resource, "resource_uuid", "") or "").strip() or str(owner_resource_id)
    resource_key = await sync_to_async(resolve_resource_identifier, thread_sensitive=True)(owner, identifier)
    if not resource_key:
        raise RuntimeError("Unable to resolve resource key for logs.")

    parsed_from = _parse_optional_iso_datetime(date_from)
    parsed_to = _parse_optional_iso_datetime(date_to)
    logs = await sync_to_async(list_resource_logs, thread_sensitive=True)(
        owner,
        resource_key,
        date_from=parsed_from,
        date_to=parsed_to,
        level=(level or "").strip().lower(),
        search=(query or "").strip(),
        limit=bounded_limit,
    )
    return {
        "scope": scope,
        "role": role,
        "owner": (getattr(owner, "username", "") or "").strip(),
        "owner_resource_id": owner_resource_id,
        "resource_uuid": (getattr(resource, "resource_uuid", "") or "").strip() or None,
        "resource_key": resource_key,
        "count": len(logs),
        "logs": logs,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def resource_log_ingest(
    resource_id: Optional[int] = None,
    resource_uuid: Optional[str] = None,
    owner_username: Optional[str] = None,
    logs: Optional[List[Dict[str, Any]]] = None,
    message: str = "",
    level: str = "info",
    logger_name: str = "alshival.agent",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Ingest one or more resource log entries into the owner's DevTools log store.

    Supports either:
    - `logs=[{level,message,logger,ts,extra}, ...]`
    - or single-entry shorthand via `message`, `level`, `logger_name`, `extra`.
    """

    if not _request_has_capability("devtools.resources.logs.write"):
        raise PermissionError("DevTools resource log write access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated user context required.")

    owner, owner_resource_id, resource, scope, role = await _resolve_client_resource_access(
        user,
        resource_id=resource_id,
        resource_uuid=resource_uuid,
        owner_username=owner_username,
    )
    if scope == "shared" and str(role or "").strip().lower() not in {"developer", "admin"}:
        raise PermissionError("Shared resource log ingest requires developer or admin role.")

    entries_raw: list[dict[str, Any]] = []
    if isinstance(logs, list) and logs:
        for item in logs:
            if isinstance(item, dict):
                entries_raw.append(item)
    elif (message or "").strip():
        entries_raw.append(
            {
                "level": level,
                "message": message,
                "logger": logger_name,
                "extra": extra if isinstance(extra, dict) else {},
            }
        )
    else:
        raise ValueError("Provide either `logs` or `message`.")

    now_iso = datetime.utcnow().isoformat() + "Z"
    allowed_levels = {"debug", "info", "warning", "error", "critical"}
    normalized_logs: list[dict[str, Any]] = []
    for item in entries_raw[:500]:
        raw_level = str(item.get("level") or "info").strip().lower()
        normalized_level = raw_level if raw_level in allowed_levels else "info"
        raw_message = str(item.get("message") or "").strip()
        if not raw_message:
            continue
        raw_logger = str(item.get("logger") or logger_name or "alshival.agent").strip() or "alshival.agent"
        raw_ts = str(item.get("ts") or "").strip() or now_iso
        parsed_ts = _parse_optional_iso_datetime(raw_ts)
        ts_value = (parsed_ts or datetime.utcnow().replace(tzinfo=timezone.utc)).isoformat().replace("+00:00", "Z")
        raw_extra = item.get("extra")
        if isinstance(raw_extra, dict):
            try:
                normalized_extra = json.loads(json.dumps(raw_extra, default=str))
            except Exception:
                normalized_extra = {}
        else:
            normalized_extra = {}
        normalized_logs.append(
            {
                "level": normalized_level,
                "message": raw_message,
                "logger": raw_logger,
                "ts": ts_value,
                "extra": normalized_extra,
            }
        )
    if not normalized_logs:
        raise ValueError("No valid log entries to ingest.")

    from client_portal.user_resources import resolve_resource_identifier, store_client_logs  # type: ignore
    from client_portal.views import _trigger_resource_log_error_alert  # type: ignore

    identifier = (getattr(resource, "resource_uuid", "") or "").strip() or str(owner_resource_id)
    resource_key = await sync_to_async(resolve_resource_identifier, thread_sensitive=True)(owner, identifier)
    if not resource_key:
        raise RuntimeError("Unable to resolve resource key for log ingest.")

    payload = {
        "resource_id": resource_key,
        "resource_uuid": (getattr(resource, "resource_uuid", "") or "").strip(),
        "submitted_by_user_id": int(getattr(user, "id", 0) or 0),
        "submitted_by_username": (getattr(user, "username", "") or "").strip(),
        "source": "mcp_resource_log_ingest",
        "logs": normalized_logs,
    }
    request_ip = str(_REQUEST_IP.get() or "").strip() or None
    user_agent = "alshival-mcp/resource_log_ingest"

    await sync_to_async(store_client_logs, thread_sensitive=True)(owner, payload, request_ip, user_agent)
    await sync_to_async(_trigger_resource_log_error_alert, thread_sensitive=True)(owner, str(resource_key), payload)

    return {
        "scope": scope,
        "role": role,
        "owner": (getattr(owner, "username", "") or "").strip(),
        "owner_resource_id": owner_resource_id,
        "resource_uuid": (getattr(resource, "resource_uuid", "") or "").strip() or None,
        "resource_key": resource_key,
        "ingested": len(normalized_logs),
        "status": "ok",
        "ts": datetime.utcnow().isoformat() + "Z",
    }


def _normalize_resource_share_login(value: Any) -> str:
    return str(value or "").strip().lstrip("@").lower()


def _user_github_login_sync(user) -> str:
    _ensure_django()
    try:
        from allauth.socialaccount.models import SocialAccount  # type: ignore
    except Exception:
        return ""
    account = SocialAccount.objects.filter(user=user, provider="github").first()
    if not account:
        return ""
    login = (getattr(account, "extra_data", {}) or {}).get("login") or ""
    return _normalize_resource_share_login(login)


def _find_user_by_github_login_sync(login: str):
    normalized = _normalize_resource_share_login(login)
    if not normalized:
        return None
    _ensure_django()
    try:
        from allauth.socialaccount.models import SocialAccount  # type: ignore
    except Exception:
        return None
    account = (
        SocialAccount.objects.select_related("user")
        .filter(provider="github", extra_data__login__iexact=normalized)
        .first()
    )
    return getattr(account, "user", None) if account else None


def _resource_share_item(share: Any) -> Dict[str, Any]:
    shared_with = getattr(share, "shared_with", None)
    return {
        "share_id": int(getattr(share, "id", 0) or 0),
        "role": str(getattr(share, "role", "") or ""),
        "shared_with_username": (getattr(shared_with, "username", "") or "").strip() if shared_with else "",
        "shared_with_email": (getattr(shared_with, "email", "") or "").strip() if shared_with else "",
        "github_login": (getattr(share, "github_login", "") or "").strip(),
        "invite_email": (getattr(share, "invite_email", "") or "").strip(),
        "invite_sent_at": (
            getattr(share, "invite_sent_at", None).isoformat() if getattr(share, "invite_sent_at", None) else None
        ),
        "created_at": getattr(share, "created_at", None).isoformat() if getattr(share, "created_at", None) else None,
        "updated_at": getattr(share, "updated_at", None).isoformat() if getattr(share, "updated_at", None) else None,
    }


def _resource_share_sync(
    *,
    actor_user: Any,
    owner_user: Any,
    owner_resource_id: int,
    access_scope: str,
    access_role: str,
    action: str,
    share_id: Optional[int],
    username: str,
    github_login: str,
    role: str,
) -> Dict[str, Any]:
    _ensure_django()
    from django.contrib.auth import get_user_model  # type: ignore
    from client_portal.models import ClientResourceShare  # type: ignore

    action_value = (action or "").strip().lower()
    if action_value not in {"list", "grant", "update_role", "revoke"}:
        raise ValueError("action must be one of: list, grant, update_role, revoke")

    can_manage = access_scope == "owned" or (access_scope == "shared" and str(access_role or "").strip().lower() == "admin")
    if not can_manage:
        raise PermissionError("Resource sharing requires owner or shared admin access.")

    shares_qs = (
        ClientResourceShare.objects.filter(owner=owner_user, user_resource_id=int(owner_resource_id))
        .select_related("shared_with")
        .order_by("id")
    )

    if action_value == "list":
        shares = [_resource_share_item(share) for share in shares_qs]
        return {"action": "list", "count": len(shares), "shares": shares}

    owner_login = _user_github_login_sync(owner_user)
    normalized_username = (username or "").strip()
    normalized_login = _normalize_resource_share_login(github_login)

    target_user = None
    if normalized_username:
        User = get_user_model()
        target_user = User.objects.filter(username__iexact=normalized_username).first()
        if not target_user:
            raise ValueError(f"User '@{normalized_username}' was not found.")
        if not _user_has_devtools_access_sync(target_user):
            raise ValueError(f"User '@{target_user.username}' does not have DevTools access.")
    if not normalized_login and target_user:
        normalized_login = _user_github_login_sync(target_user)
    if normalized_login and not target_user:
        target_user = _find_user_by_github_login_sync(normalized_login)
        if target_user and not _user_has_devtools_access_sync(target_user):
            target_user = None

    if action_value in {"grant", "update_role"}:
        if not target_user and not normalized_login:
            raise ValueError("username or github_login is required for grant/update_role.")
        if target_user and int(getattr(target_user, "id", 0) or 0) == int(getattr(owner_user, "id", 0) or 0):
            raise ValueError("Cannot share a resource with its owner.")
        if owner_login and normalized_login and owner_login == normalized_login:
            raise ValueError("Cannot share a resource with the owner's GitHub profile.")

        valid_roles = {choice[0] for choice in ClientResourceShare.ROLE_CHOICES}
        desired_role = (role or ClientResourceShare.ROLE_VIEW).strip().lower()
        if desired_role not in valid_roles:
            valid_text = ", ".join(sorted(valid_roles))
            raise ValueError(f"role must be one of: {valid_text}")

        share = None
        if share_id is not None:
            share = shares_qs.filter(id=int(share_id)).first()
            if not share:
                raise ValueError("Share not found for the provided share_id.")
        if share is None and target_user:
            share = shares_qs.filter(shared_with=target_user).first()
        if share is None and normalized_login:
            share = shares_qs.filter(github_login__iexact=normalized_login).first()
        if action_value == "update_role" and share is None:
            raise ValueError("Share not found. Use action='grant' to create a new share.")

        created = False
        if share is None:
            share = ClientResourceShare(owner=owner_user, user_resource_id=int(owner_resource_id))
            created = True
        share.shared_with = target_user
        share.github_login = normalized_login or ""
        share.role = desired_role
        if target_user:
            share.invite_email = ""
            share.invite_sent_at = None
        share.save()
        return {
            "action": action_value,
            "created": bool(created),
            "share": _resource_share_item(share),
        }

    # action == revoke
    share = None
    if share_id is not None:
        share = shares_qs.filter(id=int(share_id)).first()
    if share is None and target_user:
        share = shares_qs.filter(shared_with=target_user).first()
    if share is None and normalized_login:
        share = shares_qs.filter(github_login__iexact=normalized_login).first()
    if share is None:
        raise ValueError("Share not found for revoke action.")
    share_login = _normalize_resource_share_login(getattr(share, "github_login", "") or "")
    if int(getattr(share, "shared_with_id", 0) or 0) == int(getattr(owner_user, "id", 0) or 0):
        raise PermissionError("Owner share mapping cannot be removed.")
    if owner_login and share_login and share_login == owner_login:
        raise PermissionError("Owner GitHub share mapping cannot be removed.")

    removed = _resource_share_item(share)
    share.delete()
    return {
        "action": "revoke",
        "removed": removed,
    }


@mcp.tool()
async def resource_share(
    action: str,
    resource_id: Optional[int] = None,
    resource_uuid: Optional[str] = None,
    owner_username: Optional[str] = None,
    share_id: Optional[int] = None,
    username: str = "",
    github_login: str = "",
    role: str = "view",
) -> Dict[str, Any]:
    """Manage resource sharing for one accessible resource.

    Actions:
    - list: list current shares
    - grant: create or update a share for `username` or `github_login`
    - update_role: change role for an existing share
    - revoke: remove a share by `share_id`, `username`, or `github_login`
    """

    if not _request_has_capability("devtools.resources.share"):
        raise PermissionError("DevTools resource share access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated user context required.")

    owner, owner_resource_id, resource, scope, access_role = await _resolve_client_resource_access(
        user,
        resource_id=resource_id,
        resource_uuid=resource_uuid,
        owner_username=owner_username,
    )
    payload = await sync_to_async(_resource_share_sync, thread_sensitive=True)(
        actor_user=user,
        owner_user=owner,
        owner_resource_id=int(owner_resource_id),
        access_scope=scope,
        access_role=access_role,
        action=action,
        share_id=share_id,
        username=username,
        github_login=github_login,
        role=role,
    )

    return {
        "scope": scope,
        "caller_role": access_role,
        "owner": (getattr(owner, "username", "") or "").strip(),
        "owner_resource_id": int(owner_resource_id),
        "resource_uuid": (getattr(resource, "resource_uuid", "") or "").strip() or None,
        **payload,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def social_interaction(username: str, action: str = "follow") -> Dict[str, Any]:
    """Manage DevTools social relationships with another user.

    Actions:
    - follow: follow the target user
    - unfollow: unfollow the target user
    - collaborate: if mutual follow exists, accept/toggle collaborator mode

    `collaborate` returns state metadata so callers can tell whether activation is pending approval
    or fully activated.
    """

    action_value = (action or "").strip().lower()
    if action_value not in {"follow", "unfollow", "collaborate"}:
        raise ValueError("action must be one of: follow, unfollow, collaborate")
    if not _request_can_access_devtools_resources():
        raise PermissionError("DevTools access required.")
    actor_user = await _get_request_devtools_user()
    if not actor_user:
        raise PermissionError("Authenticated user context required.")

    target_user = await sync_to_async(_resolve_social_target_user_sync, thread_sensitive=True)(actor_user, username)
    payload = await sync_to_async(_social_interaction_sync, thread_sensitive=True)(
        actor_user,
        target_user,
        action_value,
    )
    payload["ts"] = datetime.utcnow().isoformat() + "Z"
    return payload


@mcp.tool()
async def get_account_settings() -> Dict[str, Any]:
    """Fetch account settings for the authenticated DevTools/staff user."""

    if not _request_has_capability("devtools.settings.read"):
        raise PermissionError("DevTools settings read access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated user context required.")

    settings = await sync_to_async(_get_account_settings_sync, thread_sensitive=True)(user)
    return {
        "settings": settings,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def update_account_settings(
    alshival_model: Optional[str] = None,
    devtools_profile_visibility: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    title: Optional[str] = None,
    location: Optional[str] = None,
    bio: Optional[str] = None,
    avatar_url: Optional[str] = None,
    website_url: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    twitter_url: Optional[str] = None,
    github_url: Optional[str] = None,
    spotify_url: Optional[str] = None,
    notification_settings: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Update account settings for the authenticated DevTools/staff user.

    Notes:
    - Phone verification fields are intentionally excluded from this tool.
    - Notification fields are set via:
      `notification_settings={"new_follower":{"APP": true, "SMS": true, "EMAIL": false}}`.
    """

    if not _request_has_capability("devtools.settings.write"):
        raise PermissionError("DevTools settings write access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated user context required.")

    raw_updates = {
        "alshival_model": alshival_model,
        "devtools_profile_visibility": devtools_profile_visibility,
        "first_name": first_name,
        "last_name": last_name,
        "title": title,
        "location": location,
        "bio": bio,
        "avatar_url": avatar_url,
        "website_url": website_url,
        "linkedin_url": linkedin_url,
        "twitter_url": twitter_url,
        "github_url": github_url,
        "spotify_url": spotify_url,
    }
    raw_updates.update(_notification_updates_from_payload(notification_settings))

    settings = await sync_to_async(_update_account_settings_sync, thread_sensitive=True)(user, raw_updates)
    updated_fields = sorted(_sanitize_account_settings_updates(raw_updates).keys())
    return {
        "updated_fields": updated_fields,
        "notification_settings": settings.get("notification_settings") or {},
        "settings": settings,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
def search_gif(query: str, limit: int = 8) -> Dict[str, Any]:
    """Search Tenor for GIFs.

    Parameters:
    - query (str): Search keywords.
    - limit (int, default 8): Max results to return.
    """

    query = f"anime {query}"

    if not query or not query.strip():
        raise ValueError("query is required")
    if limit <= 0:
        raise ValueError("limit must be positive")
    if not TENOR_API_KEY:
        raise RuntimeError("TENOR_API_KEY is not configured")

    params = {
        "q": query.strip(),
        "media_format": "gif",
        "key": TENOR_API_KEY,
        "client_key": "alshival",
        "limit": str(min(limit, 50)),
    }
    resp = requests.get("https://tenor.googleapis.com/v2/search", params=params, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Tenor search failed: {resp.status_code} {resp.text}")
    payload = resp.json()
    results = []
    for item in payload.get("results", []):
        media_formats = item.get("media_formats") or {}
        gif = media_formats.get("gif") or {}
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
        
    random.shuffle(results)

    return {
        "query": query,
        "count": len(results),
        "results": results,
        "powered_by": "Tenor",
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
def generate_image(prompt: str, size: str = "1024x1024") -> Dict[str, Any]:
    """Generate an image using OpenAI image generation."""

    if not (_request_access_role() == ACCESS_ROLE_STAFF or _request_is_alshival_agent()):
        raise PermissionError("Staff or Alshival agent required for image generation.")

    prompt_text = str(prompt or "").strip()
    if not prompt_text:
        raise ValueError("prompt is required")

    normalized_size = str(size or "").strip().lower() or "1024x1024"
    allowed_sizes = {"1024x1024", "1536x1024", "1024x1536", "auto"}
    if normalized_size not in allowed_sizes:
        raise ValueError(f"size must be one of: {', '.join(sorted(allowed_sizes))}")

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    model = (os.getenv("OPENAI_IMAGE_MODEL") or "gpt-image-1").strip() or "gpt-image-1"

    client = OpenAI(api_key=api_key)
    response = client.images.generate(
        model=model,
        prompt=prompt_text,
        size=normalized_size,
    )
    rows = list(getattr(response, "data", []) or [])
    if not rows:
        raise RuntimeError("Image generation returned no data.")

    first = rows[0]
    image_url = str(getattr(first, "url", "") or "").strip()
    b64_json = str(getattr(first, "b64_json", "") or "").strip()
    revised_prompt = str(getattr(first, "revised_prompt", "") or "").strip()

    result: Dict[str, Any] = {
        "model": model,
        "size": normalized_size,
        "revised_prompt": revised_prompt,
        "url": image_url,
        "has_b64_data": bool(b64_json),
        "ts": datetime.utcnow().isoformat() + "Z",
    }
    if b64_json:
        result["b64_json"] = b64_json
        result["data_url"] = f"data:image/png;base64,{b64_json}"
    return result


_IMAGE_DATA_URL_RE = re.compile(
    r"^\s*data:(?P<mime>[-a-zA-Z0-9.+/]+)?;base64,(?P<data>[a-zA-Z0-9+/=\s]+)\s*$",
    re.IGNORECASE | re.DOTALL,
)


def _normalize_post_visibility(value: str) -> str:
    _ensure_django()
    from auth.models import Profile  # type: ignore

    normalized = (value or "").strip().lower()
    allowed = {Profile.DEVTOOLS_VIS_PUBLIC, Profile.DEVTOOLS_VIS_SUBSCRIBERS, Profile.DEVTOOLS_VIS_PRIVATE}
    return normalized if normalized in allowed else Profile.DEVTOOLS_VIS_PUBLIC


def _decode_generated_image_data_url(image_data_url: str) -> tuple[bytes, str]:
    raw = str(image_data_url or "").strip()
    if not raw:
        raise ValueError("image_data_url is empty")
    match = _IMAGE_DATA_URL_RE.match(raw)
    if match:
        mime = str(match.group("mime") or "image/png").strip().lower() or "image/png"
        b64_data = re.sub(r"\s+", "", str(match.group("data") or ""))
        try:
            return base64.b64decode(b64_data, validate=True), mime
        except (ValueError, binascii.Error) as exc:
            raise ValueError("image_data_url contains invalid base64 data") from exc
    try:
        return base64.b64decode(raw, validate=True), "image/png"
    except (ValueError, binascii.Error) as exc:
        raise ValueError("image_data_url must be a data URL or raw base64 image data") from exc


def _download_generated_image(image_url: str) -> tuple[bytes, str]:
    target_url = str(image_url or "").strip()
    if not target_url:
        raise ValueError("image_url is required")
    response = requests.get(target_url, timeout=25)
    if response.status_code >= 400:
        raise RuntimeError(f"Image download failed: {response.status_code}")
    content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if not content_type:
        content_type = "image/png"
    return bytes(response.content or b""), content_type


def _image_extension_for_content_type(content_type: str) -> str:
    normalized = str(content_type or "").strip().lower().split(";", 1)[0]
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }
    return mapping.get(normalized, ".png")


def _build_generated_image_upload_sync(
    *,
    image_url: str = "",
    image_data_url: str = "",
    filename_prefix: str,
    max_bytes: int,
):
    payload_data_url = str(image_data_url or "").strip()
    payload_url = str(image_url or "").strip()
    if not payload_data_url and not payload_url:
        return None, {}

    image_bytes: bytes
    content_type: str
    source = ""
    if payload_data_url:
        image_bytes, content_type = _decode_generated_image_data_url(payload_data_url)
        source = "data_url"
    else:
        image_bytes, content_type = _download_generated_image(payload_url)
        source = "url"
    if not image_bytes:
        raise ValueError("Generated image payload is empty")
    if len(image_bytes) > int(max_bytes):
        raise ValueError(f"Generated image exceeds limit of {int(max_bytes)} bytes")

    normalized_content_type = str(content_type or "").strip().lower()
    if normalized_content_type == "image/jpg":
        normalized_content_type = "image/jpeg"
    if normalized_content_type not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
        normalized_content_type = "image/png"
    extension = _image_extension_for_content_type(normalized_content_type)
    safe_prefix = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(filename_prefix or "generated")).strip("-") or "generated"
    filename = f"{safe_prefix}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{extension}"

    _ensure_django()
    from django.core.files.uploadedfile import SimpleUploadedFile  # type: ignore

    upload = SimpleUploadedFile(filename, image_bytes, content_type=normalized_content_type)
    return upload, {
        "source": source,
        "source_url": payload_url,
        "content_type": normalized_content_type,
        "bytes": len(image_bytes),
        "filename": filename,
    }


def _autonomous_create_blog_post_sync(
    *,
    actor_user: Any,
    title: str,
    excerpt: str,
    body_markdown: str,
    visibility: str,
    publish: bool,
    image_url: str,
    image_data_url: str,
) -> Dict[str, Any]:
    _ensure_django()
    from client_portal.user_blog_posts import create_blog_post  # type: ignore

    normalized_title = str(title or "").strip()[:220]
    if not normalized_title:
        raise ValueError("title is required")
    normalized_excerpt = str(excerpt or "").strip()[:320]
    normalized_body = str(body_markdown or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized_body:
        raise ValueError("body_markdown is required")
    normalized_visibility = _normalize_post_visibility(visibility)

    cover_upload = None
    image_meta: Dict[str, Any] = {}
    fallback_cover_url = str(image_url or "").strip()
    if str(image_data_url or "").strip() or fallback_cover_url:
        try:
            cover_upload, image_meta = _build_generated_image_upload_sync(
                image_url=fallback_cover_url,
                image_data_url=str(image_data_url or "").strip(),
                filename_prefix="autonomous-blog",
                max_bytes=10 * 1024 * 1024,
            )
        except Exception:
            logger.warning("autonomous_create_blog_post image upload prep failed.", exc_info=True)
            cover_upload = None

    post = create_blog_post(
        actor_user,
        title=normalized_title,
        slug=normalized_title,
        excerpt=normalized_excerpt,
        body_markdown=normalized_body,
        cover_image_file=cover_upload,
        cover_image_url="" if cover_upload else fallback_cover_url,
        visibility=normalized_visibility,
        publish=bool(publish),
    )
    if not post:
        raise RuntimeError("Blog post creation failed")
    return {
        "post_id": int(getattr(post, "id", 0) or 0),
        "slug": str(getattr(post, "slug", "") or ""),
        "title": str(getattr(post, "title", "") or ""),
        "visibility": str(getattr(post, "visibility", "") or ""),
        "is_published": bool(getattr(post, "is_published", False)),
        "cover_image_url": str(getattr(post, "cover_image_url", "") or ""),
        "image_attached": bool(cover_upload or fallback_cover_url),
        "image_meta": image_meta,
    }


def _autonomous_create_quick_post_sync(
    *,
    actor_user: Any,
    body_markdown: str,
    visibility: str,
    image_url: str,
    image_data_url: str,
) -> Dict[str, Any]:
    _ensure_django()
    from client_portal.user_posts import create_profile_post  # type: ignore

    normalized_body = str(body_markdown or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized_body:
        raise ValueError("body_markdown is required")
    normalized_visibility = _normalize_post_visibility(visibility)

    image_upload = None
    image_meta: Dict[str, Any] = {}
    if str(image_data_url or "").strip() or str(image_url or "").strip():
        image_upload, image_meta = _build_generated_image_upload_sync(
            image_url=str(image_url or "").strip(),
            image_data_url=str(image_data_url or "").strip(),
            filename_prefix="autonomous-quick",
            max_bytes=8 * 1024 * 1024,
        )

    post_id = create_profile_post(
        actor_user,
        body_markdown=normalized_body,
        visibility=normalized_visibility,
        image_file=image_upload,
    )
    if not post_id:
        raise RuntimeError("Quick post creation failed")
    return {
        "post_id": int(post_id),
        "visibility": normalized_visibility,
        "image_attached": bool(image_upload),
        "image_meta": image_meta,
    }


@mcp.tool()
async def autonomous_create_blog_post(
    title: str,
    body_markdown: str,
    excerpt: str = "",
    visibility: str = "public",
    publish: bool = True,
    image_url: str = "",
    image_data_url: str = "",
) -> Dict[str, Any]:
    """Create a blog post with optional generated image attachment.

    Agent-only:
    - Requires Alshival agent authentication.
    - Intended for autonomous content workflows.

    Image options:
    - `image_url`: remote image URL (e.g. from `generate_image` result `url`).
    - `image_data_url`: base64 data URL (e.g. from `generate_image` result `data_url`).
    - If both are provided, `image_data_url` is preferred.
    """

    if not _request_is_alshival_agent():
        raise PermissionError("Alshival agent authentication required.")
    actor_user = await _get_request_devtools_user()
    if not actor_user:
        raise PermissionError("Authenticated DevTools user context required.")

    payload = await sync_to_async(_autonomous_create_blog_post_sync, thread_sensitive=True)(
        actor_user=actor_user,
        title=title,
        excerpt=excerpt,
        body_markdown=body_markdown,
        visibility=visibility,
        publish=bool(publish),
        image_url=image_url,
        image_data_url=image_data_url,
    )
    payload["ts"] = datetime.utcnow().isoformat() + "Z"
    return payload


@mcp.tool()
async def autonomous_create_quick_post(
    body_markdown: str,
    visibility: str = "public",
    image_url: str = "",
    image_data_url: str = "",
) -> Dict[str, Any]:
    """Create a quick profile post with optional generated image attachment.

    Agent-only:
    - Requires Alshival agent authentication.
    - Intended for autonomous content workflows.
    """

    if not _request_is_alshival_agent():
        raise PermissionError("Alshival agent authentication required.")
    actor_user = await _get_request_devtools_user()
    if not actor_user:
        raise PermissionError("Authenticated DevTools user context required.")

    payload = await sync_to_async(_autonomous_create_quick_post_sync, thread_sensitive=True)(
        actor_user=actor_user,
        body_markdown=body_markdown,
        visibility=visibility,
        image_url=image_url,
        image_data_url=image_data_url,
    )
    payload["ts"] = datetime.utcnow().isoformat() + "Z"
    return payload


@mcp.tool()
def sms(
    message: str,
    to_phone: Optional[str] = None,
    username: Optional[str] = None,
    recipient_group: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an SMS to a direct phone number or a DevTools username with a verified phone.

    Exactly one target is required:
    - `to_phone`: any E.164-compatible phone number.
    - `username`: DevTools username; recipient must have `is_verified=true` in account settings.
    - `recipient_group`: currently supports `staff` for active staff with verified phone numbers.
    """

    if not _request_has_capability("staff.sms.send"):
        raise PermissionError("Staff SMS capability required.")

    body = (message or "").strip()
    if not body:
        raise ValueError("message is required.")

    direct_phone = (to_phone or "").strip()
    target_username = (username or "").strip()
    target_group = (recipient_group or "").strip().lower()
    if _request_is_alshival_agent() and _is_alshival_agent_username(target_username):
        raise ValueError("Support agent cannot target the support account for SMS alerts.")
    selected_count = int(bool(direct_phone)) + int(bool(target_username)) + int(bool(target_group))
    if selected_count != 1:
        raise ValueError("Provide exactly one target: to_phone, username, or recipient_group.")

    dispatched: List[Dict[str, Any]] = []
    group_label = ""

    if target_group:
        if target_group != "staff":
            raise ValueError("recipient_group currently supports only 'staff'.")
        group_label = "staff"
        recipients = _resolve_staff_sms_recipients_sync()
        if not recipients:
            raise ValueError("No active staff recipients with verified phone numbers were found.")
        for recipient in recipients:
            sms_sid = _send_sms(recipient["phone_number"], body)
            dispatched.append(
                {
                    "mode": "group",
                    "group": group_label,
                    "phone": recipient["phone_number"],
                    "username": recipient.get("username") or "",
                    "user_id": int(recipient.get("user_id") or 0),
                    "status": "sent",
                    "sms_sid": sms_sid,
                }
            )
    else:
        recipient_mode = "phone"
        recipient_user_id: Optional[int] = None
        recipient_username = ""
        if direct_phone:
            recipient_phone = _normalize_sms_phone(direct_phone)
        else:
            resolved = _resolve_verified_sms_recipient_by_username_sync(target_username)
            recipient_phone = resolved["phone_number"]
            recipient_username = resolved["username"]
            recipient_user_id = int(resolved["user_id"])
            recipient_mode = "username"
        sms_sid = _send_sms(recipient_phone, body)
        dispatched.append(
            {
                "mode": recipient_mode,
                "phone": recipient_phone,
                "username": recipient_username,
                "user_id": recipient_user_id,
                "status": "sent",
                "sms_sid": sms_sid,
            }
        )

    primary = dispatched[0]
    return {
        "message": body,
        "recipient": primary,
        "dispatched": dispatched,
        "recipient_group": group_label or None,
        "sms_sid": primary.get("sms_sid"),
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
def email(
    subject: str,
    body: str,
    to_email: Optional[str] = None,
    username: Optional[str] = None,
    recipient_group: Optional[str] = None,
    content_type: str = "Text",
) -> Dict[str, Any]:
    """Send an email from support@alshival.ai to a direct address or a DevTools username.

    Exactly one target is required:
    - `to_email`: any valid email address.
    - `username`: DevTools username; recipient must have an email on file.
    - `recipient_group`: currently supports `staff` for active staff users with email.
    """

    if not _request_has_capability("email.send"):
        raise PermissionError("Email send capability required.")

    normalized_subject = (subject or "").strip()
    normalized_body = (body or "").strip()
    if not normalized_subject:
        raise ValueError("subject is required.")
    if not normalized_body:
        raise ValueError("body is required.")

    direct_email = (to_email or "").strip()
    target_username = (username or "").strip()
    target_group = (recipient_group or "").strip().lower()
    selected_count = int(bool(direct_email)) + int(bool(target_username)) + int(bool(target_group))
    if selected_count != 1:
        raise ValueError("Provide exactly one target: to_email, username, or recipient_group.")

    recipient_mode = "email"
    recipient_user_id: Optional[int] = None
    recipient_username = ""
    recipient_group_value = ""
    recipient_email = ""
    recipients: List[str] = []
    if target_group:
        if target_group != "staff":
            raise ValueError("recipient_group currently supports only 'staff'.")
        recipient_group_value = "staff"
        staff_recipients = _resolve_staff_email_recipients_sync()
        if not staff_recipients:
            raise ValueError("No active staff recipients with valid email were found.")
        recipients = [str(row.get("email") or "").strip() for row in staff_recipients if str(row.get("email") or "").strip()]
        recipient_mode = "group"
    elif direct_email:
        normalized_to = _normalize_email_list([direct_email])
        if not normalized_to:
            raise ValueError("to_email must be a valid email address.")
        recipient_email = normalized_to[0]
        if _request_is_alshival_agent() and _is_support_mailbox_email(recipient_email):
            raise ValueError("Support agent cannot target support@alshival.ai for alert emails.")
        recipients = [recipient_email]
    else:
        resolved = _resolve_email_recipient_by_username_sync(target_username)
        recipient_email = resolved["email"]
        recipient_username = resolved["username"]
        if _request_is_alshival_agent() and _is_alshival_agent_username(recipient_username):
            raise ValueError("Support agent cannot target the support account for alert emails.")
        recipient_user_id = int(resolved["user_id"])
        recipient_mode = "username"
        recipients = [recipient_email]

    mailbox = (os.getenv("SUPPORT_EMAIL") or "support@alshival.ai").strip()
    token = _graph_token()
    resolved_content_type = (content_type or "Text").strip()
    if resolved_content_type.lower() not in {"text", "html"}:
        raise ValueError("content_type must be 'Text' or 'HTML'.")
    if resolved_content_type.lower() != "html":
        logger.info("Forcing branded template for MCP email.")
    send_body = _render_alshival_branded_email_html(normalized_subject, normalized_body)
    _graph_send_mail(
        token=token,
        mailbox=mailbox,
        to_recipients=recipients,
        subject=normalized_subject,
        body=send_body,
        content_type="HTML",
    )

    dispatched = {
        "mode": recipient_mode,
        "email": recipient_email,
        "username": recipient_username,
        "user_id": recipient_user_id,
        "group": recipient_group_value or None,
        "status": "sent",
    }
    return {
        "mailbox": mailbox,
        "subject": normalized_subject,
        "recipient": dispatched,
        "recipients": recipients,
        "content_type": "HTML",
        "use_brand_template": True,
        "status": "sent",
        "ts": datetime.utcnow().isoformat() + "Z",
    }


def _parse_iso_datetime(value: str) -> datetime:
    candidate = value.strip()
    if not candidate:
        raise ValueError("start_time is required")
    candidate = candidate.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ValueError(f"Invalid datetime format: {value}") from exc
    if parsed.tzinfo is None:
        tz_name = MSGRAPH_EVENT_TIMEZONE or "UTC"
        try:
            tzinfo = ZoneInfo(tz_name)
        except Exception:
            tzinfo = timezone.utc
        parsed = parsed.replace(tzinfo=tzinfo)
    return parsed


@mcp.tool()
async def set_reminder(
    title: str,
    remind_at: str,
    message: Optional[str] = None,
    recipients: Optional[List[str]] = None,
    action: str = "notify_user",
    channels: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a scheduled reminder in the caller's DevTools user database.

    Notes:
    - Recipients are usernames and must be active collaborators (or the caller).
    - Action currently supports only `notify_user`.
    """

    if not _request_has_capability("reminders.manage"):
        raise PermissionError("Reminder access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated DevTools user context required.")
    if not title or not title.strip():
        raise ValueError("title is required")

    normalized_action = _normalize_reminder_action(action)
    normalized_channels = _normalize_reminder_channels(channels)
    normalized_recipients, recipient_status = await sync_to_async(
        _validate_reminder_recipients_sync,
        thread_sensitive=True,
    )(user, recipients)

    from client_portal import user_reminders  # type: ignore

    reminder = await sync_to_async(user_reminders.create_reminder, thread_sensitive=True)(
        user,
        title=title.strip(),
        remind_at=remind_at,
        message=(message or "").strip() or None,
        recipients=normalized_recipients,
        action=normalized_action,
        channels=normalized_channels,
        created_by_user_id=int(getattr(user, "id", 0) or 0),
        created_by_username=(getattr(user, "username", "") or "").strip(),
    )
    return {
        "reminder": reminder,
        "recipient_status": recipient_status,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def edit_reminder(
    reminder_id: int,
    title: Optional[str] = None,
    remind_at: Optional[str] = None,
    message: Optional[str] = None,
    recipients: Optional[List[str]] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
    channels: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Edit an existing reminder in the caller's DevTools user database."""

    if not _request_has_capability("reminders.manage"):
        raise PermissionError("Reminder access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated DevTools user context required.")

    try:
        reminder_id = int(reminder_id)
    except (TypeError, ValueError):
        raise ValueError("reminder_id must be positive")
    if reminder_id <= 0:
        raise ValueError("reminder_id must be positive")

    from client_portal import user_reminders  # type: ignore

    existing = await sync_to_async(user_reminders.get_reminder, thread_sensitive=True)(user, reminder_id)
    if not existing:
        raise ValueError(f"Reminder {reminder_id} not found")

    update_payload: dict[str, Any] = {}
    if title is not None:
        title_value = title.strip()
        if not title_value:
            raise ValueError("title cannot be empty")
        update_payload["title"] = title_value
    if remind_at is not None:
        update_payload["remind_at"] = remind_at
    if message is not None:
        update_payload["message"] = message.strip() or None
    if recipients is not None:
        normalized_recipients, _ = await sync_to_async(
            _validate_reminder_recipients_sync,
            thread_sensitive=True,
        )(user, recipients)
        update_payload["recipients"] = normalized_recipients
    if action is not None:
        update_payload["action"] = _normalize_reminder_action(action)
    if status is not None:
        update_payload["status"] = str(status or "").strip().lower()
    if channels is not None:
        update_payload["channels"] = _normalize_reminder_channels(channels)
    if not update_payload:
        raise ValueError("No updates provided")

    reminder = await sync_to_async(user_reminders.update_reminder, thread_sensitive=True)(
        user,
        reminder_id,
        **update_payload,
    )
    return {
        "reminder": reminder,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def delete_reminder(reminder_id: int, hard_delete: bool = False) -> Dict[str, Any]:
    """Delete or cancel a reminder from the caller's DevTools user database."""

    if not _request_has_capability("reminders.manage"):
        raise PermissionError("Reminder access required.")
    user = await _get_request_devtools_user()
    if not user:
        raise PermissionError("Authenticated DevTools user context required.")

    try:
        reminder_id = int(reminder_id)
    except (TypeError, ValueError):
        raise ValueError("reminder_id must be positive")
    if reminder_id <= 0:
        raise ValueError("reminder_id must be positive")

    from client_portal import user_reminders  # type: ignore

    reminder = await sync_to_async(user_reminders.delete_reminder, thread_sensitive=True)(
        user,
        reminder_id,
        hard_delete=bool(hard_delete),
    )
    return {
        "deleted": True,
        "hard_delete": bool(hard_delete),
        "reminder": reminder,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
def spam_flag(reason: Optional[str] = None, ip_address: Optional[str] = None) -> Dict[str, Any]:
    """Flag an IP address as spam (defaults to the caller IP if omitted)."""

    caller_ip = str(_REQUEST_IP.get() or "").strip()
    requested_ip = (ip_address or "").strip()
    if _request_access_role() == ACCESS_ROLE_PUBLIC:
        if requested_ip and caller_ip and requested_ip != caller_ip:
            raise PermissionError("Public callers can only flag their own IP address.")
        target_ip = requested_ip or caller_ip
    else:
        target_ip = requested_ip or caller_ip
    if not target_ip:
        raise ValueError("No IP address available to flag")
    try:
        target_ip = str(ipaddress.ip_address(target_ip))
    except ValueError as exc:
        raise ValueError("ip_address must be a valid IPv4 or IPv6 address") from exc

    _ensure_spam_ready()
    now_dt = datetime.utcnow()
    now = now_dt.isoformat() + "Z"
    cutoff_3d = (now_dt - timedelta(days=3)).isoformat() + "Z"
    suspended_until = None
    with _get_spam_connection() as conn:
        conn.execute(
            """
            INSERT INTO spam_ip_flags (ip_address, reason, flagged_at)
            VALUES (?, ?, ?)
            """,
            (target_ip, reason.strip() if reason and reason.strip() else None, now),
        )
        recent_count = conn.execute(
            "SELECT COUNT(*) AS count FROM spam_ip_flags WHERE ip_address = ? AND flagged_at >= ?",
            (target_ip, cutoff_3d),
        ).fetchone()["count"]
        if recent_count >= 10:
            suspended_until = (now_dt + timedelta(days=30)).isoformat() + "Z"

        existing = conn.execute(
            "SELECT * FROM spam_ips WHERE ip_address = ?",
            (target_ip,),
        ).fetchone()
        if existing:
            updated_reason = reason.strip() if reason and reason.strip() else existing["reason"]
            conn.execute(
                """
                UPDATE spam_ips
                SET reason = ?, last_seen_at = ?, hit_count = hit_count + 1, suspended_until = ?
                WHERE ip_address = ?
                """,
                (updated_reason, now, suspended_until or existing["suspended_until"], target_ip),
            )
            row = conn.execute("SELECT * FROM spam_ips WHERE ip_address = ?", (target_ip,)).fetchone()
        else:
            conn.execute(
                """
                INSERT INTO spam_ips (ip_address, reason, first_seen_at, last_seen_at, hit_count, suspended_until)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    target_ip,
                    reason.strip() if reason and reason.strip() else None,
                    now,
                    now,
                    1,
                    suspended_until,
                ),
            )
            row = conn.execute("SELECT * FROM spam_ips WHERE ip_address = ?", (target_ip,)).fetchone()

    return {
        "spam_ip": _row_to_spam_entry(row),
        "ts": now,
    }


def _graph_token() -> str:
    if not MSGRAPH_TENANT_ID or not MSGRAPH_CLIENT_ID or not MSGRAPH_CLIENT_SECRET:
        raise RuntimeError("MS Graph app credentials (tenant, client id, secret) are required")
    resp = requests.post(
        f"https://login.microsoftonline.com/{MSGRAPH_TENANT_ID}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": MSGRAPH_CLIENT_ID,
            "client_secret": MSGRAPH_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=15,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph token request failed: {resp.status_code} {resp.text}")
    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Graph token response missing access_token")
    return token


def _parse_db_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _fetch_delegated_token(email: str) -> Optional[sqlite3.Row]:
    if not email:
        return None
    if not AUTH_DB_PATH.exists():
        return None
    with sqlite3.connect(AUTH_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT t.id, t.token, t.token_secret, t.expires_at
            FROM socialaccount_socialtoken t
            JOIN socialaccount_socialaccount a ON a.id = t.account_id
            JOIN auth_user u ON u.id = a.user_id
            WHERE a.provider = 'microsoft' AND lower(u.email) = lower(?)
            ORDER BY t.id DESC
            LIMIT 1
            """,
            (email.strip(),),
        ).fetchone()
    return row


def _refresh_delegated_token(refresh_token: str) -> Dict[str, Any]:
    if not MSGRAPH_TENANT_ID or not MSGRAPH_CLIENT_ID or not MSGRAPH_CLIENT_SECRET:
        raise RuntimeError("MS Graph app credentials (tenant, client id, secret) are required")
    if not refresh_token:
        raise RuntimeError("Missing refresh token for delegated auth")
    resp = requests.post(
        f"https://login.microsoftonline.com/{MSGRAPH_TENANT_ID}/oauth2/v2.0/token",
        data={
            "grant_type": "refresh_token",
            "client_id": MSGRAPH_CLIENT_ID,
            "client_secret": MSGRAPH_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "scope": MSGRAPH_DELEGATED_SCOPES,
        },
        timeout=15,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph delegated token refresh failed: {resp.status_code} {resp.text}")
    payload = resp.json()
    access_token = payload.get("access_token")
    if not access_token:
        raise RuntimeError("Delegated token refresh missing access_token")
    expires_in = payload.get("expires_in", 0) or 0
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    return {
        "access_token": access_token,
        "refresh_token": payload.get("refresh_token") or refresh_token,
        "expires_at": expires_at,
    }


def _get_delegated_access_token(email: str) -> Optional[str]:
    row = _fetch_delegated_token(email)
    if not row:
        return None
    token = (row["token"] or "").strip()
    refresh_token = (row["token_secret"] or "").strip()
    expires_at = _parse_db_datetime(row["expires_at"])
    if token and expires_at and expires_at > datetime.now(timezone.utc) + timedelta(minutes=2):
        return token
    if not refresh_token:
        return None
    refreshed = _refresh_delegated_token(refresh_token)
    with sqlite3.connect(AUTH_DB_PATH) as conn:
        conn.execute(
            "UPDATE socialaccount_socialtoken SET token = ?, token_secret = ?, expires_at = ? WHERE id = ?",
            (
                refreshed["access_token"],
                refreshed["refresh_token"],
                refreshed["expires_at"].isoformat(),
                row["id"],
            ),
        )
        conn.commit()
    return refreshed["access_token"]


def _strip_html(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    return " ".join(soup.get_text(" ").split())


_GRAPH_MESSAGE_SELECT_FIELDS = ",".join(
    [
        "id",
        "conversationId",
        "internetMessageId",
        "subject",
        "from",
        "toRecipients",
        "ccRecipients",
        "replyTo",
        "receivedDateTime",
        "bodyPreview",
        "hasAttachments",
        "body",
    ]
)


def _extract_graph_message_body_text(item: Dict[str, Any]) -> str:
    body = item.get("body") or {}
    content = body.get("content") or ""
    content_type = str(body.get("contentType") or "").strip().lower()
    body_text = _strip_html(content) if content_type == "html" else str(content or "")
    if not body_text:
        body_text = str(item.get("bodyPreview") or "")
    return body_text


def _graph_recipient_addresses(recipients: Any) -> List[str]:
    addresses: List[str] = []
    if not isinstance(recipients, list):
        return addresses
    for recipient in recipients:
        address = str(((recipient or {}).get("emailAddress") or {}).get("address") or "").strip()
        if address:
            addresses.append(address)
    return addresses


def _build_inbox_message_payload(
    item: Dict[str, Any],
    *,
    include_body: bool = False,
) -> Dict[str, Any]:
    payload = {
        "id": item.get("id"),
        "conversationId": item.get("conversationId"),
        "internetMessageId": item.get("internetMessageId"),
        "subject": item.get("subject"),
        "from": ((item.get("from") or {}).get("emailAddress") or {}).get("address"),
        "to": _graph_recipient_addresses(item.get("toRecipients")),
        "cc": _graph_recipient_addresses(item.get("ccRecipients")),
        "replyTo": _graph_recipient_addresses(item.get("replyTo")),
        "receivedDateTime": item.get("receivedDateTime"),
        "hasAttachments": bool(item.get("hasAttachments")),
        "preview": item.get("bodyPreview"),
    }
    if include_body:
        payload["body"] = _extract_graph_message_body_text(item)
    return payload


def _graph_fetch_messages(
    token: str,
    mailbox: str,
    top: int,
    since: Optional[str] = None,
    unread: Optional[bool] = None,
    folder: Optional[str] = None,
) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "$top": str(top),
        "$orderby": "receivedDateTime desc",
        "$select": _GRAPH_MESSAGE_SELECT_FIELDS,
    }
    filters = []
    if since:
        filters.append(f"receivedDateTime ge {since}")
    if unread is True:
        filters.append("isRead eq false")
    if unread is False:
        filters.append("isRead eq true")
    if filters:
        params["$filter"] = " and ".join(filters)
    base = f"https://graph.microsoft.com/v1.0/users/{mailbox}"
    if folder:
        base = f"{base}/mailFolders/{folder}"
    url = f"{base}/messages"
    resp = requests.get(url, headers=headers, params=params, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph message fetch failed for {mailbox}: {resp.status_code} {resp.text}")
    payload = resp.json()
    return payload.get("value") or []


def _graph_get_message(
    token: str,
    mailbox: str,
    message_id: str,
) -> Dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    encoded_message_id = quote((message_id or "").strip(), safe="")
    if not encoded_message_id:
        raise ValueError("message_id is required")
    params = {"$select": _GRAPH_MESSAGE_SELECT_FIELDS}
    url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{encoded_message_id}"
    resp = requests.get(url, headers=headers, params=params, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph get message failed for {mailbox}: {resp.status_code} {resp.text}")
    payload = resp.json() if resp.text else {}
    return payload if isinstance(payload, dict) else {}


def _graph_fetch_conversation_messages(
    token: str,
    mailbox: str,
    conversation_id: str,
    *,
    top: int = 100,
) -> List[Dict[str, Any]]:
    normalized_conversation_id = (conversation_id or "").strip()
    if not normalized_conversation_id:
        return []
    page_limit = max(1, min(int(top), 250))
    conversation_filter_value = normalized_conversation_id.replace("'", "''")
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "$top": str(min(page_limit, 50)),
        "$orderby": "receivedDateTime asc",
        "$select": _GRAPH_MESSAGE_SELECT_FIELDS,
        "$filter": f"conversationId eq '{conversation_filter_value}'",
    }
    url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages"
    results: List[Dict[str, Any]] = []
    while url and len(results) < page_limit:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Graph conversation fetch failed for {mailbox}: {resp.status_code} {resp.text}"
            )
        payload = resp.json() if resp.text else {}
        values = payload.get("value") if isinstance(payload, dict) else []
        if isinstance(values, list):
            results.extend(values)
        next_link = payload.get("@odata.nextLink") if isinstance(payload, dict) else None
        if not next_link:
            break
        url = str(next_link).strip()
        params = None
    return results[:page_limit]


def _graph_get_event(
    token: str,
    calendar_owner: str,
    event_id: str,
) -> Dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    url = f"https://graph.microsoft.com/v1.0/users/{calendar_owner}/events/{event_id}"
    resp = requests.get(url, headers=headers, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph get event failed for {calendar_owner}: {resp.status_code} {resp.text}")
    return resp.json()


def _graph_update_event(
    token: str,
    calendar_owner: str,
    event_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    url = f"https://graph.microsoft.com/v1.0/users/{calendar_owner}/events/{event_id}"
    resp = requests.patch(url, headers=headers, json=payload, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph update event failed for {calendar_owner}: {resp.status_code} {resp.text}")
    return resp.json() if resp.text else {}


def _graph_get_calendar_events_delegated(
    token: str,
    start_dt: datetime,
    end_dt: datetime,
    top: int = 50,
) -> List[Dict[str, Any]]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Prefer": f'outlook.timezone="{MSGRAPH_EVENT_TIMEZONE}"',
    }
    params = {
        "startDateTime": start_dt.isoformat(),
        "endDateTime": end_dt.isoformat(),
        "$select": "id,subject,organizer,start,end,location,onlineMeeting,webLink,isCancelled,attendees",
        "$orderby": "start/dateTime asc",
        "$top": str(top),
    }
    url = "https://graph.microsoft.com/v1.0/me/calendarView"
    resp = requests.get(url, headers=headers, params=params, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph calendar events failed: {resp.status_code} {resp.text}")
    payload = resp.json()
    return payload.get("value") or []


def _normalize_email_list(values: Optional[Sequence[str]]) -> List[str]:
    if not values:
        return []
    cleaned: List[str] = []
    for value in values:
        candidate = (value or "").strip()
        if not candidate or "@" not in candidate:
            continue
        cleaned.append(candidate)
    return cleaned


def _graph_send_mail(
    token: str,
    mailbox: str,
    to_recipients: Sequence[str],
    subject: str,
    body: str,
    cc_recipients: Optional[Sequence[str]] = None,
    bcc_recipients: Optional[Sequence[str]] = None,
    reply_to: Optional[Sequence[str]] = None,
    importance: str = "normal",
    content_type: str = "Text",
) -> None:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _recipient_items(addresses: Sequence[str]) -> List[Dict[str, Any]]:
        return [{"emailAddress": {"address": address}} for address in addresses]

    payload: Dict[str, Any] = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML" if content_type.lower() == "html" else "Text", "content": body},
            "toRecipients": _recipient_items(to_recipients),
            "importance": importance.lower() if importance.lower() in {"low", "normal", "high"} else "normal",
        },
        "saveToSentItems": "true",
    }
    cc_items = _recipient_items(_normalize_email_list(cc_recipients))
    if cc_items:
        payload["message"]["ccRecipients"] = cc_items
    bcc_items = _recipient_items(_normalize_email_list(bcc_recipients))
    if bcc_items:
        payload["message"]["bccRecipients"] = bcc_items
    reply_to_items = _recipient_items(_normalize_email_list(reply_to))
    if reply_to_items:
        payload["message"]["replyTo"] = reply_to_items

    resp = requests.post(
        f"https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail",
        headers=headers,
        json=payload,
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph sendMail failed for {mailbox}: {resp.status_code} {resp.text}")


def _graph_create_reply_draft(
    token: str,
    mailbox: str,
    message_id: str,
    *,
    reply_all: bool = False,
) -> Dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    action = "createReplyAll" if reply_all else "createReply"
    encoded_message_id = quote((message_id or "").strip(), safe="")
    resp = requests.post(
        f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{encoded_message_id}/{action}",
        headers=headers,
        json={},
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph {action} failed for {mailbox}: {resp.status_code} {resp.text}")
    payload = resp.json() if resp.text else {}
    if not str(payload.get("id") or "").strip():
        raise RuntimeError(f"Graph {action} returned no draft id for mailbox {mailbox}")
    return payload


def _graph_update_draft_message(
    token: str,
    mailbox: str,
    draft_message_id: str,
    *,
    body: str,
    content_type: str = "Text",
    cc_recipients: Optional[Sequence[str]] = None,
    bcc_recipients: Optional[Sequence[str]] = None,
) -> None:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    encoded_draft_id = quote((draft_message_id or "").strip(), safe="")

    def _recipient_items(addresses: Sequence[str]) -> List[Dict[str, Any]]:
        return [{"emailAddress": {"address": address}} for address in addresses]

    payload: Dict[str, Any] = {
        "body": {
            "contentType": "HTML" if content_type.strip().lower() == "html" else "Text",
            "content": body,
        }
    }
    cc_items = _recipient_items(_normalize_email_list(cc_recipients))
    if cc_items:
        payload["ccRecipients"] = cc_items
    bcc_items = _recipient_items(_normalize_email_list(bcc_recipients))
    if bcc_items:
        payload["bccRecipients"] = bcc_items

    resp = requests.patch(
        f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{encoded_draft_id}",
        headers=headers,
        json=payload,
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph draft update failed for {mailbox}: {resp.status_code} {resp.text}")


def _graph_send_draft_message(
    token: str,
    mailbox: str,
    draft_message_id: str,
) -> None:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    encoded_draft_id = quote((draft_message_id or "").strip(), safe="")
    resp = requests.post(
        f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{encoded_draft_id}/send",
        headers=headers,
        json={},
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph draft send failed for {mailbox}: {resp.status_code} {resp.text}")


def _graph_forward_message(
    token: str,
    mailbox: str,
    message_id: str,
    to_recipients: Sequence[str],
    *,
    comment: str = "",
) -> None:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    encoded_message_id = quote((message_id or "").strip(), safe="")
    if not encoded_message_id:
        raise ValueError("message_id is required.")
    recipients = _normalize_email_list(to_recipients)
    if not recipients:
        raise ValueError("At least one valid recipient is required.")
    payload: Dict[str, Any] = {
        "toRecipients": [{"emailAddress": {"address": address}} for address in recipients],
    }
    normalized_comment = str(comment or "").strip()
    if normalized_comment:
        payload["comment"] = normalized_comment
    resp = requests.post(
        f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{encoded_message_id}/forward",
        headers=headers,
        json=payload,
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Graph forward failed for {mailbox}: {resp.status_code} {resp.text}")


def _render_alshival_branded_email_html(subject: str, body_text: str) -> str:
    safe_subject = html.escape((subject or "").strip() or "Alshival Notification")
    normalized = str(body_text or "").replace("\r\n", "\n").strip()
    if not normalized:
        normalized = "No message body provided."
    paragraphs: List[str] = []
    for block in normalized.split("\n\n"):
        lines = [html.escape(line.strip()) for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        paragraphs.append("<br>".join(lines))
    body_html = "".join(
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">{paragraph}</p>'
        for paragraph in paragraphs
    ) or '<p style="margin:0;font-size:15px;line-height:1.7;color:#334155;">No message body provided.</p>'

    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{safe_subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7fb;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,0.12);overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px;">
                <img src="https://alshival.ai/static/img/logos/brain1_transparent.png" width="48" alt="Alshival logo" style="display:block;border:0;height:auto;">
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 12px;">
                <h1 style="margin:0;font-size:22px;line-height:1.3;color:#0f172a;">{safe_subject}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                {body_html}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 26px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">This message was sent by Alshival.Ai LLC.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
""".strip()


def _resolve_inbox_target_mailbox(mailbox: Optional[str] = None, username: Optional[str] = None) -> str:
    target_mailbox = (mailbox or "").strip()
    target_username = (username or "").strip()
    if target_mailbox and target_username:
        raise ValueError("Provide only one of mailbox or username.")
    if target_username:
        normalized_username = target_username.lstrip("@").strip().lower()
        if not normalized_username:
            raise ValueError("username cannot be empty.")
        if normalized_username == "alshival":
            support_mailbox = _get_support_mailbox()
            if not support_mailbox:
                raise RuntimeError("SUPPORT_EMAIL is not configured.")
            return support_mailbox
        resolved = _resolve_email_recipient_by_username_sync(normalized_username)
        return str(resolved.get("email") or "").strip()
    if target_mailbox:
        return target_mailbox
    return (os.getenv("SUPPORT_EMAIL") or "support@alshival.ai").strip()


def _ensure_inbox_cache_table(conn: sqlite3.Connection, table_name: str) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            message_id TEXT PRIMARY KEY,
            short_id TEXT,
            conversation_id TEXT,
            mailbox TEXT NOT NULL,
            subject TEXT,
            from_email TEXT,
            from_name TEXT,
            received_at TEXT,
            has_attachments INTEGER,
            body_text TEXT,
            body_html TEXT,
            body_preview TEXT,
            content_type TEXT,
            truncated INTEGER,
            to_recipients TEXT,
            cc_recipients TEXT,
            reply_to TEXT,
            internet_message_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table_name}_mailbox_received ON {table_name} (mailbox, received_at)"
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table_name}_short_id ON {table_name} (short_id)"
    )
    conn.commit()


def _resolve_inbox_cache_destination(target_mailbox: str) -> tuple[Path, str]:
    owner_user = _resolve_user_for_api_key_sync(target_mailbox, None)
    if not owner_user:
        request_user = _resolve_user_for_api_key_sync(_get_request_user_email(), _get_request_user_name())
        if request_user:
            owner_user = request_user
    if not owner_user:
        raise RuntimeError(f"Unable to resolve user database for mailbox: {target_mailbox}")

    from client_portal.user_resources import ensure_user_db  # type: ignore

    db_path = ensure_user_db(owner_user)
    if not db_path:
        raise RuntimeError(f"Unable to resolve user database for mailbox: {target_mailbox}")
    return Path(db_path), "outlook_inbox_message_cache"


def _upsert_inbox_cache_message(
    conn: sqlite3.Connection,
    table_name: str,
    target_mailbox: str,
    item: Dict[str, Any],
    *,
    body_text: str,
    body_html: str,
    content_type: str,
    body_preview: str,
    truncated: bool,
) -> None:
    message_id = item.get("id")
    if not message_id:
        return
    now = datetime.utcnow().isoformat() + "Z"
    short_id = hashlib.sha1(str(message_id).encode("utf-8")).hexdigest()[:12]
    from_payload = (item.get("from") or {}).get("emailAddress") or {}
    conn.execute(
        f"""
        INSERT INTO {table_name} (
            message_id,
            short_id,
            conversation_id,
            mailbox,
            subject,
            from_email,
            from_name,
            received_at,
            has_attachments,
            body_text,
            body_html,
            body_preview,
            content_type,
            truncated,
            to_recipients,
            cc_recipients,
            reply_to,
            internet_message_id,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
            short_id = excluded.short_id,
            conversation_id = excluded.conversation_id,
            mailbox = excluded.mailbox,
            subject = excluded.subject,
            from_email = excluded.from_email,
            from_name = excluded.from_name,
            received_at = excluded.received_at,
            has_attachments = excluded.has_attachments,
            body_text = excluded.body_text,
            body_html = excluded.body_html,
            body_preview = excluded.body_preview,
            content_type = excluded.content_type,
            truncated = excluded.truncated,
            to_recipients = excluded.to_recipients,
            cc_recipients = excluded.cc_recipients,
            reply_to = excluded.reply_to,
            internet_message_id = excluded.internet_message_id,
            updated_at = excluded.updated_at
        """,
        (
            str(message_id),
            short_id,
            str(item.get("conversationId") or ""),
            target_mailbox,
            item.get("subject"),
            from_payload.get("address"),
            from_payload.get("name"),
            item.get("receivedDateTime"),
            1 if item.get("hasAttachments") else 0,
            body_text,
            body_html,
            body_preview,
            content_type,
            1 if truncated else 0,
            json.dumps(item.get("toRecipients") or []),
            json.dumps(item.get("ccRecipients") or []),
            json.dumps(item.get("replyTo") or []),
            item.get("internetMessageId"),
            now,
            now,
        ),
    )


@mcp.tool()
def get_calendar_events(
    start_time: str,
    end_time: str,
    top: int = 25,
) -> Dict[str, Any]:
    """Return upcoming calendar events for the logged-in user (delegated auth only)."""

    if not _request_has_internal_access():
        raise PermissionError("Access denied for get_calendar_events.")
    if top <= 0:
        raise ValueError("top must be positive")
    start_dt = _parse_iso_datetime(start_time)
    end_dt = _parse_iso_datetime(end_time)
    if end_dt <= start_dt:
        raise ValueError("end_time must be after start_time")

    user_email = _get_request_user_email()
    if not user_email:
        raise RuntimeError("Missing user context for delegated calendar access.")

    delegated_token = _get_delegated_access_token(user_email)
    if not delegated_token:
        raise RuntimeError(f"No delegated token found for {user_email}. Ask the user to connect Microsoft.")

    events = _graph_get_calendar_events_delegated(delegated_token, start_dt, end_dt, top=top)
    normalized = []
    target_tz = MSGRAPH_EVENT_TIMEZONE or "UTC"
    try:
        target_tzinfo = ZoneInfo(target_tz)
    except Exception:
        target_tzinfo = timezone.utc
    for event in events:
        start_payload = event.get("start") or {}
        end_payload = event.get("end") or {}
        event_start = None
        event_end = None
        start_tz = (start_payload.get("timeZone") or "").strip()
        end_tz = (end_payload.get("timeZone") or "").strip()
        start_raw = (start_payload.get("dateTime") or "").strip()
        end_raw = (end_payload.get("dateTime") or "").strip()
        if start_raw:
            try:
                event_start = datetime.fromisoformat(start_raw)
            except ValueError:
                event_start = None
        if end_raw:
            try:
                event_end = datetime.fromisoformat(end_raw)
            except ValueError:
                event_end = None
        if event_start and event_start.tzinfo is None:
            try:
                event_start = event_start.replace(tzinfo=ZoneInfo(start_tz or target_tz))
            except Exception:
                event_start = event_start.replace(tzinfo=target_tzinfo)
        if event_end and event_end.tzinfo is None:
            try:
                event_end = event_end.replace(tzinfo=ZoneInfo(end_tz or target_tz))
            except Exception:
                event_end = event_end.replace(tzinfo=target_tzinfo)
        start_local = event_start.astimezone(target_tzinfo).isoformat() if event_start else None
        end_local = event_end.astimezone(target_tzinfo).isoformat() if event_end else None
        normalized.append(
            {
                "id": event.get("id"),
                "subject": event.get("subject"),
                "start": start_raw or None,
                "end": end_raw or None,
                "start_time_zone": start_tz or None,
                "end_time_zone": end_tz or None,
                "start_local": start_local,
                "end_local": end_local,
                "organizer": (event.get("organizer") or {}).get("emailAddress", {}).get("address"),
                "attendees": [
                    (att.get("emailAddress") or {}).get("address")
                    for att in (event.get("attendees") or [])
                    if (att.get("emailAddress") or {}).get("address")
                ],
                "location": (event.get("location") or {}).get("displayName"),
                "online_meeting_url": (event.get("onlineMeeting") or {}).get("joinUrl"),
                "web_link": event.get("webLink"),
                "is_cancelled": bool(event.get("isCancelled")),
            }
        )

    return {
        "calendar_owner": user_email,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "time_zone": MSGRAPH_EVENT_TIMEZONE,
        "count": len(normalized),
        "events": normalized,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
def edit_calendar_event(
    event_id: str,
    owner_email: str,
    subject: Optional[str] = None,
    start_time: Optional[str] = None,
    duration_minutes: Optional[int] = None,
    description: Optional[str] = None,
    location: Optional[str] = None,
    attendee_emails: Optional[List[str]] = None,
    add_attendees: Optional[List[str]] = None,
    remove_attendees: Optional[List[str]] = None,
    create_online_meetings: Optional[bool] = None,
) -> Dict[str, Any]:
    """Edit an existing calendar event on a specific calendar via Microsoft Graph."""

    if not _request_has_internal_access():
        raise PermissionError("Access denied for edit_calendar_event.")
    if not event_id or not event_id.strip():
        raise ValueError("event_id is required")
    owner_email = (owner_email or "").strip()
    if "@" not in owner_email:
        raise ValueError("owner_email must be a valid email address")
    if duration_minutes is not None and duration_minutes <= 0:
        raise ValueError("duration_minutes must be positive")
    if duration_minutes is not None and not start_time:
        raise ValueError("start_time is required when updating duration_minutes")

    payload: Dict[str, Any] = {}
    if subject is not None:
        payload["subject"] = subject.strip()
    if description is not None:
        payload["body"] = {"contentType": "Text", "content": description.strip()}
    if location is not None:
        payload["location"] = {"displayName": location.strip()}
    if start_time is not None:
        start_dt = _parse_iso_datetime(start_time)
        end_dt = start_dt + timedelta(minutes=duration_minutes or 30)
        payload["start"] = {"dateTime": start_dt.isoformat(), "timeZone": MSGRAPH_EVENT_TIMEZONE}
        payload["end"] = {"dateTime": end_dt.isoformat(), "timeZone": MSGRAPH_EVENT_TIMEZONE}

    normalized_attendees = None
    if attendee_emails is not None:
        normalized_attendees = []
        for email in attendee_emails:
            email = (email or "").strip()
            if "@" in email:
                normalized_attendees.append(email)

    if add_attendees or remove_attendees:
        token = _graph_token()
        existing = _graph_get_event(token, owner_email, event_id)
        current = {
            (att.get("emailAddress") or {}).get("address")
            for att in (existing.get("attendees") or [])
            if (att.get("emailAddress") or {}).get("address")
        }
        if add_attendees:
            for email in add_attendees:
                email = (email or "").strip()
                if "@" in email:
                    current.add(email)
        if remove_attendees:
            for email in remove_attendees:
                email = (email or "").strip()
                if email in current:
                    current.remove(email)
        normalized_attendees = sorted(current)

    if normalized_attendees is not None:
        payload["attendees"] = [
            {"emailAddress": {"address": email, "name": email}, "type": "required"}
            for email in normalized_attendees
        ]

    if create_online_meetings is not None:
        payload["isOnlineMeeting"] = bool(create_online_meetings)
        payload["onlineMeetingProvider"] = "teamsForBusiness" if create_online_meetings else None

    if not payload:
        raise ValueError("No updates provided")

    token = _graph_token()
    updated = _graph_update_event(token, owner_email, event_id, payload)

    return {
        "event_id": event_id,
        "calendar_owner": owner_email,
        "status": "updated",
        "updated_fields": sorted(payload.keys()),
        "event": updated or None,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


def _read_inbox_impl(
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    top: int = 10,
    since: Optional[str] = None,
    include_body: bool = False,
    thread: bool = False,
    unread: Optional[bool] = True,
    folder: Optional[str] = None,
) -> Dict[str, Any]:
    target_mailbox = _resolve_inbox_target_mailbox(mailbox, username)
    if top <= 0:
        raise ValueError("top must be positive")
    if since:
        try:
            datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("since must be a valid ISO 8601 timestamp") from exc

    token = _graph_token()
    items = _graph_fetch_messages(token, target_mailbox, top, since, unread, folder)
    messages: List[Dict[str, Any]] = []
    thread_limit = max(1, min(int(os.getenv("OUTLOOK_THREAD_MAX_MESSAGES", "100")), 250))
    conversation_cache: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        payload = _build_inbox_message_payload(item, include_body=include_body)
        if thread:
            conversation_id = str(item.get("conversationId") or "").strip()
            if conversation_id:
                cached_thread = conversation_cache.get(conversation_id)
                if cached_thread is None:
                    cached_thread = _graph_fetch_conversation_messages(
                        token,
                        target_mailbox,
                        conversation_id,
                        top=thread_limit,
                    )
                    conversation_cache[conversation_id] = cached_thread
            else:
                cached_thread = [item]
            payload["thread"] = [
                _build_inbox_message_payload(thread_item, include_body=include_body)
                for thread_item in cached_thread
            ]
            payload["thread_count"] = len(payload["thread"])
        messages.append(payload)

    return {
        "mailbox": target_mailbox,
        "count": len(messages),
        "messages": messages,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


def _read_email_impl(
    message_id: str,
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    include_body: bool = True,
    thread: bool = False,
) -> Dict[str, Any]:
    target_mailbox = _resolve_inbox_target_mailbox(mailbox, username)
    target_message_id = str(message_id or "").strip()
    if not target_message_id:
        raise ValueError("message_id is required")

    token = _graph_token()
    item = _graph_get_message(token, target_mailbox, target_message_id)
    if not item:
        raise RuntimeError(f"Message not found: {target_message_id}")

    result: Dict[str, Any] = {
        "mailbox": target_mailbox,
        "message": _build_inbox_message_payload(item, include_body=include_body),
        "ts": datetime.utcnow().isoformat() + "Z",
    }
    if thread:
        thread_limit = max(1, min(int(os.getenv("OUTLOOK_THREAD_MAX_MESSAGES", "100")), 250))
        conversation_id = str(item.get("conversationId") or "").strip()
        if conversation_id:
            thread_items = _graph_fetch_conversation_messages(
                token,
                target_mailbox,
                conversation_id,
                top=thread_limit,
            )
        else:
            thread_items = [item]
        result["thread_messages"] = [
            _build_inbox_message_payload(thread_item, include_body=include_body)
            for thread_item in thread_items
        ]
        result["thread"] = result.pop("thread_messages")
        result["thread_count"] = len(result["thread"])
    return result


def _ingest_inbox_impl(
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    top: int = 10,
    since: Optional[str] = None,
    unread: Optional[bool] = True,
    folder: Optional[str] = None,
    max_chars: int = 4000,
) -> Dict[str, Any]:
    target_mailbox = _resolve_inbox_target_mailbox(mailbox, username)
    if top <= 0:
        raise ValueError("top must be positive")
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if since:
        try:
            datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("since must be a valid ISO 8601 timestamp") from exc

    token = _graph_token()
    items = _graph_fetch_messages(token, target_mailbox, top, since, unread, folder)
    db_path, table_name = _resolve_inbox_cache_destination(target_mailbox)
    skipped = 0
    ingested = 0
    with sqlite3.connect(db_path) as conn:
        _ensure_inbox_cache_table(conn, table_name)
        existing_ids = {
            str(row[0] or "")
            for row in conn.execute(f"SELECT message_id FROM {table_name} WHERE mailbox = ?", (target_mailbox,)).fetchall()
        }
        for item in items:
            message_id = str(item.get("id") or "").strip()
            if not message_id or message_id in existing_ids:
                skipped += 1
                continue
            body = item.get("body") or {}
            content = body.get("content") or ""
            content_type = (body.get("contentType") or "").lower()
            body_text = _strip_html(content) if content_type == "html" else content
            if not body_text:
                body_text = item.get("bodyPreview") or ""
            body_text = (body_text or "").strip()
            if not body_text:
                skipped += 1
                continue
            truncated = False
            if len(body_text) > max_chars:
                body_text = body_text[:max_chars]
                truncated = True
            _upsert_inbox_cache_message(
                conn,
                table_name,
                target_mailbox,
                item,
                body_text=body_text,
                body_html=content if content_type == "html" else "",
                content_type=content_type,
                body_preview=(item.get("bodyPreview") or ""),
                truncated=truncated,
            )
            ingested += 1
        conn.commit()

    return {
        "mailbox": target_mailbox,
        "requested": len(items),
        "ingested": ingested,
        "skipped": skipped,
        "cache": table_name,
        "db_path": str(db_path),
        "ts": datetime.utcnow().isoformat() + "Z",
    }


def _search_inbox_impl(
    query: Optional[str] = None,
    top_k: int = 5,
    since: Optional[str] = None,
    until: Optional[str] = None,
    from_email: Optional[str] = None,
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    *,
    include_support: bool = False,
) -> Dict[str, Any]:
    if not query and not any([since, until, from_email, mailbox, username]):
        raise ValueError("Provide query or at least one filter.")
    if top_k <= 0:
        raise ValueError("top_k must be positive")
    since_dt: Optional[datetime] = None
    until_dt: Optional[datetime] = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)
            else:
                since_dt = since_dt.astimezone(timezone.utc)
        except ValueError as exc:
            raise ValueError("since must be a valid ISO 8601 timestamp") from exc
    if until:
        try:
            until_dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
            if until_dt.tzinfo is None:
                until_dt = until_dt.replace(tzinfo=timezone.utc)
            else:
                until_dt = until_dt.astimezone(timezone.utc)
        except ValueError as exc:
            raise ValueError("until must be a valid ISO 8601 timestamp") from exc

    target_mailbox = _resolve_inbox_target_mailbox(mailbox, username)
    support_mailbox = _get_support_mailbox()
    search_targets: list[tuple[str, Path, str]] = []
    db_path, table_name = _resolve_inbox_cache_destination(target_mailbox)
    search_targets.append((target_mailbox, db_path, table_name))
    if (
        include_support
        and support_mailbox
        and target_mailbox.strip().lower() != support_mailbox.strip().lower()
    ):
        support_db_path, support_table = _resolve_inbox_cache_destination(support_mailbox)
        search_targets.append((support_mailbox, support_db_path, support_table))

    clauses = ["mailbox = ?"]
    if from_email:
        clauses.append("lower(from_email) = lower(?)")
    if query:
        q = f"%{query.strip().lower()}%"
        clauses.append("(lower(subject) LIKE ? OR lower(from_email) LIKE ? OR lower(body_text) LIKE ?)")

    where_sql = " AND ".join(clauses)
    sql = f"""
        SELECT
            message_id,
            short_id,
            mailbox,
            subject,
            from_email,
            received_at,
            has_attachments,
            body_text,
            body_preview
        FROM {table_name}
        WHERE {where_sql}
        ORDER BY id DESC
        LIMIT ?
    """
    row_limit = min(max(25, int(top_k) * 20), 500)
    results: List[Dict[str, Any]] = []
    for mailbox_value, target_db_path, target_table_name in search_targets:
        with sqlite3.connect(target_db_path) as conn:
            conn.row_factory = sqlite3.Row
            _ensure_inbox_cache_table(conn, target_table_name)
            params: List[Any] = [mailbox_value]
            if from_email:
                params.append(from_email.strip())
            if query:
                params.extend([q, q, q])
            params.append(row_limit)
            rows = conn.execute(sql.replace(table_name, target_table_name), params).fetchall()
        for row in rows:
            received_raw = (row["received_at"] or "").strip()
            if not received_raw:
                continue
            try:
                received_dt = datetime.fromisoformat(received_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
            if received_dt.tzinfo is None:
                received_dt = received_dt.replace(tzinfo=timezone.utc)
            else:
                received_dt = received_dt.astimezone(timezone.utc)
            if since_dt and received_dt < since_dt:
                continue
            if until_dt and received_dt > until_dt:
                continue
            results.append(
                {
                    "text": (row["body_text"] or "").strip() or (row["body_preview"] or "").strip(),
                    "metadata": {
                        "message_id": (row["message_id"] or "").strip(),
                        "short_id": (row["short_id"] or "").strip(),
                        "mailbox": (row["mailbox"] or "").strip(),
                        "subject": (row["subject"] or "").strip(),
                        "from": (row["from_email"] or "").strip(),
                        "receivedDateTime": received_raw,
                        "hasAttachments": bool(int(row["has_attachments"] or 0)),
                        "source": (
                            "support_inbox"
                            if support_mailbox and mailbox_value.strip().lower() == support_mailbox.strip().lower()
                            else "outlook_inbox"
                        ),
                        "_received_dt": received_dt.isoformat(),
                    },
                    "score": None,
                }
            )

    results.sort(
        key=lambda item: item["metadata"].get("_received_dt") or "",
        reverse=True,
    )
    for item in results:
        item["metadata"].pop("_received_dt", None)

    return {
        "query": query,
        "filters": {
            "since": since,
            "until": until,
            "from_email": from_email,
            "mailbox": target_mailbox,
            "username": username,
            "include_support": bool(include_support),
        },
        "count": min(len(results), int(top_k)),
        "results": results[:top_k],
        "cache": ",".join(sorted({table for _, _, table in search_targets})),
        "db_path": ",".join(sorted({str(path) for _, path, _ in search_targets})),
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
async def read_inbox(
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    top: int = 10,
    since: Optional[str] = None,
    include_body: bool = False,
    thread: bool = False,
    unread: Optional[bool] = True,
    folder: Optional[str] = None,
) -> Dict[str, Any]:
    if not _request_has_internal_access():
        raise PermissionError("Access denied for read_inbox.")
    return await sync_to_async(_read_inbox_impl, thread_sensitive=True)(
        mailbox,
        username,
        top,
        since,
        include_body,
        thread,
        unread,
        folder,
    )


@mcp.tool()
async def read_email(
    message_id: str,
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    include_body: bool = True,
    thread: bool = False,
) -> Dict[str, Any]:
    if not _request_has_internal_access():
        raise PermissionError("Access denied for read_email.")
    return await sync_to_async(_read_email_impl, thread_sensitive=True)(
        message_id,
        mailbox,
        username,
        include_body,
        thread,
    )


@mcp.tool()
async def ingest_inbox(
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    top: int = 10,
    since: Optional[str] = None,
    unread: Optional[bool] = True,
    folder: Optional[str] = None,
    max_chars: int = 4000,
) -> Dict[str, Any]:
    if not _request_has_internal_access():
        raise PermissionError("Access denied for ingest_inbox.")
    return await sync_to_async(_ingest_inbox_impl, thread_sensitive=True)(
        mailbox,
        username,
        top,
        since,
        unread,
        folder,
        max_chars,
    )


@mcp.tool()
async def search_inbox(
    query: Optional[str] = None,
    top_k: int = 5,
    since: Optional[str] = None,
    until: Optional[str] = None,
    from_email: Optional[str] = None,
    mailbox: Optional[str] = None,
    username: Optional[str] = None,
    include_support: bool = False,
) -> Dict[str, Any]:
    if not _request_has_internal_access():
        raise PermissionError("Access denied for search_inbox.")
    return await sync_to_async(_search_inbox_impl, thread_sensitive=True)(
        query,
        top_k,
        since,
        until,
        from_email,
        mailbox,
        username,
        include_support=bool(include_support),
    )


@mcp.tool()
def reply_email(
    message_id: str,
    body: str,
    mailbox: Optional[str] = None,
    reply_all: bool = False,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
    content_type: str = "Text",
    use_brand_template: bool = True,
) -> Dict[str, Any]:
    """Reply to an existing Outlook message by message ID, preserving thread context."""

    if not _request_has_capability("email.send"):
        raise PermissionError("Email send capability required.")

    target_message_id = (message_id or "").strip()
    if not target_message_id:
        raise ValueError("message_id is required.")
    normalized_body = (body or "").strip()
    if not normalized_body:
        raise ValueError("body is required.")

    mailbox_name = (mailbox or os.getenv("SUPPORT_EMAIL") or "support@alshival.ai").strip()
    if not mailbox_name:
        raise ValueError("mailbox is required.")

    resolved_content_type = (content_type or "Text").strip()
    if resolved_content_type.lower() not in {"text", "html"}:
        raise ValueError("content_type must be 'Text' or 'HTML'.")
    if not use_brand_template:
        logger.info("Forcing branded template for MCP reply_email.")

    send_body = _render_alshival_branded_email_html("Support reply", normalized_body)
    resolved_content_type = "HTML"

    token = _graph_token()
    draft = _graph_create_reply_draft(
        token=token,
        mailbox=mailbox_name,
        message_id=target_message_id,
        reply_all=bool(reply_all),
    )
    draft_id = str(draft.get("id") or "").strip()
    _graph_update_draft_message(
        token=token,
        mailbox=mailbox_name,
        draft_message_id=draft_id,
        body=send_body,
        content_type=resolved_content_type,
        cc_recipients=cc,
        bcc_recipients=bcc,
    )
    _graph_send_draft_message(
        token=token,
        mailbox=mailbox_name,
        draft_message_id=draft_id,
    )

    return {
        "mailbox": mailbox_name,
        "message_id": target_message_id,
        "draft_message_id": draft_id,
        "reply_all": bool(reply_all),
        "content_type": "HTML" if resolved_content_type.lower() == "html" else "Text",
        "use_brand_template": True,
        "status": "sent",
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
def forward_email(
    message_id: str,
    comment: str = "",
    to_email: Optional[str] = None,
    username: Optional[str] = None,
    recipient_group: Optional[str] = None,
    mailbox: Optional[str] = None,
) -> Dict[str, Any]:
    """Forward an Outlook message by message ID to an email, username, or recipient group."""

    if not _request_has_capability("email.send"):
        raise PermissionError("Email send capability required.")

    target_message_id = str(message_id or "").strip()
    if not target_message_id:
        raise ValueError("message_id is required.")

    direct_email = str(to_email or "").strip()
    target_username = str(username or "").strip()
    target_group = str(recipient_group or "").strip().lower()
    selected_count = int(bool(direct_email)) + int(bool(target_username)) + int(bool(target_group))
    if selected_count != 1:
        raise ValueError("Provide exactly one target: to_email, username, or recipient_group.")

    recipient_mode = "email"
    recipient_email = ""
    recipient_username = ""
    recipient_group_value = ""
    recipient_user_id: Optional[int] = None
    recipients: List[str] = []

    if target_group:
        if target_group != "staff":
            raise ValueError("recipient_group currently supports only 'staff'.")
        recipient_group_value = "staff"
        staff_recipients = _resolve_staff_email_recipients_sync()
        if not staff_recipients:
            raise ValueError("No active staff recipients with valid email were found.")
        recipients = [str(row.get("email") or "").strip() for row in staff_recipients if str(row.get("email") or "").strip()]
        recipient_mode = "group"
    elif direct_email:
        normalized_to = _normalize_email_list([direct_email])
        if not normalized_to:
            raise ValueError("to_email must be a valid email address.")
        recipient_email = normalized_to[0]
        if _request_is_alshival_agent() and _is_support_mailbox_email(recipient_email):
            raise ValueError("Support agent cannot target support@alshival.ai for forwarded emails.")
        recipients = [recipient_email]
    else:
        resolved = _resolve_email_recipient_by_username_sync(target_username)
        recipient_email = resolved["email"]
        recipient_username = resolved["username"]
        recipient_user_id = int(resolved["user_id"])
        if _request_is_alshival_agent() and _is_alshival_agent_username(recipient_username):
            raise ValueError("Support agent cannot target the support account for forwarded emails.")
        recipient_mode = "username"
        recipients = [recipient_email]

    mailbox_name = (mailbox or os.getenv("SUPPORT_EMAIL") or "support@alshival.ai").strip()
    if not mailbox_name:
        raise ValueError("mailbox is required.")

    token = _graph_token()
    _graph_forward_message(
        token=token,
        mailbox=mailbox_name,
        message_id=target_message_id,
        to_recipients=recipients,
        comment=str(comment or "").strip(),
    )

    dispatched = {
        "mode": recipient_mode,
        "email": recipient_email,
        "username": recipient_username,
        "user_id": recipient_user_id,
        "group": recipient_group_value or None,
        "status": "sent",
    }
    return {
        "mailbox": mailbox_name,
        "message_id": target_message_id,
        "comment": str(comment or "").strip(),
        "recipient": dispatched,
        "recipients": recipients,
        "status": "sent",
        "ts": datetime.utcnow().isoformat() + "Z",
    }


@mcp.tool()
def send_email(
    to: List[str],
    subject: str,
    body: str,
    from_mailbox: Optional[str] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
    reply_to: Optional[List[str]] = None,
    importance: str = "normal",
    content_type: str = "Text",
    use_brand_template: bool = True,
) -> Dict[str, Any]:
    """Send an email via Microsoft Graph.

    Access:
    - Internal-scope callers only (staff/internal automation).
    """

    if not _request_has_internal_access():
        raise PermissionError("Access denied for send_email.")

    recipients = _normalize_email_list(to)
    if not recipients:
        raise ValueError("At least one valid recipient is required.")
    if not subject or not subject.strip():
        raise ValueError("subject is required")
    if not body or not body.strip():
        raise ValueError("body is required")

    mailbox = (from_mailbox or os.getenv("SUPPORT_EMAIL") or "support@alshival.ai").strip()
    token = _graph_token()
    resolved_content_type = (content_type or "Text").strip()
    if resolved_content_type.lower() not in {"text", "html"}:
        raise ValueError("content_type must be 'Text' or 'HTML'.")
    if not use_brand_template:
        logger.info("Forcing branded template for MCP send_email.")

    send_body = _render_alshival_branded_email_html(subject.strip(), body)
    resolved_content_type = "HTML"

    _graph_send_mail(
        token=token,
        mailbox=mailbox,
        to_recipients=recipients,
        subject=subject.strip(),
        body=send_body,
        cc_recipients=cc,
        bcc_recipients=bcc,
        reply_to=reply_to,
        importance=importance,
        content_type=resolved_content_type,
    )

    return {
        "mailbox": mailbox,
        "recipients": recipients,
        "subject": subject.strip(),
        "content_type": "HTML" if resolved_content_type.lower() == "html" else "Text",
        "use_brand_template": True,
        "status": "sent",
        "ts": datetime.utcnow().isoformat() + "Z",
    }


# --------------------------------------------------------------------------- #
# FastAPI bridge with API-key enforcement
# --------------------------------------------------------------------------- #
mcp.settings.streamable_http_path = "/"
mcp_app = mcp.streamable_http_app()
app = FastAPI(lifespan=lambda app: mcp.session_manager.run())
app.mount("/mcp/", mcp_app)


@app.websocket("/twilio/voice-stream")
async def twilio_voice_stream(websocket: WebSocket):
    await websocket.accept()
    params = websocket.query_params
    mode = (params.get("mode") or "public").strip().lower()
    from_number = (params.get("from") or "").strip()
    to_number = (params.get("to") or "").strip()
    staff = {
        "name": (params.get("staff_name") or "").strip(),
        "email": (params.get("staff_email") or "").strip(),
        "phone": (params.get("staff_phone") or "").strip(),
    }
    logger.info(
        "Voice stream start: mode=%s from=%s to=%s staff_email=%s",
        mode,
        from_number or "unknown",
        to_number or "unknown",
        staff.get("email") or "unknown",
    )

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        await websocket.close(code=1011)
        return

    prompt = await asyncio.to_thread(
        _build_voice_prompt_with_history,
        "internal" if mode == "internal" else "public",
        staff or None,
        from_number,
        to_number,
    )
    realtime_model = os.getenv("TWILIO_VOICE_MODEL", "gpt-4o-realtime-preview-2024-12-17")
    realtime_voice = os.getenv("TWILIO_VOICE_NAME", "alloy")
    stream_sid = None

    openai_ws = await _connect_openai_realtime(api_key, realtime_model)

    vad_threshold = float(os.getenv("OPENAI_REALTIME_VAD_THRESHOLD", "0.6"))
    vad_prefix_ms = int(os.getenv("OPENAI_REALTIME_VAD_PREFIX_MS", "300"))
    vad_silence_ms = int(os.getenv("OPENAI_REALTIME_VAD_SILENCE_MS", "800"))

    session_update = {
        "type": "session.update",
        "session": {
            "instructions": prompt,
            "voice": realtime_voice,
            "input_audio_format": "g711_ulaw",
            "output_audio_format": "g711_ulaw",
            "turn_detection": {
                "type": "server_vad",
                "threshold": vad_threshold,
                "prefix_padding_ms": vad_prefix_ms,
                "silence_duration_ms": vad_silence_ms,
            },
            "input_audio_transcription": {"model": "gpt-4o-mini-transcribe"},
            "tools": _voice_tool_specs(),
            "tool_choice": "auto",
        },
    }
    await openai_ws.send(json.dumps(session_update))
    await openai_ws.send(
        json.dumps(
            {
                "type": "response.create",
                "response": {"instructions": "Start with a brief greeting and ask how you can help."},
            }
        )
    )

    call_args_buffer: Dict[str, str] = {}

    async def forward_twilio_to_openai():
        nonlocal stream_sid, mode, from_number, to_number, staff
        try:
            while True:
                payload = await websocket.receive_text()
                data = json.loads(payload)
                event = data.get("event")
                if event == "start":
                    start = data.get("start") or {}
                    stream_sid = start.get("streamSid")
                    custom_params = (start.get("customParameters") or {}) if isinstance(start, dict) else {}
                    logger.info(
                        "Voice stream start event: stream_sid=%s custom_params=%s",
                        stream_sid or "unknown",
                        custom_params or {},
                    )
                    if custom_params:
                        mode = (custom_params.get("mode") or mode).strip().lower()
                        from_number = (custom_params.get("from") or from_number).strip()
                        to_number = (custom_params.get("to") or to_number).strip()
                        staff = {
                            "name": (custom_params.get("staff_name") or staff.get("name") or "").strip(),
                            "email": (custom_params.get("staff_email") or staff.get("email") or "").strip(),
                            "phone": (custom_params.get("staff_phone") or staff.get("phone") or "").strip(),
                        }
                        updated_prompt = await asyncio.to_thread(
                            _build_voice_prompt_with_history,
                            "internal" if mode == "internal" else "public",
                            staff or None,
                            from_number,
                            to_number,
                        )
                        await openai_ws.send(
                            json.dumps(
                                {
                                    "type": "session.update",
                                    "session": {"instructions": updated_prompt},
                                }
                            )
                        )
                elif event == "media":
                    media = data.get("media") or {}
                    audio = media.get("payload")
                    if audio:
                        await openai_ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": audio}))
                elif event == "stop":
                    break
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("Twilio->OpenAI stream failure")
        finally:
            try:
                await openai_ws.close()
            except Exception:
                pass

    async def forward_openai_to_twilio():
        try:
            async for raw in openai_ws:
                data = json.loads(raw)
                event_type = data.get("type")
                if event_type == "response.audio.delta":
                    audio = data.get("delta") or data.get("audio")
                    if audio and stream_sid:
                        await websocket.send_text(
                            json.dumps(
                                {"event": "media", "streamSid": stream_sid, "media": {"payload": audio}}
                            )
                        )
                elif event_type == "response.function_call_arguments.delta":
                    call_id = data.get("call_id") or data.get("id")
                    delta = data.get("delta") or ""
                    if call_id:
                        call_args_buffer[call_id] = call_args_buffer.get(call_id, "") + delta
                elif event_type == "response.function_call_arguments.done":
                    call_id = data.get("call_id") or data.get("id")
                    name = data.get("name") or ""
                    arguments = data.get("arguments") or call_args_buffer.get(call_id, "")
                    logger.info("Voice tool call: name=%s args=%s", name, arguments)
                    try:
                        parsed_args = json.loads(arguments) if arguments else {}
                    except json.JSONDecodeError:
                        parsed_args = {}
                    result = await asyncio.to_thread(
                        _run_voice_tool,
                        name,
                        parsed_args,
                        mode="internal" if mode == "internal" else "public",
                        staff_email=(staff or {}).get("email") or "",
                    )
                    logger.info("Voice tool result: name=%s result=%s", name, result)
                    await openai_ws.send(
                        json.dumps(
                            {
                                "type": "conversation.item.create",
                                "item": {
                                    "type": "function_call_output",
                                    "call_id": call_id,
                                    "output": json.dumps(result),
                                },
                            }
                        )
                    )
                    await openai_ws.send(json.dumps({"type": "response.create"}))
                elif event_type in {"input_audio_transcription.completed", "input_audio_transcription.done"}:
                    transcript = data.get("transcript") or data.get("text") or ""
                    transcript = (transcript or "").strip()
                    if transcript:
                        await asyncio.to_thread(
                            _store_voice_message_sync,
                            mode="internal" if mode == "internal" else "public",
                            participant_number=from_number,
                            service_number=to_number,
                            direction="inbound",
                            body=transcript,
                        )
                elif event_type in {"response.audio_transcript.done", "response.text.done"}:
                    transcript = data.get("transcript") or data.get("text") or ""
                    transcript = (transcript or "").strip()
                    if transcript:
                        await asyncio.to_thread(
                            _store_voice_message_sync,
                            mode="internal" if mode == "internal" else "public",
                            participant_number=from_number,
                            service_number=to_number,
                            direction="outbound",
                            body=transcript,
                        )
        except Exception:
            logger.exception("OpenAI->Twilio stream failure")
        finally:
            try:
                await websocket.close()
            except Exception:
                pass

    await asyncio.gather(forward_twilio_to_openai(), forward_openai_to_twilio())


class ApiKeyASGIMiddleware:
    """Simple ASGI middleware to enforce API key on mounted ASGI apps (e.g., SSE)."""

    def __init__(self, inner_app):
        self.inner_app = inner_app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.inner_app(scope, receive, send)

        # Normalize headers to a dict for quick lookup
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers", [])}
        client_ip = None
        forwarded = headers.get("x-forwarded-for") or headers.get("x-real-ip")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()
        elif scope.get("client"):
            client_ip = scope["client"][0]
        token = _REQUEST_IP.set(client_ip)
        email_token = _REQUEST_USER_EMAIL.set(headers.get("x-user-email"))
        username_token = _REQUEST_USER_NAME.set(headers.get("x-user-username"))
        phone_token = _REQUEST_USER_PHONE.set(headers.get("x-user-phone"))
        auth_token = _REQUEST_AUTH_PAYLOAD.set(None)
        api_key = extract_api_key_from_headers(
            headers,
            api_key_header=API_KEY_HEADER,
            allow_bearer=True,
        )
        if not api_key:
            try:
                return await JSONResponse(
                    {"detail": f"Missing API key (expected {API_KEY_HEADER})"}, status_code=401
                )(scope, receive, send)
            finally:
                _REQUEST_IP.reset(token)
                _REQUEST_USER_EMAIL.reset(email_token)
                _REQUEST_USER_NAME.reset(username_token)
                _REQUEST_USER_PHONE.reset(phone_token)
                _REQUEST_AUTH_PAYLOAD.reset(auth_token)

        try:
            payload = await sync_to_async(_authorize_api_key, thread_sensitive=True)(
                api_key.strip(),
                user_email=headers.get("x-user-email"),
                username=headers.get("x-user-username"),
            )
            _REQUEST_AUTH_PAYLOAD.set(payload)
        except PermissionError as exc:
            try:
                return await JSONResponse({"detail": str(exc)}, status_code=401)(scope, receive, send)
            finally:
                _REQUEST_IP.reset(token)
                _REQUEST_USER_EMAIL.reset(email_token)
                _REQUEST_USER_NAME.reset(username_token)
                _REQUEST_USER_PHONE.reset(phone_token)
                _REQUEST_AUTH_PAYLOAD.reset(auth_token)

        try:
            return await self.inner_app(scope, receive, send)
        finally:
            _REQUEST_IP.reset(token)
            _REQUEST_USER_EMAIL.reset(email_token)
            _REQUEST_USER_NAME.reset(username_token)
            _REQUEST_USER_PHONE.reset(phone_token)
            _REQUEST_AUTH_PAYLOAD.reset(auth_token)


# Optional SSE endpoint for Realtime MCP (if supported by FastMCP)
if hasattr(mcp, "sse_app"):
    try:
        mcp.settings.sse_path = "/"
        mcp_sse_app = mcp.sse_app()
        app.mount("/mcp-sse/", ApiKeyASGIMiddleware(mcp_sse_app))
        logger.info("Mounted SSE MCP endpoint at /mcp-sse/")
    except Exception:  # pragma: no cover - SSE mount optional
        logger.exception("Failed to mount SSE MCP endpoint")


def _extract_api_key(request: Request) -> Optional[str]:
    header_map = {str(k): str(v) for k, v in request.headers.items()}
    api_key = extract_api_key_from_headers(
        header_map,
        api_key_header=API_KEY_HEADER,
        allow_bearer=True,
    )
    return api_key.strip() if api_key else None


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    path = request.url.path
    if path == "/health" or request.method == "OPTIONS":
        return await call_next(request)
    if path.startswith("/mcp-sse/"):
        return await call_next(request)
    if path.startswith("/twilio/voice-stream"):
        return await call_next(request)

    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else None
    token = _REQUEST_IP.set(client_ip)
    email_token = _REQUEST_USER_EMAIL.set(request.headers.get("x-user-email"))
    username_token = _REQUEST_USER_NAME.set(request.headers.get("x-user-username"))
    phone_token = _REQUEST_USER_PHONE.set(request.headers.get("x-user-phone"))
    auth_token = _REQUEST_AUTH_PAYLOAD.set(None)

    api_key = _extract_api_key(request)
    if not api_key:
        _REQUEST_IP.reset(token)
        _REQUEST_USER_EMAIL.reset(email_token)
        _REQUEST_USER_NAME.reset(username_token)
        _REQUEST_USER_PHONE.reset(phone_token)
        _REQUEST_AUTH_PAYLOAD.reset(auth_token)
        return JSONResponse(
            {"detail": f"Missing API key (expected {API_KEY_HEADER})"}, status_code=401
        )

    try:
        payload = await sync_to_async(_authorize_api_key, thread_sensitive=True)(
            api_key,
            user_email=request.headers.get("x-user-email"),
            username=request.headers.get("x-user-username"),
        )
    except PermissionError as exc:
        _REQUEST_IP.reset(token)
        _REQUEST_USER_EMAIL.reset(email_token)
        _REQUEST_USER_NAME.reset(username_token)
        _REQUEST_USER_PHONE.reset(phone_token)
        _REQUEST_AUTH_PAYLOAD.reset(auth_token)
        return JSONResponse({"detail": str(exc)}, status_code=401)

    _REQUEST_AUTH_PAYLOAD.set(payload)
    request.state.auth_payload = payload

    try:
        if path.startswith("/mcp/") and request.method.upper() == "POST":
            try:
                rpc = await request.json()
            except Exception:
                rpc = None
            if isinstance(rpc, dict):
                rpc_method = str(rpc.get("method") or "").strip()
                rpc_id = rpc.get("id")
                params = rpc.get("params") if isinstance(rpc.get("params"), dict) else {}
                if rpc_method == "tools/list":
                    tools = await mcp.list_tools()
                    serialized = [tool.model_dump() for tool in tools]
                    return JSONResponse(
                        {
                            "jsonrpc": "2.0",
                            "id": rpc_id,
                            "result": {"tools": _filter_tools_for_scope(serialized)},
                        }
                    )
                if rpc_method == "tools/call":
                    tool_name = _normalize_tool_name((params or {}).get("name"))
                    denial_reason = _tool_denial_reason(tool_name)
                    if denial_reason:
                        return _jsonrpc_error_response(
                            rpc_id,
                            -32603,
                            denial_reason,
                            status_code=403,
                        )
        return await call_next(request)
    finally:
        _REQUEST_IP.reset(token)
        _REQUEST_USER_EMAIL.reset(email_token)
        _REQUEST_USER_NAME.reset(username_token)
        _REQUEST_USER_PHONE.reset(phone_token)
        _REQUEST_AUTH_PAYLOAD.reset(auth_token)


@app.get("/health")
async def health() -> PlainTextResponse:
    return PlainTextResponse("ok")


@app.get("/list-tools")
async def list_tools() -> JSONResponse:
    tools = await mcp.list_tools()
    serialized = [tool.model_dump() for tool in tools]
    return JSONResponse({"tools": _filter_tools_for_scope(serialized)})


if __name__ == "__main__":  # pragma: no cover - manual launch helper
    import uvicorn

    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("PORT") or os.getenv("MCP_PORT") or "8080")
    logger.info("Starting MCP server on %s:%s", host, port)
    uvicorn.run(app, host=host, port=port)
