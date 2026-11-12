// Build-time only: base stats and equip requirements for the Base gear page.
import baseData from '../data/base_gear_types.json';
import balanceData from '../data/game_balance.json';
import { text } from './gear';
import { planBases } from './planner';
import type { PlanBase } from './plannerRules';

export interface BaseGear extends PlanBase {
  // Attribute requirements as a share of the level-scaled requirement curve.
  needs: { name: string; factor: number }[];
}

const raw = baseData as Record<string, { req: { scaling_req: Record<string, number> } }>;

export const baseGear: BaseGear[] = planBases.map((b) => ({
  ...b,
  needs: Object.entries(raw[b.id].req.scaling_req).map(([stat, factor]) => ({ name: text(`mmorpg.stat.${stat}`, stat), factor })),
}));

const curve = balanceData.original_balance.STAT_REQ_SCALING;
export const reqScaling = { base: curve.base_scaling, perLevel: curve.per_level_scaling };
