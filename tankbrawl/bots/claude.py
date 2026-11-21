"""Claude 的坦克 bot。

思路：看得见就先解算拦截点，炮口对齐才开火；看不见就沿最短路去最后
目击点或巡逻点，到达后原地扫视；有炮弹可能命中自己时优先侧闪。
模块级 STATE 就是这辆坦克的记忆。
"""

import math

DT = 1.0 / 60.0
TURN_SPEED = 3.0
TURN_GAIN = TURN_SPEED * DT * 6.0  # 一个决策周期最多转 0.3 弧度
TANK_SPEED = 3.0
TANK_RADIUS = 0.45
SHELL_RADIUS = 0.12
HIT_RADIUS = TANK_RADIUS + SHELL_RADIUS
SHELL_SPEED = 8.0
SHELL_LIFE = 5.0
TAU = math.pi * 2.0

STATE = {
    "last_tick": -1,
    "tracks": {},
    "patrol": -1,
    "scan_until": -1,
    "evade_until": -1,
    "evade_angle": 0.0,
    "stuck": 0,
    "own_shots": [],
}


def _reset():
    STATE["last_tick"] = -1
    STATE["tracks"] = {}
    STATE["patrol"] = -1
    STATE["scan_until"] = -1
    STATE["evade_until"] = -1
    STATE["evade_angle"] = 0.0
    STATE["stuck"] = 0
    STATE["own_shots"] = []


def _clamp(v, lo, hi):
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def _norm(a):
    a = math.fmod(a + math.pi, TAU)
    if a <= 0.0:
        a += TAU
    return a - math.pi


def _wall_cell(walls, cx, cy):
    if cy < 0 or cy >= len(walls):
        return True
    row = walls[cy]
    if cx < 0 or cx >= len(row):
        return True
    return row[cx] == 1


def _circle_wall(walls, x, y, r):
    x0 = int(math.floor(x - r))
    x1 = int(math.floor(x + r))
    y0 = int(math.floor(y - r))
    y1 = int(math.floor(y + r))
    cy = y0
    while cy <= y1:
        cx = x0
        while cx <= x1:
            if _wall_cell(walls, cx, cy):
                nx = min(max(x, cx), cx + 1.0)
                ny = min(max(y, cy), cy + 1.0)
                if (nx - x) * (nx - x) + (ny - y) * (ny - y) <= r * r:
                    return True
            cx += 1
        cy += 1
    return False


def _line_clear(walls, x0, y0, x1, y1, step):
    dx = x1 - x0
    dy = y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1e-6:
        return True
    n = int(dist / step) + 1
    i = 1
    while i < n:
        t = i / float(n)
        px = x0 + dx * t
        py = y0 + dy * t
        if _wall_cell(walls, int(math.floor(px)), int(math.floor(py))):
            return False
        i += 1
    return True


def _shot_clear(walls, x0, y0, x1, y1):
    """弹道中线与左右各偏 0.15 格的两条线都不撞墙，避免擦墙角。"""
    if not _line_clear(walls, x0, y0, x1, y1, 0.2):
        return False
    dx = x1 - x0
    dy = y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1e-6:
        return True
    ox = -dy / dist * 0.15
    oy = dx / dist * 0.15
    if not _line_clear(walls, x0 + ox, y0 + oy, x1 + ox, y1 + oy, 0.2):
        return False
    if not _line_clear(walls, x0 - ox, y0 - oy, x1 - ox, y1 - oy, 0.2):
        return False
    return True


def _bfs(walls, start, goal):
    sx, sy = start
    gx, gy = goal
    if _wall_cell(walls, sx, sy) or _wall_cell(walls, gx, gy):
        return None
    if sx == gx and sy == gy:
        return [(sx, sy)]
    h = len(walls)
    w = len(walls[0])
    seen = {(sx, sy): None}
    queue = [(sx, sy)]
    qi = 0
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while qi < len(queue):
        cx, cy = queue[qi]
        qi += 1
        for dx, dy in dirs:
            nx = cx + dx
            ny = cy + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if (nx, ny) in seen:
                continue
            if walls[ny][nx] == 1:
                continue
            seen[(nx, ny)] = (cx, cy)
            if nx == gx and ny == gy:
                path = [(nx, ny)]
                cur = (cx, cy)
                while cur is not None:
                    path.append(cur)
                    cur = seen[cur]
                path.reverse()
                return path
            queue.append((nx, ny))
    return None


def _intercept(x, y, tr):
    """返回炮弹能撞上目标运动轨迹的提前量点。"""
    px = tr["x"]
    py = tr["y"]
    vx = tr.get("vx", 0.0)
    vy = tr.get("vy", 0.0)
    rx = px - x
    ry = py - y
    a = vx * vx + vy * vy - SHELL_SPEED * SHELL_SPEED
    b = 2.0 * (rx * vx + ry * vy)
    c = rx * rx + ry * ry
    t = -1.0
    if abs(a) < 1e-6:
        if abs(b) > 1e-6:
            cand = -c / b
            if cand > 0.0:
                t = cand
    else:
        disc = b * b - 4.0 * a * c
        if disc >= 0.0:
            sq = math.sqrt(disc)
            t1 = (-b - sq) / (2.0 * a)
            t2 = (-b + sq) / (2.0 * a)
            if t1 > 0.0 and t2 > 0.0:
                t = min(t1, t2)
            elif t1 > 0.0:
                t = t1
            elif t2 > 0.0:
                t = t2
    if t < 0.0:
        t = math.hypot(rx, ry) / SHELL_SPEED
    if t > 2.5:
        t = 2.5
    return (px + vx * t, py + vy * t)


def _threat(walls, me, shells):
    """找最快会打中自己的炮弹，返回 (剩余时间, 逃逸方向角)。"""
    mx = me["x"]
    my = me["y"]
    ang = me["angle"]
    best_t = 2.0
    best_esc = None
    for sh in shells:
        vx = float(sh.get("vx", 0.0))
        vy = float(sh.get("vy", 0.0))
        sp2 = vx * vx + vy * vy
        if sp2 < 1e-6:
            continue
        sx = float(sh.get("x", 0.0))
        sy = float(sh.get("y", 0.0))
        rx = mx - sx
        ry = my - sy
        t = (rx * vx + ry * vy) / sp2
        if t < 0.0 or t > 2.0:
            continue
        cx = sx + vx * t
        cy = sy + vy * t
        if math.hypot(cx - mx, cy - my) > 0.85:
            continue
        if not _line_clear(walls, sx, sy, cx, cy, 0.2):
            continue
        if t < best_t:
            sp = math.sqrt(sp2)
            nx = -vy / sp
            ny = vx / sp
            cross = vx * ry - vy * rx
            if cross >= 0.0:
                dirs = ((nx, ny), (-nx, -ny))
            else:
                dirs = ((-nx, -ny), (nx, ny))
            esc = None
            for dx, dy in dirs:
                px = mx + dx * 0.9
                py = my + dy * 0.9
                if not _circle_wall(walls, px, py, TANK_RADIUS):
                    esc = math.atan2(dy, dx)
                    break
            if esc is None:
                a1 = math.atan2(dirs[0][1], dirs[0][0])
                a2 = math.atan2(dirs[1][1], dirs[1][0])
                if abs(_norm(a1 - ang)) <= abs(_norm(a2 - ang)):
                    esc = a1
                else:
                    esc = a2
            best_esc = esc
            best_t = t
    if best_esc is None:
        return None
    return (best_t, best_esc)


def _self_ricochet(walls, sx, sy, angle, own_x, own_y):
    """模拟一发炮弹的短期弹道，判断是否会弹回来打中自己。"""
    vx = math.cos(angle) * SHELL_SPEED
    vy = math.sin(angle) * SHELL_SPEED
    x = sx
    y = sy
    bounces = 0
    sub = DT / 4.0
    elapsed = 0.0
    hit2 = HIT_RADIUS * HIT_RADIUS
    while elapsed < 1.2:
        nx = x + vx * sub
        ny = y + vy * sub
        bounced = False
        if _circle_wall(walls, nx, y, SHELL_RADIUS):
            vx = -vx
            bounced = True
        else:
            x = nx
        if _circle_wall(walls, x, ny, SHELL_RADIUS):
            vy = -vy
            bounced = True
        else:
            y = ny
        if bounced:
            bounces += 1
            if bounces > 4:
                return False
        elapsed += sub
        if elapsed > 0.02:
            dx = x - own_x
            dy = y - own_y
            if dx * dx + dy * dy <= hit2:
                return True
    return False


def _predict_shot(walls, sx, sy, angle, tick0):
    """模拟自己这发炮弹的完整弹道，记录采样点供之后躲反弹。"""
    vx = math.cos(angle) * SHELL_SPEED
    vy = math.sin(angle) * SHELL_SPEED
    x = sx
    y = sy
    bounces = 0
    life = SHELL_LIFE
    sub = DT / 4.0
    steps = 0
    samples = []
    while life > 0.0 and steps < 1200:
        nx = x + vx * sub
        ny = y + vy * sub
        bounced = False
        if _circle_wall(walls, nx, y, SHELL_RADIUS):
            vx = -vx
            bounced = True
        else:
            x = nx
        if _circle_wall(walls, x, ny, SHELL_RADIUS):
            vy = -vy
            bounced = True
        else:
            y = ny
        if bounced:
            bounces += 1
            if bounces > 4:
                break
        life -= sub
        steps += 1
        if steps % 12 == 0:
            samples.append((tick0 + steps // 4, x, y, vx, vy))
    return samples


def _shadow_threat(walls, me, tick):
    """自己的炮弹会弹回来时，即使看不见也要提前侧闪。"""
    mx = me["x"]
    my = me["y"]
    ang = me["angle"]
    best_t = 1.5
    best_esc = None
    live = []
    for samples in STATE["own_shots"]:
        if not samples or samples[-1][0] < tick:
            continue
        live.append(samples)
        for t, x, y, vx, vy in samples:
            if t < tick:
                continue
            if t > tick + 78:
                break
            rx = mx - x
            ry = my - y
            if rx * rx + ry * ry > 1.3:
                continue
            sp2 = vx * vx + vy * vy
            if sp2 < 1e-6:
                continue
            tn = (t - tick) * DT
            if tn >= best_t:
                continue
            sp = math.sqrt(sp2)
            nx = -vy / sp
            ny = vx / sp
            cross = vx * ry - vy * rx
            if cross >= 0.0:
                dirs = ((nx, ny), (-nx, -ny))
            else:
                dirs = ((-nx, -ny), (nx, ny))
            esc = None
            for dx, dy in dirs:
                px = mx + dx * 0.9
                py = my + dy * 0.9
                if not _circle_wall(walls, px, py, TANK_RADIUS):
                    esc = math.atan2(dy, dx)
                    break
            if esc is None:
                a1 = math.atan2(dirs[0][1], dirs[0][0])
                a2 = math.atan2(dirs[1][1], dirs[1][0])
                if abs(_norm(a1 - ang)) <= abs(_norm(a2 - ang)):
                    esc = a1
                else:
                    esc = a2
            best_esc = esc
            best_t = tn if tn > 0.0 else 0.0
    STATE["own_shots"] = live
    if best_esc is None:
        return None
    return (best_t, best_esc)


def _patrol_points(spawns):
    pts = []
    for s in spawns:
        pts.append((float(s[0]) + 0.5, float(s[1]) + 0.5))
    centers = (
        (16.0, 10.0), (8.0, 6.0), (24.0, 6.0), (8.0, 14.0), (24.0, 14.0),
        (4.0, 10.0), (28.0, 10.0), (16.0, 5.0), (16.0, 16.0),
    )
    for p in centers:
        pts.append(p)
    if not pts:
        pts.append((16.0, 10.0))
    return pts


def _choose_goal(x, y, spawns, walls):
    """看不见敌人时的去处：先追最后目击点（6 秒内），否则轮换巡逻点。"""
    tick = STATE["last_tick"]
    best = None
    best_age = 1e9
    for eid in STATE["tracks"]:
        tr = STATE["tracks"][eid]
        age = tick - tr["t"]
        if age <= 360 and age < best_age:
            best_age = age
            best = (tr["x"], tr["y"])
    if best is not None:
        return best[0], best[1], False
    pts = _patrol_points(spawns)
    n = len(spawns)
    if STATE["patrol"] < 0:
        start = 0
        if n > 0:
            best_i = 0
            best_d = 1e9
            for i in range(n):
                d = (pts[i][0] - x) * (pts[i][0] - x) + (pts[i][1] - y) * (pts[i][1] - y)
                if d < best_d:
                    best_d = d
                    best_i = i
            start = (best_i + 1) % len(pts)
        STATE["patrol"] = start
    i = STATE["patrol"] % len(pts)
    tries = 0
    while tries < len(pts):
        gx = int(math.floor(pts[i][0]))
        gy = int(math.floor(pts[i][1]))
        if not _wall_cell(walls, gx, gy):
            STATE["patrol"] = i
            return pts[i][0], pts[i][1], True
        i = (i + 1) % len(pts)
        tries += 1
    return pts[0][0], pts[0][1], True


def _think(obs):
    tick = int(obs.get("tick", 0))
    me = obs.get("me") or {}
    walls = obs.get("walls") or []
    if not walls or not me.get("alive", False):
        return {"turn": 0.0, "move": 0, "fire": False}
    if tick <= STATE["last_tick"]:
        _reset()
    STATE["last_tick"] = tick

    x = float(me.get("x", 0.0))
    y = float(me.get("y", 0.0))
    ang = float(me.get("angle", 0.0))
    cooldown = float(me.get("cooldown", 0.0))
    shells_left = int(me.get("shells_left", 0))
    enemies = obs.get("enemies") or []
    shells = obs.get("shells") or []
    spawns = obs.get("spawns") or []

    seen = {}
    for e in enemies:
        eid = str(e.get("id", "?"))
        ex = float(e.get("x", 0.0))
        ey = float(e.get("y", 0.0))
        prev = STATE["tracks"].get(eid)
        vx = 0.0
        vy = 0.0
        if prev is not None:
            gap = tick - prev["t"]
            if 0 < gap <= 30:
                gdt = gap * DT
                nvx = (ex - prev["x"]) / gdt
                nvy = (ey - prev["y"]) / gdt
                sp = math.hypot(nvx, nvy)
                if sp > TANK_SPEED * 1.2:
                    k = TANK_SPEED * 1.2 / sp
                    nvx *= k
                    nvy *= k
                pv = prev.get("vx", 0.0) * prev.get("vx", 0.0) + prev.get("vy", 0.0) * prev.get("vy", 0.0)
                if pv > 0.01 and gap <= 12:
                    vx = 0.5 * nvx + 0.5 * prev.get("vx", 0.0)
                    vy = 0.5 * nvy + 0.5 * prev.get("vy", 0.0)
                else:
                    vx = nvx
                    vy = nvy
        tr = {"x": ex, "y": ey, "t": tick, "vx": vx, "vy": vy}
        STATE["tracks"][eid] = tr
        seen[eid] = tr

    danger = _threat(walls, me, shells)
    shadow = _shadow_threat(walls, me, tick)
    if shadow is not None and (danger is None or shadow[0] < danger[0]):
        danger = shadow
    trigger = 1.0 if seen else 1.5
    if danger is not None and danger[0] < trigger:
        STATE["evade_until"] = tick + int((danger[0] + 0.2) * 60.0) + 6
        STATE["evade_angle"] = danger[1]
    if tick < STATE["evade_until"]:
        diff = _norm(STATE["evade_angle"] - ang)
        action = {"turn": _clamp(diff / TURN_GAIN, -1.0, 1.0), "move": 0, "fire": False}
        if abs(diff) < 1.3:
            action["move"] = 1
        return action

    target = None
    best_d = 1e9
    for eid in seen:
        tr = seen[eid]
        d = math.hypot(tr["x"] - x, tr["y"] - y)
        if d < best_d:
            best_d = d
            target = tr

    if target is not None:
        ax, ay = _intercept(x, y, target)
        tdx = ax - x
        tdy = ay - y
        aim_angle = math.atan2(tdy, tdx)
        diff = _norm(aim_angle - ang)
        dist_aim = math.hypot(tdx, tdy)
        tol = math.atan(HIT_RADIUS / max(dist_aim, 0.8)) * 0.8
        if tol > 0.12:
            tol = 0.12
        if tol < 0.012:
            tol = 0.012
        aligned = abs(diff) <= tol
        action = {"turn": 0.0, "move": 0, "fire": False}
        if not aligned:
            action["turn"] = _clamp(diff / TURN_GAIN, -1.0, 1.0)
        if dist_aim > 2.5:
            probe_x = x + math.cos(ang) * 0.45
            probe_y = y + math.sin(ang) * 0.45
            if not _circle_wall(walls, probe_x, probe_y, TANK_RADIUS):
                action["move"] = 1
        if aligned and cooldown <= 0.02 and shells_left > 0 and dist_aim < 11.5:
            muzzle_x = x + math.cos(ang) * (TANK_RADIUS + SHELL_RADIUS)
            muzzle_y = y + math.sin(ang) * (TANK_RADIUS + SHELL_RADIUS)
            if not _circle_wall(walls, muzzle_x, muzzle_y, SHELL_RADIUS):
                if _shot_clear(walls, muzzle_x, muzzle_y, ax, ay):
                    if not _self_ricochet(walls, muzzle_x, muzzle_y, ang, x, y):
                        action["fire"] = True
                        STATE["own_shots"].append(
                            _predict_shot(walls, muzzle_x, muzzle_y, ang, tick + 1)
                        )
                        if len(STATE["own_shots"]) > 6:
                            STATE["own_shots"] = STATE["own_shots"][-6:]
        return action

    if STATE["scan_until"] > tick:
        return {"turn": 1.0, "move": 0, "fire": False}

    goal_x, goal_y, is_patrol = _choose_goal(x, y, spawns, walls)
    if math.hypot(goal_x - x, goal_y - y) < 0.9:
        STATE["scan_until"] = tick + 24
        if is_patrol:
            STATE["patrol"] += 1
        else:
            for eid in STATE["tracks"]:
                STATE["tracks"][eid]["t"] = tick - 400
        return {"turn": 1.0, "move": 0, "fire": False}

    gx = int(math.floor(goal_x))
    gy = int(math.floor(goal_y))
    if _wall_cell(walls, gx, gy):
        gx = int(math.floor(x))
        gy = int(math.floor(y))
    cell = (int(math.floor(x)), int(math.floor(y)))
    path = _bfs(walls, cell, (gx, gy))
    if path is None:
        return {"turn": 1.0, "move": 0, "fire": False}

    idx = 1
    while idx < len(path):
        wx = path[idx][0] + 0.5
        wy = path[idx][1] + 0.5
        if (wx - x) * (wx - x) + (wy - y) * (wy - y) < 0.16:
            idx += 1
        else:
            break
    if idx < len(path):
        wx = path[idx][0] + 0.5
        wy = path[idx][1] + 0.5
    else:
        wx = goal_x
        wy = goal_y
    if STATE["stuck"] >= 4:
        best_a = None
        best_off = 9.0
        for off in (0.0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, 2.8, -2.8, 3.4, -3.4):
            a = ang + off
            px = x + math.cos(a) * 0.5
            py = y + math.sin(a) * 0.5
            if not _circle_wall(walls, px, py, TANK_RADIUS):
                if abs(off) < best_off:
                    best_off = abs(off)
                    best_a = a
        if best_a is None:
            return {"turn": 1.0, "move": 0, "fire": False}
        d = _norm(best_a - ang)
        move = 1 if best_off < 0.35 else 0
        if move:
            STATE["stuck"] = 0
        return {"turn": _clamp(d / TURN_GAIN, -1.0, 1.0), "move": move, "fire": False}

    desired = math.atan2(wy - y, wx - x)
    diff = _norm(desired - ang)
    action = {"turn": _clamp(diff / TURN_GAIN, -1.0, 1.0), "move": 0, "fire": False}
    if abs(diff) < 0.5:
        probe_x = x + math.cos(ang) * 0.45
        probe_y = y + math.sin(ang) * 0.45
        if not _circle_wall(walls, probe_x, probe_y, TANK_RADIUS):
            action["move"] = 1
            STATE["stuck"] = 0
        else:
            STATE["stuck"] += 1
    return action


def decide(obs):
    try:
        return _think(obs)
    except Exception:
        return {"turn": 0.0, "move": 0, "fire": False}
