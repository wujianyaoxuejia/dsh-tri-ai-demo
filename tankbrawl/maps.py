"""tankbrawl.maps —— 三张固定地图。对所有 bot 公开，不算作弊信息。"""

from __future__ import annotations

W = 32
H = 20

# 出生点固定在三个角落/中央，单位是格中心
SPAWNS = [(2.5, 2.5), (29.5, 17.5), (15.5, 2.5)]


def _border() -> list[list[int]]:
    walls = [[0] * W for _ in range(H)]
    for x in range(W):
        walls[0][x] = 1
        walls[H - 1][x] = 1
    for y in range(H):
        walls[y][0] = 1
        walls[y][W - 1] = 1
    return walls


def _clear_spawns(walls: list[list[int]]) -> None:
    for sx, sy in SPAWNS:
        cx, cy = int(sx), int(sy)
        for y in range(cy - 1, cy + 2):
            for x in range(cx - 1, cx + 2):
                if 0 < x < W - 1 and 0 < y < H - 1:
                    walls[y][x] = 0


def _pillars() -> list[list[int]]:
    walls = _border()
    for y in range(4, H - 3, 5):
        for x in range(4, W - 3, 5):
            for dy in range(2):
                for dx in range(2):
                    walls[y + dy][x + dx] = 1
    _clear_spawns(walls)
    return walls


def _maze() -> list[list[int]]:
    walls = _border()
    # 交错的长墙，每段留两个缺口，保证任意两点可达
    for y in range(3, H - 2, 4):
        gap = 6 if (y // 4) % 2 == 0 else 12
        for x in range(2, W - 2):
            if (x % 11) in (gap % 11, (gap + 1) % 11):
                continue
            walls[y][x] = 1
    for x in range(6, W - 4, 9):
        gap = 4 if (x // 9) % 2 == 0 else 13
        for y in range(2, H - 2):
            if (y % 9) in (gap % 9, (gap + 1) % 9):
                continue
            walls[y][x] = 1
    _clear_spawns(walls)
    return walls


def _open() -> list[list[int]]:
    walls = _border()
    blocks = [
        (5, 5, 3, 1), (7, 12, 1, 3), (12, 8, 3, 1), (16, 4, 1, 3),
        (20, 12, 3, 1), (24, 6, 1, 3), (10, 15, 2, 1), (26, 14, 2, 1),
    ]
    for bx, by, bw, bh in blocks:
        for dy in range(bh):
            for dx in range(bw):
                walls[by + dy][bx + dx] = 1
    _clear_spawns(walls)
    return walls


_BUILDERS = {"pillars": _pillars, "maze": _maze, "open": _open}
_cache: dict[str, list[list[int]]] = {}


def get_map(name: str) -> list[list[int]]:
    if name not in _BUILDERS:
        raise KeyError(f"未知地图：{name}（可选：{', '.join(_BUILDERS)}）")
    if name not in _cache:
        _cache[name] = _BUILDERS[name]()
    return [row[:] for row in _cache[name]]


def map_names() -> list[str]:
    return list(_BUILDERS)


def spawns_for(name: str) -> list[tuple[float, float]]:
    get_map(name)  # 校验名字
    return list(SPAWNS)