"""courier 内核测试：全部用 DryAgent，不调用 Claude/Codex，不花钱。"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from orchestrator import core


class CourierTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        (self.repo / "runs").mkdir()
        card = self.repo / "task.md"
        card.write_text("# 测试任务卡\n", encoding="utf-8")
        self.worktree = self.repo / "wt"
        self.worktree.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def make(self, tid="T1"):
        return core.create_task(
            self.repo, tid, self.repo / "task.md", "ai/" + tid.lower(), self.worktree)

    # --- 状态机

    def test_clean_review_parks_for_approval(self):
        task = self.make()
        out = core.run_task(self.repo, task, core.Policy(),
                            core.DryAgent(), core.DryAgent(["CLEAN"]))
        self.assertEqual(out.status, core.AWAITING_APPROVAL)
        self.assertEqual(out.round, 0)

    def test_findings_trigger_fix_then_clean(self):
        task = self.make()
        codex = core.DryAgent(["[高] web/app.js:10 少了判空", "CLEAN"])
        out = core.run_task(self.repo, task, core.Policy(), core.DryAgent(), codex)
        self.assertEqual(out.status, core.AWAITING_APPROVAL)
        self.assertEqual(out.round, 1)

    def test_fix_round_cap_hands_back_to_human(self):
        task = self.make()
        codex = core.DryAgent(["[高] 永远有问题"])
        out = core.run_task(self.repo, task, core.Policy(max_fix_rounds=2),
                            core.DryAgent(), codex)
        self.assertEqual(out.status, core.AWAITING_APPROVAL)
        self.assertEqual(out.round, 2)

    def test_failed_work_blocks_human(self):
        task = self.make()
        out = core.run_task(self.repo, task, core.Policy(),
                            core.DryAgent(code=1), core.DryAgent())
        self.assertEqual(out.status, core.BLOCKED_HUMAN)

    def test_budget_stops_before_next_dispatch(self):
        task = self.make()
        task.state["cost_usd"] = 5.0
        task.save()
        out = core.run_task(self.repo, task, core.Policy(max_task_usd=3.0),
                            core.DryAgent(), core.DryAgent())
        self.assertEqual(out.status, core.BLOCKED_BUDGET)

    # --- 崩溃恢复

    def test_recover_marks_inflight_as_interrupted(self):
        task = self.make()
        task.transit(core.WORKING, "假装正在跑")
        fixed = core.recover(self.repo)
        self.assertEqual([t.id for t in fixed], ["T1"])
        self.assertEqual(core.load_task(self.repo, "T1").status, core.INTERRUPTED)

    def test_recover_leaves_terminal_alone(self):
        task = self.make()
        task.transit(core.AWAITING_APPROVAL, "等批准")
        self.assertEqual(core.recover(self.repo), [])

    # --- 信箱

    def test_mailbox_is_append_only_and_cursor_based(self):
        task = self.make()
        task.send("courier", "claude", "task", "第一条")
        task.send("claude", "dsn", "result", "第二条")
        first = task.inbox("dsn")
        self.assertEqual(len(first), 2)
        self.assertEqual(task.inbox("dsn"), [])
        task.send("dsn", "claude", "answer", "第三条")
        self.assertEqual([m["body"] for m in task.inbox("dsn")], ["第三条"])

    def test_message_rejects_unknown_kind(self):
        task = self.make()
        with self.assertRaises(AssertionError):
            task.send("a", "b", "chitchat", "?")

    def test_events_are_jsonl_and_ordered(self):
        task = self.make()
        task.transit(core.WORKING, "开始")
        task.transit(core.REVIEWING, "评审")
        rows = [json.loads(l) for l in task.events_path.read_text("utf-8").splitlines()]
        self.assertEqual([r["type"] for r in rows], ["created", "state", "state"])
        self.assertEqual([r["detail"] for r in rows[1:]], ["开始", "评审"])

    # --- 评审判定

    def test_looks_clean(self):
        self.assertTrue(core.looks_clean("CLEAN"))
        self.assertTrue(core.looks_clean("CLEAN / NO BLOCKING ISSUES"))
        # [低] 不阻塞合并：只记录，不退回修复轮
        self.assertTrue(core.looks_clean("[低] 命名可以更好\nCLEAN"))
        self.assertFalse(core.looks_clean("[中] 这里有个边界"))


if __name__ == "__main__":
    unittest.main()