(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const RUN_PARAM = (params.get('run') || 'runs/tb-001').trim() || 'runs/tb-001';

  const $ = function (id) {
    return document.getElementById(id);
  };

  const els = {
    runName: $('runName'),
    status: $('status'),
    matchCount: $('matchCount'),
    matchList: $('matchList'),
    standings: $('standings'),
    mapName: $('mapName'),
    matchMeta: $('matchMeta'),
    canvasWrap: $('canvasWrap'),
    canvas: $('screen'),
    canvasHint: $('canvasHint'),
    playBtn: $('playBtn'),
    prevBtn: $('prevBtn'),
    nextBtn: $('nextBtn'),
    seek: $('seek'),
    tickLabel: $('tickLabel'),
    speeds: $('speeds'),
  };

  const ctx = els.canvas.getContext('2d');
  const MAP_W = 32;
  const MAP_H = 20;
  const KNOWN_COLORS = { dsh: '#ff6b6b', claude: '#5b8cff', codex: '#3ddc97' };
  const PALETTE = ['#ff6b6b', '#5b8cff', '#3ddc97', '#f5a623', '#c084fc', '#4dd0e1', '#fb923c'];

  const state = {
    runDir: '',
    matches: [],
    current: null,
    frames: [],
    frameTicks: [],
    lastTick: 0,
    tickFloat: 0,
    playing: false,
    speed: 1,
    scale: 1,
    colors: {},
    flashes: [],
    flashCursor: 0,
    lastFrameTime: 0,
    activeIndex: -1,
  };

  // ---------- 小工具 ----------

  function colorFor(id) {
    const key = String(id || '?');
    if (KNOWN_COLORS[key]) return KNOWN_COLORS[key];
    if (!state.colors[key]) {
      let h = 0;
      for (let i = 0; i < key.length; i += 1) {
        h = (h * 31 + key.charCodeAt(i)) >>> 0;
      }
      state.colors[key] = PALETTE[h % PALETTE.length];
    }
    return state.colors[key];
  }

  function shortId(id) {
    const text = String(id || '');
    return text.replace(/^match-/, '') || '—';
  }

  function fmtSeconds(value) {
    const v = Number(value);
    if (!isFinite(v)) return '—';
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  function fmtPoints(value) {
    const v = Number(value);
    if (!isFinite(v)) return '—';
    return String(Math.round(v * 100) / 100);
  }

  function verdictFrom(obj) {
    if (!obj) return '—';
    if (obj.winner) return obj.winner + ' 胜';
    if (Array.isArray(obj.survivors) && obj.survivors.length) {
      return '平局 · ' + obj.survivors.join(' / ');
    }
    return '同归于尽';
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle('error', !!isError);
  }

  function showHint(text) {
    els.canvasHint.textContent = text;
    els.canvasHint.classList.remove('hidden');
  }

  function hideHint() {
    els.canvasHint.classList.add('hidden');
  }

  function resolveRunDir() {
    if (/^[a-z]+:\/\//i.test(RUN_PARAM)) {
      return RUN_PARAM.replace(/\/+$/, '') + '/';
    }
    let rel = RUN_PARAM.replace(/^\.?\//, '').replace(/\/+$/, '');
    if (!rel) rel = 'runs/tb-001';
    return new URL('../../' + rel + '/', window.location.href).href;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' ' + (res.statusText || ''));
    }
    return res.json();
  }

  // ---------- 侧栏 ----------

  function renderMatchList(list) {
    els.matchList.replaceChildren();
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = '暂无对局';
      els.matchList.append(empty);
      return;
    }
    list.forEach(function (entry, index) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'match-item';
      btn.dataset.index = String(index);

      const id = document.createElement('span');
      id.className = 'm-id';
      id.textContent = '#' + shortId(entry.id);

      const map = document.createElement('span');
      map.className = 'm-map';
      map.textContent = entry.map || '—';

      const result = document.createElement('span');
      result.className = 'm-result';
      result.textContent = verdictFrom(entry);
      if (entry.winner) result.style.color = colorFor(entry.winner);

      const sub = document.createElement('span');
      sub.className = 'm-sub';
      const order = Array.isArray(entry.spawn_order) ? entry.spawn_order.join(' → ') : '';
      sub.textContent = (order ? order + ' · ' : '') + fmtSeconds(entry.seconds) + ' 秒';

      btn.append(id, map, result, sub);
      btn.addEventListener('click', function () {
        selectMatch(index, { autoplay: true });
      });
      els.matchList.append(btn);
    });
  }

  function renderStandings(standings) {
    const ranking = standings && standings.ranking;
    if (!Array.isArray(ranking) || !ranking.length) {
      els.standings.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = '暂无排名';
      els.standings.append(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'rank-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['#', 'Bot', '分', '胜/平/负', '错误'].forEach(function (label) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.append(th);
    });
    thead.append(headRow);

    const tbody = document.createElement('tbody');
    ranking.forEach(function (entry) {
      const tr = document.createElement('tr');

      const rank = document.createElement('td');
      rank.textContent = String(entry.rank == null ? '—' : entry.rank);

      const bot = document.createElement('td');
      const botCell = document.createElement('span');
      botCell.className = 'bot-cell';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = colorFor(entry.bot);
      const name = document.createElement('span');
      name.textContent = entry.bot || '—';
      botCell.append(dot, name);
      bot.append(botCell);

      const points = document.createElement('td');
      points.textContent = fmtPoints(entry.points);

      const record = document.createElement('td');
      record.textContent =
        String(entry.wins == null ? 0 : entry.wins) +
        '/' +
        String(entry.draws == null ? 0 : entry.draws) +
        '/' +
        String(entry.losses == null ? 0 : entry.losses);

      const errors = document.createElement('td');
      const errCount = Number(entry.errors || 0);
      errors.textContent = String(errCount);
      if (errCount > 0) errors.className = 'err';

      tr.append(rank, bot, points, record, errors);
      tbody.append(tr);
    });

    table.append(thead, tbody);
    els.standings.replaceChildren(table);
  }

  function setActiveMatch(index) {
    state.activeIndex = index;
    const items = els.matchList.querySelectorAll('.match-item');
    items.forEach(function (el, idx) {
      el.classList.toggle('active', idx === index);
    });
    if (items[index] && items[index].scrollIntoView) {
      items[index].scrollIntoView({ block: 'nearest' });
    }
  }

  function renderMatchInfo(data, entry) {
    const mapName = data.map || (entry && entry.map) || '—';
    els.mapName.textContent = mapName;

    els.matchMeta.replaceChildren();

    const head = document.createElement('span');
    head.className = 'strong';
    const id = data.id || (entry && entry.id) || '';
    head.textContent = '#' + shortId(id) + (data.round ? ' · 第 ' + data.round + ' 轮' : '');
    els.matchMeta.append(head);

    const spawns = document.createElement('span');
    spawns.className = 'spawn-group';
    spawns.append(document.createTextNode('出生 '));
    const order = Array.isArray(data.spawn_order)
      ? data.spawn_order
      : Array.isArray(data.tanks)
        ? data.tanks
        : [];
    order.forEach(function (name, index) {
      if (index > 0) spawns.append(document.createTextNode(' → '));
      const item = document.createElement('span');
      item.className = 'spawn';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = colorFor(name);
      const label = document.createElement('span');
      label.textContent = name;
      item.append(dot, label);
      spawns.append(item);
    });
    els.matchMeta.append(spawns);

    const result = data.result || {};
    const verdict = document.createElement('span');
    verdict.append(document.createTextNode('结果 '));
    const strong = document.createElement('span');
    strong.className = 'strong';
    strong.textContent = verdictFrom(result);
    if (result.winner) strong.style.color = colorFor(result.winner);
    verdict.append(strong);
    els.matchMeta.append(verdict);

    const duration = document.createElement('span');
    duration.textContent = '时长 ' + fmtSeconds(result.seconds) + ' 秒';
    els.matchMeta.append(duration);
  }

  // ---------- 数据 ----------

  async function selectMatch(index, opts) {
    const entry = state.matches[index];
    if (!entry) return;
    const autoplay = !!(opts && opts.autoplay);
    setActiveMatch(index);
    const file = entry.file || 'matches/' + entry.id + '.json';
    const url = new URL(file, state.runDir).href;
    setStatus('正在加载 ' + (entry.id || '对局') + ' …', false);
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      setStatus('读取对局失败：' + (err && err.message ? err.message : err), true);
      return;
    }
    loadMatch(data, entry);
    if (autoplay) startPlayback();
  }

  function loadMatch(data, entry) {
    state.current = data;
    state.frames = Array.isArray(data.frames) ? data.frames : [];
    state.frameTicks = state.frames.map(function (f) {
      return f[0];
    });
    state.lastTick = state.frameTicks.length
      ? state.frameTicks[state.frameTicks.length - 1]
      : 0;
    state.tickFloat = 0;
    state.playing = false;
    state.flashes = [];
    state.flashCursor = 0;
    state.lastFrameTime = 0;

    els.seek.max = String(state.lastTick);
    els.seek.value = '0';
    els.seek.disabled = state.lastTick <= 0;
    els.playBtn.disabled = false;
    els.prevBtn.disabled = false;
    els.nextBtn.disabled = false;

    updatePlayButton();
    updateTickUI(0);
    hideHint();
    renderMatchInfo(data, entry);
    setStatus('已加载 ' + (entry && entry.id ? entry.id : data.id || '对局'), false);
    resizeCanvas();
  }

  function failIndex(err) {
    const url = new URL('index.json', state.runDir).href;
    const msg = '读取 index.json 失败：' + (err && err.message ? err.message : String(err));
    setStatus(msg, true);
    els.matchList.replaceChildren();
    const p = document.createElement('p');
    p.className = 'placeholder error';
    p.style.whiteSpace = 'pre-line';
    p.textContent = msg + '\n' + url;
    els.matchList.append(p);
    showHint('无法加载回放数据');
  }

  async function boot() {
    els.runName.textContent = RUN_PARAM;
    state.runDir = resolveRunDir();
    setStatus('数据目录：' + RUN_PARAM, false);

    let data;
    try {
      data = await fetchJson(new URL('index.json', state.runDir).href);
    } catch (err) {
      failIndex(err);
      return;
    }

    const list = Array.isArray(data.matches) ? data.matches : [];
    state.matches = list;
    els.matchCount.textContent = list.length + ' 局';
    renderStandings(data.standings);
    renderMatchList(list);

    if (!list.length) {
      showHint('数据目录中没有对局');
      setStatus('数据目录中没有对局', true);
      return;
    }

    setStatus('已读取 ' + list.length + ' 局对局', false);
    selectMatch(0, { autoplay: true });
  }

  // ---------- 播放控制 ----------

  function updatePlayButton() {
    els.playBtn.textContent = state.playing ? '暂停' : '播放';
  }

  function updateTickUI(tick) {
    els.tickLabel.textContent = tick + ' / ' + state.lastTick;
    if (document.activeElement !== els.seek) {
      els.seek.value = String(tick);
    }
  }

  function seekTo(tick) {
    if (!state.current) return;
    const clamped = Math.max(0, Math.min(state.lastTick, Math.round(tick)));
    state.tickFloat = clamped;
    state.flashes = [];
    state.flashCursor = clamped;
    updateTickUI(clamped);
  }

  function startPlayback() {
    if (!state.current) return;
    if (state.tickFloat >= state.lastTick) {
      state.tickFloat = 0;
      state.flashCursor = 0;
      state.flashes = [];
      updateTickUI(0);
    }
    state.playing = true;
    state.lastFrameTime = 0;
    updatePlayButton();
  }

  function togglePlay() {
    if (!state.current) return;
    if (state.playing) {
      state.playing = false;
      updatePlayButton();
    } else {
      startPlayback();
    }
  }

  function stepFrame(delta) {
    if (!state.current) return;
    state.playing = false;
    updatePlayButton();
    seekTo(Math.round(state.tickFloat) + delta);
  }

  function triggerKills(toTick) {
    if (!state.current) return;
    const events = state.current.events || [];
    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i];
      if (ev.type !== 'kill') continue;
      if (ev.tick > state.flashCursor && ev.tick <= toTick) {
        const pos = victimPosition(ev.tick, ev.victim);
        if (pos) {
          state.flashes.push({ x: pos[0], y: pos[1], start: performance.now() });
        }
      }
    }
    state.flashCursor = toTick;
  }

  // ---------- 画面 ----------

  function resizeCanvas() {
    const rect = els.canvasWrap.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    const pad = 18;
    const availW = Math.max(80, rect.width - pad);
    const availH = Math.max(60, rect.height - pad);

    let width = availW;
    let height = (width * MAP_H) / MAP_W;
    if (height > availH) {
      height = availH;
      width = (height * MAP_W) / MAP_H;
    }
    width = Math.max(80, Math.floor(width));
    height = Math.max(50, Math.floor(height));

    const dpr = window.devicePixelRatio || 1;
    els.canvas.style.width = width + 'px';
    els.canvas.style.height = height + 'px';
    els.canvas.width = Math.round(width * dpr);
    els.canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.scale = width / MAP_W;
  }

  function frameAtTick(tick) {
    const ticks = state.frameTicks;
    if (!ticks.length) return null;
    if (tick <= ticks[0]) return state.frames[0];
    if (tick >= ticks[ticks.length - 1]) return state.frames[ticks.length - 1];
    let lo = 0;
    let hi = ticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ticks[mid] <= tick) lo = mid;
      else hi = mid - 1;
    }
    return state.frames[lo];
  }

  function victimPosition(tick, id) {
    const frame = frameAtTick(tick);
    if (!frame) return null;
    const tanks = frame[1] || [];
    for (let i = 0; i < tanks.length; i += 1) {
      if (tanks[i][0] === id) return [tanks[i][1], tanks[i][2]];
    }
    return null;
  }

  function drawShell(shell, scale) {
    const x = shell[0];
    const y = shell[1];
    const owner = shell[4];
    const color = colorFor(owner);
    const radius = Math.max(2.2, scale * 0.16);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * scale, y * scale, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x * scale, y * scale, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTank(tank, scale) {
    const id = tank[0];
    const x = tank[1];
    const y = tank[2];
    const angle = tank[3];
    const alive = !!tank[4];
    const color = colorFor(id);
    const px = x * scale;
    const py = y * scale;
    const r = 0.45 * scale;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.globalAlpha = alive ? 1 : 0.26;

    if (alive) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 12, 18, 0.86)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.6, 0.07 * scale);
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(r * 1.28, 0);
    ctx.lineTo(-r * 0.55, r * 0.72);
    ctx.lineTo(-r * 0.12, 0);
    ctx.lineTo(-r * 0.55, -r * 0.72);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alive ? 0.95 : 0.3;
    const fontSize = Math.max(10, Math.round(scale * 0.36));
    ctx.font = '600 ' + fontSize + 'px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const cssW = els.canvas.clientWidth;
    const cssH = els.canvas.clientHeight;
    const labelX = Math.min(Math.max(px, 34), cssW - 34);
    const labelY = Math.min(
      Math.max(py + r + Math.max(4, scale * 0.12), 4),
      cssH - fontSize - 3
    );
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5, 8, 13, 0.86)';
    ctx.strokeText(id, labelX, labelY);
    ctx.fillStyle = color;
    ctx.fillText(id, labelX, labelY);
    ctx.restore();
  }

  function drawFlashes(now) {
    if (!state.flashes.length) return;
    const scale = state.scale;
    const alive = [];
    for (let i = 0; i < state.flashes.length; i += 1) {
      const flash = state.flashes[i];
      const age = now - flash.start;
      if (age < 0 || age > 750) continue;
      alive.push(flash);
      const p = age / 750;
      const radius = (0.35 + p * 1.6) * scale;

      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.9;
      ctx.beginPath();
      ctx.arc(flash.x * scale, flash.y * scale, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = Math.max(0.6, 3.2 * (1 - p));
      ctx.shadowColor = '#ff4d4d';
      ctx.shadowBlur = 16 * (1 - p);
      ctx.stroke();
      ctx.restore();
    }
    state.flashes = alive;
  }

  function render(now) {
    const cssW = els.canvas.clientWidth;
    const cssH = els.canvas.clientHeight;
    if (!cssW || !cssH) return;

    ctx.clearRect(0, 0, cssW, cssH);
    const bg = ctx.createLinearGradient(0, 0, cssW, cssH);
    bg.addColorStop(0, '#0d131d');
    bg.addColorStop(1, '#080b11');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const match = state.current;
    if (!match) return;

    const scale = state.scale;
    const walls = match.walls || [];
    ctx.fillStyle = '#212c3c';
    for (let y = 0; y < walls.length; y += 1) {
      const row = walls[y];
      for (let x = 0; x < row.length; x += 1) {
        if (row[x]) {
          ctx.fillRect(x * scale, y * scale, scale + 0.4, scale + 0.4);
        }
      }
    }

    ctx.strokeStyle = 'rgba(110, 168, 254, 0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);

    const frame = frameAtTick(Math.round(state.tickFloat));
    if (frame) {
      const shells = frame[2] || [];
      for (let i = 0; i < shells.length; i += 1) {
        drawShell(shells[i], scale);
      }
      const tanks = frame[1] || [];
      for (let i = 0; i < tanks.length; i += 1) {
        drawTank(tanks[i], scale);
      }
    }

    drawFlashes(now);
  }

  function frameLoop(now) {
    const dt = state.lastFrameTime
      ? Math.min(0.1, (now - state.lastFrameTime) / 1000)
      : 0;
    state.lastFrameTime = now;

    if (state.playing && state.current) {
      let nextTick = state.tickFloat + dt * 60 * state.speed;
      if (nextTick >= state.lastTick) {
        nextTick = state.lastTick;
        state.playing = false;
        updatePlayButton();
      }
      state.tickFloat = nextTick;
      triggerKills(nextTick);
      updateTickUI(Math.round(nextTick));
    }

    render(now);
    window.requestAnimationFrame(frameLoop);
  }

  // ---------- 事件绑定 ----------

  els.playBtn.addEventListener('click', togglePlay);
  els.prevBtn.addEventListener('click', function () {
    stepFrame(-1);
  });
  els.nextBtn.addEventListener('click', function () {
    stepFrame(1);
  });

  els.seek.addEventListener('input', function () {
    state.playing = false;
    updatePlayButton();
    seekTo(Number(els.seek.value));
  });

  els.speeds.addEventListener('click', function (ev) {
    const btn = ev.target.closest('button[data-speed]');
    if (!btn) return;
    state.speed = Number(btn.dataset.speed) || 1;
    const buttons = els.speeds.querySelectorAll('button');
    buttons.forEach(function (item) {
      item.classList.toggle('active', item === btn);
    });
  });

  window.addEventListener('keydown', function (ev) {
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      togglePlay();
    } else if (ev.code === 'ArrowLeft') {
      ev.preventDefault();
      stepFrame(-1);
    } else if (ev.code === 'ArrowRight') {
      ev.preventDefault();
      stepFrame(1);
    }
  });

  window.addEventListener('resize', resizeCanvas);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(function () {
      resizeCanvas();
    });
    observer.observe(els.canvasWrap);
  }

  window.addEventListener('error', function (ev) {
    setStatus('页面脚本错误：' + (ev.message || '未知错误'), true);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    const reason = ev.reason;
    setStatus(
      '页面脚本错误：' + (reason && reason.message ? reason.message : String(reason)),
      true
    );
  });

  // ---------- 启动 ----------

  function init() {
    resizeCanvas();
    updatePlayButton();
    boot();
    window.requestAnimationFrame(frameLoop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
