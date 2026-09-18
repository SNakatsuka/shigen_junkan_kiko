"use strict";

const { WorldGenerator } = typeof module !== "undefined" && module.exports
  ? require("./world.js")
  : window.WorldSystem;

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
  initialPower: 18,
  generatorFuelCost: 1,
  generatorPowerGain: 6,
});

const TYPE = Object.freeze({ ROCK: "rock", TUNNEL: "tunnel", WELL: "well", REFINERY: "refinery", CORE: "core", SEALED: "sealed" });

class Game {
  constructor() {
    this.gridEl = document.querySelector("#grid");
    this.messageEl = document.querySelector("#message");
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
    this.power = CONFIG.initialPower;
    this.refined = 0;
    this.leaked = 0;
    this.gameOver = false;
    this.paused = false;
    this.speed = 1;
    this.player = { x: 21, y: 24, dir: "up" };
    this.seed = Math.floor(Math.random() * 1000000);
    const operatorLabel = document.querySelector("#modeLabel");
    if (operatorLabel) delete operatorLabel.dataset.flash;
    this.cells = Array.from({ length: CONFIG.cols * CONFIG.rows }, (_, i) => ({
      x: i % CONFIG.cols,
      y: Math.floor(i / CONFIG.cols),
      type: TYPE.ROCK,
      oil: 0,
      variant: (i * 17 + Math.floor(i / CONFIG.cols) * 11) % 4,
      well: null,
      hiddenWell: null,
      active: false,
    }));
    this.wells = WorldGenerator.generate(this.seed, CONFIG.cols);
    this.wells.forEach((well) => {
      const cell = this.at(well.x, well.y);
      cell.hiddenWell = well;
      cell.well = well;
    });

    // A small, safe starting chamber: enough to understand the system, not enough to solve it.
    this.carveRect(17, 22, 25, 25);
    // The central well can be connected straight down to this starter unit.
    // Excess oil then continues toward the CORE below it.
    const refinery = this.at(21, 22);
    refinery.type = TYPE.REFINERY;
    for (let x = 20; x <= 22; x += 1) this.at(x, 25).type = TYPE.CORE;

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
      fragment.append(el);
      this.els.push(el);
    });
    this.gridEl.append(fragment);
    this.playerEl = document.createElement("span");
    this.playerEl.setAttribute("aria-label", "作業員");
    this.render(true);
  }

  bindUI() {
    document.querySelector("#pauseButton").addEventListener("click", () => {
      if (this.gameOver) return;
      this.paused = !this.paused;
      document.querySelector("#pauseButton").textContent = this.paused ? "運転再開" : "一時停止";
    });
    document.querySelector("#speedButton").addEventListener("click", () => {
      this.speed = this.speed === 1 ? 2 : 1;
      document.querySelector("#speedButton").textContent = `速度 ×${this.speed}`;
    });
    document.querySelector("#generatorButton").addEventListener("click", () => this.generatePower());
    document.querySelector("#resetButton").addEventListener("click", () => this.reset());
    window.addEventListener("keydown", (event) => this.handleKey(event));
  }

  handleKey(event) {
    const directions = {
      ArrowUp: [0, -1, "up"], ArrowDown: [0, 1, "down"],
      ArrowLeft: [-1, 0, "left"], ArrowRight: [1, 0, "right"],
    };
    if (directions[event.key]) {
      event.preventDefault();
      if (!this.gameOver) this.movePlayer(...directions[event.key]);
      return;
    }
    const key = event.key.toLowerCase();
    if (["d", "r", "s", "g"].includes(key) || event.code === "Space") event.preventDefault();
    if (this.gameOver) return;
    if (key === "d") this.digFacing();
    if (key === "r") this.buildRefineryFacing();
    if (key === "s") this.sealFacing();
    if (key === "g") this.generatePower();
    if (event.code === "Space") document.querySelector("#pauseButton").click();
  }

  directionDelta() {
    return { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.player.dir];
  }

  facingCell() {
    const [dx, dy] = this.directionDelta();
    return this.at(this.player.x + dx, this.player.y + dy);
  }

  movePlayer(dx, dy, dir) {
    this.player.dir = dir;
    const target = this.at(this.player.x + dx, this.player.y + dy);
    if (target && [TYPE.TUNNEL, TYPE.REFINERY].includes(target.type)) {
      this.player.x = target.x;
      this.player.y = target.y;
    }
    this.renderPlayer();
  }

  digFacing() {
    const cell = this.facingCell();
    if (!cell || cell.type !== TYPE.ROCK) {
      this.flashStatus("正面に掘削可能な岩盤なし");
      return;
    }
    const cost = this.digCost(cell);
    if (this.power < cost) {
      this.flashStatus(`電力不足 / 必要 ${cost.toFixed(2)} kE`);
      return;
    }
    this.power -= cost;
    if (cell.hiddenWell) {
      this.discoverWell(cell);
    } else {
      cell.type = TYPE.TUNNEL;
      this.renderCell(this.index(cell.x, cell.y), true);
      this.flashStatus(`掘削完了 -${cost.toFixed(2)} kE`);
    }
    this.updateUI();
  }

  discoverWell(cell) {
    const well = cell.hiddenWell;
    well.discovered = true;
    cell.type = TYPE.WELL;
    const blowout = Math.min(well.reserve, 0.16 * well.pressure);
    const playerCell = this.at(this.player.x, this.player.y);
    playerCell.oil = Math.min(CONFIG.capacity, playerCell.oil + blowout);
    well.reserve -= blowout;
    this.flashStatus(`${well.name}を発見 / 圧力 ${well.pressure.toFixed(2)}`);
    this.render(true);
  }

  buildRefineryFacing() {
    const cell = this.facingCell();
    if (!cell || cell.type !== TYPE.TUNNEL) {
      this.flashStatus("正面の空き坑道にのみ設置可能");
      return;
    }
    if (this.fuel < CONFIG.refineryCost) {
      this.flashStatus(`燃料不足 / 必要 ${CONFIG.refineryCost.toFixed(1)} u`);
      return;
    }
    this.fuel -= CONFIG.refineryCost;
    cell.type = TYPE.REFINERY;
    this.renderCell(this.index(cell.x, cell.y), true);
    this.flashStatus("精製機を設置");
    this.updateUI();
  }

  sealFacing() {
    const cell = this.facingCell();
    if (!cell || cell.type !== TYPE.TUNNEL) {
      this.flashStatus("正面の坑道のみ封鎖可能");
      return;
    }
    if (this.fuel < CONFIG.sealCost) {
      this.flashStatus(`燃料不足 / 必要 ${CONFIG.sealCost.toFixed(1)} u`);
      return;
    }
    this.fuel -= CONFIG.sealCost;
    cell.oil = 0;
    cell.type = TYPE.SEALED;
    this.renderCell(this.index(cell.x, cell.y), true);
    this.flashStatus("坑道を封鎖");
    this.updateUI();
  }

  digCost(cell) {
    // Deeper layers and denser visual rock variants take more work.
    return 0.32 + cell.y * 0.018 + cell.variant * 0.035;
  }

  generatePower() {
    if (this.gameOver || this.fuel < CONFIG.generatorFuelCost) return;
    this.fuel -= CONFIG.generatorFuelCost;
    this.power += CONFIG.generatorPowerGain;
    this.flashStatus(`補助発電 +${CONFIG.generatorPowerGain.toFixed(1)} kE`);
    this.updateUI();
  }

  flashStatus(text) {
    const label = document.querySelector("#modeLabel");
    const token = String(performance.now());
    label.dataset.flash = token;
    label.textContent = text;
    window.setTimeout(() => {
      if (label.dataset.flash !== token) return;
      delete label.dataset.flash;
      this.updateOperatorLabel();
    }, 1100);
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
      if (!well.discovered || well.reserve <= 0) continue;
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
    this.renderPlayer();
    this.updateUI();
  }

  renderPlayer() {
    if (!this.playerEl) return;
    this.playerEl.className = `operator dir-${this.player.dir}`;
    const cellEl = this.els[this.index(this.player.x, this.player.y)];
    if (cellEl && this.playerEl.parentElement !== cellEl) cellEl.append(this.playerEl);
    this.updateOperatorLabel();
  }

  updateOperatorLabel() {
    const label = document.querySelector("#modeLabel");
    if (!label || label.dataset.flash) return;
    const names = { up: "北", down: "南", left: "西", right: "東" };
    label.textContent = `OPERATOR: ${this.player.x},${this.player.y} / ${names[this.player.dir]}向き`;
  }

  renderCell(i, force = false) {
    const cell = this.cells[i];
    const el = this.els[i];
    if (!el) return;
    const oilBand = Math.round(cell.oil * 20);
    const signal = [TYPE.TUNNEL, TYPE.REFINERY].includes(cell.type)
      ? WorldGenerator.signalAt(this.wells, cell.x, cell.y)
      : 0;
    const signature = `${cell.type}:${oilBand}:${cell.active}:${signal}`;
    if (!force && el.dataset.signature === signature) return;
    el.dataset.signature = signature;
    el.className = `cell ${cell.type} variant-${cell.variant}`;
    if (cell.type === TYPE.WELL && cell.well?.grade === "HIGH") el.classList.add("high");
    if (cell.active) el.classList.add("running");
    if (cell.oil > 0.82) el.classList.add("pressurized");
    if (signal) el.classList.add(`signal-${signal}`);
    el.style.setProperty("--oil", String(Math.max(0, Math.min(1, cell.oil))));
    if (cell.type === TYPE.WELL) {
      el.title = `${cell.well.name}\n圧力 ${cell.well.pressure.toFixed(2)} / 埋蔵 ${cell.well.reserve.toFixed(1)}`;
    } else if (this.isFluidCell(cell)) {
      const signalNames = ["兆候なし", "微弱な油臭", "油徴あり", "強い圧力振動"];
      el.title = `油量 ${cell.oil.toFixed(2)} / 1.00\n地質: ${signalNames[signal]}`;
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
    document.querySelector("#powerValue").textContent = this.power.toFixed(1);
    document.querySelector("#generatorButton").disabled = this.fuel < CONFIG.generatorFuelCost || this.gameOver;
    document.querySelector("#refinedValue").textContent = this.refined.toFixed(1);
    document.querySelector("#leakValue").textContent = this.leaked.toFixed(1);
    document.querySelector("#timeValue").textContent = this.formatTime(this.time);
    document.querySelector("#seedValue").textContent = String(this.seed).padStart(6, "0");
    document.querySelector("#wellList").innerHTML = this.wells.map((well) => `
      ${well.discovered ? `<article class="well-card">
        <header><span>${well.name}</span><em>${well.grade} PRESSURE</em></header>
        <dl><dt>圧力</dt><dd>${well.pressure.toFixed(2)}</dd><dt>瞬間流量</dt><dd>${well.output.toFixed(2)}</dd><dt>埋蔵量</dt><dd>${well.reserve.toFixed(1)} u</dd></dl>
        <div class="reserve"><i style="width:${Math.max(0, well.reserve / well.initialReserve * 100)}%"></i></div>
      </article>` : `<article class="well-card unknown"><header><span>未確認資源</span><em>NO DATA</em></header><p>坑道の地質兆候を追跡せよ</p></article>`}`).join("");
  }

  formatTime(seconds) {
    const min = Math.floor(seconds / 60).toString().padStart(2, "0");
    const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${min}:${sec}`;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Game, CONFIG, TYPE };
} else {
  new Game();
}
