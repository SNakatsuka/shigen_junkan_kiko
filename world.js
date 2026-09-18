(function registerWorldSystem(global) {
  "use strict";

  class SeededRandom {
    constructor(seed) { this.state = seed >>> 0 || 1; }
    next() {
      this.state = (this.state * 1664525 + 1013904223) >>> 0;
      return this.state / 4294967296;
    }
    int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
    range(min, max) { return min + this.next() * (max - min); }
  }

  const ZONES = [
    { name: "低圧油田", grade: "LOW",  x: [16, 26], y: [14, 18], pressure: [1.12, 1.38], output: [0.042, 0.055], reserve: [48, 60] },
    { name: "中圧油田", grade: "MID",  x: [7, 35],  y: [7, 13],  pressure: [1.58, 1.92], output: [0.066, 0.086], reserve: [37, 49] },
    { name: "高圧油田", grade: "HIGH", x: [3, 38],  y: [2, 7],   pressure: [2.18, 2.58], output: [0.094, 0.118], reserve: [27, 36] },
  ];

  function rockVariant(x, y, cols) {
    const i = y * cols + x;
    return (i * 17 + y * 11) % 4;
  }

  function rockCost(x, y, cols) {
    return 0.32 + y * 0.018 + rockVariant(x, y, cols) * 0.035;
  }

  function starterRouteCost(x, y, cols) {
    const startX = Math.max(17, Math.min(25, x));
    const targetY = y + 1;
    let cost = 0;
    for (let row = 21; row >= targetY; row -= 1) cost += rockCost(startX, row, cols);
    const step = Math.sign(x - startX);
    for (let col = startX + step; step && col !== x + step; col += step) cost += rockCost(col, targetY, cols);
    return cost;
  }

  class WorldGenerator {
    static generate(seed, cols) {
      const rng = new SeededRandom(seed);
      const wells = [];
      ZONES.forEach((zone, index) => {
        let x;
        let y;
        let attempts = 0;
        do {
          x = rng.int(zone.x[0], zone.x[1]);
          y = rng.int(zone.y[0], zone.y[1]);
          attempts += 1;
        } while (
          attempts < 100 &&
          (wells.some((well) => Math.abs(well.x - x) + Math.abs(well.y - y) < 7) ||
           (index === 0 && starterRouteCost(x, y, cols) > 12.5))
        );
        const reserve = rng.range(zone.reserve[0], zone.reserve[1]);
        wells.push({
          name: zone.name,
          grade: zone.grade,
          x, y,
          pressure: rng.range(zone.pressure[0], zone.pressure[1]),
          maxOutput: rng.range(zone.output[0], zone.output[1]),
          reserve,
          initialReserve: reserve,
          output: 0,
          discovered: false,
        });
      });
      return wells;
    }

    static generateOres(seed, cols, wells) {
      const rng = new SeededRandom((seed ^ 0x9e3779b9) >>> 0);
      const zones = [
        { name: "第1鉱脈", x: [9, 33], y: [11, 18], reserve: [9, 13] },
        { name: "第2鉱脈", x: [4, 38], y: [4, 11], reserve: [7, 11] },
      ];
      const ores = [];
      for (const zone of zones) {
        let x;
        let y;
        let attempts = 0;
        do {
          x = rng.int(zone.x[0], zone.x[1]);
          y = rng.int(zone.y[0], zone.y[1]);
          attempts += 1;
        } while (attempts < 100 && (
          wells.some((well) => Math.abs(well.x - x) + Math.abs(well.y - y) < 4) ||
          ores.some((ore) => Math.abs(ore.x - x) + Math.abs(ore.y - y) < 7)
        ));
        const reserve = rng.int(zone.reserve[0], zone.reserve[1]);
        ores.push({ name: zone.name, x, y, reserve, initialReserve: reserve, discovered: false });
      }
      return ores;
    }

    static signalAt(wells, x, y) {
      let distance = Infinity;
      for (const well of wells) {
        if (well.discovered || well.reserve <= 0) continue;
        distance = Math.min(distance, Math.abs(well.x - x) + Math.abs(well.y - y));
      }
      if (distance <= 2) return 3;
      if (distance <= 5) return 2;
      if (distance <= 8) return 1;
      return 0;
    }

    static mineralSignalAt(ores, x, y) {
      let distance = Infinity;
      for (const ore of ores) {
        if (ore.discovered && ore.reserve <= 0) continue;
        distance = Math.min(distance, Math.abs(ore.x - x) + Math.abs(ore.y - y));
      }
      if (distance <= 2) return 3;
      if (distance <= 4) return 2;
      if (distance <= 7) return 1;
      return 0;
    }

    static starterRouteCost(well, cols) { return starterRouteCost(well.x, well.y, cols); }
  }

  const api = { WorldGenerator, SeededRandom };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.WorldSystem = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
