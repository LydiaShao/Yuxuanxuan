#!/usr/bin/env python3
"""Serve the job archive, and let an admin edit each page."""

import hashlib
import hmac
import json
import re
import secrets
import socket
import threading
import time
from html import escape, unescape
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = ROOT / "images" / "uploads"
DISPLAYS = UPLOADS / ".display"
DISPLAY_EDGE = 1920
EDGE_MIN = 80
EDGE_MAX = 8192
EDGE_STEP = 80
SITE_PATH = DATA / "site.json"
ADMIN_PATH = DATA / "admin.json"
SECRET_PATH = DATA / "secret.key"
SESSIONS_PATH = DATA / "sessions.json"

MAX_JSON = 1024 * 1024
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
SLUG = re.compile(r"^[a-z0-9-]{1,40}$")
UPLOAD_NAME = re.compile(r"^images/uploads/[A-Za-z0-9._-]{1,80}$")
BOUNDARY = re.compile(r"""boundary=(?:"([^"]+)"|([^;\s]+))""", re.IGNORECASE)
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
DEFAULT_JOB_COLORS = {
    "background": "#1e3a34",
    "bar": "#142826",
    "barText": "#f4faf7",
    "text": "#f4faf7",
    "muted": "#c5ddd4",
}
JOB_COLOR_KEYS = ("background", "bar", "barText", "text", "muted")
JOB_COLOR_LABELS = {
    "background": "页面背景",
    "bar": "顶栏",
    "barText": "顶栏文字",
    "text": "文字",
    "muted": "次要文字",
}
PANEL_BACKGROUND = "#f4efe6"
PANEL_TEXT = "#2a2420"
MAX_IMAGES = 40
MAX_BLOCKS = 16
MAX_SPRITES = 12
MAX_JOBS = 40

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


def clean_hex(value, label, fallback=None):
    text = str(value or "").strip()
    if HEX.match(text):
        return text.lower()
    if fallback is None:
        raise ValueError(f"{label}需要是 #RRGGBB")
    return fallback


def clean_color_map(source, keys, labels, defaults, legacy_key, legacy_value, strict):
    source = source if isinstance(source, dict) else {}
    if strict:
        return {key: clean_hex(source.get(key), labels[key]) for key in keys}
    cleaned = dict(defaults)
    for key in keys:
        text = str(source.get(key) or "").strip()
        if HEX.match(text):
            cleaned[key] = text.lower()
    legacy = str(legacy_value or "").strip()
    if legacy_key and HEX.match(legacy) and not HEX.match(str(source.get(legacy_key) or "").strip()):
        cleaned[legacy_key] = legacy.lower()
    return cleaned


def clean_job_colors(job, strict):
    source = job.get("colors") if isinstance(job.get("colors"), dict) else {}
    legacy = source.get("fade") or job.get("color") or ""
    colors = clean_color_map(source, JOB_COLOR_KEYS, JOB_COLOR_LABELS, DEFAULT_JOB_COLORS, "background", legacy, strict)
    return colors


def clean_align(value):
    side = str(value or "left").strip().lower()
    return side if side in ("left", "right") else "left"


def clean_rotate(value):
    try:
        number = int(value) % 360
    except (TypeError, ValueError):
        return 0
    if number in (0, 90, 180, 270):
        return number
    return min((0, 90, 180, 270), key=lambda item: min(abs(item - number), 360 - abs(item - number)))


def clean_percent(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 8.0
    return round(min(92.0, max(0.0, number)), 2)


def clean_blocks(job, strict):
    raw = job.get("blocks")
    if not isinstance(raw, list):
        raw = []
        if not strict:
            for paragraph in job.get("paragraphs") if isinstance(job.get("paragraphs"), list) else []:
                text = str(paragraph).strip()
                if text:
                    raw.append({"text": text, "background": PANEL_BACKGROUND, "color": PANEL_TEXT})
    if strict and len(raw) > MAX_BLOCKS:
        raise ValueError(f"每个职业最多 {MAX_BLOCKS} 个文字板块")
    blocks = []
    for item in raw[:MAX_BLOCKS]:
        if isinstance(item, str):
            item = {"text": item}
        if not isinstance(item, dict):
            if strict:
                raise ValueError("文字板块格式不对")
            continue
        text = str(item.get("text", "")).replace("\r\n", "\n").strip()[:2000]
        if not text and not strict:
            continue
        blocks.append({
            "text": text,
            "background": clean_hex(item.get("background"), "文字板块底色", PANEL_BACKGROUND if not strict else None),
            "color": clean_hex(item.get("color"), "文字板块文字", PANEL_TEXT if not strict else None),
        })
    return blocks


def clean_sprites(value, strict):
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        if strict:
            raise ValueError("小人格式不对")
        return []
    if strict and len(value) > MAX_SPRITES:
        raise ValueError(f"每个职业最多 {MAX_SPRITES} 个小人")
    sprites = []
    for item in value[:MAX_SPRITES]:
        if not isinstance(item, dict):
            if strict:
                raise ValueError("小人格式不对")
            continue
        src = clean_image(item.get("src"), strict)
        if not src:
            continue
        sprites.append({
            "src": src,
            "x": clean_percent(item.get("x")),
            "y": clean_percent(item.get("y")),
            "rotate": clean_rotate(item.get("rotate")),
        })
        size = clean_scale(item.get("size"))
        if size is not None:
            sprites[-1]["size"] = size
    return sprites


def clean_scale(value):
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    size = round(min(100.0, max(20.0, number)), 1)
    if size == 50:
        return None
    return size


def clean_ratio(value):
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return round(min(100.0, max(8.0, number)), 2)


def clean_images(value, strict):
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        if strict:
            raise ValueError("更多图片格式不对")
        return []
    if strict and len(value) > MAX_IMAGES:
        raise ValueError(f"每个职业最多 {MAX_IMAGES} 张更多图片")
    images = []
    for item in value[:MAX_IMAGES]:
        cleaned = clean_image(item, strict)
        if cleaned:
            images.append(cleaned)
    return images


class RichText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ("script", "style"):
            self.skip += 1
            return
        if self.skip:
            return
        if tag in ("b", "strong"):
            self.parts.append("<b>")
        elif tag in ("i", "em"):
            self.parts.append("<i>")
        elif tag == "br":
            self.parts.append("<br>")
        elif tag in ("p", "div", "li") and self.parts and self.parts[-1] != "<br>":
            self.parts.append("<br>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("script", "style"):
            if self.skip:
                self.skip -= 1
            return
        if self.skip:
            return
        if tag in ("b", "strong"):
            self.parts.append("</b>")
        elif tag in ("i", "em"):
            self.parts.append("</i>")

    def handle_data(self, data):
        if self.skip:
            return
        self.parts.append(escape(data, quote=False))


def clean_markup(value):
    parser = RichText()
    parser.feed(str(value or "")[:12000])
    parser.close()
    markup = "".join(parser.parts).strip()
    return markup[:8000]


def plain_from_markup(markup):
    text = re.sub(r"(?i)<br\s*/?>", "\n", markup)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text).strip()[:6000]


def text_item(text, markup, background, color, strict):
    cleaned = clean_markup(markup if markup else escape(text or "", quote=False).replace("\n", "<br>"))
    plain = plain_from_markup(cleaned) or str(text or "").strip()[:6000]
    if not plain and not cleaned:
        if strict:
            return {
                "type": "text",
                "text": "",
                "markup": "",
                "background": clean_hex(background, "文字板块底色", None) if strict else PANEL_BACKGROUND,
                "color": clean_hex(color, "文字板块文字", None) if strict else PANEL_TEXT,
            }
        return None
    return {
        "type": "text",
        "text": plain,
        "markup": cleaned or escape(plain, quote=False).replace("\n", "<br>"),
        "background": clean_hex(background, "文字板块底色", PANEL_BACKGROUND if not strict else None),
        "color": clean_hex(color, "文字板块文字", PANEL_TEXT if not strict else None),
    }


def parse_body(raw, strict):
    if strict and len(raw) > MAX_BLOCKS + MAX_IMAGES:
        raise ValueError("正文太长了")
    body = []
    texts = 0
    pictures = 0
    for item in raw:
        if not isinstance(item, dict):
            if strict:
                raise ValueError("正文格式不对")
            continue
        kind = str(item.get("type") or "").strip().lower()
        if kind == "image":
            src = clean_image(item.get("src"), strict)
            if not src:
                continue
            pictures += 1
            if pictures > MAX_IMAGES:
                if strict:
                    raise ValueError(f"每个职业最多 {MAX_IMAGES} 张更多图片")
                continue
            image = {"type": "image", "src": src}
            width = clean_ratio(item.get("w"))
            side = str(item.get("side") or "").strip().lower()
            if width is not None:
                image["w"] = width
            if side in ("left", "right"):
                image["side"] = side
            body.append(image)
            continue
        if kind not in ("text", ""):
            if strict:
                raise ValueError("正文格式不对")
            continue
        texts += 1
        if texts > MAX_BLOCKS:
            if strict:
                raise ValueError(f"每个职业最多 {MAX_BLOCKS} 个文字板块")
            continue
        block = text_item(item.get("text", ""), item.get("markup", ""), item.get("background"), item.get("color"), strict)
        if block:
            body.append(block)
    blocks = [
        {"text": item["text"], "background": item["background"], "color": item["color"]}
        for item in body
        if item["type"] == "text"
    ]
    images = [item["src"] for item in body if item["type"] == "image"]
    return body, blocks, images


def body_from_legacy(job, strict):
    blocks = clean_blocks(job, strict)
    images = clean_images(job.get("images"), strict)
    body = []
    for block in blocks:
        body.append({
            "type": "text",
            "text": block["text"],
            "markup": escape(block["text"], quote=False).replace("\n", "<br>"),
            "background": block["background"],
            "color": block["color"],
        })
    for src in images:
        body.append({"type": "image", "src": src})
    return body, blocks, images


def clean_job(job, strict=True):
    if not isinstance(job, dict):
        raise ValueError("职业格式不对")
    job_id = str(job.get("id", "")).strip().lower()
    name = str(job.get("name", "")).strip()
    if not SLUG.match(job_id):
        raise ValueError("职业 id 只能用英文小写、数字和连字符")
    if not name or len(name) > 40:
        raise ValueError("职业名称需要 1 到 40 个字符")
    colors = clean_job_colors(job, strict)
    if isinstance(job.get("body"), list):
        body, blocks, images = parse_body(job.get("body"), strict)
    else:
        body, blocks, images = body_from_legacy(job, strict)
    if not strict:
        theme = job.get("_theme") if isinstance(job.get("_theme"), dict) else {}
        source = job.get("colors") if isinstance(job.get("colors"), dict) else {}
        if not HEX.match(str(source.get("bar") or "").strip()):
            inherited = str(theme.get("background") or "").strip()
            if HEX.match(inherited) and inherited.lower() != colors["background"]:
                colors["bar"] = inherited.lower()
        if not HEX.match(str(source.get("barText") or "").strip()):
            inherited = str(theme.get("text") or "").strip()
            if HEX.match(inherited):
                colors["barText"] = inherited.lower()
    return {
        "id": job_id,
        "name": name,
        "align": clean_align(job.get("align")),
        "tagline": str(job.get("tagline", "")).strip()[:160],
        "colors": colors,
        "body": body,
        "blocks": blocks,
        "banner": clean_image(job.get("banner"), strict),
        "portrait": clean_image(job.get("portrait"), strict),
        "images": images,
        "sprites": clean_sprites(job.get("sprites"), strict),
    }


def unique_slug(name, taken):
    base = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")[:40] or "job"
    slug = base
    n = 2
    while slug in taken:
        suffix = f"-{n}"
        slug = f"{base[: max(1, 40 - len(suffix))]}{suffix}"
        n += 1
    return slug


def stamp_job_ids(jobs):
    taken = set()
    for job in jobs:
        job["id"] = unique_slug(job["name"], taken)
        taken.add(job["id"])
    return jobs


def validate_site(payload):
    if not isinstance(payload, dict):
        raise ValueError("档案格式不对")
    jobs_in = payload.get("jobs")
    if not isinstance(jobs_in, list):
        raise ValueError("缺少职业列表")
    if len(jobs_in) > MAX_JOBS:
        raise ValueError(f"最多 {MAX_JOBS} 个职业")
    jobs = []
    seen = set()
    for job in jobs_in:
        cleaned = clean_job(job)
        if cleaned["id"] in seen:
            raise ValueError(f"职业 id 重复：{cleaned['id']}")
        seen.add(cleaned["id"])
        jobs.append(cleaned)
    return {"jobs": stamp_job_ids(jobs)}


def public_site():
    raw = load_json(SITE_PATH, {"jobs": []})
    theme = raw.get("theme") if isinstance(raw, dict) and isinstance(raw.get("theme"), dict) else {}
    jobs = []
    seen = set()
    source = raw.get("jobs") if isinstance(raw, dict) and isinstance(raw.get("jobs"), list) else []
    for job in source:
        if isinstance(job, dict):
            job = {**job, "_theme": theme}
        try:
            cleaned = clean_job(job, strict=False)
        except ValueError:
            continue
        if cleaned["id"] in seen:
            continue
        seen.add(cleaned["id"])
        jobs.append(cleaned)
    return {"jobs": stamp_job_ids(jobs)}


def requested_edge(value):
    try:
        edge = int(str(value).strip() or DISPLAY_EDGE)
    except ValueError:
        edge = DISPLAY_EDGE
    edge = min(EDGE_MAX, max(EDGE_MIN, edge))
    return ((edge + EDGE_STEP - 1) // EDGE_STEP) * EDGE_STEP


def requested_quality(value):
    try:
        quality = int(str(value).strip() or 88)
    except ValueError:
        quality = 88
    return min(90, max(70, quality))


def soften_image(source, edge, quality):
    """A display copy. The uploaded file stays untouched, and nothing is upscaled."""
    try:
        from PIL import Image
    except ImportError:
        return source
    stamp = source.stat().st_mtime_ns
    with Image.open(source) as image:
        if getattr(image, "n_frames", 1) > 1:
            return source
        width, height = image.size
        if max(width, height) <= edge:
            return source
        has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        suffix = ".png" if has_alpha else ".jpg"
        target = DISPLAYS / f"{source.stem}-{stamp}-{edge}-q{quality}{suffix}"
        if target.is_file():
            return target
        DISPLAYS.mkdir(parents=True, exist_ok=True)
        frame = image.copy()
        frame.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        temporary = target.with_suffix(target.suffix + ".part")
        if has_alpha:
            frame.convert("RGBA").save(temporary, format="PNG", optimize=True)
        else:
            frame.convert("RGB").save(temporary, format="JPEG", quality=quality, optimize=True)
        temporary.replace(target)
        prefix = f"{source.stem}-{stamp}-"
        for stale in DISPLAYS.glob(f"{source.stem}-*"):
            if not stale.name.startswith(prefix):
                stale.unlink(missing_ok=True)
        return target


def still_frame(source, edge):
    try:
        from PIL import Image
    except ImportError:
        return source
    stamp = source.stat().st_mtime_ns
    target = DISPLAYS / f"{source.stem}-{stamp}-still-{edge}.png"
    if target.is_file():
        return target
    DISPLAYS.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        if not (getattr(image, "is_animated", False) and getattr(image, "n_frames", 1) > 1):
            return soften_image(source, edge, 74)
        image.seek(0)
        frame = image.convert("RGBA")
        frame.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        temporary = target.with_suffix(target.suffix + ".part")
        frame.save(temporary, format="PNG", optimize=True)
        temporary.replace(target)
    prefix = f"{source.stem}-{stamp}-still-"
    for stale in DISPLAYS.glob(f"{source.stem}-*-still-*.png"):
        if not stale.name.startswith(prefix):
            stale.unlink(missing_ok=True)
    return target


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


def boundary_token(content_type):
    match = BOUNDARY.search(content_type or "")
    if not match:
        return None
    token = (match.group(1) or match.group(2) or "").strip()
    if not token or len(token) > 70:
        return None
    if any(ord(char) < 32 or ord(char) > 126 for char in token):
        return None
    return token


class BudgetReader:
    def __init__(self, raw, remaining):
        self.raw = raw
        self.remaining = remaining

    def read(self, size):
        if self.remaining <= 0:
            return b""
        chunk = self.raw.read(min(size, self.remaining))
        if not chunk:
            return b""
        self.remaining -= len(chunk)
        return chunk

    def drain(self):
        while self.remaining > 0:
            if not self.read(256 * 1024):
                break


def read_until(reader, buf, marker, cap):
    while marker not in buf:
        if len(buf) > cap:
            raise ValueError("上传头太大")
        chunk = reader.read(8192)
        if not chunk:
            raise ValueError("上传不完整")
        buf += chunk
    index = buf.index(marker)
    return buf[index + len(marker) :]


def save_multipart_image(reader, boundary, dest):
    """Stream the first file part to dest without rewriting the bytes."""
    opener = b"--" + boundary.encode("latin-1")
    buf = read_until(reader, b"", opener + b"\r\n", 65536)
    buf = read_until(reader, buf, b"\r\n\r\n", 65536)
    closer = b"\r\n" + opener
    head = bytearray()
    with dest.open("wb") as handle:
        while True:
            found = buf.find(closer)
            if found >= 0:
                piece = buf[:found]
                if len(head) < 16:
                    head.extend(piece[: 16 - len(head)])
                handle.write(piece)
                break
            keep = len(closer) - 1
            if len(buf) > keep:
                piece = buf[:-keep]
                if len(head) < 16:
                    head.extend(piece[: 16 - len(head)])
                handle.write(piece)
                buf = buf[-keep:]
            if len(head) >= 16 and sniff_image(bytes(head)) is None:
                reader.drain()
                raise ValueError("只接受 JPG、PNG、WEBP 或 GIF")
            chunk = reader.read(256 * 1024)
            if not chunk:
                raise ValueError("上传不完整")
            buf += chunk
    reader.drain()
    return bytes(head)


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
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/site":
            self.send_json(200, public_site())
            return
        if path == "/api/display":
            self.handle_display(parsed.query)
            return
        if path == "/api/still":
            self.handle_still(parsed.query)
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

    def handle_display(self, query):
        params = parse_qs(query)
        src = (params.get("src") or [""])[0]
        edge = requested_edge((params.get("w") or [""])[0])
        quality = requested_quality((params.get("q") or [""])[0])
        try:
            cleaned = clean_image(src, strict=True)
        except ValueError:
            self.send_error(404)
            return
        source = ROOT / cleaned
        try:
            path = soften_image(source, edge, quality)
        except Exception:
            path = source
        blob = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(blob)

    def handle_still(self, query):
        params = parse_qs(query)
        src = (params.get("src") or [""])[0]
        try:
            cleaned = clean_image(src, strict=True)
        except ValueError:
            self.send_error(404)
            return
        source = ROOT / cleaned
        try:
            path = still_frame(source, requested_edge((params.get("w") or [""])[0]))
        except Exception:
            path = source
        blob = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(blob)

    def handle_upload(self):
        if not self.require_admin():
            return
        boundary = boundary_token(self.headers.get("Content-Type", ""))
        if boundary is None:
            self.send_json(400, {"error": "请用表单上传图片"})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_json(411, {"error": "缺少内容长度"})
            return
        if length < 0:
            self.send_json(400, {"error": "缺少内容长度"})
            return
        UPLOADS.mkdir(parents=True, exist_ok=True)
        temporary = UPLOADS / f".{secrets.token_hex(12)}.part"
        try:
            save_multipart_image(BudgetReader(self.rfile, length), boundary, temporary)
            with temporary.open("rb") as handle:
                extension = sniff_image(handle.read(16))
            if extension is None or temporary.stat().st_size == 0:
                raise ValueError("只接受 JPG、PNG、WEBP 或 GIF")
            name = f"{secrets.token_hex(12)}{extension}"
            temporary.replace(UPLOADS / name)
        except ValueError as error:
            temporary.unlink(missing_ok=True)
            self.send_json(400, {"error": str(error)})
            return
        except OSError:
            temporary.unlink(missing_ok=True)
            self.send_json(500, {"error": "图片没有保存成功"})
            return
        self.send_json(200, {"path": f"images/uploads/{name}"})


class IPv4Server(ThreadingHTTPServer):
    address_family = socket.AF_INET
    allow_reuse_address = True


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = True

    def server_bind(self):
        # Keep this socket off the IPv4 port so 0.0.0.0:4173 stays visible to port forwarding.
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    if not SITE_PATH.exists():
        atomic_write(SITE_PATH, {"jobs": []})
    for stale in UPLOADS.glob(".*.part"):
        stale.unlink(missing_ok=True)
    ipv4 = IPv4Server(("0.0.0.0", 4173), Handler)
    ipv6 = IPv6Server(("::", 4173), Handler)
    threading.Thread(target=ipv4.serve_forever, name="http-ipv4", daemon=True).start()
    print("Yuxuanxuan http://127.0.0.1:4173")
    ipv6.serve_forever()


if __name__ == "__main__":
    main()
