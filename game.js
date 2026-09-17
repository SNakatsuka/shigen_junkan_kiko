(() => {
  "use strict";

  const COLS = 18;
  const ROWS = 11;
  const TICK_MS = 420;
  const SOURCE_RATE = 2;

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

      this.timer = null;
      this.reset();
    }

    reset() {
      if (this.timer) {
        clearInterval(this.timer);
      }

      this.coreHp = 100;
      this.fuel = 0;
      this.tickCount = 0;
      this.gameOver = false;
      this.cells = [];
      this.oil = new Map();

      this.buildWorld();
      this.render();
      this.setMessage("地盤を掘削して流路を設計してください。");

      this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    buildWorld() {
      for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) {
          row.push({
            x,
            y,
            type: TILE.ROCK,
            diggable: true
          });
        }
        this.cells.push(row);
      }

      // 上部の石油源
      this.setTile(4, 1, TILE.SOURCE, false);
      this.setTile(13, 1, TILE.SOURCE, false);

      // 初期坑道
      [
        [4, 2], [4, 3], [5, 3],
        [13, 2], [13, 3], [12, 3],
        [8, 7], [9, 7]
      ].forEach(([x, y]) => this.setTile(x, y, TILE.TUNNEL, false));

      // 精製機
      this.setTile(7, 6, TILE.REFINERY, false);
      this.setTile(10, 6, TILE.REFINERY, false);

      // CORE
      this.setTile(8, 9, TILE.CORE, false);
      this.setTile(9, 9, TILE.CORE, false);

      // CORE直上は掘られた状態にしておく
      this.setTile(8, 8, TILE.TUNNEL, false);
      this.setTile(9, 8, TILE.TUNNEL, false);
    }

    setTile(x, y, type, diggable = false) {
      const cell = this.getCell(x, y);
      if (!cell) return;
      cell.type = type;
      cell.diggable = diggable;
    }

    getCell(x, y) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
      return this.cells[y][x];
    }

    key(x, y) {
      return `${x},${y}`;
    }

    parseKey(key) {
      return key.split(",").map(Number);
    }

    isPassable(cell) {
      return cell && (
        cell.type === TILE.TUNNEL ||
        cell.type === TILE.REFINERY ||
        cell.type === TILE.CORE ||
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

    spawnOil() {
      if (this.tickCount % SOURCE_RATE !== 0) return;

      for (const source of [[4, 1], [13, 1]]) {
        const key = this.key(source[0], source[1]);
        const current = this.oil.get(key) || 0;
        if (current < 2) {
          this.oil.set(key, current + 1);
        }
      }
    }

    tick() {
      if (this.gameOver) return;

      this.tickCount += 1;
      this.spawnOil();
      this.advanceOil();

      if (this.coreHp <= 0) {
        this.coreHp = 0;
        this.gameOver = true;
        clearInterval(this.timer);
        this.setMessage("CORE機能停止。資源循環機構は沈黙しました。");
      }

      this.render();
    }

    advanceOil() {
      const nextOil = new Map();

      // 下方向優先。左右、最後に上方向。
      const directions = [
        [0, 1],
        [-1, 0],
        [1, 0],
        [0, -1]
      ];

      const occupiedTargets = new Set();

      for (const [key, amount] of this.oil.entries()) {
        const [x, y] = this.parseKey(key);

        for (let i = 0; i < amount; i++) {
          let moved = false;

          for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            const target = this.getCell(nx, ny);
            const targetKey = this.key(nx, ny);

            if (!this.isPassable(target)) continue;
            if (occupiedTargets.has(targetKey)) continue;

            if (target.type === TILE.REFINERY) {
              this.fuel += 1;
              occupiedTargets.add(targetKey);
              moved = true;
              this.setMessage("石油を精製。燃料 +1");
              break;
            }

            if (target.type === TILE.CORE) {
              this.coreHp -= 12;
              occupiedTargets.add(targetKey);
              moved = true;
              this.setMessage("警告：未処理石油がCOREへ侵入！");
              break;
            }

            nextOil.set(targetKey, (nextOil.get(targetKey) || 0) + 1);
            occupiedTargets.add(targetKey);
            moved = true;
            break;
          }

          if (!moved) {
            const currentKey = this.key(x, y);
            nextOil.set(currentKey, (nextOil.get(currentKey) || 0) + 1);
          }
        }
      }

      this.oil = nextOil;
    }

    setMessage(message) {
      this.messageEl.textContent = message;
    }

    render() {
      this.gridEl.innerHTML = "";

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const cell = this.cells[y][x];
          const div = document.createElement("div");

          div.className = `cell ${cell.type}`;
          div.dataset.x = x;
          div.dataset.y = y;

          if (cell.type === TILE.ROCK && cell.diggable && !this.gameOver) {
            div.addEventListener("click", () => this.dig(x, y));
          }

          const oilAmount = this.oil.get(this.key(x, y)) || 0;
          if (oilAmount > 0) {
            const blob = document.createElement("div");
            blob.className = "oil-blob";
            blob.title = `石油 x${oilAmount}`;
            div.appendChild(blob);
          }

          this.gridEl.appendChild(div);
        }
      }

      this.coreHpEl.textContent = this.coreHp;
      this.fuelEl.textContent = this.fuel;
      this.oilCountEl.textContent = [...this.oil.values()]
        .reduce((sum, value) => sum + value, 0);
    }
  }

  new Game();
})();
