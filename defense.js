(function registerDefenseSystem(global) {
  "use strict";

  const DEFENSE_RULES = Object.freeze({
    barricadeDurability: 30,
    barricadeDamageRate: 2.8,
    bulkheadDurability: 120,
    bulkheadDamageRate: 1.2,
    bulkheadMetalCost: 1,
    maxBuildOil: 0.12,
  });

  class DefenseSystem {
    static update(game, dt) {
      for (const cell of game.cells) {
        if (cell.type !== "barricade" && cell.type !== "bulkhead") continue;
        const pressure = Math.max(0, ...game.neighbors(cell.x, cell.y).map((neighbor) => neighbor.oil || 0));
        if (pressure <= 0.01) continue;
        const rate = cell.type === "barricade"
          ? DEFENSE_RULES.barricadeDamageRate
          : DEFENSE_RULES.bulkheadDamageRate;
        cell.durability = Math.max(0, cell.durability - pressure * rate * dt);
        if (!cell.warned && cell.durability / cell.maxDurability <= 0.25) {
          cell.warned = true;
          game.flashStatus(cell.type === "barricade" ? "警告：粗鉱壁が崩壊寸前" : "警告：強化隔壁が損傷");
        }
        if (cell.durability > 0) continue;
        const name = cell.type === "barricade" ? "粗鉱壁" : "強化隔壁";
        cell.type = "tunnel";
        cell.durability = 0;
        cell.maxDurability = 0;
        cell.warned = false;
        game.flashStatus(`${name}が圧壊`);
      }
    }
  }

  const api = { DefenseSystem, DEFENSE_RULES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.DefenseModule = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
