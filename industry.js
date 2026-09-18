(function registerIndustrySystem(global) {
  "use strict";

  const INDUSTRY_RULES = Object.freeze({
    smelterCost: 6,
    smeltSeconds: 3.5,
    fuelPerOre: 0.6,
    metalPerOre: 0.65,
    catalystPerOre: 0.35,
    cargoCapacity: 4,
    oreMiningPower: 0.28,
  });

  class IndustrySystem {
    static update(game, dt) {
      for (const cell of game.cells) cell.active = false;
      this.runRefineries(game, dt);
      this.runSmelters(game, dt);
    }

    static runRefineries(game, dt) {
      for (const cell of game.cells) {
        if (cell.type !== "refinery" || cell.oil <= 0) continue;
        const amount = Math.min(cell.oil, game.config.refineryRate * dt * 10);
        cell.oil -= amount;
        game.fuel += amount;
        game.refined += amount;
        cell.active = amount > 0.0001;
      }
    }

    static runSmelters(game, dt) {
      for (const cell of game.cells) {
        if (cell.type !== "smelter" || cell.oreBuffer < 1) continue;
        if (game.fuel < INDUSTRY_RULES.fuelPerOre) continue;
        cell.active = true;
        cell.process += dt;
        if (cell.process < INDUSTRY_RULES.smeltSeconds) continue;
        cell.process -= INDUSTRY_RULES.smeltSeconds;
        cell.oreBuffer -= 1;
        game.fuel -= INDUSTRY_RULES.fuelPerOre;
        game.metal += INDUSTRY_RULES.metalPerOre;
        game.catalyst += INDUSTRY_RULES.catalystPerOre;
      }
    }
  }

  const api = { IndustrySystem, INDUSTRY_RULES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.IndustryModule = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
