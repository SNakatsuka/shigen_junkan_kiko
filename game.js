(() => {
  "use strict";

  const COLS = 18;
  const ROWS = 11;
  const TICK_MS = 90;

  const CELL_CAPACITY = 1.0;
  const CONDUCTANCE = 0.22;
  const GRAVITY_HEAD = 0.20;
  const MAX_EDGE_FLOW = 0.24;
  const REFINERY_RATE = 0.16;
  const CORE_DAMAGE_PER_OIL = 18;

  const TILE = Object.freeze({
    ROCK: "rock",
    TUNNEL: "tunnel",
    SOURCE: "source",
    REFINERY: "refinery",
    CORE: "core"
  });

  class Game {
    constructor() {
      this.gridEl = document.getElementById("grid");
      this.coreHpEl = document.getElementById("coreHp");
      this.fuelEl = document.getElementById("fuel");
      this.oilCountEl = document.getElementById("oilCount");
      this.messageEl = document.getElementById("message");
      this.restartBtn = document.getElementById("restartBtn");

      this.gridEl.style.setProperty("--cols", COLS);
      this.restartBtn.addEventListener("click", () => this.reset());
      this.reset();
    }

    reset() {
      if (this.timer) clearInterval(this.timer);

      this.coreHp = 100;
      this.fuel = 0;
      this.gameOver = false;
      this.cells = [];
      this.oil = new Float64Array(COLS * ROWS);

      this.oilFields = [
        {
          name: "第1油田",
          x: 4,
          y: 1,
          pressure: 1.30,
          maxOutput: 0.090,
          reserve: 90
        },
        {
          name: "第2油田",
          x: 13,
          y: 1,
          pressure: 2.10,
          maxOutput: 0.155,
          reserve: 55
        }
      ];

      this.buildWorld();
      this.render();
      this.setMessage("低圧油田と高圧油田。掘り方で流量を制御してください。");

      this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    buildWorld() {
      for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) {
          row.push({ x, y, type: TILE.ROCK, diggable: true });
        }
        this.cells.push(row);
      }

      for (const field of this.oilFields) {
        this.setTile(field.x, field.y, TILE.SOURCE, false);
      }

      [
        [4, 2], [4, 3], [5, 3],
        [13, 2], [13, 3], [12, 3],
        [8, 7], [9, 7],
        [8, 8], [9, 8]
      ].forEach(([x, y]) => this.setTile(x, y, TILE.TUNNEL, false));

      this.setTile(7, 6, TILE.REFINERY, false);
      this.setTile(10, 6, TILE.REFINERY, false);

      this.setTile(8, 9, TILE.CORE, false);
      this.setTile(9, 9, TILE.CORE, false);
    }

    idx(x, y) {
      return y * COLS + x;
    }

    getCell(x, y) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
      return this.cells[y][x];
    }

    setTile(x, y, type, diggable = false) {
      const cell = this.getCell(x, y);
      if (!cell) return;
      cell.type = type;
      cell.diggable = diggable;
    }

    isFluidCell(cell) {
      return cell && (
        cell.type === TILE.TUNNEL ||
        cell.type === TILE.SOURCE
      );
    }

    dig(x, y) {
      if (this.gameOver) return;

      const cell = this.getCell(x, y);
      if (!cell || cell.type !== TILE.ROCK || !cell.diggable) return;

      cell.type = TILE.TUNNEL;
      cell.diggable = false;
      this.setMessage(`区画 ${x + 1}-${y + 1} を掘削。`);
      this.render();
    }

    pressureAt(x, y, oilArray = this.oil) {
      const cell = this.getCell(x, y);
      if (!cell) return 0;

      const amount = oilArray[this.idx(x, y)];
      const field = this.oilFields.find(f => f.x === x && f.y === y);

      if (field && field.reserve > 0) {
        return amount / CELL_CAPACITY + field.pressure;
      }

      return amount / CELL_CAPACITY;
    }

    injectFromFields(nextOil) {
      for (const field of this.oilFields) {
        if (field.reserve <= 0) continue;

        const i = this.idx(field.x, field.y);
        const localBackPressure = nextOil[i] / CELL_CAPACITY;
        const pressureMargin = Math.max(0, field.pressure - localBackPressure);
        const pressureFactor = Math.min(1, pressureMargin / field.pressure);

        const produced = Math.min(
          field.maxOutput * pressureFactor,
          field.reserve
        );

        nextOil[i] += produced;
        field.reserve -= produced;
      }
    }

    simulatePressureFlow() {
      const before = this.oil;
      const delta = new Float64Array(before.length);

      const edges = [
        [1, 0],
        [0, 1]
      ];

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const aCell = this.getCell(x, y);
          if (!this.isFluidCell(aCell)) continue;

          for (const [dx, dy] of edges) {
            const nx = x + dx;
            const ny = y + dy;
            const bCell = this.getCell(nx, ny);
            if (!this.isFluidCell(bCell)) continue;

            const ai = this.idx(x, y);
            const bi = this.idx(nx, ny);

            const aAmount = before[ai];
            const bAmount = before[bi];

            let aHead = this.pressureAt(x, y, before);
            let bHead = this.pressureAt(nx, ny, before);

            if (dy === 1) {
              bHead -= GRAVITY_HEAD;
            }

            let flow = (aHead - bHead) * CONDUCTANCE;
            flow = Math.max(-MAX_EDGE_FLOW, Math.min(MAX_EDGE_FLOW, flow));

            if (flow > 0) {
              flow = Math.min(flow, aAmount);
            } else {
              flow = -Math.min(-flow, bAmount);
            }

            delta[ai] -= flow;
            delta[bi] += flow;
          }
        }
      }

      const next = new Float64Array(before.length);

      for (let i = 0; i < before.length; i++) {
        next[i] = Math.max(0, before[i] + delta[i]);
      }

      this.injectFromFields(next);
      this.oil = next;
    }

    processMachines() {
      const dirs = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0]
      ];

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const cell = this.getCell(x, y);
          if (cell.type !== TILE.REFINERY) continue;

          let remaining = REFINERY_RATE;

          const neighbors = dirs
            .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
            .filter(p => this.isFluidCell(this.getCell(p.x, p.y)))
            .sort((a, b) =>
              this.pressureAt(b.x, b.y) - this.pressureAt(a.x, a.y)
            );

          for (const n of neighbors) {
            if (remaining <= 0) break;

            const i = this.idx(n.x, n.y);
            const consumed = Math.min(this.oil[i], remaining);

            this.oil[i] -= consumed;
            this.fuel += consumed;
            remaining -= consumed;
          }
        }
      }

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const cell = this.getCell(x, y);
          if (cell.type !== TILE.CORE) continue;

          for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            const nCell = this.getCell(nx, ny);
            if (!this.isFluidCell(nCell)) continue;

            const i = this.idx(nx, ny);
            const pressure = this.pressureAt(nx, ny);
            const leaked = Math.min(
              this.oil[i],
              Math.max(0, (pressure - 0.15) * 0.035)
            );

            if (leaked <= 0) continue;

            this.oil[i] -= leaked;
            this.coreHp -= leaked * CORE_DAMAGE_PER_OIL;
          }
        }
      }
    }

    tick() {
      if (this.gameOver) return;

      this.simulatePressureFlow();
      this.processMachines();

      if (this.coreHp <= 0) {
        this.coreHp = 0;
        this.gameOver = true;
        clearInterval(this.timer);
        this.setMessage("CORE機能停止。未処理石油の圧力に耐えられませんでした。");
      }

      this.render();
    }

    setMessage(message) {
      this.messageEl.textContent = message;
    }

    render() {
      this.gridEl.innerHTML = "";
      let totalOil = 0;

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const cell = this.cells[y][x];
          const div = document.createElement("div");
          div.className = `cell ${cell.type}`;

          if (cell.type === TILE.ROCK && cell.diggable && !this.gameOver) {
            div.addEventListener("click", () => this.dig(x, y));
          }

          const amount = this.oil[this.idx(x, y)];
          totalOil += amount;

          if (amount > 0.001) {
            const fill = document.createElement("div");
            fill.className = "oil-fill";
            fill.style.height =
              `${Math.max(4, Math.min(1, amount / CELL_CAPACITY) * 100)}%`;
            div.appendChild(fill);

            const p = document.createElement("span");
            p.className = "pressure-label";
            p.textContent = this.pressureAt(x, y).toFixed(1);
            div.appendChild(p);
          }

          const field = this.oilFields.find(f => f.x === x && f.y === y);
          if (field) {
            div.title =
              `${field.name}\n` +
              `地層圧: ${field.pressure.toFixed(2)}\n` +
              `最大流量: ${field.maxOutput.toFixed(3)}/tick\n` +
              `残存量: ${field.reserve.toFixed(1)}`;
          }

          this.gridEl.appendChild(div);
        }
      }

      this.coreHpEl.textContent = Math.max(0, this.coreHp).toFixed(0);
      this.fuelEl.textContent = this.fuel.toFixed(1);
      this.oilCountEl.textContent = totalOil.toFixed(1);
    }
  }

  new Game();
})();
