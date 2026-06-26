from __future__ import annotations

import json
import ipaddress
import socket
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DAV_FILENAME = "simple-note-export.json"
ARCHIVE_SIGNATURE = "SIMPLE_NOTE_WEBDAV_V1"
NOTE_FILE_SUFFIX = ".json"
IMAGE_DIR = "images"
IMAGE_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}

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
    return f"{dav_base(url)}/{DAV_FILENAME}"


def dav_base(url: str) -> str:
    url = url.rstrip("/")
    if url.endswith(f"/{DAV_FILENAME}"):
        return url[: -(len(DAV_FILENAME) + 1)]
    return url


def dav_note_target(url: str, note_id: str) -> str:
    safe_name = quote(f"{note_id}{NOTE_FILE_SUFFIX}", safe="")
    return f"{dav_base(url)}/{safe_name}"


def dav_image_target(url: str, filename: str) -> str:
    safe_name = quote(normalize_image_filename(filename), safe="")
    return f"{dav_base(url)}/{IMAGE_DIR}/{safe_name}"


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


def normalize_note_id(value: Any) -> str:
    note_id = str(value or "").strip()
    if not note_id:
        raise ValueError("笔记 ID 不能为空")
    if "/" in note_id or "\\" in note_id or note_id in {".", ".."}:
        raise ValueError(f"笔记 ID 不适合作为文件名：{note_id}")
    return note_id


def normalize_image_filename(value: Any) -> str:
    filename = str(value or "").strip()
    if not filename:
        raise ValueError("图片文件名不能为空")
    if "/" in filename or "\\" in filename or filename in {".", ".."}:
        raise ValueError(f"图片文件名无效：{filename}")
    suffix = Path(filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        raise ValueError(f"不支持的图片格式：{suffix or filename}")
    return filename


def image_extension(content_type: str, original_name: str) -> str:
    media_type = content_type.split(";")[0].strip().lower()
    suffix = Path(original_name).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    if media_type in IMAGE_EXTENSIONS:
        return IMAGE_EXTENSIONS[media_type]
    raise ValueError("只支持 png、jpg、gif、webp、svg 图片")


def credentials_from_cookies(request: Request) -> WebDavCredentials:
    return WebDavCredentials(
        url=request.cookies.get("simple_note_dav_url", ""),
        username=request.cookies.get("simple_note_dav_user", ""),
        password=request.cookies.get("simple_note_dav_password", ""),
    )


def note_ids_from_payload(payload: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for note in payload.get("notes", []):
        note_id = normalize_note_id(note.get("id") if isinstance(note, dict) else note)
        if note_id not in ids:
            ids.append(note_id)
    return ids


def webdav_get_json(url: str, body: WebDavCredentials) -> tuple[int, dict[str, Any] | None]:
    response = httpx.get(
        url,
        auth=(body.username, body.password),
        timeout=30,
        follow_redirects=False,
    )
    if response.status_code == 404:
        return 404, None
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("WebDAV 文件不是有效的 JSON 对象")
    return response.status_code, payload


def read_note_files(body: WebDavCredentials, note_ids: list[str]) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    for note_id in note_ids:
        _, note = webdav_get_json(dav_note_target(body.url, note_id), body)
        if note is None:
            raise ValueError(f"笔记文件不存在：{note_id}{NOTE_FILE_SUFFIX}")
        note["id"] = normalize_note_id(note.get("id", note_id))
        note["title"] = str(note.get("title") or "")
        note["content"] = str(note.get("content") or "")
        note["format"] = "html" if note.get("format") == "html" else "markdown"
        note["category"] = str(note.get("category") or "随笔")
        note["created_at"] = str(note.get("created_at") or note.get("updated_at") or utc_now())
        note["updated_at"] = str(note.get("updated_at") or note.get("created_at") or utc_now())
        note["deleted"] = bool(note.get("deleted"))
        notes.append(note)
    return notes


def split_index_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "signature": ARCHIVE_SIGNATURE,
        "version": 3,
        "exported_at": payload["exported_at"],
        "notes": note_ids_from_payload(payload),
        "categories": payload.get("categories") or ["随笔", "待办", "阅读"],
    }


def write_json(url: str, body: WebDavCredentials, payload: dict[str, Any]) -> None:
    response = httpx.put(
        url,
        content=json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
        auth=(body.username, body.password),
        headers={"Content-Type": "application/json; charset=utf-8"},
        timeout=30,
        follow_redirects=False,
    )
    response.raise_for_status()


def delete_json(url: str, body: WebDavCredentials) -> None:
    response = httpx.request(
        "DELETE",
        url,
        auth=(body.username, body.password),
        timeout=30,
        follow_redirects=False,
    )
    if response.status_code != 404:
        response.raise_for_status()


def write_binary(url: str, body: WebDavCredentials, content: bytes, content_type: str) -> None:
    response = httpx.put(
        url,
        content=content,
        auth=(body.username, body.password),
        headers={"Content-Type": content_type},
        timeout=30,
        follow_redirects=False,
    )
    response.raise_for_status()


def ensure_image_dir(body: WebDavCredentials) -> None:
    response = httpx.request(
        "MKCOL",
        f"{dav_base(body.url)}/{IMAGE_DIR}",
        auth=(body.username, body.password),
        timeout=30,
        follow_redirects=False,
    )
    if response.status_code not in {201, 405}:
        response.raise_for_status()


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
        _, payload = webdav_get_json(dav_target(body.url), body)
        if payload is None:
            return {"exists": False, "payload": empty_payload()}

        if not isinstance(payload.get("notes", []), list):
            raise ValueError("纸间数据文件中的 notes 格式无效")
        signature = payload.get("signature")
        legacy = signature is None
        if legacy:
            if payload.get("version") not in {1, 2} or not isinstance(payload.get("categories"), list):
                raise ValueError("文件特征码不匹配，这不是纸间的 WebDAV 数据文件")
        elif signature != ARCHIVE_SIGNATURE:
            raise ValueError("文件特征码不匹配，这不是纸间的 WebDAV 数据文件")

        raw_notes = payload.get("notes", [])
        split_files = all(not isinstance(item, dict) for item in raw_notes)
        if split_files:
            payload["notes"] = read_note_files(body, [normalize_note_id(item) for item in raw_notes])
        else:
            legacy = True

        payload.setdefault("version", 3 if split_files else 2)
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
    payload["version"] = 3
    payload["exported_at"] = utc_now()
    payload.setdefault("notes", [])
    payload.setdefault("categories", ["随笔", "待办", "阅读"])
    try:
        old_ids: set[str] = set()
        try:
            _, existing = webdav_get_json(dav_target(body.url), body)
            if existing and isinstance(existing.get("notes"), list):
                old_ids = {
                    normalize_note_id(item)
                    for item in existing["notes"]
                    if not isinstance(item, dict)
                }
        except (httpx.HTTPStatusError, ValueError, json.JSONDecodeError):
            old_ids = set()

        notes = [note for note in payload["notes"] if isinstance(note, dict)]
        new_ids = {normalize_note_id(note.get("id")) for note in notes}
        for note in notes:
            note_id = normalize_note_id(note.get("id"))
            note["id"] = note_id
            write_json(dav_note_target(body.url, note_id), body, note)
        for stale_id in old_ids - new_ids:
            delete_json(dav_note_target(body.url, stale_id), body)
        write_json(dav_target(body.url), body, split_index_payload(payload))
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status in {401, 403}:
            raise HTTPException(401, "WebDAV 用户名或密码不正确") from exc
        raise HTTPException(502, f"WebDAV 返回错误状态：{status}") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, f"无法写入 WebDAV：{exc}") from exc
    return {"ok": True, "count": len(payload["notes"]), "synced_at": payload["exported_at"]}


@app.put("/api/webdav/images")
async def upload_webdav_image(
    request: Request,
    x_file_name: str = Header(default="", alias="X-File-Name"),
) -> dict[str, str]:
    content = await request.body()
    if not content:
        raise HTTPException(400, "图片内容为空")
    content_type = request.headers.get("content-type", "application/octet-stream")
    try:
        credentials = credentials_from_cookies(request)
        filename = f"{uuid.uuid4()}{image_extension(content_type, x_file_name)}"
        ensure_image_dir(credentials)
        write_binary(dav_image_target(credentials.url, filename), credentials, content, content_type)
        return {"path": f"{IMAGE_DIR}/{filename}", "filename": filename}
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status in {401, 403}:
            raise HTTPException(401, "WebDAV 用户名或密码不正确") from exc
        if status in {404, 405, 409}:
            raise HTTPException(502, "WebDAV 不允许写入 images 目录，请先在 WebDAV 根目录创建 images 文件夹") from exc
        raise HTTPException(502, f"WebDAV 返回错误状态：{status}") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, f"无法上传图片：{exc}") from exc


@app.get("/api/webdav/images/{filename}")
def load_webdav_image(filename: str, request: Request) -> Response:
    try:
        credentials = credentials_from_cookies(request)
        response = httpx.get(
            dav_image_target(credentials.url, filename),
            auth=(credentials.username, credentials.password),
            timeout=30,
            follow_redirects=False,
        )
        response.raise_for_status()
        return Response(
            content=response.content,
            media_type=response.headers.get("content-type", "application/octet-stream"),
            headers={"Cache-Control": "private, max-age=3600"},
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 404:
            raise HTTPException(404, "图片不存在") from exc
        if status in {401, 403}:
            raise HTTPException(401, "WebDAV 用户名或密码不正确") from exc
        raise HTTPException(502, f"WebDAV 返回错误状态：{status}") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, f"无法读取图片：{exc}") from exc
