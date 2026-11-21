"""tankbrawl.arena —— 裁判：组织比赛、跑对局、产出回放与排名。

    python -m tankbrawl.arena --maps pillars,maze,open --rounds 3 --out runs/tb-001
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

from . import maps
from . import bots as botmod
from .sim import DECIDE_EVERY, ERROR_LIMIT, World


def run_match(bot_map, map_name: str, tank_ids: list[str]) -> dict:
    walls = maps.get_map(map_name)
    world = World(map_name, walls, maps.spawns_for(map_name), tank_ids)
    actions = {tid: {} for tid in tank_ids}

    while not world.finished():
        if world.tick % DECIDE_EVERY == 0:
            for tank in world.tanks:
                if not tank.alive:
                    continue
                bot = bot_map[tank.id]
                obs = world.observe(tank.id)
                action = bot.decide(obs)
                if action is None:
                    tank.errors += 1
                    actions[tank.id] = {}
                    if tank.errors >= ERROR_LIMIT:
                        tank.alive = False
                        world.death_tick[tank.id] = world.tick
                        world.events.append(
                            {"tick": world.tick, "type": "error_limit", "victim": tank.id}
                        )
                else:
                    actions[tank.id] = action
        world.step(actions)

    result = world.result()
    return {
        "map": map_name,
        "tanks": tank_ids,
        "walls": walls,
        "frames": world.frames,
        "events": world.events,
        "result": result,
    }


def _score(result: dict, tank_ids: list[str]):
    """返回 {bot: 得分} 与每位是否获胜。"""
    winner = result["winner"]
    survivors = result["survivors"]
    points = {tid: 0.0 for tid in tank_ids}
    if winner:
        points[winner] = 1.0
    elif survivors:
        share = 0.5 / len(survivors)
        for tid in survivors:
            points[tid] = share
    return points


def run_tournament(bot_names, map_names, rounds, out_dir: Path, log=print) -> dict:
    if bot_names is not None:
        requested = list(bot_names)
        if len(set(requested)) != len(requested):
            raise ValueError("同一场比赛里 bot 名必须唯一（一个 bot 一辆坦克）")
    bot_map = botmod.load_all(bot_names)
    bot_names = list(bot_map)
    tank_ids = list(bot_names)
    out_dir.mkdir(parents=True, exist_ok=True)
    matches_dir = out_dir / "matches"
    matches_dir.mkdir(exist_ok=True)

    standings = {
        tid: {"bot": tid, "points": 0.0, "wins": 0, "draws": 0, "losses": 0,
              "alive_seconds": 0.0, "matches": 0, "errors": 0}
        for tid in tank_ids
    }
    index = []
    match_no = 0

    for map_name in map_names:
        for order in itertools.permutations(tank_ids):
            for round_no in range(rounds):
                match_no += 1
                started = time.time()
                for bot in bot_map.values():
                    bot.calls = 0
                    bot.errors = 0
                replay = run_match(bot_map, map_name, list(order))
                replay["id"] = f"match-{match_no:04d}"
                replay["round"] = round_no + 1
                replay["spawn_order"] = list(order)
                replay["elapsed_ms"] = int((time.time() - started) * 1000)

                path = matches_dir / f"{replay['id']}.json"
                path.write_text(json.dumps(replay, ensure_ascii=False, separators=(",", ":")),
                                encoding="utf-8")

                result = replay["result"]
                points = _score(result, tank_ids)
                for tid in tank_ids:
                    entry = standings[tid]
                    entry["matches"] += 1
                    entry["points"] += points[tid]
                    entry["alive_seconds"] += result["alive_seconds"].get(tid, 0.0)
                    entry["errors"] += result["errors"].get(tid, 0)
                    if points[tid] >= 1.0:
                        entry["wins"] += 1
                    elif points[tid] > 0:
                        entry["draws"] += 1
                    else:
                        entry["losses"] += 1

                index.append({
                    "id": replay["id"],
                    "file": f"matches/{replay['id']}.json",
                    "map": map_name,
                    "spawn_order": list(order),
                    "round": round_no + 1,
                    "winner": result["winner"],
                    "survivors": result["survivors"],
                    "seconds": result["seconds"],
                })
                if log:
                    verdict = result["winner"] or ("平局 " + "/".join(result["survivors"]))
                    log(f"  {replay['id']} {map_name:<8} {verdict}  tick={result['tick']}")

    ranking = sorted(
        standings.values(),
        key=lambda e: (-e["points"], -e["alive_seconds"], e["bot"]),
    )
    for position, entry in enumerate(ranking, start=1):
        entry["rank"] = position
        entry["points"] = round(entry["points"], 3)
        entry["alive_seconds"] = round(entry["alive_seconds"], 2)

    payload = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "maps": list(map_names),
        "rounds": rounds,
        "matches": match_no,
        "ranking": ranking,
        "bots": {name: {"source": str(bot.source_path)} for name, bot in bot_map.items()},
    }
    (out_dir / "standings.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "index.json").write_text(
        json.dumps({"standings": payload, "matches": index}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "summary.md").write_text(_render_summary(payload, index), encoding="utf-8")
    return payload


def _render_summary(payload: dict, index: list[dict]) -> str:
    lines = [
        "# 坦克大乱斗 —— 战报",
        "",
        f"生成时间：{payload['generated']}　地图：{', '.join(payload['maps'])}　局数：{payload['matches']}",
        "",
        "| 名次 | Bot | 总分 | 胜 | 平 | 负 | 存活时长 | 决策错误 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for entry in payload["ranking"]:
        lines.append(
            f"| {entry['rank']} | {entry['bot']} | {entry['points']} | {entry['wins']} | "
            f"{entry['draws']} | {entry['losses']} | {entry['alive_seconds']}s | {entry['errors']} |"
        )
    lines += ["", "## 每局结果", "", "| 局 | 地图 | 出生顺序 | 结果 | 时长 |", "| --- | --- | --- | --- | --- |"]
    for item in index:
        verdict = item["winner"] or ("平局 " + "/".join(item["survivors"]))
        lines.append(
            f"| {item['id']} | {item['map']} | {' → '.join(item['spawn_order'])} | {verdict} | {item['seconds']}s |"
        )
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="tankbrawl.arena")
    parser.add_argument("--maps", default=",".join(maps.map_names()))
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--bots", default="")
    parser.add_argument("--out", default="runs/tb-latest")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    map_names = [m.strip() for m in args.maps.split(",") if m.strip()]
    bot_names = [b.strip() for b in args.bots.split(",") if b.strip()] or None
    out_dir = Path(args.out)

    log = (lambda *a, **k: None) if args.quiet else print
    log(f"比赛开始：{len(map_names)} 张图，每张 6 种出生顺序 × {args.rounds} 局")
    payload = run_tournament(bot_names, map_names, args.rounds, out_dir, log=log)
    log("")
    log("排名：")
    for entry in payload["ranking"]:
        log(f"  {entry['rank']}. {entry['bot']:<8} {entry['points']:>5} 分  "
            f"（{entry['wins']} 胜 {entry['draws']} 平 {entry['losses']} 负）")
    log(f"\n回放与战报：{out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())