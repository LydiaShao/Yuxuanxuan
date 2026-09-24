#!/usr/bin/env python3
"""Serve the job archive, and an admin for theme colors and image uploads."""

import hashlib
import hmac
import json
import re
import secrets
import time
from email import message_from_bytes
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = ROOT / "images" / "uploads"
SITE_PATH = DATA / "site.json"
ADMIN_PATH = DATA / "admin.json"
SECRET_PATH = DATA / "secret.key"
SESSIONS_PATH = DATA / "sessions.json"

MAX_UPLOAD = 12 * 1024 * 1024
MAX_JSON = 1024 * 1024
THEME_KEYS = ("background", "surface", "text", "muted", "accent", "frame")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
SLUG = re.compile(r"^[a-z0-9-]{1,40}$")
UPLOAD_NAME = re.compile(r"^images/uploads/[A-Za-z0-9._-]{1,80}$")
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
DEFAULT_THEME = {
    "background": "#12151c",
    "surface": "#1c2230",
    "text": "#f6f1e7",
    "muted": "#b3a89a",
    "accent": "#d4b46a",
    "frame": "#8a7044",
}

FAILURES = {}
SESSIONS = None


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def atomic_write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def sessions():
    global SESSIONS
    if SESSIONS is None:
        stored = load_json(SESSIONS_PATH, {"tokens": []})
        tokens = stored.get("tokens") if isinstance(stored, dict) else []
        SESSIONS = set(tokens) if isinstance(tokens, list) else set()
    return SESSIONS


def save_sessions():
    atomic_write(SESSIONS_PATH, {"tokens": list(sessions())[-24:]})


def needs_setup():
    stored = load_json(ADMIN_PATH, {})
    return not (isinstance(stored, dict) and isinstance(stored.get("passwordHash"), str) and stored["passwordHash"])


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def check_password(password, stored):
    try:
        scheme, salt_hex, digest_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return hmac.compare_digest(digest, expected)


def clean_image(value, strict=True):
    if not value:
        return ""
    text = str(value).strip()
    if not UPLOAD_NAME.match(text):
        if strict:
            raise ValueError("图片路径无效")
        return ""
    path = (ROOT / text).resolve()
    try:
        path.relative_to(UPLOADS.resolve())
    except ValueError as error:
        if strict:
            raise ValueError("图片路径无效") from error
        return ""
    if not path.is_file():
        if strict:
            raise ValueError("图片文件不存在")
        return ""
    return text


def clean_job(job, strict=True):
    if not isinstance(job, dict):
        raise ValueError("职业格式不对")
    job_id = str(job.get("id", "")).strip().lower()
    name = str(job.get("name", "")).strip()
    if not SLUG.match(job_id):
        raise ValueError("职业 id 只能用英文小写、数字和连字符")
    if not name or len(name) > 40:
        raise ValueError("职业名称需要 1 到 40 个字符")
    paragraphs = job.get("paragraphs") if isinstance(job.get("paragraphs"), list) else []
    text = [str(item).strip() for item in paragraphs if str(item).strip()][:12]
    return {
        "id": job_id,
        "name": name,
        "tagline": str(job.get("tagline", "")).strip()[:160],
        "paragraphs": [item[:2000] for item in text],
        "banner": clean_image(job.get("banner"), strict),
        "portrait": clean_image(job.get("portrait"), strict),
    }


def validate_site(payload):
    if not isinstance(payload, dict):
        raise ValueError("档案格式不对")
    incoming = payload.get("theme")
    if not isinstance(incoming, dict):
        raise ValueError("缺少主题色")
    theme = {}
    for key in THEME_KEYS:
        value = str(incoming.get(key, "")).strip()
        if not HEX.match(value):
            raise ValueError(f"{key} 需要是 #RRGGBB")
        theme[key] = value.lower()
    jobs_in = payload.get("jobs")
    if not isinstance(jobs_in, list):
        raise ValueError("缺少职业列表")
    if len(jobs_in) > 24:
        raise ValueError("最多 24 个职业")
    jobs = []
    seen = set()
    for job in jobs_in:
        cleaned = clean_job(job)
        if cleaned["id"] in seen:
            raise ValueError(f"职业 id 重复：{cleaned['id']}")
        seen.add(cleaned["id"])
        jobs.append(cleaned)
    return {"theme": theme, "jobs": jobs}


def public_site():
    raw = load_json(SITE_PATH, {"theme": DEFAULT_THEME, "jobs": []})
    theme = dict(DEFAULT_THEME)
    incoming = raw.get("theme") if isinstance(raw, dict) else {}
    if isinstance(incoming, dict):
        for key in THEME_KEYS:
            value = incoming.get(key)
            if isinstance(value, str) and HEX.match(value):
                theme[key] = value.lower()
    jobs = []
    seen = set()
    source = raw.get("jobs") if isinstance(raw, dict) and isinstance(raw.get("jobs"), list) else []
    for job in source:
        try:
            cleaned = clean_job(job, strict=False)
        except ValueError:
            continue
        if cleaned["id"] in seen:
            continue
        seen.add(cleaned["id"])
        jobs.append(cleaned)
    return {"theme": theme, "jobs": jobs}


def sniff_image(blob):
    if blob.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if blob.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if len(blob) > 12 and blob.startswith(b"RIFF") and blob[8:12] == b"WEBP":
        return ".webp"
    return None


def parse_multipart(content_type, body):
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
    message = message_from_bytes(header + body, policy=HTTP)
    if not message.is_multipart():
        return []
    parts = []
    for part in message.iter_parts():
        payload = part.get_payload(decode=True) or b""
        parts.append((part.get_filename(), payload))
    return parts


def static_file(url_path):
    rel = unquote(url_path.split("?", 1)[0]).lstrip("/")
    if rel in ("", "index.html"):
        candidate = ROOT / "index.html"
    elif rel in ("admin", "admin/"):
        candidate = ROOT / "admin.html"
    elif rel == "favicon.svg" or rel.startswith(("css/", "js/", "images/")):
        candidate = (ROOT / rel).resolve()
    else:
        return None
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    return None


def cookies_from(header):
    found = {}
    for bit in (header or "").split(";"):
        if "=" not in bit:
            continue
        key, value = bit.strip().split("=", 1)
        found[key] = value
    return found


def locked(ip):
    count, until = FAILURES.get(ip, (0, 0))
    if until and until > time.time():
        return True
    if until and until <= time.time():
        FAILURES[ip] = (0, 0)
    return False


def note_failure(ip):
    count, _until = FAILURES.get(ip, (0, 0))
    count += 1
    FAILURES[ip] = (count, time.time() + 60 if count >= 8 else 0)


def note_success(ip):
    FAILURES.pop(ip, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "Yuxuanxuan/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def client_ip(self):
        return self.client_address[0]

    def send_json(self, code, payload, headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length < 0 or length > limit:
            return None
        return self.rfile.read(length)

    def same_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return False
        return urlparse(origin).netloc == self.headers.get("Host")

    def require_admin(self):
        if self.headers.get("X-Admin") != "1" or not self.same_origin():
            self.send_json(403, {"error": "请求被拒绝"})
            return False
        token = cookies_from(self.headers.get("Cookie")).get("yx_session", "")
        if token not in sessions():
            self.send_json(401, {"error": "请先登录"})
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/site":
            self.send_json(200, public_site())
            return
        if path == "/api/session":
            self.send_json(200, {"needsSetup": needs_setup(), "authenticated": self.is_authenticated()})
            return
        file_path = static_file(path)
        if file_path is None:
            self.send_error(404)
            return
        blob = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(file_path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(blob)

    def is_authenticated(self):
        token = cookies_from(self.headers.get("Cookie")).get("yx_session", "")
        return token in sessions()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/upload":
            self.handle_upload()
            return
        body = self.read_body(MAX_JSON)
        if body is None:
            self.send_json(413, {"error": "请求太大"})
            return
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "请求不是 JSON"})
            return
        if path == "/api/setup":
            self.handle_setup(payload)
            return
        if path == "/api/login":
            self.handle_login(payload)
            return
        if path == "/api/logout":
            self.handle_logout()
            return
        self.send_json(404, {"error": "没有这个接口"})

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/site":
            self.send_json(404, {"error": "没有这个接口"})
            return
        if not self.require_admin():
            return
        body = self.read_body(MAX_JSON)
        if body is None:
            self.send_json(413, {"error": "请求太大"})
            return
        try:
            payload = json.loads(body.decode("utf-8"))
            site = validate_site(payload)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "请求不是 JSON"})
            return
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        atomic_write(SITE_PATH, site)
        self.send_json(200, site)

    def handle_setup(self, payload):
        if not self.same_origin() or self.headers.get("X-Admin") != "1":
            self.send_json(403, {"error": "请求被拒绝"})
            return
        if not needs_setup():
            self.send_json(409, {"error": "管理员密码已经设置"})
            return
        password = str(payload.get("password", ""))
        if len(password) < 8 or len(password) > 128:
            self.send_json(400, {"error": "密码需要 8 到 128 位"})
            return
        atomic_write(ADMIN_PATH, {"passwordHash": hash_password(password)})
        self.send_json(200, {"ok": True}, {"Set-Cookie": self.session_cookie()})

    def handle_login(self, payload):
        if not self.same_origin() or self.headers.get("X-Admin") != "1":
            self.send_json(403, {"error": "请求被拒绝"})
            return
        ip = self.client_ip()
        if locked(ip):
            self.send_json(429, {"error": "尝试太多，请稍后再来"})
            return
        if needs_setup():
            self.send_json(409, {"error": "请先设置管理员密码"})
            return
        stored = load_json(ADMIN_PATH, {})
        password = str(payload.get("password", ""))
        if not check_password(password, stored.get("passwordHash", "")):
            note_failure(ip)
            self.send_json(401, {"error": "密码不对"})
            return
        note_success(ip)
        self.send_json(200, {"ok": True}, {"Set-Cookie": self.session_cookie()})

    def handle_logout(self):
        token = cookies_from(self.headers.get("Cookie")).get("yx_session", "")
        if token in sessions():
            sessions().discard(token)
            save_sessions()
        self.send_json(200, {"ok": True}, {"Set-Cookie": "yx_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})

    def session_cookie(self):
        token = secrets.token_urlsafe(32)
        sessions().add(token)
        save_sessions()
        return f"yx_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600"

    def handle_upload(self):
        if not self.require_admin():
            return
        body = self.read_body(MAX_UPLOAD)
        if body is None:
            self.send_json(413, {"error": "图片需要小于 12MB"})
            return
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.send_json(400, {"error": "请用表单上传图片"})
            return
        parts = parse_multipart(content_type, body)
        blob = next((payload for _name, payload in parts if payload), b"")
        extension = sniff_image(blob)
        if extension is None:
            self.send_json(400, {"error": "只接受 JPG、PNG、WEBP 或 GIF"})
            return
        UPLOADS.mkdir(parents=True, exist_ok=True)
        name = f"{secrets.token_hex(12)}{extension}"
        (UPLOADS / name).write_bytes(blob)
        self.send_json(200, {"path": f"images/uploads/{name}"})


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    if not SITE_PATH.exists():
        atomic_write(SITE_PATH, {"theme": DEFAULT_THEME, "jobs": []})
    server = ThreadingHTTPServer(("0.0.0.0", 4173), Handler)
    print("Yuxuanxuan http://127.0.0.1:4173")
    server.serve_forever()


if __name__ == "__main__":
    main()
