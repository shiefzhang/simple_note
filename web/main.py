from __future__ import annotations

import json
import ipaddress
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DAV_FILENAME = "simple-note-export.json"
ARCHIVE_SIGNATURE = "SIMPLE_NOTE_WEBDAV_V1"

app = FastAPI(title="纸间 · 简单笔记", version="2.0.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class WebDavCredentials(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    username: str = Field(default="", max_length=512)
    password: str = Field(default="", max_length=4096)

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith(("http://", "https://")):
            raise ValueError("WebDAV 地址必须以 http:// 或 https:// 开头")
        validate_public_webdav_url(value)
        return value


class WebDavSaveBody(WebDavCredentials):
    payload: dict[str, Any]


def dav_target(url: str) -> str:
    url = url.rstrip("/")
    if url.endswith(f"/{DAV_FILENAME}"):
        return url
    return f"{url}/{DAV_FILENAME}"


def validate_public_webdav_url(url: str) -> None:
    parsed = urlsplit(url)
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("WebDAV 地址格式无效")
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as exc:
        raise ValueError("无法解析 WebDAV 服务器地址") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("WebDAV 地址不能指向本机、内网或保留网络")


def empty_payload() -> dict[str, Any]:
    return {
        "signature": ARCHIVE_SIGNATURE,
        "version": 2,
        "exported_at": utc_now(),
        "notes": [],
        "categories": ["随笔", "待办", "阅读"],
    }


@app.get("/", response_class=HTMLResponse)
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(STATIC / "icons" / "favicon.ico")


@app.post("/api/webdav/load")
def load_webdav(body: WebDavCredentials) -> dict[str, Any]:
    """Read the note document without retaining credentials or data."""
    try:
        response = httpx.get(
            dav_target(body.url),
            auth=(body.username, body.password),
            timeout=30,
            follow_redirects=False,
        )
        if response.status_code == 404:
            return {"exists": False, "payload": empty_payload()}
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("WebDAV 文件不是有效的 JSON 对象")
        if not isinstance(payload.get("notes", []), list):
            raise ValueError("纸间数据文件中的 notes 格式无效")
        signature = payload.get("signature")
        legacy = signature is None
        if legacy:
            if payload.get("version") != 2 or not isinstance(payload.get("categories"), list):
                raise ValueError("文件特征码不匹配，这不是纸间的 WebDAV 数据文件")
        elif signature != ARCHIVE_SIGNATURE:
            raise ValueError("文件特征码不匹配，这不是纸间的 WebDAV 数据文件")
        payload.setdefault("version", 2)
        payload.setdefault("notes", [])
        payload.setdefault("categories", ["随笔", "待办", "阅读"])
        payload["signature"] = ARCHIVE_SIGNATURE
        return {"exists": True, "legacy": legacy, "payload": payload}
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status in {401, 403}:
            raise HTTPException(401, "WebDAV 用户名或密码不正确") from exc
        raise HTTPException(502, f"WebDAV 返回错误状态：{status}") from exc
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(502, f"无法读取 WebDAV：{exc}") from exc


@app.put("/api/webdav/save")
def save_webdav(body: WebDavSaveBody) -> dict[str, Any]:
    """Write the supplied document without retaining credentials or data."""
    payload = dict(body.payload)
    payload["signature"] = ARCHIVE_SIGNATURE
    payload["version"] = 2
    payload["exported_at"] = utc_now()
    payload.setdefault("notes", [])
    payload.setdefault("categories", ["随笔", "待办", "阅读"])
    try:
        response = httpx.put(
            dav_target(body.url),
            content=json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
            auth=(body.username, body.password),
            headers={"Content-Type": "application/json; charset=utf-8"},
            timeout=30,
            follow_redirects=False,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status in {401, 403}:
            raise HTTPException(401, "WebDAV 用户名或密码不正确") from exc
        raise HTTPException(502, f"WebDAV 返回错误状态：{status}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"无法写入 WebDAV：{exc}") from exc
    return {"ok": True, "count": len(payload["notes"]), "synced_at": payload["exported_at"]}
