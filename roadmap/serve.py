#!/usr/bin/env python3
"""DeepSeek Harness 学习 Roadmap —— 本地服务。

零第三方依赖：仅使用 Python 标准库。启动后浏览器访问 http://127.0.0.1:5173。

提供的接口：
    GET  /api/manifest              章节清单
    GET  /api/chapter?id=&lang=     章节正文（Markdown 原文，前端渲染）
    GET  /api/quiz?id=              章节题目（不含参考答案要点）
    GET  /api/tree?path=            仓库目录列表（懒加载，单层）
    GET  /api/file?path=            仓库文件内容
    GET  /api/search?q=&regex=      全仓搜索（优先 ripgrep，回退纯 Python）
    GET  /api/symbol?name=          符号定义跳转
    GET  /api/progress              学习进度
    POST /api/progress              写入学习进度
    POST /api/judge                 调用 DeepSeek 判卷（题目源码上下文实时从仓库抽取）
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
REPO = PROJECT / "deepseek-harness"
CONTENT = HERE / "content"
STATIC = HERE / "static"
PROGRESS_FILE = HERE / "progress.json"

HOST = "127.0.0.1"
PORT = int(os.environ.get("ROADMAP_PORT", "5173"))

# 文件树与搜索都跳过这些目录：构建产物和依赖不是学习对象。
SKIP_DIRS = {
    ".git", "node_modules", "lib", "dist", "build", ".turbo", "coverage",
    "__pycache__", ".venv", ".pnpm-store", "tmp", ".vitest", ".idea", ".vscode",
}
# 搜索与符号索引只看这些扩展名。
CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md", ".py", ".rs", ".toml"}
MAX_FILE_BYTES = 2_000_000

_progress_lock = threading.Lock()


# ---------------------------------------------------------------- 环境变量

def load_env() -> dict[str, str]:
    """解析项目根目录的 .env（不依赖 python-dotenv）。"""
    env: dict[str, str] = {}
    path = PROJECT / ".env"
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        # 去掉可能存在的成对引号
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    return env


ENV = load_env()


# ---------------------------------------------------------------- 路径安全

def safe_repo_path(rel: str) -> Path | None:
    """把相对路径解析到仓库内，越界一律返回 None（防目录穿越）。"""
    rel = unquote(rel or "").strip().lstrip("/")
    candidate = (REPO / rel).resolve()
    try:
        candidate.relative_to(REPO.resolve())
    except ValueError:
        return None
    return candidate


def rel_to_repo(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


# ---------------------------------------------------------------- 文件树

def list_dir(rel: str) -> dict:
    base = safe_repo_path(rel) if rel else REPO
    if base is None or not base.is_dir():
        return {"error": "not a directory", "path": rel}
    dirs, files = [], []
    for entry in sorted(base.iterdir(), key=lambda p: p.name.lower()):
        if entry.name in SKIP_DIRS or entry.name.startswith(".") and entry.name not in {".env", ".agents"}:
            continue
        if entry.is_dir():
            dirs.append({"name": entry.name, "path": rel_to_repo(entry), "type": "dir"})
        elif entry.is_file():
            try:
                size = entry.stat().st_size
            except OSError:
                continue
            files.append({"name": entry.name, "path": rel_to_repo(entry), "type": "file", "size": size})
    return {"path": rel, "entries": dirs + files}


def read_file(rel: str) -> dict:
    path = safe_repo_path(rel)
    if path is None or not path.is_file():
        return {"error": "file not found", "path": rel}
    try:
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            return {"error": f"file too large ({size} bytes)", "path": rel}
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"error": str(exc), "path": rel}
    return {"path": rel_to_repo(path), "content": text, "lines": text.count("\n") + 1}


def extract_lines(rel: str, start: int | None, end: int | None) -> str:
    """抽取指定行区间，用于判题时拼装源码上下文。"""
    path = safe_repo_path(rel)
    if path is None or not path.is_file():
        return f"[缺失：{rel}]"
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        return f"[读取失败：{rel}：{exc}]"
    if start is None:
        body = lines
        first = 1
    else:
        first = max(1, start)
        last = min(len(lines), end or start)
        body = lines[first - 1:last]
    numbered = "\n".join(f"{first + i:>5} | {line}" for i, line in enumerate(body))
    return numbered


# ---------------------------------------------------------------- 搜索

def _iter_code_files():
    for root, dirnames, filenames in os.walk(REPO):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            if Path(name).suffix in CODE_EXT:
                yield Path(root) / name


def search_rg(query: str, is_regex: bool, limit: int) -> list[dict] | None:
    rg = shutil.which("rg")
    if not rg:
        return None
    cmd = [rg, "--json", "--max-count", "5", "--max-columns", "300"]
    if not is_regex:
        cmd.append("--fixed-strings")
    for skip in SKIP_DIRS:
        cmd += ["--glob", f"!{skip}/"]
    cmd += ["--", query, str(REPO)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (subprocess.SubprocessError, OSError):
        return None
    hits: list[dict] = []
    for line in out.stdout.splitlines():
        if len(hits) >= limit:
            break
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("type") != "match":
            continue
        data = rec["data"]
        try:
            path = Path(data["path"]["text"])
            hits.append({
                "path": rel_to_repo(path),
                "line": data["line_number"],
                "text": data["lines"]["text"].rstrip("\n")[:300],
            })
        except (KeyError, ValueError):
            continue
    return hits


def search_python(query: str, is_regex: bool, limit: int) -> list[dict]:
    try:
        pattern = re.compile(query if is_regex else re.escape(query))
    except re.error as exc:
        return [{"error": f"正则错误：{exc}"}]
    hits: list[dict] = []
    for path in _iter_code_files():
        if len(hits) >= limit:
            break
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if not pattern.search(text):
            continue
        for num, line in enumerate(text.splitlines(), 1):
            if pattern.search(line):
                hits.append({"path": rel_to_repo(path), "line": num, "text": line.rstrip()[:300]})
                if len(hits) >= limit:
                    break
    return hits


def do_search(query: str, is_regex: bool, limit: int = 200) -> dict:
    if not query.strip():
        return {"hits": [], "engine": "none"}
    started = time.time()
    hits = search_rg(query, is_regex, limit)
    engine = "ripgrep"
    if hits is None:
        hits = search_python(query, is_regex, limit)
        engine = "python"
    return {"hits": hits, "engine": engine, "ms": int((time.time() - started) * 1000)}


# ---------------------------------------------------------------- 符号索引

_symbol_index: dict[str, list[dict]] | None = None
_symbol_lock = threading.Lock()

# 覆盖 TS 里绝大多数顶层定义形态。
SYMBOL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?"
    r"(?P<kind>class|interface|type|enum|namespace|function|const|let|var)\s+"
    r"(?P<name>[A-Za-z_$][\w$]*)",
)
METHOD_RE = re.compile(r"^\s{2}(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|async\s+|get\s+|set\s+)*(?P<name>[A-Za-z_$][\w$]*)\s*[(<]")


def build_symbol_index() -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    for path in _iter_code_files():
        if path.suffix not in {".ts", ".tsx"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = rel_to_repo(path)
        for num, line in enumerate(text.splitlines(), 1):
            match = SYMBOL_RE.match(line)
            kind = None
            if match:
                name, kind = match.group("name"), match.group("kind")
            else:
                match = METHOD_RE.match(line)
                if not match or line.lstrip().startswith(("if", "for", "while", "switch", "catch", "return")):
                    continue
                name, kind = match.group("name"), "method"
            entry = {"path": rel, "line": num, "kind": kind, "text": line.strip()[:200]}
            index.setdefault(name, []).append(entry)
    return index


def get_symbol_index() -> dict[str, list[dict]]:
    global _symbol_index
    with _symbol_lock:
        if _symbol_index is None:
            _symbol_index = build_symbol_index()
        return _symbol_index


def lookup_symbol(name: str) -> dict:
    index = get_symbol_index()
    hits = index.get(name, [])
    # 定义形态优先于方法名，src/ 优先于 tests/
    def rank(hit: dict) -> tuple:
        kind_rank = 0 if hit["kind"] in {"class", "interface", "type", "enum", "function"} else 1
        src_rank = 0 if "/src/" in hit["path"] else 1
        return (kind_rank, src_rank, len(hit["path"]))
    return {"name": name, "hits": sorted(hits, key=rank)[:40], "total": len(hits)}


# ---------------------------------------------------------------- 内容

def load_manifest() -> dict:
    path = CONTENT / "manifest.json"
    if not path.exists():
        return {"chapters": []}
    return json.loads(path.read_text(encoding="utf-8"))


def load_chapter(chapter_id: str, lang: str) -> dict:
    lang = "en" if lang == "en" else "zh"
    path = CONTENT / f"{chapter_id}.{lang}.md"
    if not path.exists():
        fallback = CONTENT / f"{chapter_id}.zh.md"
        if not fallback.exists():
            return {"error": "chapter not found", "id": chapter_id}
        return {"id": chapter_id, "lang": "zh", "fallback": True, "markdown": fallback.read_text(encoding="utf-8")}
    return {"id": chapter_id, "lang": lang, "markdown": path.read_text(encoding="utf-8")}


def pick_lang(value, lang: str):
    """把题面里的 {"zh": …, "en": …} 双语字段按当前语言拍平；缺哪边就回退另一边。"""
    if isinstance(value, dict) and ("zh" in value or "en" in value):
        return value.get(lang) or value.get("zh") or value.get("en")
    if isinstance(value, list):
        return [pick_lang(item, lang) for item in value]
    return value


def load_quiz(chapter_id: str, lang: str = "zh") -> dict:
    lang = "en" if lang == "en" else "zh"
    path = CONTENT / f"{chapter_id}.quiz.json"
    if not path.exists():
        return {"id": chapter_id, "choice": [], "open": []}
    data = json.loads(path.read_text(encoding="utf-8"))

    choice = [{k: pick_lang(v, lang) for k, v in item.items()} for item in data.get("choice", [])]
    # 开放题的评分要点绝不下发给前端，否则等于把答案贴在页面上。
    public_open = [
        {k: pick_lang(v, lang) for k, v in item.items() if k not in {"rubric", "reference"}}
        for item in data.get("open", [])
    ]
    return {"id": chapter_id, "choice": choice, "open": public_open}


def load_quiz_raw(chapter_id: str) -> dict:
    path = CONTENT / f"{chapter_id}.quiz.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- 进度

def read_progress() -> dict:
    if not PROGRESS_FILE.exists():
        return {"chapters": {}, "answers": {}, "updatedAt": None}
    try:
        return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"chapters": {}, "answers": {}, "updatedAt": None}


def write_progress(patch: dict) -> dict:
    with _progress_lock:
        data = read_progress()
        for key in ("chapters", "answers"):
            if key in patch:
                data.setdefault(key, {}).update(patch[key])
        if "reset" in patch:
            data = {"chapters": {}, "answers": {}, "updatedAt": None}
        data["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        PROGRESS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return data


# ---------------------------------------------------------------- 判题

JUDGE_SYSTEM = """你是《DeepSeek Harness 源码精读》课程的助教，负责批改开放式问答。

批改原则：
1. 只依据下面给出的**源码上下文**判断对错。源码是唯一权威；学生答案与源码冲突就是错，哪怕听起来合理。
2. 严格但公正。学生用自己的话复述机制就算对，不要求术语逐字一致；但把机制说反、说漏关键因果、或用"大概/应该"糊弄的，要扣分。
3. 特别警惕**似是而非**：答案表面用对了术语，实际描述的机制是错的，这种要明确指出并重扣。
4. 空答、答非所问、或明显在复述题面而无实质内容，给 0 分。

必须只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码围栏：
{
  "score": 0-100 的整数,
  "verdict": "correct" | "partial" | "incorrect",
  "summary": "一句话总评",
  "points": [{"point": "评分要点原文", "got": true/false, "comment": "学生在这一点上的具体表现"}],
  "missed": ["学生完全没提到的关键点，逐条列出"],
  "corrections": ["学生说错的地方，逐条写成『你说了X，实际上是Y』"],
  "reference": "一段简明的参考答案，直接引用源码中的函数名/行为"
}
评分参考：全部要点命中 90-100；主干对但漏次要点 70-89；抓住部分但漏主干 40-69；主要机制说错 0-39。"""


def build_judge_prompt(question: dict, answer: str, chapter_title: str) -> str:
    blocks = []
    for ref in question.get("context", []):
        path = ref.get("path", "")
        start, end = ref.get("lineStart"), ref.get("lineEnd")
        note = ref.get("note", "")
        header = f"--- {path}"
        if start:
            header += f" 第 {start}-{end or start} 行"
        if note:
            header += f"（{note}）"
        blocks.append(header + " ---\n" + extract_lines(path, start, end))
    context = "\n\n".join(blocks) if blocks else "（本题未声明源码上下文）"

    rubric = question.get("rubric", [])
    rubric_text = "\n".join(f"{i}. {p}" for i, p in enumerate(rubric, 1)) or "（未提供，请依据源码自行判断）"
    reference = question.get("reference", "")

    return f"""# 章节
{chapter_title}

# 题目
{pick_lang(question.get('prompt', ''), 'zh')}

# 评分要点（学生看不到）
{rubric_text}

# 出题人给的参考答案（学生看不到）
{reference or '（未提供）'}

# 源码上下文（唯一权威依据，来自仓库实时抽取）
```ts
{context}
```

# 学生的回答
\"\"\"
{answer.strip() or '(空)'}
\"\"\"

请按 system 中约定的 JSON 格式批改。"""


def build_ssl_context() -> ssl.SSLContext:
    """python.org 版 Python 不读 macOS 钥匙串，默认 CA 包往往是空的。

    按优先级找一个真正装了根证书的来源，全都不行才退回默认（此时会报证书错误，
    但错误信息比静默失败有用）。
    """
    for cafile in (_certifi_path(), "/etc/ssl/cert.pem"):
        if not cafile or not os.path.exists(cafile):
            continue
        try:
            context = ssl.create_default_context(cafile=cafile)
            if context.get_ca_certs():
                return context
        except (ssl.SSLError, OSError):
            continue
    return ssl.create_default_context()


def _certifi_path() -> str | None:
    try:
        import certifi
    except ImportError:
        return None
    return certifi.where()


_SSL_CONTEXT = build_ssl_context()


def call_deepseek(system: str, user: str, timeout: int = 180) -> dict:
    api_key = ENV.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_API_KEY", "")
    base = (ENV.get("DEEPSEEK_BASE_URL_OPENAI") or "https://api.deepseek.com").rstrip("/")
    if not api_key:
        return {"error": "缺少 DEEPSEEK_API_KEY，请检查项目根目录的 .env"}
    payload = {
        "model": ENV.get("ROADMAP_MODEL", "deepseek-v4-flash"),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "reasoning_effort": "high",
        "thinking": {"type": "enabled"},
    }
    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=_SSL_CONTEXT) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        return {"error": f"DeepSeek 返回 {exc.code}：{detail}"}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"error": f"请求失败：{exc}"}
    except json.JSONDecodeError as exc:
        return {"error": f"响应不是合法 JSON：{exc}"}
    try:
        return {"content": body["choices"][0]["message"]["content"], "usage": body.get("usage")}
    except (KeyError, IndexError):
        return {"error": f"响应结构异常：{json.dumps(body)[:500]}"}


def parse_judge_json(text: str) -> dict | None:
    """模型偶尔会套 markdown 围栏或前后加话，尽力抠出 JSON 对象。"""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    else:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            text = text[start:end + 1]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def judge(body: dict) -> dict:
    chapter_id = body.get("chapterId", "")
    question_id = body.get("questionId", "")
    answer = body.get("answer", "")
    quiz = load_quiz_raw(chapter_id)
    question = next((q for q in quiz.get("open", []) if q.get("id") == question_id), None)
    if question is None:
        return {"error": f"题目不存在：{chapter_id}/{question_id}"}
    manifest = load_manifest()
    title = next((c.get("title", {}).get("zh", chapter_id) for c in manifest.get("chapters", []) if c.get("id") == chapter_id), chapter_id)

    result = call_deepseek(JUDGE_SYSTEM, build_judge_prompt(question, answer, title))
    if "error" in result:
        return result
    parsed = parse_judge_json(result["content"])
    if parsed is None:
        return {"error": "模型返回的内容无法解析为 JSON", "raw": result["content"][:2000]}
    parsed["usage"] = result.get("usage")
    return parsed


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "RoadmapServer/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: A002 - 覆盖父类噪声日志
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write(f"  {args[0]}\n")

    # -- 响应工具 --------------------------------------------------

    def send_json(self, data, status: int = 200):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def send_bytes(self, payload: bytes, content_type: str, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def serve_static(self, name: str):
        path = (STATIC / name).resolve()
        try:
            path.relative_to(STATIC.resolve())
        except ValueError:
            return self.send_json({"error": "forbidden"}, 403)
        if not path.is_file():
            return self.send_json({"error": "not found", "path": name}, 404)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in {"application/javascript", "application/json"}:
            ctype += "; charset=utf-8"
        self.send_bytes(path.read_bytes(), ctype)

    # -- 路由 ------------------------------------------------------

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler 约定
        parsed = urlparse(self.path)
        route = parsed.path
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        if route in ("/", "/index.html"):
            return self.serve_static("index.html")
        if route.startswith("/static/"):
            return self.serve_static(route[len("/static/"):])

        if route == "/api/manifest":
            return self.send_json(load_manifest())
        if route == "/api/chapter":
            return self.send_json(load_chapter(query.get("id", ""), query.get("lang", "zh")))
        if route == "/api/quiz":
            return self.send_json(load_quiz(query.get("id", ""), query.get("lang", "zh")))
        if route == "/api/tree":
            return self.send_json(list_dir(query.get("path", "")))
        if route == "/api/file":
            return self.send_json(read_file(query.get("path", "")))
        if route == "/api/search":
            return self.send_json(do_search(query.get("q", ""), query.get("regex") == "1", int(query.get("limit", "200"))))
        if route == "/api/symbol":
            return self.send_json(lookup_symbol(query.get("name", "")))
        if route == "/api/progress":
            return self.send_json(read_progress())
        return self.send_json({"error": "unknown route", "path": route}, 404)

    def do_POST(self):  # noqa: N802
        route = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_json({"error": f"请求体不是合法 JSON：{exc}"}, 400)

        if route == "/api/progress":
            return self.send_json(write_progress(body))
        if route == "/api/judge":
            return self.send_json(judge(body))
        return self.send_json({"error": "unknown route", "path": route}, 404)


def preheat_symbols():
    started = time.time()
    count = len(get_symbol_index())
    print(f"  符号索引就绪：{count} 个符号（{time.time() - started:.1f}s）")


def main():
    if not REPO.is_dir():
        sys.exit(f"找不到仓库目录：{REPO}")
    print("\n  DeepSeek Harness 学习 Roadmap")
    print(f"  仓库：{REPO}")
    print(f"  搜索引擎：{'ripgrep' if shutil.which('rg') else '纯 Python 回退（装 rg 会更快）'}")
    print(f"  API Key：{'已从 .env 载入' if ENV.get('DEEPSEEK_API_KEY') else '缺失，判题功能不可用'}")
    threading.Thread(target=preheat_symbols, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"\n  → http://{HOST}:{PORT}\n  Ctrl-C 停止\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止")
        server.server_close()


if __name__ == "__main__":
    main()
