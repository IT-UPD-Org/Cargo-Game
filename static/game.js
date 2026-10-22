import { cargoPlayer } from './player.js';

(() => {
  "use strict";

  const COLS = 10;
  const ROWS = 7;
  const MAX_LIVES = 1;
  const LINE_SCORES = [0, 100, 300, 500, 800];

  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  };
  const TYPES = Object.keys(SHAPES);

  // Each piece uses a container skin: quadrant of the sprite + optional tint
  // Quadrants: 0 white, 1 blue, 2 yellow, 3 red
  const SKINS = {
    I: { q: 1 },
    O: { q: 2 },
    T: { q: 0, tint: "#9b59d0" },
    J: { q: 0 },
    L: { q: 0, tint: "#f08a24" },
  };

  // ---------- DOM ----------
  const boardCv = document.getElementById("board");
  const ctx = boardCv.getContext("2d");
  const fallingCv = document.createElement('canvas');
  fallingCv.id = 'fallingCargo';
  fallingCv.setAttribute('aria-hidden', 'true');
  document.body.append(fallingCv);
  const fallingCtx = fallingCv.getContext('2d');
  let entryRows = 5;
  const nextCv = document.getElementById("next");
  const nctx = nextCv.getContext("2d");
  const stage = document.getElementById("stage");
  const $score = document.getElementById("score");
  const $lines = document.getElementById("lines");
  const $level = document.getElementById("level");
  const $lives = document.getElementById("lives");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ovTitle");
  const ovBody = document.getElementById("ovBody");
  const ovBtn = document.getElementById("ovBtn");

  // ---------- Sprite tiles ----------
  const sprite = new Image();
  sprite.src = "assets/containers.jpg";
  let tiles = {}; // type -> canvas
  let cell = 24;
  let dpr = 1;

  function buildTiles() {
    tiles = {};
    if (!sprite.complete || !sprite.naturalWidth) return;
    const px = 48;
    const qw = sprite.naturalWidth / 2;
    const qh = sprite.naturalHeight / 2;
    for (const t of TYPES) {
      const { q, tint } = SKINS[t];
      const c = document.createElement("canvas");
      c.width = c.height = px;
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(sprite, (q % 2) * qw, Math.floor(q / 2) * qh, qw, qh, 0, 0, px, px);
      if (tint) {
        g.globalCompositeOperation = "multiply";
        g.fillStyle = tint;
        g.fillRect(0, 0, px, px);
        g.globalCompositeOperation = "destination-in";
        g.drawImage(sprite, (q % 2) * qw, Math.floor(q / 2) * qh, qw, qh, 0, 0, px, px);
        g.globalCompositeOperation = "source-over";
      }
      // Crisp pixel-art door frame, central seam and metal locking bars.
      g.fillStyle = '#152530';
      g.fillRect(0, 0, px, 2);
      g.fillRect(0, px - 2, px, 2);
      g.fillRect(0, 0, 2, px);
      g.fillRect(px - 2, 0, 2, px);
      g.fillRect(23, 2, 2, 44);
      for (const x of [12, 34]) {
        g.fillStyle = '#26343c';
        g.fillRect(x, 3, 3, 42);
        g.fillStyle = '#d5ded9';
        g.fillRect(x, 3, 1, 42);
        for (const y of [9, 34]) {
          g.fillStyle = '#e2e6d9';
          g.fillRect(x - 3, y, 7, 3);
          g.fillStyle = '#56656b';
          g.fillRect(x - 2, y + 1, 1, 1);
        }
      }
      tiles[t] = c;
    }
  }
  sprite.onload = () => { buildTiles(); draw(); };

  // ---------- Layout ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const layout = getComputedStyle(stage);
    const w = stage.clientWidth - 36;
    const h = stage.clientHeight - parseFloat(layout.paddingTop) - parseFloat(layout.paddingBottom) - 6;
    cell = Math.max(10, Math.floor(Math.min(w / COLS, h / ROWS, 70)));
    boardCv.style.width = cell * COLS + "px";
    boardCv.style.height = cell * ROWS + "px";
    stage.style.setProperty("--board-size", cell * COLS + "px");
    stage.style.setProperty("--board-height", cell * ROWS + "px");
    requestAnimationFrame(() => {
      const boardRect = boardCv.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const entryH = Math.max(0, Math.round(boardRect.top + boardCv.clientTop));
      entryRows = Math.max(1, Math.ceil(entryH / cell));
      const entryW = cell * COLS;
      Object.assign(fallingCv.style, {
        left: `${boardRect.left + boardCv.clientLeft}px`, top: '0px',
        width: `${entryW}px`, height: `${entryH}px`
      });
      const pxW = Math.round(entryW * dpr), pxH = Math.round(entryH * dpr);
      if (fallingCv.width !== pxW) fallingCv.width = pxW;
      if (fallingCv.height !== pxH) fallingCv.height = pxH;
      stage.style.setProperty('--board-top', `${boardRect.top - stageRect.top}px`);
      stage.style.setProperty('--board-height', `${boardRect.height}px`);
      const waterline = boardRect.bottom - 16;
      document.documentElement.style.setProperty('--waterline', `${waterline}px`);
    });
    boardCv.width = cell * COLS * dpr;
    boardCv.height = cell * ROWS * dpr;
    nextCv.width = 80 * dpr;
    nextCv.height = 80 * dpr;
    buildTiles();
    draw();
    drawNext();
  }
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(stage);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  // ---------- Game state ----------
  let grid, piece, nextType, bag;
  let score, lines, level;
  let lives, roundScores;
  let dropTimer, lastTime;
  const LOCK_DELAY = 500;
  let lockTimer = 0;
  let placedPieces = 0;
  let state = "menu"; // menu | playing | paused | roundOver | gameOver
  let clearing = null; // { rows, t }
  let breaking = null; // { cells, piece, t } - unsupported cargo falling/broken

  const emptyGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  function nextFromBag() {
    if (!bag || !bag.length) {
      bag = TYPES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  }

  function makePiece(type) {
    const m = SHAPES[type].map((r) => r.slice());
    const bottom = m.reduce((last, row, r) => row.some(Boolean) ? r : last, 0);
    return { type, m, x: Math.floor((COLS - m[0].length) / 2), y: -entryRows - bottom };
  }

  function collides(m, x, y) {
    for (let r = 0; r < m.length; r++)
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const gx = x + c, gy = y + r;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && grid[gy][gx]) return true;
      }
    return false;
  }

  function rotateMatrix(m) {
    const n = m.length;
    const out = Array.from({ length: n }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[c][n - 1 - r] = m[r][c];
    return out;
  }

  function startRound() {
    grid = emptyGrid();
    bag = [];
    score = 0; lines = 0; level = 1; placedPieces = 0;
    nextType = nextFromBag();
    spawn();
    dropTimer = 0;
    lastTime = performance.now();
    clearing = null;
    breaking = null;
    state = "playing";
    hideOverlay();
    updateHud();
  }

  function startGame() {
    if (!cargoPlayer.ready) return;
    lives = MAX_LIVES;
    roundScores = [];
    startRound();
  }

  function spawn() {
    lockTimer = 0;
    dropTimer = 0;
    piece = makePiece(nextType);
    nextType = nextFromBag();
    drawNext();
  }

  function dropInterval() {
    // Quickly deliver cargo from the screen edge to the hold entrance.
    const bottom = piece.m.reduce((last, row, r) => row.some(Boolean) ? r : last, 0);
    const interval = 800 / (1 + Math.min(placedPieces, 10) * 3 / 10);
    if (piece.y + bottom < 0) return Math.min(65, interval);
    return interval;
  }

  function move(dx) {
    if (state !== "playing" || clearing || breaking) return;
    if (!collides(piece.m, piece.x + dx, piece.y)) { piece.x += dx; vibrate(5); draw(); }
  }

  function rotate() {
    if (state !== "playing" || clearing || breaking || piece.type === "O") return;
    const r = rotateMatrix(piece.m);
    for (const k of [0, -1, 1, -2, 2]) {
      if (!collides(r, piece.x + k, piece.y)) {
        piece.m = r; piece.x += k; vibrate(8); draw(); return;
      }
    }
  }

  function softDrop() {
    if (state !== "playing" || clearing || breaking) return;
    if (!collides(piece.m, piece.x, piece.y + 1)) { piece.y++; score += 1; dropTimer = 0; updateHud(); }
    draw();
  }

  function hardDrop() {
    if (state !== "playing" || clearing || breaking) return;
    let d = 0;
    while (!collides(piece.m, piece.x, piece.y + 1)) { piece.y++; d++; }
    score += d * 2;
    vibrate(20);
    lock();
    draw();
  }

  // Cells of a piece at (x,y) that would hang over empty space
  function floatingCells(m, x, y) {
    const out = [];
    for (let r = 0; r < m.length; r++)
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const gx = x + c, gy = y + r;
        let below = gy + 1;
        // Follow the whole vertical stack to its actual support.
        let nextRow = r + 1;
        while (m[nextRow] && m[nextRow][c]) { nextRow++; below++; }
        if (below >= ROWS) continue;
        if (below >= 0 && !grid[below][gx]) out.push([gx, gy]);
      }
    return out;
  }

  function lock() {
    // Only landed cargo extending above the board counts as overflow.
    if (piece.m.some((row, r) => row.some(Boolean) && piece.y + r < 0)) {
      loseLife();
      return;
    }
    const floating = floatingCells(piece.m, piece.x, piece.y);
    if (floating.length) {
      breaking = { cells: floating, piece: { ...piece }, t: 0 };
      vibrate([60, 40, 60]);
      return;
    }
    let over = false;
    piece.m.forEach((row, r) => row.forEach((v, c) => {
      if (!v) return;
      const gy = piece.y + r;
      if (gy < 0) over = true;
      else grid[gy][piece.x + c] = piece.type;
    }));
    if (over) { loseLife(); return; }
    placedPieces++;
    level = 1 + Math.floor(Math.min(placedPieces, 10) * 3 / 10);

    const full = [];
    for (let r = 0; r < ROWS; r++) if (grid[r].every(Boolean)) full.push(r);
    if (full.length) {
      clearing = { rows: full, t: 0 };
      vibrate([30, 30, 30]);
    } else {
      spawn();
    }
    updateHud();
  }

  function finishClear() {
    const n = clearing.rows.length;
    for (const r of clearing.rows) { grid.splice(r, 1); grid.unshift(Array(COLS).fill(null)); }
    lines += n;
    score += LINE_SCORES[n] * level;
    clearing = null;
    spawn();
    updateHud();
  }

  function loseLife(reason) {
    if (state !== 'playing') return;
    breaking = null;
    roundScores.push(score);
    lives--;
    vibrate([80, 50, 120]);
    updateHud();
    if (lives > 0) {
      state = "roundOver";
      showOverlay(
        reason === "broken" ? "Rớt công rồi!" : "Tàu chở cao quá giới hạn",
        `<p>Điểm lượt ${roundScores.length}</p><div class="big">${score}</div>
         <p>Còn ${lives} mạng</p>`,
        "Lượt tiếp theo",
        startRound
      );
    } else {
      state = "gameOver";
      const top = Math.max(...roundScores);
      showOverlay(
        reason === 'broken' ? 'Rớt công rồi!' : 'Tàu chở cao quá giới hạn',
        `<p>Điểm cao nhất</p><div class="big">${top}</div>`,
        "Chơi lại",
        startGame
      );
      const status = document.getElementById('playerStatus');
      status.textContent = 'Đang lưu điểm…';
      ovBtn.disabled = true;
      const savedScores = roundScores.slice();
      const playId = crypto.randomUUID();
      const save = async () => {
        ovBtn.disabled = true;
        try {
          const highest = await cargoPlayer.save(savedScores, playId);
          ovBody.innerHTML = `<p>Điểm cao nhất</p><div class="big">${highest}</div>`;
          status.textContent = `Mã của bạn: ${cargoPlayer.firstPlayCode}`;
          ovBtn.textContent = 'Chơi lại';
          ovAction = startGame;
        } catch (error) {
          status.textContent = error.message;
          ovBtn.textContent = 'Thử lưu lại';
          ovAction = save;
        } finally { ovBtn.disabled = false; }
      };
      void save();
    }
  }

  // ---------- Overlay ----------
  let ovAction = startGame;
  function showOverlay(title, html, btn, action) {
    ovTitle.textContent = title;
    ovBody.innerHTML = html;
    ovBtn.textContent = btn;
    ovAction = action;
    overlay.classList.add("show");
  }
  function hideOverlay() { overlay.classList.remove("show"); }
  ovBtn.addEventListener("click", () => ovAction());


  // ---------- HUD ----------
  function updateHud() {
    $score.textContent = score;
  }

  // ---------- Rendering ----------
  function drawTile(g, type, x, y, size, alpha = 1) {
    g.imageSmoothingEnabled = false;
    g.globalAlpha = alpha;
    const t = tiles[type];
    if (t) g.drawImage(t, x, y, size, size);
    else { g.fillStyle = SKINS[type].tint || "#888"; g.fillRect(x, y, size, size); }
    g.globalAlpha = 1;
  }

  function draw() {
    fallingCtx.clearRect(0, 0, fallingCv.width, fallingCv.height);
    if (!grid) return;
    const s = cell * dpr;
    ctx.clearRect(0, 0, boardCv.width, boardCv.height);

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) { ctx.moveTo(c * s + 0.5, 0); ctx.lineTo(c * s + 0.5, ROWS * s); }
    for (let r = 1; r < ROWS; r++) { ctx.moveTo(0, r * s + 0.5); ctx.lineTo(COLS * s, r * s + 0.5); }
    ctx.stroke();

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c]) drawTile(ctx, grid[r][c], c * s, r * s, s);

    if (breaking) {
      const p = breaking.piece;
      const k = Math.min(1, breaking.t / 900);
      const shake = Math.sin(breaking.t / 25) * s * 0.08 * (1 - k);
      p.m.forEach((row, r) => row.forEach((v, c) => {
        const falling = breaking.cells.some(([x, y]) => x === p.x + c && y === p.y + r);
        if (v && !falling && p.y + r >= 0) drawTile(ctx, p.type, (p.x + c) * s + shake, (p.y + r) * s, s);
      }));
      for (const [gx, gy] of breaking.cells) {
        let bottom = gy;
        while (breaking.cells.some(([x, y]) => x === gx && y === bottom + 1)) bottom++;
        let y = bottom + 1;
        while (y < ROWS && !grid[y][gx]) y++;
        const x0 = gx * s;
        const fall = Math.min(1, breaking.t / 480);
        const landingY = (gy + y - bottom - 1) * s;
        const fallY = gy * s + (landingY - gy * s) * fall * fall;
        if (fall < 1) {
          drawTile(ctx, p.type, x0, fallY, s);
          continue;
        }
        const burst = Math.min(1, (breaking.t - 480) / 420);
        drawTile(ctx, p.type, x0, landingY, s, 1 - burst);
        ctx.fillStyle = `rgba(255,178,79,${1 - burst})`;
        for (let i = 0; i < 10; i++) {
          const angle = i * Math.PI * 2 / 10;
          const distance = burst * s * (0.5 + (i % 3) * 0.3);
          const size = Math.max(2, s * 0.12 * (1 - burst));
          ctx.fillRect(Math.round(x0 + s / 2 + Math.cos(angle) * distance), Math.round(landingY + s / 2 + Math.sin(angle) * distance + burst * burst * s), size, size);
        }
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(2, s * 0.06);
        ctx.beginPath();
        ctx.moveTo(x0 + s * 0.3, landingY + s * 0.2);
        ctx.lineTo(x0 + s * 0.55, landingY + s * 0.5);
        ctx.lineTo(x0 + s * 0.4, landingY + s * 0.65);
        ctx.lineTo(x0 + s * 0.7, landingY + s * 0.85);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.font = `900 ${s * 0.9}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = k;
      ctx.globalAlpha = 1;
      return;
    }

    if (clearing) {
      const a = 0.5 + 0.5 * Math.sin(clearing.t / 40);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      for (const r of clearing.rows) ctx.fillRect(0, r * s, COLS * s, s);
      return;
    }

    if (piece && state === "playing") {
      piece.m.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return;
        const gy = piece.y + r;
        if (gy >= 0) drawTile(ctx, piece.type, (piece.x + c) * s, gy * s, s);
        else drawTile(fallingCtx, piece.type, (piece.x + c) * s, fallingCv.height + gy * s, s);
      }));
    }
  }

  function drawNext() {
    nctx.clearRect(0, 0, nextCv.width, nextCv.height);
    if (!nextType) return;
    const m = SHAPES[nextType];
    let minR = 9, maxR = -1, minC = 9, maxC = -1;
    m.forEach((row, r) => row.forEach((v, c) => {
      if (v) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
    }));
    const w = maxC - minC + 1, h = maxR - minR + 1;
    const sz = Math.floor(nextCv.width / 4.4);
    const ox = (nextCv.width - w * sz) / 2, oy = (nextCv.height - h * sz) / 2;
    m.forEach((row, r) => row.forEach((v, c) => {
      if (v) drawTile(nctx, nextType, ox + (c - minC) * sz, oy + (r - minR) * sz, sz);
    }));
  }

  // ---------- Loop ----------
  function loop(now) {
    const dt = Math.min(100, now - (lastTime || now));
    lastTime = now;
    if (state === "playing") {
      const before = `${piece.x},${piece.y},${piece.type},${placedPieces}`;
      if (breaking) {
        breaking.t += dt;
        if (breaking.t > 900) loseLife("broken");
      } else if (clearing) {
        clearing.t += dt;
        if (clearing.t > 250) finishClear();
      } else {
        if (collides(piece.m, piece.x, piece.y + 1)) {
          dropTimer = 0;
          lockTimer += dt;
          if (lockTimer >= LOCK_DELAY) lock();
        } else {
          lockTimer = 0;
          dropTimer += dt;
          while (dropTimer >= dropInterval() && !collides(piece.m, piece.x, piece.y + 1)) {
            dropTimer -= dropInterval();
            piece.y++;
          }
        }
      }
      const after = piece ? `${piece.x},${piece.y},${piece.type},${placedPieces}` : '';
      if (breaking || clearing || before !== after) draw();
    }
    requestAnimationFrame(loop);
  }

  // ---------- Input: keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target.closest('form')) return;
    if ((e.key === "Enter" || e.key === " ") && overlay.classList.contains("show")) { e.preventDefault(); if (!ovBtn.disabled) ovAction(); return; }
    switch (e.key) {
      case "ArrowLeft": move(-1); break;
      case "ArrowRight": move(1); break;
      case "ArrowDown": softDrop(); break;
      case "ArrowUp": case "x": case "X": rotate(); break;
      case " ": hardDrop(); break;
      default: return;
    }
    e.preventDefault();
  });

  // ---------- Input: on-screen buttons (with auto-repeat) ----------
  const actions = { left: () => move(-1), right: () => move(1), down: softDrop, rotate, drop: hardDrop };
  const repeatable = new Set(["left", "right"]);
  document.querySelectorAll(".ctl").forEach((btn) => {
    const act = btn.dataset.action;
    let delayT, repT;
    const stop = () => { clearTimeout(delayT); clearInterval(repT); btn.classList.remove("pressed"); };
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      btn.classList.add("pressed");
      actions[act]();
      if (repeatable.has(act)) {
        delayT = setTimeout(() => { repT = setInterval(actions[act], act === "down" ? 40 : 70); }, 170);
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });


  function vibrate(p) { if (navigator.vibrate) try { navigator.vibrate(p); } catch (_) {} }

  // ---------- Boot ----------
  grid = emptyGrid();
  lives = MAX_LIVES; score = 0; lines = 0; level = 1;
  updateHud();
  resize();
  requestAnimationFrame(loop);
})();
