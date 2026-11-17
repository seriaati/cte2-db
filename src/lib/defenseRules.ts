// Client-safe: how much of a mob's hits a character takes, and how many of them it can take. The
// hit itself is worked out in damageRules.ts. Like affix.ts, no data imports here.
import { rolled, type StatMod } from './affix';
import { UNARMED, average, type ByElement, type Element, type Fighter, type Hit, type HitRules, type Rule } from './damageRules';
import { multiplier } from './spellRules';
import { totalStats, type StatRules, type Total } from './statRules';

// The rules of a hit are the effects a mob's stats have on a hit it deals.
export interface DefenseRules extends HitRules {
  // What a character's stats do to a hit it takes.
  taken: Record<string, Rule[]>;
  // Stats whose effect on a hit taken depends on the moment: health, buffs, the time of day.
  situational: string[];
  mob: {
    // What every mob has that changes its hits.
    stats: StatMod[];
    // The "more" multiplier on a mob's damage: `base` times `growth` to the power of its level.
    power: { base: number; growth: number };
    rarities: { id: string; name: string; damage: number; affixes: number }[];
    affixes: { id: string; name: string; stats: StatMod[] }[];
  };
}

export interface Enemy {
  level: number;
  // What a common mob's hit is before any stat acts on it, and how many hits land a second.
  hit: number;
  rate: number;
  rarity: DefenseRules['mob']['rarities'][number];
  affixes: DefenseRules['mob']['affixes'][number][];
}

// Numbers in the mod's code (6.4.13), which need rechecking when it updates.
const BLOCK = { cap: 75, cooldownTicks: 20, minCooldownTicks: 5 };
// IUsableStat: the rating that makes half at level 1, and the most the stat can come to.
const DODGE = { per: 100, max: 0.8 };
const SPELL_DODGE = { per: 200, max: 0.9 };
// MagicShield: the share of chaos damage that goes past magic shield.
const CHAOS_BYPASS = 0.5;
// DamageAbsorbedByMana: mana stops taking damage once this share of it is left.
const MANA_KEPT = 0.5;

type Stats = Map<string, Total>;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const read = (stats: Stats, id: string) => stats.get(id)?.value ?? 0;

// StatCalculation for a mob: what every mob has and what its affixes give, at its level.
export function mobStats(rules: DefenseRules, statRules: StatRules, enemy: Enemy): Stats {
  const mods = [...rules.mob.stats, ...enemy.affixes.flatMap((affix) => affix.stats)];
  return totalStats(statRules, [{ kind: 'other', stats: mods.map((mod) => ({ id: mod.id, type: mod.type, value: rolled(mod, 100, enemy.level) })) }]);
}

// IUsableStat.getUsableValue: a rating turns into a share that shrinks as the attacker's level goes up.
function usable(rules: DefenseRules, value: number, level: number, { per, max }: { per: number; max: number }) {
  const points = Math.max(0, Math.trunc(value));
  return clamp(points / (points + per * multiplier(rules.scaling, level)), 0, max);
}

export interface Avoidance {
  // The shares of attacks and of magic spells that are dodged.
  dodge: number;
  spellDodge: number;
  // The chance to block while a block is ready, the seconds until the next one is, the share of
  // hits blocked at the enemy's pace, and the share of a blocked hit that the block stops.
  block: number;
  recovery: number;
  blocked: number;
  stops: number;
}

// DodgeRating, SpellDodgeEffect and BlockChance. The mob's accuracy comes off the dodge ratings,
// and dodges are spread evenly over the hits taken. Blocking needs a shield, and a hit that lands
// before the last block has recovered can't be blocked.
export function avoidance(rules: DefenseRules, stats: Stats, enemy: Enemy, mob: Stats, shield: boolean): Avoidance {
  const block = shield ? clamp(Math.trunc(read(stats, 'block_chance')), 0, BLOCK.cap + read(stats, 'max_block_chance')) / 100 : 0;
  const ticks = Math.max(BLOCK.minCooldownTicks, Math.round(BLOCK.cooldownTicks / (1 + Math.max(-99, read(stats, 'block_recovery')) / 100)));
  const missed = Math.max(0, Math.ceil((ticks * enemy.rate) / 20) - 1);
  return {
    dodge: usable(rules, read(stats, 'dodge') - read(mob, 'accuracy'), enemy.level, DODGE),
    spellDodge: usable(rules, read(stats, 'spell_dodge') - read(mob, 'accuracy'), enemy.level, SPELL_DODGE),
    block,
    recovery: ticks / 20,
    blocked: block / (1 + block * missed),
    stops: clamp(stats.get('block_damage_reduction')?.value ?? 100, 0, 100) / 100,
  };
}

const sum = (damage: ByElement) => Object.values(damage).reduce((total, value) => total + value, 0);

// How much damage, after defenses, takes a character down from full. Mana takes its share of every
// hit until half of it is gone, magic shield goes before health, and half of chaos damage goes
// past magic shield (DamageAbsorbedByMana and MagicShield, in the order DamageEvent applies them).
function pool(stats: Stats, taken: ByElement) {
  const health = read(stats, 'health');
  const total = sum(taken);
  const past = total > 0 && read(stats, 'chaos_doesnt_bypass_magic_shield') <= 0 ? ((taken.Shadow ?? 0) / total) * CHAOS_BYPASS : 0;
  const life = past > 0 ? Math.min(health + read(stats, 'magic_shield'), health / past) : health + read(stats, 'magic_shield');
  const share = clamp(read(stats, 'mana_shield') / 100, 0, 1);
  return Math.min(life / (1 - share), life + read(stats, 'mana') * (1 - MANA_KEPT));
}

export interface Taken {
  // What a hit that is neither dodged nor blocked deals.
  lands: number;
  // The damage of hits it takes on average to bring the character down from full, with nothing
  // healed in between: counted as a common mob's hits before any stat acts on them, so that what
  // the enemy's rarity and affixes add counts against the character.
  effectiveHealth: number;
}

// How a character of `level` with `stats` holds up against the enemy's hits of one element:
// EntityData.mobBasicAttack, with the multipliers of DamageEvent.addMobDamageMultipliers.
export function taken(rules: DefenseRules, level: number, stats: Stats, enemy: Enemy, mob: Stats, avoid: Avoidance, element: Element): Taken {
  const who: Fighter = { level: enemy.level, own: mob, unit: mob, weapon: UNARMED, dualWield: false };
  const target = { level, stats, rules: rules.taken };
  // The hit is given as a common mob's after the multiplier its level brings, which the game puts on last.
  const power = rules.mob.power.base * rules.mob.power.growth ** enemy.level;
  const hit: Hit = { amount: enemy.hit / power, element, bonus: false, depth: 0, style: 'str', tags: null, basic: true, effectiveness: 1, multis: [power, enemy.rarity.damage] };
  const open = average(rules, who, target, hit);
  // A block that stops the whole hit leaves nothing to work out.
  const held = avoid.stops < 1 ? average(rules, who, target, { ...hit, blocked: true }) : {};
  const mean: ByElement = {};
  for (const [part, share] of [
    [open, 1 - avoid.blocked],
    [held, avoid.blocked],
  ] as const) {
    for (const [to, amount] of Object.entries(part) as [Element, number][]) mean[to] = (mean[to] ?? 0) + amount * share * (1 - avoid.dodge);
  }
  return { lands: sum(open), effectiveHealth: (pool(stats, mean) * enemy.hit) / sum(mean) };
}
