"""Northstar Helpdesk demo UI.

Web chat for the IT Helpdesk agent with:
  - streamed agent turns (LLM round -> tool calls -> tool results -> answer)
  - a dashboard over the mock helpdesk data (services, devices, users, tickets, KB)
    where every direct action calls the same local tools the agent uses
  - a trace view of every turn and a log of every tool call
Transcripts are written in the same format as chat.py (plus timing and UI tool calls).

Run from starter_v0/:
    python ui/server.py --provider openai --model ag/gemini-3.6-flash-medium --version v0
Open http://127.0.0.1:8800
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import time
import uuid
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

UI_DIR = Path(__file__).resolve().parent
ROOT = UI_DIR.parent
STATIC_DIR = UI_DIR / "static"
sys.path.insert(0, str(ROOT))

from chat import (  # noqa: E402  (chat.py also loads .env)
    assistant_tool_message,
    execute_tool_call,
    now_iso,
    safe_slug,
    tool_results_message,
    trim_history,
    write_transcript,
)
from providers import make_provider  # noqa: E402
from providers.base import ToolCall  # noqa: E402
from tools import TOOL_FUNCTIONS, load_tool_declarations, to_openai_tools  # noqa: E402
from tools.policy.tool import POLICY_DIR, _parse_markdown_doc  # noqa: E402
from tools.search_kb.tool import KB_DIR, _load_doc  # noqa: E402
from versioning import artifact_version_dict, build_artifact_version  # noqa: E402

VERSIONS_DIR = ROOT / "artifacts" / "versions"
WORKING_VERSION = "working"  # startup artifacts when --version has no snapshot folder (e.g. a new v4)
DATA_DIR = ROOT / "helpdesk_data"
TICKET_DIR = ROOT / "tickets"
UI_TOOLS = set(TOOL_FUNCTIONS) - {"clarify"}  # tools the dashboard may call directly

CONFIG: dict[str, Any] = {}
PROVIDER: Any = None
SESSIONS: dict[str, dict[str, Any]] = {}
LOCK = threading.RLock()


# ------------------------------------------------------------------ helpers

def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_artifacts() -> dict[str, Any]:
    """Read prompt and tool declarations on every turn so artifact edits apply without restart."""
    prompt_path: Path = CONFIG["system_prompt"]
    tools_path: Path = CONFIG["tools"]
    declarations = load_tool_declarations(tools_path)
    version = build_artifact_version(CONFIG["version"], prompt_path, tools_path)
    return {
        "system_prompt": prompt_path.read_text(encoding="utf-8"),
        "declarations": declarations,
        "openai_tools": to_openai_tools(declarations),
        "version": version,
    }


def snapshot_versions() -> list[dict[str, Any]]:
    versions = []
    if VERSIONS_DIR.is_dir():
        for folder in sorted(VERSIONS_DIR.iterdir(), key=lambda p: p.name):
            prompt, tools = folder / "system_prompt.md", folder / "tools.yaml"
            if prompt.is_file() and tools.is_file():
                versions.append({"id": folder.name, "label": folder.name, "system_prompt": prompt, "tools": tools})
    return versions


def list_versions() -> list[dict[str, Any]]:
    """Snapshots in artifacts/versions/<vN>/. The startup artifacts are listed only when no snapshot has that label."""
    versions = snapshot_versions()
    startup = CONFIG["startup"]
    if not CONFIG["startup_is_snapshot"]:
        clash = any(v["id"] == startup["version"] for v in versions)
        label = f"{startup['version']} · custom" if clash else startup["version"]
        versions.append({"id": WORKING_VERSION, "label": label, "version": startup["version"],
                         "system_prompt": startup["system_prompt"], "tools": startup["tools"]})
    return versions


def switch_version(version_id: str) -> bool:
    target = next((v for v in list_versions() if v["id"] == version_id), None)
    if target is None:
        return False
    with LOCK:
        CONFIG.update({"version_id": target["id"], "version": target.get("version", target["id"]),
                       "system_prompt": target["system_prompt"], "tools": target["tools"]})
    return True


def info_payload() -> dict[str, Any]:
    artifacts = load_artifacts()
    return {
        "provider": CONFIG["provider"],
        "model": CONFIG["model"],
        "version": CONFIG["version"],
        "version_id": CONFIG["version_id"],
        "versions": [{"id": v["id"], "label": v["label"]} for v in list_versions()],
        "artifact_version": artifacts["version"].artifact_version,
        "history_window": CONFIG["history_window"],
        "max_tool_rounds": CONFIG["max_tool_rounds"],
        "tools": [{"name": d["name"], "description": d.get("description", ""),
                   "implemented": d["name"] in TOOL_FUNCTIONS} for d in artifacts["declarations"]],
    }


CALL_STATUSES = {"created", "needs_confirmation"}  # statuses that describe the call itself, not the data


def result_status(result: Any) -> str:
    if not isinstance(result, dict):
        return "ok"
    if result.get("error"):
        return "error"
    if result.get("awaiting_user"):
        return "awaiting_user"
    status = result.get("status")
    return status if status in CALL_STATUSES else "ok"


def list_tickets() -> list[dict[str, Any]]:
    if not TICKET_DIR.exists():
        return []
    tickets = []
    for path in TICKET_DIR.glob("*.json"):
        try:
            tickets.append(load_json(path))
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(tickets, key=lambda item: item.get("created_at", ""), reverse=True)


def dashboard_data() -> dict[str, Any]:
    kb = []
    for path in sorted(KB_DIR.glob("*.md")):
        meta, _ = _load_doc(path)
        kb.append({"article_id": meta.get("article_id") or path.stem, "title": meta.get("title") or path.stem,
                   "category": meta.get("category") or "general", "updated_at": str(meta.get("updated_at") or "")})
    policies = []
    for path in sorted(POLICY_DIR.glob("*.md")):
        meta, _ = _parse_markdown_doc(path)
        if not meta:
            continue
        policies.append({"doc_id": meta.get("doc_id") or path.stem, "title": meta.get("title") or path.stem,
                         "policy_area": meta.get("policy_area") or path.stem})
    return {
        "services": load_json(DATA_DIR / "service_status.json"),
        "assets": load_json(DATA_DIR / "assets.json"),
        "users": load_json(DATA_DIR / "users.json"),
        "tickets": list_tickets(),
        "kb": kb,
        "policies": policies,
    }


# ------------------------------------------------------------------ sessions & transcripts

def get_session(session_id: str) -> dict[str, Any]:
    with LOCK:
        session = SESSIONS.get(session_id)
        if session is None:
            stamp = datetime.now().strftime("%Y%m%dT%H%M%S%f")
            transcript_id = "_".join([safe_slug(CONFIG["version"]), safe_slug(CONFIG["provider"]), stamp, "ui"])
            session = {
                "id": session_id,
                "history": [],
                "turns": [],
                "ui_calls": [],
                "lock": threading.Lock(),
                "transcript_path": CONFIG["transcripts_dir"] / f"{transcript_id}.transcript.json",
                "transcript": {
                    "transcript_id": transcript_id,
                    **artifact_version_dict(load_artifacts()["version"]),
                    "provider": CONFIG["provider"],
                    "model": CONFIG["model"],
                    "system_prompt": str(CONFIG["system_prompt"]),
                    "tools": str(CONFIG["tools"]),
                    "history_window": CONFIG["history_window"],
                    "max_tool_rounds": CONFIG["max_tool_rounds"],
                    "interface": "ui/server.py",
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                    "turns": [],
                    "ui_tool_calls": [],
                },
            }
            SESSIONS[session_id] = session
        return session


def save_transcript(session: dict[str, Any], artifact_version: Any | None = None) -> None:
    transcript = session["transcript"]
    if artifact_version is not None:
        transcript.update(artifact_version_dict(artifact_version))
    transcript["turns"] = session["turns"]
    transcript["ui_tool_calls"] = session["ui_calls"]
    write_transcript(session["transcript_path"], transcript)


# ------------------------------------------------------------------ agent turn (mirrors chat.run_model_tool_loop)

def run_turn(session_id: str, user_text: str, send) -> None:
    session = get_session(session_id)
    with session["lock"]:
        artifacts = load_artifacts()
        version = artifacts["version"]
        t0 = time.perf_counter()
        ms = lambda: round((time.perf_counter() - t0) * 1000, 1)  # noqa: E731
        turn: dict[str, Any] = {
            "turn_id": uuid.uuid4().hex[:8],
            "turn_index": len(session["turns"]) + 1,
            "started_at": now_iso(),
            "user": user_text,
            "status": "started",
            "assistant_text": None,
            "artifact_version": version.artifact_version,
            "provider": CONFIG["provider"],
            "model": CONFIG["model"],
            "rounds": [],
            "tool_events": [],
            "timing": [],
        }
        send({"event": "turn_start", "turn_id": turn["turn_id"], "turn_index": turn["turn_index"], "user": user_text,
              "artifact_version": version.artifact_version, "t_ms": 0})

        messages = [
            {"role": "system", "content": artifacts["system_prompt"]},
            *trim_history(session["history"], CONFIG["history_window"]),
            {"role": "user", "content": user_text},
        ]
        working = list(messages)
        try:
            result = None
            for round_index in range(1, CONFIG["max_tool_rounds"] + 1):
                start = ms()
                send({"event": "llm_start", "round": round_index, "message_count": len(working), "t_ms": start})
                response = PROVIDER.complete(working, artifacts["openai_tools"], model=CONFIG["model_arg"], temperature=0.0)
                end = ms()
                calls: list[ToolCall] = response.tool_calls
                round_record: dict[str, Any] = {
                    "round": round_index,
                    "assistant_text": response.text,
                    "tool_calls": [{"name": c.name, "args": c.args} for c in calls],
                    "tool_results": [],
                }
                turn["rounds"].append(round_record)
                turn["timing"].append({"kind": "llm", "round": round_index, "start_ms": start, "end_ms": end})
                send({"event": "llm_end", "round": round_index, "assistant_text": response.text,
                      "tool_calls": round_record["tool_calls"], "start_ms": start, "t_ms": end})

                if not calls:
                    result = {"status": "answered", "assistant_text": response.text or ""}
                    break

                working.append(assistant_tool_message(response.text, calls))
                non_clarification: list[dict[str, Any]] = []
                waiting = None
                for index, call in enumerate(calls):
                    tool_start = ms()
                    send({"event": "tool_start", "round": round_index, "index": index, "tool": call.name,
                          "args": call.args, "t_ms": tool_start})
                    event = execute_tool_call(call)
                    tool_end = ms()
                    status = result_status(event.get("result"))
                    event_record = {**event, "status": status, "round": round_index, "duration_ms": round(tool_end - tool_start, 2)}
                    round_record["tool_results"].append(event_record)
                    turn["tool_events"].append(event_record)
                    turn["timing"].append({"kind": "tool", "round": round_index, "index": index, "tool": call.name,
                                           "start_ms": tool_start, "end_ms": tool_end})
                    send({"event": "tool_end", "round": round_index, "index": index, **event_record,
                          "start_ms": tool_start, "t_ms": tool_end})
                    res = event.get("result", {})
                    if isinstance(res, dict) and res.get("awaiting_user"):
                        waiting = {
                            "status": "waiting_for_user",
                            "assistant_text": res.get("question") or call.args.get("question") or "Bạn bổ sung thêm thông tin nhé.",
                            "clarify": {"response_type": res.get("response_type"), "options": res.get("options") or []},
                        }
                        break
                    non_clarification.append(event)
                if waiting:
                    result = waiting
                    break
                working.append(tool_results_message(non_clarification))
            if result is None:
                result = {"status": "max_tool_rounds",
                          "assistant_text": f"Stopped after {CONFIG['max_tool_rounds']} tool rounds. Inspect the transcript for details."}
            turn.update(result)
            session["history"].append({"role": "user", "content": user_text})
            session["history"].append({"role": "assistant", "content": result["assistant_text"]})
        except Exception as exc:  # provider errors are evidence, keep them visible
            turn.update({"status": "provider_error", "error": f"{type(exc).__name__}: {exc}"})

        turn["ended_at"] = now_iso()
        turn["total_ms"] = ms()
        session["turns"].append(turn)
        save_transcript(session, version)
        send({"event": "turn_end", "turn": turn, "transcript_path": str(session["transcript_path"])})


def run_ui_tool(session_id: str, tool: str, args: dict[str, Any]) -> dict[str, Any]:
    session = get_session(session_id)
    start = time.perf_counter()
    event = execute_tool_call(ToolCall(name=tool, args=args))
    record = {
        "call_id": uuid.uuid4().hex[:8],
        "source": "ui",
        "created_at": now_iso(),
        **event,
        "status": result_status(event.get("result")),
        "duration_ms": round((time.perf_counter() - start) * 1000, 2),
    }
    with session["lock"]:
        session["ui_calls"].append(record)
        save_transcript(session)
    return record


# ------------------------------------------------------------------ HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "NorthstarHelpdeskUI/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[{datetime.now():%H:%M:%S}] {fmt % args}\n")

    def _json(self, data: Any, status: HTTPStatus = HTTPStatus.OK, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def _static(self, rel: str) -> None:
        path = (STATIC_DIR / rel).resolve()
        if STATIC_DIR not in path.parents or not path.is_file():
            return self._json({"error": "not_found"}, HTTPStatus.NOT_FOUND)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        qs = parse_qs(url.query)
        if url.path in ("/", "/index.html"):
            return self._static("index.html")
        if url.path.startswith("/static/"):
            return self._static(url.path[len("/static/"):])
        if url.path == "/api/info":
            return self._json(info_payload())
        if url.path == "/api/data":
            return self._json(dashboard_data())
        if url.path == "/api/session":
            session = SESSIONS.get((qs.get("session_id") or [""])[0])
            if not session:
                return self._json({"turns": [], "ui_calls": [], "transcript_path": None})
            return self._json({"turns": session["turns"], "ui_calls": session["ui_calls"],
                               "transcript_path": str(session["transcript_path"])})
        if url.path == "/api/transcript":
            session = SESSIONS.get((qs.get("session_id") or [""])[0])
            if not session:
                return self._json({"error": "session_not_found"}, HTTPStatus.NOT_FOUND)
            name = session["transcript_path"].name
            return self._json(session["transcript"], headers={"Content-Disposition": f'attachment; filename="{name}"'})
        return self._json({"error": "not_found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self._body()
        except json.JSONDecodeError:
            return self._json({"error": "invalid_json"}, HTTPStatus.BAD_REQUEST)
        session_id = str(body.get("session_id") or uuid.uuid4().hex)

        if path == "/api/version":
            # Applies to new sessions; the UI opens a new session after switching.
            if not switch_version(str(body.get("version_id", ""))):
                return self._json({"error": "unknown_version"}, HTTPStatus.BAD_REQUEST)
            return self._json(info_payload())
        if path == "/api/chat":
            message = str(body.get("message", "")).strip()
            if not message:
                return self._json({"error": "empty_message"}, HTTPStatus.BAD_REQUEST)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            alive = {"ok": True}

            def send(event: dict[str, Any]) -> None:
                if not alive["ok"]:
                    return
                try:
                    self.wfile.write((json.dumps(event, ensure_ascii=False, default=str) + "\n").encode("utf-8"))
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    alive["ok"] = False  # tab closed: finish the turn and keep the transcript

            run_turn(session_id, message, send)
            self.close_connection = True
            return None
        if path == "/api/tool":
            tool = str(body.get("tool", ""))
            args = body.get("args") or {}
            if tool not in UI_TOOLS or not isinstance(args, dict):
                return self._json({"error": "tool_not_allowed", "tool": tool}, HTTPStatus.BAD_REQUEST)
            return self._json(run_ui_tool(session_id, tool, args))
        return self._json({"error": "not_found"}, HTTPStatus.NOT_FOUND)


def main() -> None:
    global PROVIDER
    parser = argparse.ArgumentParser(description="Web UI for the IT Helpdesk agent with tool trace.")
    parser.add_argument("--provider", choices=["openrouter", "openai", "anthropic", "gemini"], required=True)
    parser.add_argument("--model", default=None)
    parser.add_argument("--version", required=True, help="Artifact version label, e.g. v0, v3.")
    parser.add_argument("--system-prompt", type=Path, default=ROOT / "artifacts" / "system_prompt.md")
    parser.add_argument("--tools", type=Path, default=ROOT / "artifacts" / "tools.yaml")
    parser.add_argument("--transcripts-dir", type=Path, default=ROOT / "transcripts")
    parser.add_argument("--history-window", type=int, default=5)
    parser.add_argument("--max-tool-rounds", type=int, default=4)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8800)
    args = parser.parse_args()

    PROVIDER = make_provider(args.provider)
    CONFIG.update({
        "provider": args.provider,
        "model": args.model or getattr(PROVIDER, "default_model", None),
        "model_arg": args.model,
        "version": args.version,
        "version_id": WORKING_VERSION,
        "system_prompt": args.system_prompt.resolve(),
        "tools": args.tools.resolve(),
        "startup": {"version": args.version, "system_prompt": args.system_prompt.resolve(), "tools": args.tools.resolve()},
        "transcripts_dir": args.transcripts_dir.resolve(),
        "history_window": args.history_window,
        "max_tool_rounds": args.max_tool_rounds,
        "startup_is_snapshot": False,
    })
    # --version vN with the default artifact paths runs the saved snapshot artifacts/versions/vN/.
    default_paths = parser.get_default("system_prompt").resolve(), parser.get_default("tools").resolve()
    if (CONFIG["system_prompt"], CONFIG["tools"]) == default_paths and switch_version(args.version):
        CONFIG["startup_is_snapshot"] = True
    server =ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"Northstar Helpdesk UI  provider={args.provider} model={CONFIG['model']}")
    print(f"artifact_version={load_artifacts()['version'].artifact_version}")
    print(f"Transcripts: {CONFIG['transcripts_dir']}")
    print(f"Open http://{args.host}:{args.port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
