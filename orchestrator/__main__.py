"""courier 命令行入口。

    python -m orchestrator new handoff/task-T5.md --id T5 --branch ai/t5 --worktree ../wt-t5
    python -m orchestrator run T5            # 真跑（花钱）
    python -m orchestrator run T5 --dry      # 假 agent，不花钱，只验流程
    python -m orchestrator status [T5]
    python -m orchestrator recover           # 崩溃后把 interrupted 捞出来
    python -m orchestrator hud --port 8787
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from . import core, hud

REPO = Path(__file__).resolve().parent.parent


def cmd_new(args) -> int:
    card = Path(args.task_file)
    if not card.is_absolute():
        card = REPO / card
    if not card.exists():
        print(f"任务卡不存在：{card}")
        return 2
    worktree = Path(args.worktree)
    if not worktree.is_absolute():
        worktree = (REPO / worktree).resolve()
    task_id = args.id or card.stem.upper()
    task = core.create_task(REPO, task_id, card, args.branch, worktree)
    print(f"已建任务 {task.id} → {task.root}")
    print(f"  分支 {args.branch}，worktree {worktree}")
    print(f"  下一步：python -m orchestrator run {task.id} --dry")
    return 0


def cmd_run(args) -> int:
    task = core.load_task(REPO, args.id)
    policy = core.Policy.from_file(REPO / "orchestrator" / "config.json")
    if args.max_task_usd:
        policy.max_task_usd = args.max_task_usd

    if args.dry:
        claude = core.DryAgent()
        codex = core.DryAgent(reviews=[args.fake_review] if args.fake_review else None)
        print("[dry] 使用假 agent，不调用任何 CLI，不产生费用")
    else:
        claude = core.ClaudeAgent()
        codex = core.CodexAgent()

    task = core.run_task(REPO, task, policy, claude, codex)
    print(f"{task.id}: {task.status}  轮次={task.round}  成本=${task.cost:.3f}")
    if task.status == core.AWAITING_APPROVAL:
        print("等待人工批准：合并前请先看 artifacts/ 与 runs/<id>/events.jsonl")
    return 0 if task.status in (core.AWAITING_APPROVAL, core.DONE) else 1


def cmd_status(args) -> int:
    tasks = [core.load_task(REPO, args.id)] if args.id else core.list_tasks(REPO)
    if not tasks:
        print("暂无任务")
        return 0
    for t in tasks:
        print(f"{t.id:8} {t.status:18} round={t.round} ${t.cost:.3f}  {t.state.get('branch','')}")
    return 0


def cmd_recover(args) -> int:
    fixed = core.recover(REPO)
    if not fixed:
        print("没有需要恢复的任务")
    for t in fixed:
        print(f"{t.id} → interrupted（可用 run 续跑）")
    return 0


def cmd_merge(args) -> int:
    """批准后的合并动作：仍然是 DSH 手动执行，这里只做检查与提示。"""
    task = core.load_task(REPO, args.id)
    if task.status != core.AWAITING_APPROVAL:
        print(f"任务状态是 {task.status}，只有 awaiting_approval 才能合并")
        return 2
    branch = task.state["branch"]
    print("将执行（需人工确认后自行运行）：")
    print(f"  git -C {REPO} merge --no-ff {branch}")
    print(f"  python -m unittest discover -s tests")
    print(f"  git push")
    return 0


def cmd_hud(args) -> int:
    hud.serve(REPO, args.port)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="orchestrator", description="courier 派发器")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new", help="登记一个新任务")
    p.add_argument("task_file")
    p.add_argument("--id", default="")
    p.add_argument("--branch", required=True)
    p.add_argument("--worktree", required=True)
    p.set_defaults(func=cmd_new)

    p = sub.add_parser("run", help="推进任务")
    p.add_argument("id")
    p.add_argument("--dry", action="store_true")
    p.add_argument("--fake-review", default="CLEAN")
    p.add_argument("--max-task-usd", type=float, default=0.0)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("status", help="看状态")
    p.add_argument("id", nargs="?")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("recover", help="崩溃恢复")
    p.set_defaults(func=cmd_recover)

    p = sub.add_parser("merge", help="显示合并命令（不自动执行）")
    p.add_argument("id")
    p.set_defaults(func=cmd_merge)

    p = sub.add_parser("hud", help="启动本地面板")
    p.add_argument("--port", type=int, default=8787)
    p.set_defaults(func=cmd_hud)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())