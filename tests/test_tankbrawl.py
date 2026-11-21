"""tankbrawl 契约测试：模拟器确定性、沙箱边界、裁判产物。"""

from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

from tankbrawl import arena, bots, maps
from tankbrawl.sim import (
    ERROR_LIMIT,
    MATCH_SECONDS,
    MAX_BOUNCE,
    SHELL_SPEED,
    VIEW_RANGE,
    World,
)


def _world(map_name="open", ids=("a", "b")):
    return World(map_name, maps.get_map(map_name), maps.spawns_for(map_name), list(ids))


class MapTests(unittest.TestCase):
    def test_three_maps_have_closed_border(self):
        for name in maps.map_names():
            walls = maps.get_map(name)
            self.assertEqual(len(walls), maps.H, name)
            self.assertEqual(len(walls[0]), maps.W, name)
            for x in range(maps.W):
                self.assertEqual(walls[0][x], 1, f"{name} 上边界漏了")
                self.assertEqual(walls[maps.H - 1][x], 1, f"{name} 下边界漏了")
            for y in range(maps.H):
                self.assertEqual(walls[y][0], 1, f"{name} 左边界漏了")
                self.assertEqual(walls[y][maps.W - 1], 1, f"{name} 右边界漏了")

    def test_spawns_are_free_and_connected(self):
        for name in maps.map_names():
            walls = maps.get_map(name)
            for sx, sy in maps.SPAWNS:
                self.assertEqual(walls[int(sy)][int(sx)], 0, f"{name} 出生点 ({sx},{sy}) 在墙里")
            # 从 0 号出生点洪泛，必须能走到另外两个
            start = (int(maps.SPAWNS[0][0]), int(maps.SPAWNS[0][1]))
            seen = {start}
            stack = [start]
            while stack:
                cx, cy = stack.pop()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < maps.W and 0 <= ny < maps.H and walls[ny][nx] == 0:
                        if (nx, ny) not in seen:
                            seen.add((nx, ny))
                            stack.append((nx, ny))
            for sx, sy in maps.SPAWNS[1:]:
                self.assertIn((int(sx), int(sy)), seen, f"{name} 出生点不通")

    def test_unknown_map_rejected(self):
        with self.assertRaises(KeyError):
            maps.get_map("no-such-map")


class SimTests(unittest.TestCase):
    def test_deterministic_frames(self):
        a = _world()
        b = _world()
        script = {
            "a": {"turn": 1, "move": 1, "fire": True},
            "b": {"turn": -1, "move": 1, "fire": False},
        }
        for _ in range(240):
            a.step(script)
            b.step(script)
        self.assertEqual(a.frames, b.frames)
        self.assertEqual(a.result(), b.result())

    def test_shell_speed_and_cooldown(self):
        w = _world()
        tank = w.tanks[0]
        w.step({"a": {"fire": True}})
        self.assertTrue(w.shells, "开火后应该有炮弹")
        shell = w.shells[0]
        self.assertAlmostEqual(math.hypot(shell.vx, shell.vy), SHELL_SPEED, places=3)
        self.assertGreater(tank.cooldown, 0.0)
        before = len(w.shells)
        w.step({"a": {"fire": True}})
        self.assertEqual(len(w.shells), before, "冷却中不应再开火")

    def test_shell_bounces_off_wall(self):
        w = _world()
        tank = w.tanks[0]
        tank.x, tank.y, tank.angle = 2.2, 10.0, math.pi  # 朝左墙
        w.shells.clear()
        w.step({"a": {"fire": True}})
        self.assertTrue(w.shells)
        shell = w.shells[0]
        self.assertLess(shell.vx, 0)
        for _ in range(90):
            w.step({})
            if shell not in w.shells:
                break
            if shell.vx > 0:
                break
        self.assertGreater(shell.vx, 0, "撞左墙后 vx 应反向")

    def test_shell_expires(self):
        w = _world()
        w.tanks[0].angle = 0.0
        w.step({"a": {"fire": True}})
        shell = w.shells[0]
        w.shells = [shell]
        for _ in range(int(6.0 * 60)):
            w.step({})
            if not w.shells:
                break
        self.assertEqual(w.shells, [], "炮弹应在 SHELL_LIFE 秒后消失")

    def test_line_of_sight_blocked_by_wall(self):
        walls = [[0] * 10 for _ in range(10)]
        for y in range(10):
            walls[y][0] = walls[y][9] = 1
        for x in range(10):
            walls[0][x] = walls[9][x] = 1
        for y in range(1, 9):
            walls[y][5] = 1
        w = World("custom", walls, [(2.5, 4.5), (7.5, 4.5)], ["a", "b"])
        self.assertFalse(w.can_see(w.tanks[0], 7.5, 4.5), "隔墙应看不见")
        self.assertTrue(w.can_see(w.tanks[0], 4.0, 4.5), "同侧应看得见")

    def test_observe_hides_out_of_view_enemy(self):
        w = _world()
        a, b = w.tanks[0], w.tanks[1]
        b.x, b.y = a.x + VIEW_RANGE + 2.0, a.y
        obs = w.observe("a")
        self.assertEqual(obs["enemies"], [], "视野外不应出现敌人")
        self.assertIn("walls", obs)
        self.assertIn("arena", obs)
        self.assertEqual(obs["arena"], {"w": maps.W, "h": maps.H})

    def test_error_limit_kills_tank(self):
        w = _world()
        tank = w.tanks[0]
        tank.errors = ERROR_LIMIT
        tank.alive = False
        w.death_tick[tank.id] = 0
        result = w.result()
        self.assertNotIn("a", result["survivors"])
        self.assertEqual(result["winner"], "b")

    def test_match_timeout_is_draw_when_multiple_alive(self):
        w = _world()
        w.time = MATCH_SECONDS
        result = w.result()
        self.assertIsNone(result["winner"])
        self.assertEqual(sorted(result["survivors"]), ["a", "b"])


class SandboxTests(unittest.TestCase):
    def test_rejects_dunder(self):
        with self.assertRaises(bots.BotError):
            bots.check_source("x", "def decide(obs):\n    return (1).__class__\n")

    def test_rejects_open_and_import(self):
        for src in ("def decide(obs):\n    return open('x')\n",
                    "import os\ndef decide(obs):\n    return {}\n"):
            with self.assertRaises(bots.BotError, msg=src):
                bots.check_source("x", src)

    def test_allows_math_import(self):
        bots.check_source("x", "import math\ndef decide(obs):\n    return math.pi\n")

    def test_bot_exception_is_recorded_not_raised(self):
        bot = bots.load_bot("boom", Path(tempfile.mkdtemp()) / "boom.py") if False else None
        tmp = Path(tempfile.mkdtemp()) / "boom.py"
        tmp.write_text("def decide(obs):\n    return 1 / 0\n", encoding="utf-8")
        bot = bots.load_bot("boom", tmp)
        self.assertIsNone(bot.decide({}))
        self.assertEqual(bot.errors, 1)
        self.assertIn("ZeroDivisionError", bot.last_error)

    def test_shipped_dsh_bot_loads_and_returns_action(self):
        bot = bots.load_bot("dsh")
        w = _world()
        obs = w.observe("a")
        action = bot.decide(obs)
        self.assertIsInstance(action, dict)
        self.assertIn(action["turn"], (-1, 0, 1))
        self.assertIn(action["move"], (0, 1))
        self.assertIsInstance(action["fire"], bool)


class ArenaTests(unittest.TestCase):
    def test_tournament_writes_replay_and_standings(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "tb"
            payload = arena.run_tournament(["dsh"], ["open"], 1, out, log=None)
            self.assertEqual(payload["matches"], 1)
            self.assertEqual(len(payload["ranking"]), 1)
            self.assertEqual(payload["ranking"][0]["bot"], "dsh")
            self.assertTrue((out / "standings.json").exists())
            self.assertTrue((out / "summary.md").exists())
            index = json.loads((out / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(len(index["matches"]), 1)
            replay = json.loads((out / index["matches"][0]["file"]).read_text(encoding="utf-8"))
            self.assertEqual(replay["map"], "open")
            self.assertTrue(replay["frames"], "回放应有帧")

    def test_duplicate_bot_ids_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                arena.run_tournament(["dsh", "dsh"], ["open"], 1, Path(tmp) / "tb", log=None)

    def test_fractional_turn_rotates_proportionally(self):
        w = _world()
        tank = w.tanks[0]
        start = tank.angle
        w.step({"a": {"turn": 0.5}})
        from tankbrawl.sim import TURN_SPEED
        self.assertAlmostEqual(tank.angle - start, 0.5 * TURN_SPEED / 60.0, places=5)
        w.step({"a": {"turn": 9.0}})
        self.assertAlmostEqual(tank.angle - start, 1.5 * TURN_SPEED / 60.0, places=5)


if __name__ == "__main__":
    unittest.main()