"""本地 HUD：只读的任务面板。http.server + SSE，仅监听 127.0.0.1。

启动时生成一次性 token，写到 runs/hud-token.txt；访问需带 ?token=<值>。
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import core

PAGE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>courier HUD</title>
<style>
 :root{--bg:#0b0f14;--fg:#d7e2ee;--dim:#7b8899;--ok:#38d39f;--warn:#ffb454;--bad:#ff6b6b;--line:#1e2733}
 *{box-sizing:border-box}
 body{margin:0;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:baseline}
 h1{font-size:15px;margin:0;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
 main{display:grid;grid-template-columns:340px 1fr;height:calc(100vh - 52px)}
 #list{border-right:1px solid var(--line);overflow:auto}
 .task{padding:12px 18px;border-bottom:1px solid var(--line);cursor:pointer}
 .task:hover{background:#111823}
 .task.active{background:#14202d}
 .id{font-weight:600}
 .badge{font-size:11px;padding:1px 7px;border-radius:9px;margin-left:8px;border:1px solid currentColor}
 .s-awaiting_approval,.s-done{color:var(--ok)}
 .s-working,.s-reviewing{color:#59a5ff}
 .s-blocked_human,.s-blocked_budget,.s-interrupted{color:var(--bad)}
 .s-queued{color:var(--dim)}
 #detail{padding:18px 22px;overflow:auto}
 .row{display:flex;gap:10px;padding:3px 0}
 .k{color:var(--dim);min-width:96px}
 pre{background:#0e141c;border:1px solid var(--line);padding:10px;overflow:auto;font-size:12px}
 .msg{border-left:2px solid var(--line);padding:4px 10px;margin:6px 0}
 .msg b{color:#59a5ff}
</style></head>
<body>
<header><h1>courier</h1><span id="sum" style="color:var(--dim)"></span></header>
<main><div id="list"></div><div id="detail"><p style="color:var(--dim)">选择左侧任务</p></div></main>
<script>
let cur=null, tasks=[];
const token=new URLSearchParams(location.search).get('token')||'';
async function load(){
  const r=await fetch('/api/state?token='+encodeURIComponent(token));
  const d=await r.json();
  tasks=d.tasks;
  document.getElementById('sum').textContent=
    `共 ${tasks.length} 个任务 · 今日 $${d.today_usd.toFixed(2)} / $${d.max_day_usd}`;
  render();
}
function render(){
  document.getElementById('list').innerHTML=tasks.map(t=>
    `<div class="task ${t.id===cur?'active':''}" onclick="pick('${t.id}')">
       <div><span class="id">${t.id}</span><span class="badge s-${t.status}">${t.status}</span></div>
       <div style="color:var(--dim);font-size:12px">轮次 ${t.round} · $${t.cost.toFixed(3)}</div>
     </div>`).join('')||'<p style="padding:18px;color:var(--dim)">暂无任务</p>';
}
async function pick(id){
  cur=id; render();
  const r=await fetch('/api/task?id='+id+'&token='+encodeURIComponent(token));
  const d=await r.json();
  document.getElementById('detail').innerHTML=`
    <h2 style="margin:0 0 6px">${d.state.id} <span class="badge s-${d.state.status}">${d.state.status}</span></h2>
    <div class="row"><span class="k">分支</span><span>${d.state.branch}</span></div>
    <div class="row"><span class="k">worktree</span><span>${d.state.worktree}</span></div>
    <div class="row"><span class="k">轮次</span><span>${d.state.round}</span></div>
    <div class="row"><span class="k">累计成本</span><span>$${d.state.cost_usd}</span></div>
    <h3 style="margin:18px 0 6px;font-size:13px;color:var(--dim)">信箱</h3>
    ${d.messages.map(m=>`<div class="msg"><b>${m.from} → ${m.to}</b> <span style="color:var(--dim);font-size:12px">${m.kind} · ${m.ts}</span><br>${esc(m.body).slice(0,400)}</div>`).join('')}
    <h3 style="margin:18px 0 6px;font-size:13px;color:var(--dim)">事件</h3>
    <pre>${esc(d.events.map(e=>`${e.ts}  ${e.type}  ${e.detail}`).join('\\n'))}</pre>`;
}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
load(); setInterval(load, 3000);
</script></body></html>"""


def make_handler(repo: Path, token: str):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # 静音
            pass

        def _ok(self, body: bytes, ctype="application/json; charset=utf-8"):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _auth(self, qs) -> bool:
            got = (qs.get("token") or [""])[0]
            if got != token:
                body = b'{"error":"bad token"}'
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return False
            return True

        def do_GET(self):
            url = urlparse(self.path)
            qs = parse_qs(url.query)
            if url.path in ("/", "/index.html"):
                return self._ok(PAGE.encode("utf-8"), "text/html; charset=utf-8")
            if not self._auth(qs):
                return
            if url.path == "/api/state":
                tasks = core.list_tasks(repo)
                policy = core.Policy.from_file(repo / "orchestrator" / "config.json")
                today = time.strftime("%Y-%m-%d")
                today_usd = sum(
                    t.cost for t in tasks
                    if str(t.state.get("updated_at", ""))[:10] == today
                )
                return self._ok(json.dumps({
                    "tasks": [{
                        "id": t.id, "status": t.status, "round": t.round,
                        "cost": t.cost, "branch": t.state.get("branch", ""),
                    } for t in tasks],
                    "today_usd": today_usd,
                    "max_day_usd": policy.max_day_usd,
                }, ensure_ascii=False).encode("utf-8"))
            if url.path == "/api/task":
                tid = (qs.get("id") or [""])[0]
                try:
                    task = core.load_task(repo, tid)
                except SystemExit:
                    self.send_response(404)
                    self.end_headers()
                    return
                msgs = []
                if task.mailbox_path.exists():
                    for line in task.mailbox_path.read_text(encoding="utf-8").splitlines():
                        if line.strip():
                            msgs.append(json.loads(line))
                events = []
                if task.events_path.exists():
                    for line in task.events_path.read_text(encoding="utf-8").splitlines()[-80:]:
                        if line.strip():
                            events.append(json.loads(line))
                return self._ok(json.dumps(
                    {"state": task.state, "messages": msgs[-40:], "events": events},
                    ensure_ascii=False).encode("utf-8"))
            self.send_response(404)
            self.end_headers()

    return Handler


def serve(repo: Path, port: int = 8787) -> None:
    token = secrets.token_urlsafe(18)
    (repo / "runs").mkdir(parents=True, exist_ok=True)
    (repo / "runs" / "hud-token.txt").write_text(token, encoding="utf-8")
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(repo, token))
    print(f"HUD: http://127.0.0.1:{port}/?token={token}")
    print(f"token 也写在 {repo / 'runs' / 'hud-token.txt'}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n停止 HUD")
    finally:
        httpd.server_close()