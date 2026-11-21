"""dsh 的坦克 bot。

思路：能看见目标就「预判提前量 → 对准 → 保持 6–9 格距离 → 冷却好就开火」；
看不见就沿网格 BFS 去最后目击点，再退化为巡逻；侦测到来袭炮弹时侧向闪避。
只依赖 obs，状态全在模块级字典里（允许，属于 bot 自己的记忆）。
"""

import math

SHELL_SPEED = 8.0
VIEW_RANGE = 12.0
FIRE_TOLERANCE = 0.035
KEEP_MIN = 4.0
KEEP_MAX = 9.0

M = {
    "enemy_hist": {},   # id -> (x, y, tick)
    "last_seen": None,  # (x, y, tick)
    "waypoint": None,
    "last_pos": None,
    "stuck_for": 0.0,
    "patrol_i": 0,
}


def _norm(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def _free(walls, x, y):
    h = len(walls)
    w = len(walls[0])
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    return walls[y][x] == 0


def _bfs_step(walls, start, goal):
    """返回从 start 走一步后的格子中心；不可达时返回 None。"""
    h = len(walls)
    w = len(walls[0])
    sx, sy = start
    gx, gy = goal
    if not _free(walls, sx, sy) or not _free(walls, gx, gy):
        return None
    if (sx, sy) == (gx, gy):
        return None
    prev = {(sx, sy): None}
    queue = [(sx, sy)]
    head = 0
    while head < len(queue):
        cx, cy = queue[head]
        head += 1
        if (cx, cy) == (gx, gy):
            break
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if not _free(walls, nx, ny) or (nx, ny) in prev:
                continue
            prev[(nx, ny)] = (cx, cy)
            queue.append((nx, ny))
    if (gx, gy) not in prev:
        return None
    node = (gx, gy)
    while prev[node] is not None and prev[node] != (sx, sy):
        node = prev[node]
    return (node[0] + 0.5, node[1] + 0.5)


def _aim_point(me, enemy, tick):
    hist = M["enemy_hist"]
    vx = vy = 0.0
    prev = hist.get(enemy["id"])
    if prev is not None:
        dt = (tick - prev[2]) / 60.0
        if 0 < dt <= 1.0:
            vx = (enemy["x"] - prev[0]) / dt
            vy = (enemy["y"] - prev[1]) / dt
    hist[enemy["id"]] = (enemy["x"], enemy["y"], tick)
    px, py = enemy["x"], enemy["y"]
    for _ in range(2):
        dist = math.hypot(px - me["x"], py - me["y"])
        flight = dist / SHELL_SPEED
        px = enemy["x"] + vx * flight
        py = enemy["y"] + vy * flight
    return px, py, math.hypot(vx, vy)


def _threat(me, shells):
    """找出 1.2 秒内可能命中我的炮弹，返回其 (x, y) 或 None。"""
    best = None
    best_tt = 1e9
    for s in shells:
        dx = me["x"] - s["x"]
        dy = me["y"] - s["y"]
        dist = math.hypot(dx, dy)
        if dist > 6.0 or dist < 1e-6:
            continue
        closing = (s["vx"] * dx + s["vy"] * dy) / dist
        if closing <= 0.5:
            continue
        tt = dist / closing
        if tt > 1.2 or tt >= best_tt:
            continue
        # 最近接近距离（把炮弹当直线）
        cross = abs(s["vx"] * dy - s["vy"] * dx) / max(1e-6, math.hypot(s["vx"], s["vy"]))
        if cross > 1.1:
            continue
        best = (s["x"], s["y"])
        best_tt = tt
    return best


def _patrol_target(obs):
    arena = obs["arena"]
    spawns = obs["spawns"]
    if not spawns:
        return (arena["w"] // 2, arena["h"] // 2)
    M["patrol_i"] = (M["patrol_i"] + 1) % len(spawns)
    sx, sy = spawns[M["patrol_i"]]
    return (sx, sy)


def decide(obs):
    me = obs["me"]
    if not me["alive"]:
        return {"turn": 0, "move": 0, "fire": False}

    tick = obs["tick"]
    walls = obs["walls"]
    action = {"turn": 0, "move": 0, "fire": False}

    # 卡住检测：位移 < 0.3 格且持续 1 秒以上就换目标
    last = M["last_pos"]
    if last is not None:
        moved = math.hypot(me["x"] - last[0], me["y"] - last[1])
        M["stuck_for"] = M["stuck_for"] + (1.0 / 6.0) if moved < 0.05 else 0.0
    M["last_pos"] = (me["x"], me["y"])

    enemies = [e for e in obs["enemies"] if e.get("id") != me.get("id")]
    target = None
    best_d = 1e9
    for e in enemies:
        d = math.hypot(e["x"] - me["x"], e["y"] - me["y"])
        if d < best_d:
            best_d = d
            target = e

    if target is not None:
        M["last_seen"] = (target["x"], target["y"], tick)
        ax, ay, enemy_speed = _aim_point(me, target, tick)
        desired = math.atan2(ay - me["y"], ax - me["x"])
        diff = _norm(desired - me["angle"])
        # 连续舵：误差大就满舵，小了就细调
        action["turn"] = max(-1.0, min(1.0, diff * 4.0))
        if best_d > KEEP_MAX:
            action["move"] = 1
        if (abs(diff) < FIRE_TOLERANCE and me["shells_left"] > 0
                and me["cooldown"] <= 0.0 and best_d < VIEW_RANGE):
            action["fire"] = True
    else:
        goal = None
        seen = M["last_seen"]
        if seen is not None and (tick - seen[2]) < 60 * 8:
            goal = (int(seen[0]), int(seen[1]))
        if goal is None or M["stuck_for"] > 1.0:
            goal = _patrol_target(obs)
            M["stuck_for"] = 0.0
        # 巡逻点要粘住：走到或卡住才换，否则每个决策周期都换目标等于原地打转
        if M["waypoint"] is None:
            M["waypoint"] = goal
        elif math.hypot(me["x"] - M["waypoint"][0], me["y"] - M["waypoint"][1]) < 0.9:
            M["waypoint"] = goal
        if seen is None or (tick - seen[2]) >= 60 * 8:
            goal = M["waypoint"]
        step = _bfs_step(walls, (int(me["x"]), int(me["y"])), goal)
        if step is None:
            step = (goal[0] + 0.5, goal[1] + 0.5)
        desired = math.atan2(step[1] - me["y"], step[0] - me["x"])
        diff = _norm(desired - me["angle"])
        action["turn"] = max(-1.0, min(1.0, diff * 3.0))
        if abs(diff) < 0.5:
            action["move"] = 1

    # 闪避优先于进攻
    threat = _threat(me, obs["shells"])
    if threat is not None:
        away = math.atan2(me["y"] - threat[1], me["x"] - threat[0])
        diff = _norm(away - me["angle"])
        action["turn"] = max(-1.0, min(1.0, diff * 4.0))
        action["move"] = 1
        if abs(diff) < 1.2 and me["shells_left"] > 0 and me["cooldown"] <= 0.0:
            action["fire"] = True

    return action