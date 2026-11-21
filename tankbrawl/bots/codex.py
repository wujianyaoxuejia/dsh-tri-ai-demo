import math
DT, STEP, LAST = 1.0 / 60.0, 0.05, [None, None, -10**9]
def norm(a): return math.atan2(math.sin(a), math.cos(a))
def circle(x, y, walls, radius):
    for cy in range(int(math.floor(y - radius)), int(math.floor(y + radius)) + 1):
        for cx in range(int(math.floor(x - radius)), int(math.floor(x + radius)) + 1):
            if cx < 0 or cy < 0 or cy >= len(walls) or cx >= len(walls[0]) or not walls[cy][cx]:
                continue
            nx, ny = min(max(x, cx), cx + 1), min(max(y, cy), cy + 1)
            if (nx - x) ** 2 + (ny - y) ** 2 <= radius ** 2:
                return True
    return False
def shell_step(x, y, vx, vy, walls):
    for unused in range(4):
        nx, ny = x + vx * DT / 4.0, y + vy * DT / 4.0
        if circle(nx, y, walls, 0.12):
            vx = -vx
        else:
            x = nx
        if circle(x, ny, walls, 0.12):
            vy = -vy
        else:
            y = ny
    return x, y, vx, vy
def hit_shot(obs, walls, aim, target):
    me, x, y = obs["me"], obs["me"]["x"] + math.cos(aim) * 0.57, obs["me"]["y"] + math.sin(aim) * 0.57
    if circle(x, y, walls, 0.0):
        x, y = me["x"], me["y"]
    vx, vy = math.cos(aim) * 8.0, math.sin(aim) * 8.0
    tx, ty, ta = target["x"], target["y"], target["angle"]
    for i in range(75):
        ntx, nty = tx + math.cos(ta) * STEP, ty + math.sin(ta) * STEP
        tx, ty = (ntx if not circle(ntx, ty, walls, 0.46) else tx), (nty if not circle(tx, nty, walls, 0.46) else ty)
        x, y, vx, vy = shell_step(x, y, vx, vy, walls)
        if i > 2 and math.hypot(x - me["x"], y - me["y"]) < 0.57:
            return False
        if math.hypot(x - tx, y - ty) < 0.57:
            return True
    return False
def attack_angle(obs, walls, target):
    me, rx, ry = obs["me"], target["x"] - obs["me"]["x"], target["y"] - obs["me"]["y"]
    tvx, tvy = math.cos(target["angle"]) * 3.0, math.sin(target["angle"]) * 3.0
    qa, qb, qc = tvx * tvx + tvy * tvy - 64.0, 2.0 * (rx * tvx + ry * tvy), rx * rx + ry * ry
    time = (math.sqrt(max(0.0, qb * qb - 4.0 * qa * qc)) - qb) / (2.0 * qa) if qa else 0.0
    base = math.atan2(ry + tvy * time, rx + tvx * time) if time > 0.0 else math.atan2(ry, rx)
    best = None
    for offset in (0.0, -0.02, 0.02, -0.05, 0.05, -0.09, 0.09, -0.14, 0.14):
        candidate = norm(base + offset)
        if hit_shot(obs, walls, candidate, target) and (best is None or abs(norm(candidate - me["angle"])) < abs(norm(best - me["angle"]))):
            best = candidate
    return best if best is not None else base
def evade_angle(obs, walls):
    me, threats = obs["me"], []
    for shell in obs["shells"]:
        path, x, y, vx, vy = [], shell["x"], shell["y"], shell["vx"], shell["vy"]
        for unused in range(50):
            x, y, vx, vy = shell_step(x, y, vx, vy, walls)
            path.append((x, y))
        if any(math.hypot(x - me["x"], y - me["y"]) < 1.15 for x, y in path):
            threats.append(path)
    if not threats:
        return None
    best, score = me["angle"], -1.0
    for j in range(24):
        heading, x, y, angle, clear = -math.pi + j * math.pi / 12.0, me["x"], me["y"], me["angle"], 10.0
        for i in range(50):
            angle = norm(angle + max(-STEP, min(STEP, norm(heading - angle))))
            nx, ny = x + math.cos(angle) * STEP, y + math.sin(angle) * STEP
            if not circle(nx, y, walls, 0.46):
                x = nx
            if not circle(x, ny, walls, 0.46):
                y = ny
            clear = min(clear, min(math.hypot(x - p[i][0], y - p[i][1]) for p in threats))
        if clear > score:
            best, score = heading, clear
    return best
def next_waypoint(walls, sx, sy, gx, gy):
    start, goal, queue = (int(sx), int(sy)), (int(gx), int(gy)), [(int(sx), int(sy))]
    parent = {start: None}
    for cell in queue:
        if cell == goal:
            break
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nxt = (cell[0] + dx, cell[1] + dy)
            if nxt in parent or not (0 < nxt[0] < len(walls[0]) and 0 < nxt[1] < len(walls)):
                continue
            if not circle(nxt[0] + 0.5, nxt[1] + 0.5, walls, 0.5):
                parent[nxt], queue = cell, queue + [nxt]
    if goal not in parent:
        return None
    cell = goal
    while parent[cell] != start:
        cell = parent[cell]
    return cell[0] + 0.5, cell[1] + 0.5
def decide(obs):
    me, walls, tick = obs["me"], obs["walls"], obs["tick"]
    enemies = sorted(obs["enemies"], key=lambda e: math.hypot(e["x"] - me["x"], e["y"] - me["y"]))
    target = enemies[0] if enemies else None
    if target:
        LAST[0], LAST[1], LAST[2] = target["x"], target["y"], tick
    evade = evade_angle(obs, walls)
    if evade is not None:
        error = norm(evade - me["angle"])
        return {"turn": max(-1.0, min(1.0, error / STEP)), "move": int(abs(error) < 0.4), "fire": False}
    if target:
        desired = attack_angle(obs, walls, target)
        fire = me["cooldown"] <= 0.0 and me["shells_left"] > 0 and hit_shot(obs, walls, desired, target)
        error = norm(desired - me["angle"])
        fire = fire and abs(error) <= STEP
        return {"turn": max(-1.0, min(1.0, error / STEP)), "move": int(abs(error) < 0.3), "fire": fire}
    recent = LAST[0] is not None and tick - LAST[2] < 360
    gx, gy = (LAST[0], LAST[1]) if recent else (len(walls[0]) / 2.0, len(walls) / 2.0)
    waypoint = next_waypoint(walls, me["x"], me["y"], gx, gy)
    if waypoint:
        desired, moving = math.atan2(waypoint[1] - me["y"], waypoint[0] - me["x"]), 1
    else:
        desired, moving = me["angle"] + 0.35, 0
    error = norm(desired - me["angle"])
    return {"turn": max(-1.0, min(1.0, error / STEP)), "move": moving, "fire": False}
