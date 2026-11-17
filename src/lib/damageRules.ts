// Client-safe: how Mine and Slash works out the damage of a hit and how often a skill is used.
// Like affix.ts, no data imports here.
import { leveled, multiplier, type Leveled } from './spellRules';
import type { Total } from './statRules';

// The game's own names: Cold is water, Nature is lightning and Shadow is chaos.
export type Element = 'Physical' | 'Fire' | 'Cold' | 'Nature' | 'Shadow' | 'Elemental' | 'ALL';
export const ELEMENTS: Record<Element, { name: string; id: string }> = {
  Physical: { name: 'Physical', id: 'physical' },
  Fire: { name: 'Fire', id: 'fire' },
  Cold: { name: 'Cold', id: 'water' },
  Nature: { name: 'Lightning', id: 'lightning' },
  Shadow: { name: 'Chaos', id: 'chaos' },
  Elemental: { name: 'Elemental', id: 'elemental' },
  ALL: { name: 'All', id: 'all' },
};
const MADE_OF: Partial<Record<Element, Element[]>> = { Elemental: ['Nature', 'Fire', 'Cold'], ALL: ['Nature', 'Fire', 'Cold', 'Shadow'] };
const RESISTED: Element[] = ['Fire', 'Cold', 'Nature', 'Shadow'];

// Elements.elementsMatch: the same element, or one that is part of the other.
export const matches = (a: Element, b: Element) => a === b || !!MADE_OF[a]?.includes(b) || !!MADE_OF[b]?.includes(a);

// What a stat's effect asks of the hit before it does anything.
export type Cond = { not?: true } & (
  | { k: 'str'; key: string; value: string }
  | { k: 'bool'; id: string }
  | { k: 'tag'; tag: string }
  | { k: 'wep'; type: string }
  | { k: 'is'; element: Element }
  | { k: 'any'; ifs: Cond[] }
  // The hit's element matches the stat's own, is fire, cold or lightning, comes from a spell, is from
  // a ranged weapon, is made while dual wielding, wins a roll of the stat's value as a chance, is not
  // yet twice converted, or never happens.
  | { k: 'ele' | 'elemental' | 'single' | 'spell' | 'ranged' | 'dual' | 'roll' | 'shallow' | 'never' }
);

export type Act =
  // Adds to one of the layers a hit's damage goes through: the stat's value, a fixed number, or the
  // stat's value as a percentage of another stat of the character.
  | { k: 'layer'; layer: string; sign: 1 | -1; n?: number; of?: string; scaled?: true }
  | { k: 'bool'; id: string; value: boolean }
  | { k: 'pen' }
  | { k: 'flat'; to: Element; scaled: boolean }
  | { k: 'convert' | 'extra'; to: Element }
  // Numbers of a cast: its speed and cooldown.
  | { k: 'add' | 'inc' | 'dec'; num: string };

export interface Rule {
  on: 'damage' | 'cast';
  order: number;
  // The stat's own element, where the rule asks about it.
  element?: Element;
  ifs: Cond[];
  acts: Act[];
}

export interface Layer {
  action: 'ADD' | 'MULTIPLY';
  priority: number;
  min: number;
  max: number;
}

// One [calc] of a damaging action: what its damage starts at.
export interface DamageCalc {
  base: Leveled;
  parts: { stat: string; multi: Leveled }[];
  // The other parts can't add more than this many times what weapon damage gives.
  cap: number | null;
  // How much of flat added damage the hit takes.
  effectiveness: Leveled;
}

export interface SkillHit {
  calc: string;
  element: Element;
  // How many times it lands on one target each cast.
  count: number;
  when: 'cast' | 'hit' | 'tick' | 'end';
}

export interface SkillDamage {
  style: string;
  tags: string[];
  castTicks: number;
  recoveryTicks: number;
  cooldownTicks: number;
  charges: number;
  chargeTicks: number;
  times: number;
  channel: boolean;
  // What the skill does depends on the effects its caster is under: one list of hits for each
  // such state that deals damage, with the effects it takes. The one that takes the fewest is first.
  variants: { needs: string[]; hits: SkillHit[] }[];
}

export interface Weapon {
  type: string;
  style: string;
  ranged: boolean;
  // What a basic attack with it is multiplied by, and how many swings a second it makes.
  multi: number;
  rate: number;
}

export interface DamageRules {
  rules: Record<string, Rule[]>;
  layers: Record<string, Layer>;
  calcs: Record<string, DamageCalc>;
  skills: Record<string, SkillDamage>;
  weapons: Record<string, Weapon>;
  // Stats whose effect on damage depends on the moment: health, buffs, curses, the time of day.
  situational: string[];
  scaling: { base: number; perLevel: number };
  // Where among the layers physical damage is turned into the elements its target takes it as.
  takenAs: number;
  globalCooldownTicks: number;
  minCooldown: number;
  channelSpeed: number;
}

// The pack's server config: a mob more than LEEWAY levels above the player takes less damage.
const LEVEL_PENALTY = { leeway: 3, perLevel: 0.33, min: 0.25 };
// Player.getAttackSpeed before a weapon changes it.
const VANILLA_ATTACK_SPEED = 4;
export const UNARMED: Weapon = { type: 'none', style: 'str', ranged: false, multi: 1, rate: VANILLA_ATTACK_SPEED };

export interface Fighter {
  level: number;
  // The character's stats, and the ones the skill is used with: its support gems and its own stats on top.
  own: Map<string, Total>;
  unit: Map<string, Total>;
  weapon: Weapon;
  dualWield: boolean;
}

export interface Target {
  level: number;
  // Its stats, and the effects they have on a hit it takes.
  stats: Map<string, Total>;
  rules: Record<string, Rule[]>;
}

// What working out a hit takes of the rules.
export type HitRules = Pick<DamageRules, 'rules' | 'layers' | 'scaling' | 'takenAs'>;

// ElementalResist: a resistance counts up to a cap that the target's stats can raise.
const RESIST = { min: -300, cap: 75, max: 90 };
// Armor.getMaxMulti.
const MAX_ARMOR = 0.9;

// ArmorEffect: the share of a physical hit that armor stops at the attacker's level. Penetration
// past what armor there is turns into more damage.
export function armorShare(scaling: DamageRules['scaling'], armor: number, penetration: number, level: number) {
  const left = armor - penetration;
  const points = Math.round(Math.abs(left));
  // IUsableStat.getUsableValue.
  return clamp(points / (points + 100 * multiplier(scaling, level)), 0, MAX_ARMOR) * (left > 0 ? 1 : -1);
}

// ElementalResistEffect: the resistance that counts against a hit, in percent, by element id as in fire_resist.
export function resistance(stats: Map<string, Total>, element: string, penetration: number) {
  const of = (id: string) => stats.get(id)?.value ?? 0;
  return clamp(Math.trunc(of(`${element}_resist`) - penetration), RESIST.min, clamp(RESIST.cap + of(`max_${element}_resist`), RESIST.min, RESIST.max));
}

export interface Hit {
  amount: number;
  element: Element;
  bonus: boolean;
  // How many times it was converted from another element.
  depth: number;
  style: string;
  tags: string[] | null;
  basic: boolean;
  effectiveness: number;
  // "More" multipliers the hit starts with.
  multis: number[];
  // The target blocked it, which stops the share of it that the target's blocks do.
  blocked?: boolean;
  // Damage the target took as another element, which nothing of the attacker's acts on.
  takenAs?: boolean;
}

const f = Math.fround;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const active = (total: Total) => total.value !== 0 || total.more !== 1;
const rulesOf = (rules: Record<string, Rule[]>, unit: Map<string, Total>, on: Rule['on']) =>
  [...unit]
    .filter(([, total]) => active(total))
    .flatMap(([id, total]) => (rules[id] ?? []).filter((rule) => rule.on === on).map((rule) => ({ id, total, rule })))
    .sort((a, b) => a.rule.order - b.rule.order);

// DamageEvent for one outcome of every roll: `luck` says which of the chances come through. Gives
// the damage in the hit's own element, what it adds in others, what the target takes of it as
// other elements, and the chances it came across.
function strike(rules: HitRules, who: Fighter, target: Target, hit: Hit, luck: Map<string, boolean>) {
  const bools = new Set<string>([...(hit.basic ? ['is_basic_atk'] : []), ...(hit.bonus ? ['is_bonus_element_damage'] : []), ...(hit.blocked ? ['is_blocked'] : [])]);
  const strings: Record<string, string> = { attack_type: hit.bonus ? 'bonus_dmg' : 'hit', style: hit.style };
  const layers = new Map<string, number>();
  const conversion = new Map<Element, number>();
  const extra = new Map<Element, number>();
  const other = new Map<Element, number>();
  const takenAs = new Map<Element, number>();
  const chances = new Map<string, number>();
  const multis = [...hit.multis];
  const defense = (id: string) => target.stats.get(id)?.value ?? 0;
  let penetration = 0;

  const layer = (id: string, amount: number) => layers.set(id, (layers.get(id) ?? 0) + amount);
  // DamageEvent.addBonusEleDmg: damage of another element becomes a hit of its own.
  const add = (to: Element, amount: number) => (to === hit.element ? layer('flat_damage', amount) : other.set(to, Math.trunc((other.get(to) ?? 0) + amount)));

  // The attacker's effects and the target's, each roll told apart by whose it is.
  const acting = [
    ...(hit.takenAs ? [] : rulesOf(rules.rules, who.unit, 'damage').map((r) => ({ ...r, key: r.id }))),
    ...rulesOf(target.rules, target.stats, 'damage').map((r) => ({ ...r, key: `taken ${r.id}` })),
  ].sort((a, b) => a.rule.order - b.rule.order);
  for (const { key, total, rule } of acting) {
    const met = (cond: Cond): boolean => !!cond.not !== test(cond);
    const test = (cond: Cond): boolean => {
      switch (cond.k) {
        case 'str':
          return strings[cond.key] === cond.value;
        case 'bool':
          return bools.has(cond.id);
        case 'tag':
          return !!hit.tags?.includes(cond.tag);
        case 'wep':
          return who.weapon.type === cond.type;
        case 'is':
          return hit.element === cond.element;
        case 'any':
          return cond.ifs.some(met);
        case 'ele':
          return matches(hit.element, rule.element!);
        case 'elemental':
          return matches(hit.element, 'Elemental');
        case 'single':
          return !!MADE_OF.Elemental?.includes(hit.element);
        case 'spell':
          return !!hit.tags;
        case 'ranged':
          return who.weapon.ranged;
        case 'dual':
          return who.dualWield;
        case 'shallow':
          return hit.depth < 2;
        case 'never':
          return false;
        case 'roll': {
          const chance = total.value / 100;
          if (chance > 0 && chance < 1) chances.set(key, chance);
          return chance >= 1 || (chance > 0 && !!luck.get(key));
        }
      }
    };
    if (!rule.ifs.every(met)) continue;
    for (const act of rule.acts) {
      if (act.k === 'layer') {
        const amount = act.n ?? (act.of ? ((who.own.get(act.of)?.value ?? 0) * total.value) / 100 : total.value);
        layer(act.layer, act.sign * amount * (act.scaled ? hit.effectiveness : 1));
        if (total.more !== 1) multis.push(total.more);
      } else if (act.k === 'bool') act.value ? bools.add(act.id) : bools.delete(act.id);
      else if (act.k === 'pen') penetration += total.value;
      else if (act.k === 'flat') add(act.to, total.value * (act.scaled ? hit.effectiveness : 1));
      else if (act.k === 'convert') conversion.set(act.to, (conversion.get(act.to) ?? 0) + Math.trunc(total.value));
      else if (act.k === 'extra') extra.set(act.to, Math.trunc(total.value));
    }
  }

  // ArmorEffect and ElementalResistEffect, then BlockChance and DamageShield.
  if (hit.element === 'Physical') {
    const stopped = armorShare(rules.scaling, defense('armor'), penetration, who.level);
    if (stopped) layer('armor_mitigation', -100 * stopped);
    if (defense('physical_resist')) layer('physical_mitigation', -resistance(target.stats, 'physical', 0));
  } else if (RESISTED.includes(hit.element) && !bools.has('resisted_already')) {
    layer('elemental_mitigation', -resistance(target.stats, ELEMENTS[hit.element].id, penetration));
  }
  if (hit.blocked) layer('damage_block', -(target.stats.get('block_damage_reduction')?.value ?? 100));
  if (defense('damage_shield')) layer('flat_damage_reduction', -defense('damage_shield'));

  // EffectEvent.calculateStatLayersAndMoreMultis: the layers in their order, then every "more" multiplier.
  let damage = f(hit.amount + (layers.get('flat_damage') ?? 0));
  if (conversion.size) {
    const whole = damage;
    const share = Math.min(1, 100 / [...conversion.values()].reduce((sum, percent) => sum + percent, 0));
    let left = 100;
    for (const [to, percent] of conversion) {
      const taken = Math.min(percent * share, left);
      if (taken <= 0) break;
      left -= taken;
      add(to, (whole * taken) / 100);
      damage -= (whole * taken) / 100;
    }
  }
  for (const [to, percent] of extra) if (percent > 0 && damage > 0) add(to, (damage * percent) / 100);
  const rest = [...layers].filter(([id]) => id !== 'flat_damage').sort((a, b) => rules.layers[a[0]].priority - rules.layers[b[0]].priority);
  const run = (steps: typeof rest) => {
    for (const [id, amount] of steps) {
      const { action, min, max } = rules.layers[id];
      damage = action === 'ADD' ? damage + amount : damage * clamp(1 + amount / 100, min, max);
    }
  };
  run(rest.filter(([id]) => rules.layers[id].priority < rules.takenAs));
  // PhysicalDamageTakenAs: shares that add up to more than the whole hit are scaled down to it.
  if (hit.element === 'Physical' && hit.depth < 2) {
    const shares = RESISTED.map((to) => [to, Math.trunc(defense(`phys_taken_as_${ELEMENTS[to].id}`))] as const).filter(([, percent]) => percent > 0);
    const scale = Math.min(1, 100 / shares.reduce((sum, [, percent]) => sum + percent, 0));
    const whole = damage;
    for (const [to, percent] of shares) {
      const moved = (whole * percent * scale) / 100;
      takenAs.set(to, Math.trunc(moved));
      damage -= moved;
    }
  }
  run(rest.filter(([id]) => rules.layers[id].priority >= rules.takenAs));
  for (const multi of multis) damage *= multi;
  return { damage: Math.max(0, damage), other, takenAs, chances };
}

export type ByElement = Partial<Record<Element, number>>;

// What a hit comes to on average, by element: every roll weighed by its chance, and the damage it
// adds in other elements or is taken as worked out as hits of their own
// (DamageEvent.calculateAllBonusElementalDamage). What is taken as another element gets none of
// the "more" multipliers the hit started with.
export function average(rules: HitRules, who: Fighter, target: Target, hit: Hit): ByElement {
  const chances = new Map<string, number>();
  for (;;) {
    const rolls = [...chances];
    let damage = 0;
    let found = false;
    const other = new Map<Element, number>();
    const takenAs = new Map<Element, number>();
    for (let outcome = 0; outcome < 2 ** rolls.length; outcome++) {
      const luck = new Map(rolls.map(([id], i) => [id, !!(outcome & (1 << i))]));
      const weight = rolls.reduce((p, [id, chance]) => p * (luck.get(id) ? chance : 1 - chance), 1);
      const result = strike(rules, who, target, hit, luck);
      for (const [id, chance] of result.chances) {
        if (!chances.has(id)) found = true;
        chances.set(id, chance);
      }
      damage += weight * result.damage;
      for (const [to, amount] of result.other) other.set(to, (other.get(to) ?? 0) + weight * amount);
      for (const [to, amount] of result.takenAs) takenAs.set(to, (takenAs.get(to) ?? 0) + weight * amount);
    }
    // A roll that only showed up now wasn't weighed, so the outcomes are gone over again with it.
    if (found) continue;
    const total: ByElement = { [hit.element]: damage };
    if (hit.depth < 2) {
      const next = { ...hit, bonus: true, depth: hit.depth + 1 };
      const more = [
        ...[...other].map(([to, amount]) => ({ ...next, amount, element: to })),
        ...[...takenAs].map(([to, amount]) => ({ ...next, amount, element: to, takenAs: true, multis: [] })),
      ];
      for (const bonus of more) {
        if (bonus.amount <= 0) continue;
        for (const [element, value] of Object.entries(average(rules, who, target, bonus)) as [Element, number][]) total[element] = (total[element] ?? 0) + value;
      }
    }
    return total;
  }
}

// DamageEvent.addMobDamageMultipliers, for a player hitting a mob.
function levelPenalty(who: Fighter, target: Target) {
  const above = target.level - who.level - LEVEL_PENALTY.leeway;
  return above > 0 ? clamp(1 - above * LEVEL_PENALTY.perLevel, LEVEL_PENALTY.min, 1) : 1;
}

// ValueCalculation.getCalculatedValue, with the character's own stats: support gems don't count here.
function calcValue(rules: DamageRules, calc: DamageCalc, who: Fighter, rank: number, topRank: number) {
  const part = (p: DamageCalc['parts'][number]) => Math.trunc(f(leveled(p.multi, rank, topRank) * (who.own.get(p.stat)?.value ?? 0)));
  const weapon = calc.parts.filter((p) => p.stat === 'weapon_damage').slice(0, 1).reduce((sum, p) => sum + part(p), 0);
  const others = calc.parts.filter((p) => p.stat !== 'weapon_damage').reduce((sum, p) => sum + part(p), 0);
  const base = Math.trunc(f(leveled(calc.base, rank, topRank) * multiplier(rules.scaling, who.level)));
  return Math.trunc(weapon + (calc.cap === null ? others : Math.min(others, weapon * calc.cap))) + base;
}

// SpellStatsCalculationEvent and SpellCastingData: how many ticks one use of a skill takes when it
// is used over and over.
function castTicks(rules: DamageRules, who: Fighter, skill: SkillDamage) {
  const start: Record<string, number> = { cast_ticks: skill.castTicks, cast_speed_ticks: skill.recoveryTicks, cd_ticks: skill.cooldownTicks, charge_cd_ticks: skill.chargeTicks };
  const now = { ...start };
  const strings: Record<string, string> = { style: skill.style };
  for (const { total, rule } of rulesOf(rules.rules, who.unit, 'cast')) {
    const met = (cond: Cond): boolean => !!cond.not !== (cond.k === 'tag' ? skill.tags.includes(cond.tag) : cond.k === 'str' ? strings[cond.key] === cond.value : cond.k === 'any' && cond.ifs.some(met));
    if (!rule.ifs.every(met)) continue;
    for (const act of rule.acts) {
      if (act.k === 'add') now[act.num] = (now[act.num] ?? 0) + total.value;
      else if (act.k === 'inc') now[act.num] = ((now[act.num] ?? 0) + ((start[act.num] ?? 0) * total.value) / 100) * total.more;
      else if (act.k === 'dec') now[act.num] = (now[act.num] ?? 0) - ((start[act.num] ?? 0) * total.value) / 100;
    }
  }
  const cooled = (id: string) => Math.trunc(clamp(now[id], start[id] * rules.minCooldown, 1000000));
  const percent = skill.tags.includes('channel') ? (now.cast_speed_perc ?? 0) * rules.channelSpeed + (now.channel_speed_perc ?? 0) : (now.cast_speed_perc ?? 0);
  const speed = 1 + Math.max(-99, percent) / 100;
  const cast = clamp(Math.ceil(f(now.cast_ticks / speed)), skill.channel ? 1 : skill.times, 10000);
  const recovery = Math.ceil(Math.max(rules.globalCooldownTicks, f(now.cast_speed_ticks / speed)));
  // A channelled skill goes off again as soon as it is cast; any other waits out its cooldown, and
  // one with charges can't be used faster than they come back.
  return skill.channel ? cast : Math.max(cast + Math.max(cooled('cd_ticks'), recovery), skill.charges > 0 ? cooled('charge_cd_ticks') : 0);
}

export interface Part {
  hit?: SkillHit;
  // How many times it lands for each use of the skill, and what it then deals on average.
  count: number;
  damage: ByElement;
}

export interface Damage {
  // The effects the skill is taken to be used under.
  needs: string[];
  parts: Part[];
  // One use of the skill: what it deals by element and in all, and how many there are a second.
  perUse: ByElement;
  total: number;
  rate: number;
  dps: number;
}

const sum = (damage: ByElement) => Object.values(damage).reduce((total, value) => total + value, 0);

function result(needs: string[], parts: Part[], rate: number): Damage {
  const perUse: ByElement = {};
  for (const part of parts) for (const [element, value] of Object.entries(part.damage) as [Element, number][]) perUse[element] = (perUse[element] ?? 0) + value * part.count;
  return { needs, parts, perUse, total: sum(perUse), rate, dps: sum(perUse) * rate };
}

// A skill's damage against one target, used in one of the states it can be used in.
export function skillDamage(rules: DamageRules, who: Fighter, target: Target, skill: SkillDamage, variant: SkillDamage['variants'][number], rank: number, topRank: number): Damage {
  const multis = [levelPenalty(who, target)];
  const parts = variant.hits.map((hit): Part => {
    const calc = rules.calcs[hit.calc];
    const amount = calcValue(rules, calc, who, rank, topRank);
    const effectiveness = leveled(calc.effectiveness, rank, topRank);
    return {
      hit,
      count: hit.count,
      damage: average(rules, who, target, { amount, element: hit.element, bonus: false, depth: 0, style: skill.style, tags: skill.tags, basic: false, effectiveness, multis }),
    };
  });
  return result(variant.needs, parts, 20 / castTicks(rules, who, skill));
}

// How many basic attacks a second the weapon makes at full swing: the vanilla attack speed, which
// the Attack Speed stat multiplies.
export const attackRate = (who: Fighter) => Math.max(0, who.weapon.rate * (1 + (who.own.get('attack_speed')?.value ?? 0) / 100));

// WeaponMechanic.doNormalAttack and DamageEvent.initBeforeActivating: a basic attack starts at the
// character's weapon damage, at full swing, and support gems have no part in it.
export function attackDamage(rules: DamageRules, who: Fighter, target: Target, rate: number): Damage {
  const multis = [1 + (who.own.get('full_swing_damage')?.value ?? 0) / 100, who.weapon.multi, levelPenalty(who, target)];
  const amount = Math.trunc(who.own.get('weapon_damage')?.value ?? 0);
  const hit: Hit = { amount, element: 'Physical', bonus: false, depth: 0, style: who.weapon.style, tags: null, basic: true, effectiveness: 1, multis };
  return result([], [{ count: 1, damage: average(rules, { ...who, unit: who.own }, target, hit) }], rate);
}
