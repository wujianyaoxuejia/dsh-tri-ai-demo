"""T4 验收脚本：静态约束 + 无头浏览器渲染检查（含关键状态截图）。

用法：
    python tools/verify_t4.py --worktree ../wt-web

依赖页面提供的验收钩子 window.__PLANET_ENGINE__ 与深链参数
（?theme=light&explode=all&ignite=1&launch=1&select=casing），
以便在无头浏览器里对每种状态截图，而不是只截一张初始画面。
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

PART_IDS = [
    "base-ring", "bolt-rings", "truss-tower", "reactor-core", "fuel-pipes",
    "casing", "heat-sink-fins", "control-ring", "main-nozzle", "vernier-nozzle",
]

STATES = {
    "dark": "",
    "light": "?theme=light",
    "exploded": "?explode=all",
    "ignited": "?ignite=1",
    "launched": "?launch=1",
    "selected": "?select=reactor-core&explode=all",
}

results: list[tuple[bool, str, str]] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    results.append((bool(ok), label, detail))
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok or not detail else f"  [{detail}]"))


def find_edge() -> str | None:
    for candidate in EDGE_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


def serve(root: Path, port: int) -> ThreadingHTTPServer:
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def run_edge(edge: str, url: str, mode: str, shot: Path | None = None,
             size: str = "1600,1000", budget: int = 9000) -> str:
    common = [edge, "--headless=new", "--disable-gpu", "--no-sandbox",
              f"--virtual-time-budget={budget}", "--hide-scrollbars"]
    if mode == "dom":
        cmd = common + ["--dump-dom", url]
    else:
        cmd = common + [f"--window-size={size}", f"--screenshot={shot}", url]
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=240)
    return proc.stdout if mode == "dom" else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--tag", default="t4")
    args = ap.parse_args()

    root = Path(args.worktree).resolve()
    web = root / "web"
    out = Path(__file__).resolve().parent / "out"
    out.mkdir(exist_ok=True)

    print(f"\n== 检查 {web} ==\n")
    if not web.exists():
        print("!! web/ 不存在，任务还没产出")
        return 2

    files = [p for p in web.rglob("*") if p.suffix in (".js", ".css", ".html")]
    blob = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in files)

    print("[1] 零外部依赖")
    urls = re.findall(r"https?://\S{0,40}", blob)
    check(not urls, "无 http(s) 外链", str(urls[:3]))
    check(not re.search(r"\.(glb|gltf|obj|fbx|hdr)\b", blob, re.I), "无外部 3D 模型引用")
    check("vendor/three.module.js" in blob, "引用 vendor/three.module.js")
    check("vendor/OrbitControls.js" in blob, "引用 vendor/OrbitControls.js")

    print("\n[2] 部件表与细节")
    for pid in PART_IDS:
        check(f"'{pid}'" in blob or f'"{pid}"' in blob, f"部件 id：{pid}")
    check("InstancedMesh" in blob, "InstancedMesh 实例化")
    check("8192" in blob.replace(",", ""), "螺栓数量 8192")
    check("Raycaster" in blob, "Raycaster 拾取")
    check("data-theme" in blob, "主题切换落 DOM")

    print("\n[3] 无头渲染")
    edge = find_edge()
    check(edge is not None, "找到 Edge")
    if not edge:
        return 1

    httpd = serve(root, args.port)
    time.sleep(0.5)
    url = f"http://127.0.0.1:{args.port}/web/index.html"
    shots: dict[str, Path] = {}
    try:
        dom = run_edge(edge, url, "dom")
        check("<canvas" in dom, "渲染出 canvas")
        check(dom.count("part-row") >= 10, "部件列表 ≥10 行", f"实测 {dom.count('part-row')}")
        check('data-theme="dark"' in dom, "默认深色主题")
        check("__PLANET_ENGINE__" in blob, "页面暴露验收钩子")

        dom_light = run_edge(edge, url + "?theme=light", "dom")
        check('data-theme="light"' in dom_light, "?theme=light 生效")

        print("\n[4] 关键状态截图")
        for name, query in STATES.items():
            shot = out / f"{args.tag}-{name}.png"
            run_edge(edge, url + query, "shot", shot=shot)
            shots[name] = shot
            size = shot.stat().st_size if shot.exists() else 0
            check(size > 20000, f"{name} 截图", f"{size} bytes")

        if shots["dark"].exists() and shots["light"].exists():
            same = shots["dark"].read_bytes() == shots["light"].read_bytes()
            check(not same, "浅色主题画面与深色不同")
        if shots["exploded"].exists() and shots["dark"].exists():
            same = shots["exploded"].read_bytes() == shots["dark"].read_bytes()
            check(not same, "拆解状态画面与初始不同")
        if shots["ignited"].exists() and shots["dark"].exists():
            same = shots["ignited"].read_bytes() == shots["dark"].read_bytes()
            check(not same, "点火状态画面与初始不同")
    finally:
        httpd.shutdown()

    ok = sum(1 for good, _, _ in results if good)
    print(f"\n{ok}/{len(results)} 通过")
    bad = [(label, detail) for good, label, detail in results if not good]
    if bad:
        print("失败项：")
        for label, detail in bad:
            print(f"  - {label} {detail}")
        return 1
    print(f"截图目录：{out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())