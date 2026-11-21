"""tankbrawl.sim —— 确定性的俯视坦克对战模拟核心。

只做一件事：给定地图、出生点、三个 bot 的决策，跑出一局的结果与回放。
不做 IO、不做加载、不做渲染。同样输入必得同样输出。
"""

from __future__ import annotations

import math

DT = 1.0 / 60.0
DECIDE_EVERY = 6

TANK_RADIUS = 0.45
TANK_SPEED = 3.0
TURN_SPEED = 3.0
FIRE_COOLDOWN = 0.5
MAX_SHELLS = 3

SHELL_SPEED = 8.0
SHELL_RADIUS = 0.12
SHELL_LIFE = 5.0
MAX_BOUNCE = 4
SHELL_SUBSTEPS = 4

VIEW_HALF_ANGLE = math.radians(75.0)
VIEW_RANGE = 12.0

MATCH_SECONDS = 30.0
ERROR_LIMIT = 20

TAU = math.pi * 2.0


def normalize_angle(a: float) -> float:
    """把角度规约到 (-pi, pi]。"""
    a = math.fmod(a + math.pi, TAU)
    if a <= 0:
        a += TAU
    return a - math.pi


class Tank:
    __slots__ = ("id", "x", "y", "angle", "alive", "cooldown", "errors", "spawn")

    def __init__(self, tid: str, x: float, y: float, angle: float):
        self.id = tid
        self.x = float(x)
        self.y = float(y)
        self.angle = float(angle)
        self.alive = True
        self.cooldown = 0.0
        self.errors = 0
        self.spawn = (float(x), float(y), float(angle))


class Shell:
    __slots__ = ("x", "y", "vx", "vy", "owner", "bounces", "life")

    def __init__(self, x, y, vx, vy, owner):
        self.x = float(x)
        self.y = float(y)
        self.vx = float(vx)
        self.vy = float(vy)
        self.owner = owner
        self.bounces = 0
        self.life = SHELL_LIFE


class World:
    """一局对战。walls 是 [h][w] 的 0/1 列表。"""

    def __init__(self, map_name: str, walls, spawns, tank_ids):
        self.map_name = map_name
        self.walls = walls
        self.h = len(walls)
        self.w = len(walls[0])
        self.spawns = [(float(x), float(y)) for x, y in spawns]
        self.tick = 0
        self.time = 0.0
        self.shells: list[Shell] = []
        self.tanks: list[Tank] = []
        self.events: list[dict] = []
        self.frames: list[list] = []
        self.death_tick: dict[str, int | None] = {tid: None for tid in tank_ids}
        for index, tid in enumerate(tank_ids):
            sx, sy = self.spawns[index % len(self.spawns)]
            # 出生朝向指向场地中心，避免一出场就贴墙
            angle = math.atan2(self.h / 2.0 - sy, self.w / 2.0 - sx)
            self.tanks.append(Tank(tid, sx, sy, angle))
        self._record_frame()

    # ---------- 地图 ----------

    def is_wall_cell(self, cx: int, cy: int) -> bool:
        if cx < 0 or cy < 0 or cx >= self.w or cy >= self.h:
            return True
        return self.walls[cy][cx] == 1

    def is_wall_at(self, x: float, y: float) -> bool:
        return self.is_wall_cell(int(math.floor(x)), int(math.floor(y)))

    def circle_hits_wall(self, x: float, y: float, radius: float) -> bool:
        x0 = int(math.floor(x - radius))
        x1 = int(math.floor(x + radius))
        y0 = int(math.floor(y - radius))
        y1 = int(math.floor(y + radius))
        for cy in range(y0, y1 + 1):
            for cx in range(x0, x1 + 1):
                if not self.is_wall_cell(cx, cy):
                    continue
                nx = min(max(x, cx), cx + 1)
                ny = min(max(y, cy), cy + 1)
                if (nx - x) ** 2 + (ny - y) ** 2 <= radius * radius:
                    return True
        return False

    # ---------- 视野 ----------

    def line_of_sight(self, x0: float, y0: float, x1: float, y1: float) -> bool:
        """Amanatides-Woo 网格步进：起点到终点之间没有墙就返回 True。"""
        dx = x1 - x0
        dy = y1 - y0
        cx = int(math.floor(x0))
        cy = int(math.floor(y0))
        step_x = 1 if dx > 0 else -1
        step_y = 1 if dy > 0 else -1
        if dx == 0:
            t_max_x = float("inf")
            t_delta_x = float("inf")
        else:
            t_delta_x = abs(1.0 / dx)
            t_max_x = (
                (cx + 1 - x0) / dx if dx > 0 else (x0 - cx) / -dx
            )
        if dy == 0:
            t_max_y = float("inf")
            t_delta_y = float("inf")
        else:
            t_delta_y = abs(1.0 / dy)
            t_max_y = (
                (cy + 1 - y0) / dy if dy > 0 else (y0 - cy) / -dy
            )
        target_x = int(math.floor(x1))
        target_y = int(math.floor(y1))
        guard = self.w * self.h * 2
        while guard > 0:
            guard -= 1
            if cx == target_x and cy == target_y:
                return True
            if t_max_x < t_max_y:
                cx += step_x
                t_max_x += t_delta_x
            else:
                cy += step_y
                t_max_y += t_delta_y
            if self.is_wall_cell(cx, cy):
                return False
        return False

    def can_see(self, tank: Tank, tx: float, ty: float) -> bool:
        dx = tx - tank.x
        dy = ty - tank.y
        dist = math.hypot(dx, dy)
        if dist > VIEW_RANGE:
            return False
        if dist < 0.001:
            return True
        delta = abs(normalize_angle(math.atan2(dy, dx) - tank.angle))
        if delta > VIEW_HALF_ANGLE:
            return False
        return self.line_of_sight(tank.x, tank.y, tx, ty)

    # ---------- 观察 ----------

    def observe(self, tid: str) -> dict:
        me = next(t for t in self.tanks if t.id == tid)
        enemies = []
        shells = []
        if me.alive:
            for t in self.tanks:
                if t.id == tid or not t.alive:
                    continue
                if self.can_see(me, t.x, t.y):
                    enemies.append(
                        {"id": t.id, "x": round(t.x, 3), "y": round(t.y, 3), "angle": round(t.angle, 4)}
                    )
            for s in self.shells:
                if self.can_see(me, s.x, s.y):
                    shells.append(
                        {
                            "x": round(s.x, 3),
                            "y": round(s.y, 3),
                            "vx": round(s.vx, 3),
                            "vy": round(s.vy, 3),
                            "owner": s.owner,
                        }
                    )
        mine = sum(1 for s in self.shells if s.owner == tid)
        return {
            "tick": self.tick,
            "time_left": round(max(0.0, MATCH_SECONDS - self.time), 3),
            "me": {
                "x": round(me.x, 3),
                "y": round(me.y, 3),
                "angle": round(me.angle, 4),
                "alive": me.alive,
                "cooldown": round(me.cooldown, 3),
                "shells_left": MAX_SHELLS - mine,
            },
            "enemies": enemies,
            "shells": shells,
            "walls": self.walls,
            "arena": {"w": self.w, "h": self.h},
            "spawns": [[int(x), int(y)] for x, y in self.spawns],
        }

    # ---------- 推进 ----------

    def step(self, actions: dict[str, dict]) -> None:
        if self.finished():
            return
        self.tick += 1
        self.time += DT

        for tank in self.tanks:
            if not tank.alive:
                continue
            action = actions.get(tank.id) or {}
            turn = _clamp_float(action.get("turn", 0), -1.0, 1.0)
            move = _clamp_int(action.get("move", 0), 0, 1)
            fire = bool(action.get("fire", False))

            tank.angle = normalize_angle(tank.angle + turn * TURN_SPEED * DT)
            if move:
                self._move_tank(tank)
            if tank.cooldown > 0:
                tank.cooldown = max(0.0, tank.cooldown - DT)
            if fire and tank.cooldown <= 0.0:
                mine = sum(1 for s in self.shells if s.owner == tank.id)
                if mine < MAX_SHELLS:
                    self._fire(tank)

        self._separate_tanks()
        self._advance_shells()
        self._record_frame()

    def _move_tank(self, tank: Tank) -> None:
        nx = tank.x + math.cos(tank.angle) * TANK_SPEED * DT
        ny = tank.y + math.sin(tank.angle) * TANK_SPEED * DT
        if not self.circle_hits_wall(nx, tank.y, TANK_RADIUS):
            tank.x = nx
        if not self.circle_hits_wall(tank.x, ny, TANK_RADIUS):
            tank.y = ny

    def _separate_tanks(self) -> None:
        alive = [t for t in self.tanks if t.alive]
        for i in range(len(alive)):
            for j in range(i + 1, len(alive)):
                a, b = alive[i], alive[j]
                dx = b.x - a.x
                dy = b.y - a.y
                dist = math.hypot(dx, dy)
                if dist >= TANK_RADIUS * 2:
                    continue
                if dist < 1e-6:
                    dx, dy, dist = 1.0, 0.0, 1.0
                push = (TANK_RADIUS * 2 - dist) / 2.0
                ux, uy = dx / dist, dy / dist
                ax, ay = a.x - ux * push, a.y - uy * push
                bx, by = b.x + ux * push, b.y + uy * push
                if not self.circle_hits_wall(ax, ay, TANK_RADIUS):
                    a.x, a.y = ax, ay
                if not self.circle_hits_wall(bx, by, TANK_RADIUS):
                    b.x, b.y = bx, by

    def _fire(self, tank: Tank) -> None:
        muzzle_x = tank.x + math.cos(tank.angle) * (TANK_RADIUS + 0.12)
        muzzle_y = tank.y + math.sin(tank.angle) * (TANK_RADIUS + 0.12)
        if self.is_wall_at(muzzle_x, muzzle_y):
            muzzle_x, muzzle_y = tank.x, tank.y
        self.shells.append(
            Shell(
                muzzle_x,
                muzzle_y,
                math.cos(tank.angle) * SHELL_SPEED,
                math.sin(tank.angle) * SHELL_SPEED,
                tank.id,
            )
        )
        tank.cooldown = FIRE_COOLDOWN
        self.events.append({"tick": self.tick, "type": "fire", "who": tank.id})

    def _advance_shells(self) -> None:
        survivors: list[Shell] = []
        for shell in self.shells:
            if not self._advance_shell(shell):
                continue
            if self._shell_hits_tank(shell):
                continue
            survivors.append(shell)
        self.shells = survivors

    def _advance_shell(self, shell: Shell) -> bool:
        sub = SHELL_SUBSTEPS
        step_dt = DT / sub
        for _ in range(sub):
            if shell.life <= 0:
                return False
            nx = shell.x + shell.vx * step_dt
            ny = shell.y + shell.vy * step_dt
            bounced = False
            if self.circle_hits_wall(nx, shell.y, SHELL_RADIUS):
                shell.vx = -shell.vx
                bounced = True
            else:
                shell.x = nx
            if self.circle_hits_wall(shell.x, ny, SHELL_RADIUS):
                shell.vy = -shell.vy
                bounced = True
            else:
                shell.y = ny
            if bounced:
                shell.bounces += 1
                if shell.bounces > MAX_BOUNCE:
                    return False
            shell.life -= step_dt
        return True

    def _shell_hits_tank(self, shell: Shell) -> bool:
        hit_radius = TANK_RADIUS + SHELL_RADIUS
        for tank in self.tanks:
            if not tank.alive:
                continue
            if (tank.x - shell.x) ** 2 + (tank.y - shell.y) ** 2 <= hit_radius ** 2:
                tank.alive = False
                self.death_tick[tank.id] = self.tick
                self.events.append(
                    {"tick": self.tick, "type": "kill", "victim": tank.id, "by": shell.owner}
                )
                return True
        return False

    # ---------- 结束 ----------

    def finished(self) -> bool:
        if self.time >= MATCH_SECONDS - 1e-9:
            return True
        return sum(1 for t in self.tanks if t.alive) <= 1

    def survivors(self) -> list[str]:
        return [t.id for t in self.tanks if t.alive]

    def result(self) -> dict:
        alive = self.survivors()
        if len(alive) == 1:
            winner = alive[0]
        elif not alive:
            winner = None
        else:
            winner = None  # 超时且不止一辆存活 → 平
        return {
            "winner": winner,
            "survivors": alive,
            "tick": self.tick,
            "seconds": round(self.time, 3),
            "alive_seconds": {
                tid: round((tick if tick is not None else self.tick) * DT, 3)
                for tid, tick in self.death_tick.items()
            },
            "errors": {t.id: t.errors for t in self.tanks},
        }

    def _record_frame(self) -> None:
        self.frames.append(
            [
                self.tick,
                [
                    [t.id, round(t.x, 2), round(t.y, 2), round(t.angle, 3), 1 if t.alive else 0]
                    for t in self.tanks
                ],
                [
                    [round(s.x, 2), round(s.y, 2), round(s.vx, 1), round(s.vy, 1), s.owner]
                    for s in self.shells
                ],
            ]
        )


def _clamp_int(value, low: int, high: int) -> int:
    try:
        ivalue = int(value)
    except (TypeError, ValueError):
        return 0
    if ivalue < low:
        return low
    if ivalue > high:
        return high
    return ivalue


def _clamp_float(value, low: float, high: float) -> float:
    """转向是连续量：允许 -1..1 之间的小数，用来做精细瞄准。"""
    try:
        fvalue = float(value)
    except (TypeError, ValueError):
        return 0.0
    if fvalue != fvalue:  # NaN
        return 0.0
    if fvalue < low:
        return low
    if fvalue > high:
        return high
    return fvalue