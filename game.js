"use strict";

const CONFIG = Object.freeze({
  cols: 42,
  rows: 28,
  tickMs: 80,
  capacity: 1,
  conductance: 0.19,
  gravityHead: 0.055,
  maxEdgeFlow: 0.16,
  refineryRate: 0.085,
  coreDamageRate: 2.8,
  refineryCost: 4,
  sealCost: 1,
});

const WELL_BLUEPRINTS = [
  { name: "第1油田", x: 7,  y: 3, pressure: 1.25, maxOutput: 0.048, reserve: 52, grade: "LOW" },
  { name: "第2油田", x: 21, y: 2, pressure: 1.78, maxOutput: 0.075, reserve: 42, grade: "MID" },
  { name: "第3油田", x: 34, y: 4, pressure: 2.35, maxOutput: 0.105, reserve: 31, grade: "HIGH" },
];

const TYPE = Object.freeze({ ROCK: "rock", TUNNEL: "tunnel", WELL: "well", REFINERY: "refinery", CORE: "core", SEALED: "sealed" });

class Game {
  constructor() {
    this.gridEl = document.querySelector("#grid");
    this.messageEl = document.querySelector("#message");
    this.tool = "dig";
    this.dragging = false;
    this.paused = false;
    this.speed = 1;
    this.lastFrame = performance.now();
    this.lastRender = 0;
    this.accumulator = 0;
    this.cells = [];
    this.els = [];
    this.bindUI();
    this.reset();
    requestAnimationFrame((time) => this.frame(time));
  }

  index(x, y) { return y * CONFIG.cols + x; }
  at(x, y) { return x < 0 || y < 0 || x >= CONFIG.cols || y >= CONFIG.rows ? null : this.cells[this.index(x, y)]; }
  isFluidCell(cell) { return cell && [TYPE.TUNNEL, TYPE.REFINERY, TYPE.CORE].includes(cell.type); }

  reset() {
    this.time = 0;
    this.core = 100;
    this.fuel = 0;
    this.refined = 0;
    this.leaked = 0;
    this.gameOver = false;
    this.paused = false;
    this.speed = 1;
    this.cells = Array.from({ length: CONFIG.cols * CONFIG.rows }, (_, i) => ({
      x: i % CONFIG.cols,
      y: Math.floor(i / CONFIG.cols),
      type: TYPE.ROCK,
      oil: 0,
      variant: (i * 17 + Math.floor(i / CONFIG.cols) * 11) % 4,
      well: null,
      active: false,
    }));
    this.wells = WELL_BLUEPRINTS.map((data) => ({ ...data, initialReserve: data.reserve, output: 0 }));
    this.wells.forEach((well) => {
      const cell = this.at(well.x, well.y);
      cell.type = TYPE.WELL;
      cell.well = well;
    });

    // A small, safe starting chamber: enough to understand the system, not enough to solve it.
    this.carveRect(17, 22, 25, 25);
    const refinery = this.at(19, 23);
    refinery.type = TYPE.REFINERY;
    for (let x = 20; x <= 22; x += 1) this.at(x, 24).type = TYPE.CORE;

    this.buildGrid();
    this.updateUI();
    this.messageEl.classList.add("hidden");
    document.querySelector("#pauseButton").textContent = "一時停止";
    document.querySelector("#speedButton").textContent = "速度 ×1";
  }

  carveRect(x1, y1, x2, y2) {
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) this.at(x, y).type = TYPE.TUNNEL;
  }

  buildGrid() {
    this.gridEl.replaceChildren();
    this.els = [];
    const fragment = document.createDocumentFragment();
    this.cells.forEach((cell, i) => {
      const el = document.createElement("div");
      el.className = `cell ${cell.type} variant-${cell.variant}`;
      el.dataset.index = String(i);
      el.setAttribute("role", "gridcell");
      el.addEventListener("pointerdown", (event) => this.pointerDown(event, i));
      el.addEventListener("pointerenter", () => this.pointerEnter(i));
      el.addEventListener("contextmenu", (event) => { event.preventDefault(); this.setTool("dig"); });
      fragment.append(el);
      this.els.push(el);
    });
    this.gridEl.append(fragment);
    this.render(true);
  }

  bindUI() {
    window.addEventListener("pointerup", () => { this.dragging = false; });
    document.querySelectorAll(".tool").forEach((button) => button.addEventListener("click", () => this.setTool(button.dataset.tool)));
    document.querySelector("#pauseButton").addEventListener("click", () => {
      if (this.gameOver) return;
      this.paused = !this.paused;
      document.querySelector("#pauseButton").textContent = this.paused ? "運転再開" : "一時停止";
    });
    document.querySelector("#speedButton").addEventListener("click", () => {
      this.speed = this.speed === 1 ? 2 : 1;
      document.querySelector("#speedButton").textContent = `速度 ×${this.speed}`;
    });
    document.querySelector("#resetButton").addEventListener("click", () => this.reset());
    window.addEventListener("keydown", (event) => {
      if (event.key === "1") this.setTool("dig");
      if (event.key === "2") this.setTool("refinery");
      if (event.key === "3") this.setTool("seal");
      if (event.code === "Space") { event.preventDefault(); document.querySelector("#pauseButton").click(); }
    });
  }

  setTool(tool) {
    this.tool = tool;
    const labels = { dig: "掘削", refinery: "精製機", seal: "封鎖材" };
    document.querySelectorAll(".tool").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    document.querySelector("#modeLabel").textContent = `MODE: ${labels[tool]}`;
  }

  pointerDown(event, index) {
    if (event.button !== 0 || this.gameOver) return;
    this.dragging = true;
    this.useTool(index);
  }

  pointerEnter(index) {
    if (this.dragging && this.tool === "dig" && !this.gameOver) this.useTool(index);
  }

  useTool(index) {
    const cell = this.cells[index];
    if (this.tool === "dig" && cell.type === TYPE.ROCK) {
      cell.type = TYPE.TUNNEL;
      this.renderCell(index, true);
    } else if (this.tool === "refinery" && cell.type === TYPE.TUNNEL && this.fuel >= CONFIG.refineryCost) {
      this.fuel -= CONFIG.refineryCost;
      cell.type = TYPE.REFINERY;
      this.renderCell(index, true);
    } else if (this.tool === "seal" && this.isFluidCell(cell) && cell.type !== TYPE.CORE && this.fuel >= CONFIG.sealCost) {
      this.fuel -= CONFIG.sealCost;
      cell.oil = 0;
      cell.type = TYPE.SEALED;
      this.renderCell(index, true);
    }
    this.updateUI();
  }

  frame(now) {
    const elapsed = Math.min(now - this.lastFrame, 120);
    this.lastFrame = now;
    if (!this.paused && !this.gameOver) {
      this.accumulator += elapsed * this.speed;
      while (this.accumulator >= CONFIG.tickMs) {
        this.update(CONFIG.tickMs / 1000);
        this.accumulator -= CONFIG.tickMs;
      }
    }
    if (now - this.lastRender >= CONFIG.tickMs) {
      this.render();
      this.lastRender = now;
    }
    requestAnimationFrame((time) => this.frame(time));
  }

  update(dt) {
    this.time += dt;
    this.injectFromWells(dt);
    this.flow(dt);
    this.runRefineries(dt);
    this.damageCore(dt);
    if (this.core <= 0) this.endGame();
  }

  injectFromWells(dt) {
    for (const well of this.wells) {
      well.output = 0;
      if (well.reserve <= 0) continue;
      const neighbors = this.neighbors(well.x, well.y).filter((cell) => this.isFluidCell(cell));
      if (!neighbors.length) continue;
      neighbors.sort((a, b) => a.oil - b.oil);
      const target = neighbors[0];
      const backPressure = target.oil * 1.4;
      const pressureFactor = Math.max(0, Math.min(1, well.pressure - backPressure));
      const amount = Math.min(well.maxOutput * pressureFactor * dt * 10, CONFIG.capacity - target.oil, well.reserve);
      if (amount > 0) {
        target.oil += amount;
        well.reserve -= amount;
        well.output = amount / dt;
      }
    }
  }

  flow(dt) {
    const delta = new Float32Array(this.cells.length);
    for (const cell of this.cells) {
      if (!this.isFluidCell(cell)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const other = this.at(cell.x + dx, cell.y + dy);
        if (!this.isFluidCell(other)) continue;
        const i = this.index(cell.x, cell.y);
        const j = this.index(other.x, other.y);
        const aOil = cell.oil + delta[i];
        const bOil = other.oil + delta[j];
        // Screen Y grows downward. Subtracting the Y head makes an upper
        // cell's potential higher, so equal volumes naturally flow downward.
        const aHead = aOil - cell.y * CONFIG.gravityHead;
        const bHead = bOil - other.y * CONFIG.gravityHead;
        let amount = (aHead - bHead) * CONFIG.conductance * dt * 10;
        amount = Math.max(-CONFIG.maxEdgeFlow, Math.min(CONFIG.maxEdgeFlow, amount));
        if (amount > 0) amount = Math.min(amount, aOil, CONFIG.capacity - bOil);
        else amount = -Math.min(-amount, bOil, CONFIG.capacity - aOil);
        delta[i] -= amount;
        delta[j] += amount;
      }
    }
    this.cells.forEach((cell, i) => {
      if (this.isFluidCell(cell)) cell.oil = Math.max(0, Math.min(CONFIG.capacity, cell.oil + delta[i]));
    });
  }

  runRefineries(dt) {
    for (const cell of this.cells) {
      cell.active = false;
      if (cell.type !== TYPE.REFINERY || cell.oil <= 0) continue;
      const amount = Math.min(cell.oil, CONFIG.refineryRate * dt * 10);
      cell.oil -= amount;
      this.fuel += amount;
      this.refined += amount;
      cell.active = amount > 0.0001;
    }
  }

  damageCore(dt) {
    for (const cell of this.cells) {
      if (cell.type !== TYPE.CORE || cell.oil <= 0) continue;
      const amount = Math.min(cell.oil, 0.12 * dt * 10);
      cell.oil -= amount;
      this.leaked += amount;
      this.core = Math.max(0, this.core - amount * CONFIG.coreDamageRate);
    }
  }

  neighbors(x, y) { return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => this.at(x + dx, y + dy)).filter(Boolean); }

  endGame() {
    this.gameOver = true;
    this.messageEl.innerHTML = `CORE機能停止<br><small>稼働時間 ${this.formatTime(this.time)} / 精製 ${this.refined.toFixed(1)} u</small>`;
    this.messageEl.classList.remove("hidden");
  }

  render(force = false) {
    this.cells.forEach((cell, i) => this.renderCell(i, force));
    this.updateUI();
  }

  renderCell(i, force = false) {
    const cell = this.cells[i];
    const el = this.els[i];
    if (!el) return;
    const oilBand = Math.round(cell.oil * 20);
    const signature = `${cell.type}:${oilBand}:${cell.active}`;
    if (!force && el.dataset.signature === signature) return;
    el.dataset.signature = signature;
    el.className = `cell ${cell.type} variant-${cell.variant}`;
    if (cell.type === TYPE.WELL && cell.well?.grade === "HIGH") el.classList.add("high");
    if (cell.active) el.classList.add("running");
    if (cell.oil > 0.82) el.classList.add("pressurized");
    el.style.setProperty("--oil", String(Math.max(0, Math.min(1, cell.oil))));
    if (cell.type === TYPE.WELL) {
      el.title = `${cell.well.name}\n圧力 ${cell.well.pressure.toFixed(2)} / 埋蔵 ${cell.well.reserve.toFixed(1)}`;
    } else if (this.isFluidCell(cell)) {
      el.title = `油量 ${cell.oil.toFixed(2)} / 1.00`;
    } else {
      el.title = cell.type === TYPE.ROCK ? "岩盤：掘削可能" : "封鎖済み";
    }
  }

  updateUI() {
    document.querySelector("#coreValue").textContent = this.core.toFixed(0);
    const coreBar = document.querySelector("#coreBar");
    coreBar.style.width = `${this.core}%`;
    coreBar.style.background = this.core > 55 ? "#88a96c" : this.core > 25 ? "#d6a847" : "#c65d3e";
    document.querySelector("#fuelValue").textContent = this.fuel.toFixed(1);
    document.querySelector("#refinedValue").textContent = this.refined.toFixed(1);
    document.querySelector("#leakValue").textContent = this.leaked.toFixed(1);
    document.querySelector("#timeValue").textContent = this.formatTime(this.time);
    document.querySelector("#wellList").innerHTML = this.wells.map((well) => `
      <article class="well-card">
        <header><span>${well.name}</span><em>${well.grade} PRESSURE</em></header>
        <dl><dt>圧力</dt><dd>${well.pressure.toFixed(2)}</dd><dt>瞬間流量</dt><dd>${well.output.toFixed(2)}</dd><dt>埋蔵量</dt><dd>${well.reserve.toFixed(1)} u</dd></dl>
        <div class="reserve"><i style="width:${Math.max(0, well.reserve / well.initialReserve * 100)}%"></i></div>
      </article>`).join("");
  }

  formatTime(seconds) {
    const min = Math.floor(seconds / 60).toString().padStart(2, "0");
    const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${min}:${sec}`;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Game, CONFIG, WELL_BLUEPRINTS, TYPE };
} else {
  new Game();
}
