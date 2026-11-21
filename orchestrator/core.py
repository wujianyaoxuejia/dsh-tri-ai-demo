"""courier 内核：任务状态、信箱、agent 适配器、策略与循环。

零第三方依赖（仅 Python 3.11 标准库）。所有对磁盘的写入都是原子的：
先写 <name>.tmp 再 os.replace，避免崩溃时留下半截 JSON。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------- 状态定义

QUEUED = "queued"
WORKING = "working"
REVIEWING = "reviewing"
AWAITING_APPROVAL = "awaiting_approval"
BLOCKED_HUMAN = "blocked_human"
BLOCKED_BUDGET = "blocked_budget"
INTERRUPTED = "interrupted"
DONE = "done"

TERMINAL = {DONE, BLOCKED_HUMAN, BLOCKED_BUDGET}
# 进程死掉时这些状态说明「当时正在干活」，启动扫描要改判成 interrupted
IN_FLIGHT = {WORKING, REVIEWING}

MESSAGE_KINDS = {"task", "result", "review", "question", "answer",
                 "approval", "system"}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- 原子 IO


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


# ---------------------------------------------------------------- 任务


@dataclass
class Task:
    """一个任务 = runs/<id>/ 目录 + state.json。"""

    root: Path              # runs/<id>
    state: dict

    @property
    def id(self) -> str:
        return self.state["id"]

    @property
    def status(self) -> str:
        return self.state["status"]

    @property
    def round(self) -> int:
        return int(self.state.get("round", 0))

    @property
    def cost(self) -> float:
        return float(self.state.get("cost_usd", 0.0))

    # --- 路径
    @property
    def state_path(self) -> Path:
        return self.root / "state.json"

    @property
    def events_path(self) -> Path:
        return self.root / "events.jsonl"

    @property
    def mailbox_path(self) -> Path:
        return self.root / "mailbox.jsonl"

    @property
    def artifacts(self) -> Path:
        return self.root / "artifacts"

    @property
    def task_file(self) -> Path:
        return self.root / "task.md"

    # --- 写
    def save(self) -> None:
        self.state["updated_at"] = now_iso()
        write_json(self.state_path, self.state)

    def event(self, kind: str, detail: str = "", **extra) -> None:
        row = {"ts": now_iso(), "task": self.id, "type": kind, "detail": detail}
        row.update(extra)
        self.root.mkdir(parents=True, exist_ok=True)
        with self.events_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    def transit(self, status: str, detail: str = "", **extra) -> None:
        """状态迁移：唯一的改状态入口，保证有 event 记录。"""
        old = self.status
        self.state["status"] = status
        self.state["history"] = (self.state.get("history") or [])[-49:] + [
            {"ts": now_iso(), "from": old, "to": status}
        ]
        self.event("state", detail or f"{old} -> {status}", **extra)
        self.save()

    def add_cost(self, usd: float) -> None:
        self.state["cost_usd"] = round(self.cost + max(0.0, float(usd)), 4)
        self.save()

    # --- 信箱（"纸飞机"）：append-only，只传结论
    def send(self, frm: str, to: str, kind: str, body: str,
             refs: dict | None = None, cost_usd: float = 0.0) -> dict:
        assert kind in MESSAGE_KINDS, f"未知消息类型 {kind}"
        rows = self._mailbox()
        msg = {
            "seq": len(rows),
            "id": uuid.uuid4().hex[:12],
            "ts": now_iso(),
            "task": self.id,
            "from": frm,
            "to": to,
            "kind": kind,
            "body": body,
            "refs": refs or {},
            "cost_usd": cost_usd,
        }
        with self.mailbox_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(msg, ensure_ascii=False) + "\n")
        return msg

    def _mailbox(self) -> list[dict]:
        if not self.mailbox_path.exists():
            return []
        out = []
        for line in self.mailbox_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                out.append(json.loads(line))
        return out

    def inbox(self, reader: str) -> list[dict]:
        """读该读者还没读过的消息，并推进游标。"""
        cursor_path = self.root / "cursors.json"
        cursors = read_json(cursor_path, {}) or {}
        seen = int(cursors.get(reader, 0))
        rows = self._mailbox()
        fresh = rows[seen:]
        if fresh:
            cursors[reader] = len(rows)
            write_json(cursor_path, cursors)
        return fresh


def create_task(repo: Path, task_id: str, task_md: Path, branch: str,
                worktree: Path) -> Task:
    root = repo / "runs" / task_id
    root.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(task_md, root / "task.md")
    state = {
        "id": task_id,
        "status": QUEUED,
        "round": 0,
        "cost_usd": 0.0,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "branch": branch,
        "worktree": str(worktree),
        "history": [],
    }
    task = Task(root=root, state=state)
    task.save()
    task.event("created", f"task={task_md.name} branch={branch}")
    return task


def load_task(repo: Path, task_id: str) -> Task:
    root = repo / "runs" / task_id
    state = read_json(root / "state.json")
    if state is None:
        raise SystemExit(f"没有这个任务：{task_id}")
    return Task(root=root, state=state)


def list_tasks(repo: Path) -> list[Task]:
    base = repo / "runs"
    if not base.exists():
        return []
    out = []
    for child in sorted(base.iterdir()):
        state = read_json(child / "state.json")
        if state:
            out.append(Task(root=child, state=state))
    return out


def recover(repo: Path) -> list[Task]:
    """启动扫描：把「上次进程死掉时正在干活」的任务改判为 interrupted。"""
    fixed = []
    for task in list_tasks(repo):
        if task.status in IN_FLIGHT:
            task.transit(INTERRUPTED, "进程重启，任务中断，可 resume")
            fixed.append(task)
    return fixed


# ---------------------------------------------------------------- Agent


@dataclass
class AgentResult:
    ok: bool
    text: str = ""
    cost_usd: float = 0.0
    tokens: int = 0
    exit_code: int = 0
    raw: dict = field(default_factory=dict)


def _run(cmd: list[str], cwd: Path, timeout: int) -> tuple[int, str, str]:
    proc = subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


class ClaudeAgent:
    """实现方：在 worktree 里按任务卡写代码。"""

    name = "claude"

    def __init__(self, timeout: int = 1800):
        self.timeout = timeout

    def work(self, card: str, worktree: Path, round_no: int) -> AgentResult:
        prompt = card if round_no == 0 else f"{card}\n\n---\n上一轮评审提出了问题，见下表，只修问题，不要重写：\n"
        cmd = ["claude", "-p", prompt, "--output-format", "json",
               "--permission-mode", "acceptEdits",
               "--allowedTools", "Bash Edit Read Write Glob Grep"]
        code, out, err = _run(cmd, worktree, self.timeout)
        payload = {}
        m = re.search(r"\{.*\}", out, re.S)
        if m:
            try:
                payload = json.loads(m.group(0))
            except json.JSONDecodeError:
                payload = {}
        text = payload.get("result") or out[-4000:]
        return AgentResult(
            ok=(code == 0 and not payload.get("is_error")),
            text=text, cost_usd=float(payload.get("costUSD") or 0.0),
            exit_code=code, raw=payload,
        )


class CodexAgent:
    """评审方：只读。"""

    name = "codex"

    def __init__(self, timeout: int = 1200):
        self.timeout = timeout

    def review(self, card: str, worktree: Path, round_no: int) -> AgentResult:
        prompt = (
            "你是只读评审方。任务卡如下：\n\n" + card +
            "\n\n请只审查本轮改动，按严重度列出问题（[高]/[中]/[低]），"
            "每条给出 文件:行 与复现方式；没有阻塞问题就只回 CLEAN。"
        )
        cmd = ["codex", "exec", "-s", "read-only", "-C", str(worktree), prompt]
        code, out, err = _run(cmd, worktree, self.timeout)
        tokens = 0
        m = re.search(r"tokens used\D+([\d,]+)", out + err, re.I)
        if m:
            tokens = int(m.group(1).replace(",", ""))
        body = out.strip() or err.strip()
        return AgentResult(ok=(code == 0), text=body, tokens=tokens,
                           exit_code=code)


class DryAgent:
    """不花钱的假 agent，用于 P0 自动化测试。"""

    def __init__(self, reviews: list[str] | None = None, code: int = 0):
        self.reviews = list(reviews or ["CLEAN"])
        self.code = code
        self.calls = 0

    name = "dry"

    def work(self, card: str, worktree: Path, round_no: int) -> AgentResult:
        self.calls += 1
        return AgentResult(ok=self.code == 0, text="dry-run 实现完成",
                           cost_usd=0.0, exit_code=self.code)

    def review(self, card: str, worktree: Path, round_no: int) -> AgentResult:
        self.calls += 1
        text = self.reviews.pop(0) if len(self.reviews) > 1 else self.reviews[0]
        return AgentResult(ok=True, text=text, tokens=1000)


# ---------------------------------------------------------------- 策略


@dataclass
class Policy:
    max_task_usd: float = 3.0
    max_day_usd: float = 15.0
    max_fix_rounds: int = 3

    @classmethod
    def from_file(cls, path: Path) -> "Policy":
        data = read_json(path, {}) or {}
        return cls(
            max_task_usd=float(data.get("max_task_usd", 3.0)),
            max_day_usd=float(data.get("max_day_usd", 15.0)),
            max_fix_rounds=int(data.get("max_fix_rounds", 3)),
        )

    def over_task_budget(self, task: Task) -> bool:
        return task.cost >= self.max_task_usd


def looks_clean(review: str) -> bool:
    text = review.upper()
    if "CLEAN" in text and not re.search(r"\[高\]|\[中\]", text):
        return True
    return "[高]" not in text and "[中]" not in text


# ---------------------------------------------------------------- 循环


def run_task(repo: Path, task: Task, policy: Policy,
             claude: ClaudeAgent | DryAgent, codex: CodexAgent | DryAgent,
             log=print) -> Task:
    """把任务推进到 awaiting_approval 或某个 blocked 状态后返回。"""
    worktree = Path(task.state["worktree"])
    card = task.task_file.read_text(encoding="utf-8")

    while True:
        if task.status in TERMINAL or task.status == AWAITING_APPROVAL:
            return task
        if policy.over_task_budget(task):
            task.transit(BLOCKED_BUDGET, f"累计 ${task.cost:.2f} 超过单任务上限 ${policy.max_task_usd:.2f}")
            return task

        if task.status in (QUEUED, INTERRUPTED):
            task.transit(WORKING, f"第 {task.round} 轮实现")
            task.send("courier", "claude", "task", f"开始第 {task.round} 轮实现")

        if task.status == WORKING:
            res = claude.work(card, worktree, task.round)
            task.artifacts.mkdir(parents=True, exist_ok=True)
            (task.artifacts / f"claude-round{task.round}.txt").write_text(
                res.text, encoding="utf-8")
            task.add_cost(res.cost_usd)
            task.send("claude", "dsn", "result",
                      res.text[-1200:] or "(无输出)", {"artifact": f"claude-round{task.round}.txt"},
                      res.cost_usd)
            if not res.ok:
                task.transit(BLOCKED_HUMAN, f"实现失败 exit={res.exit_code}")
                return task
            task.transit(REVIEWING, "实现完成，送评审")
            continue

        if task.status == REVIEWING:
            res = codex.review(card, worktree, task.round)
            (task.artifacts / f"review-round{task.round}.txt").write_text(
                res.text, encoding="utf-8")
            task.send("codex", "dsn", "review", res.text[-1200:] or "(无输出)",
                      {"artifact": f"review-round{task.round}.txt"})
            if not res.ok:
                task.transit(BLOCKED_HUMAN, f"评审失败 exit={res.exit_code}")
                return task
            if looks_clean(res.text):
                task.transit(AWAITING_APPROVAL, "评审通过，等待人工批准合并")
                task.send("courier", "human", "approval", "评审通过，是否合并？")
                return task
            if task.round >= policy.max_fix_rounds:
                task.transit(AWAITING_APPROVAL,
                             f"已达 {policy.max_fix_rounds} 轮修复上限，带问题交人工")
                return task
            task.state["round"] = task.round + 1
            task.save()
            task.transit(WORKING, f"评审有问题，进入第 {task.round} 轮修复")
            continue

        # 其它状态（blocked 等）由人处理
        return task