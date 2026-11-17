// Client-safe: how Mine and Slash works out the damage of a hit and how often a skill is used.
// Like affix.ts, no data imports here.
import type { StatMod } from './affix';
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
  when: 'cast' | 'hit' | 'tick' | 'end' | 'attack' | 'spell';
}

// What a summon skill puts out: pets whose attacks are its damage. A pet's attack is a spell of
// its own that the character casts through it (PetAttackUTIL).
export interface Pets {
  // The kind whose Max Summons stat they count toward, where they do.
  kind: string;
  capped: boolean;
  // How many one cast summons, the ticks they last, and the ticks between one's attacks.
  count: number;
  lifeTicks: number;
  attackTicks: number;
  style: string;
  tags: string[];
  // Skills a pet may cast as it attacks, one picked at random, and the chance of it in percent
  // before a stat adds to it.
  spells: string[];
  chance: number;
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
  // One that spends a Retribution stack is used whenever the character holds one, and by then has
  // put `marks` on its target: stats at the skill's level.
  variants: { needs: string[]; hits: SkillHit[]; retribution?: true; marks?: StatMod[] }[];
  pets?: Pets;
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
  // What the stats a skill puts on its target do to a hit it takes.
  taken: Record<string, Rule[]>;
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

// Ailments, which are in the mod's code (6.4.13): the element of the hits that cause one, the share
// of the hit it is made of, and the ticks it deals that over. One with no ticks builds up on the
// target instead, until a hit of its element sets it off.
export const AILMENTS: Record<string, { element: Element; share: number; ticks: number }> = {
  burn: { element: 'Fire', share: 1, ticks: 60 },
  poison: { element: 'Shadow', share: 1.5, ticks: 200 },
  bleed: { element: 'Physical', share: 1.2, ticks: 100 },
  freeze: { element: 'Cold', share: 0.85, ticks: 0 },
  electrify: { element: 'Nature', share: 1, ticks: 0 },
};
// EntityAilmentData: the shortest an ailment lasts, and the share of what has built up that is lost every second.
const AILMENT = { minTicks: 21, decay: 0.1 };

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
  // The ailment it is the damage of, which isn't a hit: it can't be a critical one or be converted.
  ailment?: string;
  // A pet dealt it.
  summon?: boolean;
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
// other elements, what an ailment it causes is made of, and the chances it came across.
function strike(rules: HitRules, who: Fighter, target: Target, hit: Hit, luck: Map<string, boolean>) {
  const bools = new Set<string>([...(hit.basic ? ['is_basic_atk'] : []), ...(hit.bonus ? ['is_bonus_element_damage'] : []), ...(hit.blocked ? ['is_blocked'] : []), ...(hit.summon ? ['is_summon_attack'] : [])]);
  const strings: Record<string, string> = { attack_type: hit.ailment ? 'dot' : hit.bonus ? 'bonus_dmg' : 'hit', style: hit.style, ailment: hit.ailment ?? '' };
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
  // AilmentChance: what the hit started at with flat damage added, less what was converted.
  const base = damage;
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
  if (hit.element === 'Physical' && hit.depth < 2 && !hit.ailment) {
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
  return { damage: Math.max(0, damage), base, other, takenAs, chances };
}

export type ByElement = Partial<Record<Element, number>>;
const addTo = (to: ByElement, from: ByElement, times = 1) => {
  for (const [element, value] of Object.entries(from) as [Element, number][]) to[element] = (to[element] ?? 0) + value * times;
};

export interface Average {
  damage: ByElement;
  // For the ailments it can cause: how many hits of each element it comes to, and what they are made of.
  landed: ByElement;
  base: ByElement;
}

// What a hit comes to on average, by element: every roll weighed by its chance, and the damage it
// adds in other elements or is taken as worked out as hits of their own
// (DamageEvent.calculateAllBonusElementalDamage). What is taken as another element gets none of
// the "more" multipliers the hit started with.
export function average(rules: HitRules, who: Fighter, target: Target, hit: Hit): Average {
  const chances = new Map<string, number>();
  for (;;) {
    const rolls = [...chances];
    let damage = 0;
    let landed = 0;
    let base = 0;
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
      if (result.damage > 0) {
        landed += weight;
        base += weight * result.base;
      }
      for (const [to, amount] of result.other) other.set(to, (other.get(to) ?? 0) + weight * amount);
      for (const [to, amount] of result.takenAs) takenAs.set(to, (takenAs.get(to) ?? 0) + weight * amount);
    }
    // A roll that only showed up now wasn't weighed, so the outcomes are gone over again with it.
    if (found) continue;
    // AilmentChance.canActivate: only the attacker's own hits that aren't blocked cause ailments.
    const causes = !hit.takenAs && !hit.blocked && !hit.ailment;
    const total: Average = { damage: { [hit.element]: damage }, landed: causes ? { [hit.element]: landed } : {}, base: causes ? { [hit.element]: base } : {} };
    if (hit.depth < 2) {
      const next = { ...hit, bonus: true, depth: hit.depth + 1 };
      const more = [
        ...[...other].map(([to, amount]) => ({ ...next, amount, element: to })),
        ...[...takenAs].map(([to, amount]) => ({ ...next, amount, element: to, takenAs: true, multis: [] })),
      ];
      for (const bonus of more) {
        if (bonus.amount <= 0) continue;
        const added = average(rules, who, target, bonus);
        addTo(total.damage, added.damage);
        addTo(total.landed, added.landed);
        addTo(total.base, added.base);
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
// is used over and over, what its duration is multiplied by, and how many pets of its kind can be out.
function castNumbers(rules: DamageRules, who: Fighter, skill: SkillDamage) {
  const start: Record<string, number> = { cast_ticks: skill.castTicks, cast_speed_ticks: skill.recoveryTicks, cd_ticks: skill.cooldownTicks, charge_cd_ticks: skill.chargeTicks, duration_multi: 1 };
  const now = { ...start };
  const strings: Record<string, string> = { style: skill.style, summon_type: skill.pets?.kind ?? 'none' };
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
  const ticks = skill.channel ? cast : Math.max(cast + Math.max(cooled('cd_ticks'), recovery), skill.charges > 0 ? cooled('charge_cd_ticks') : 0);
  return { ticks, duration: now.duration_multi, summons: Math.trunc(now.bonus_total_summons ?? 0) };
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
  // What the ailments its hits cause deal on top for each use, by ailment.
  ailments: Record<string, number>;
  // For a summon skill, whose use is one attack of one pet: how many pets it keeps out.
  pets?: number;
}

const sum = (damage: ByElement) => Object.values(damage).reduce((total, value) => total + value, 0);

// AilmentChance and EntityAilmentData: what each ailment the hits cause deals for one use of a
// skill that is used over and over. An ailment's damage is worked out once, as damage over time
// of no weapon that the attacker's and the target's stats act on, and is then dealt as it is.
// Ailment strength and DOT speed, which nothing in the pack gives, are left out. A hit a pet's
// spell deals has that spell's chance to cause one; how long it lasts goes by the skill's own stats.
function ailmentDamage(rules: HitRules, who: Fighter, target: Target, hits: { count: number; from: Hit; by: Fighter; mean: Average }[], rate: number) {
  const perUse: Record<string, number> = {};
  for (const [id, { element, share, ticks }] of Object.entries(AILMENTS)) {
    const stat = (name: string, of = who) => of.unit.get(`${id}_${name}`)?.value ?? 0;
    let made = 0;
    let rolls = 0;
    for (const { count, from, by, mean } of hits) {
      const landed = mean.landed[element] ?? 0;
      const chance = stat('chance', by) / 100;
      if (!landed) continue;
      rolls += count * landed;
      if (chance <= 0) continue;
      const event: Hit = { ...from, amount: mean.base[element]! / landed, element, ailment: id, bonus: false, depth: 0, style: 'int', basic: false, effectiveness: 1, multis: [levelPenalty(by, target)] };
      made += count * landed * chance * (average(rules, { ...by, weapon: UNARMED }, target, event).damage[element] ?? 0);
    }
    made *= share * Math.max(0, 1 - (target.stats.get(`${id}_resistance`)?.value ?? 0) / 100);
    if (made <= 0) continue;
    const lasts = Math.max(0.01, 1 + stat('duration') / 100);
    if (ticks) {
      // It deals a second's worth each time its target's age reaches a whole second while it
      // lasts, which on average leaves it one tick's worth short of the whole.
      perUse[id] = (made * (Math.max(AILMENT.minTicks, Math.trunc(ticks * lasts)) - 1)) / ticks;
    } else {
      // AilmentProcStat: every hit of its element has a chance to set off all that has built up.
      // The hits of one use are taken to land together, and what is left decays until the next.
      const setOff = 1 - (1 - stat('proc_chance') / 100) ** rolls;
      const kept = (1 - clamp(AILMENT.decay / lasts, 0, 1)) ** (1 / rate);
      if (setOff > 0) perUse[id] = (setOff * made) / (1 - (1 - setOff) * kept);
    }
  }
  return perUse;
}

// One use of a skill or one attack: its hits on the target and the ailments they cause. A hit is
// the user's own unless it says whose it is.
function dealt(rules: HitRules, who: Fighter, target: Target, needs: string[], hits: { hit?: SkillHit; count: number; from: Hit; by?: Fighter }[], rate: number): Damage {
  const means = hits.map(({ count, from, by = who }) => ({ count, from, by, mean: average(rules, by, target, from) }));
  const perUse: ByElement = {};
  for (const { count, mean } of means) addTo(perUse, mean.damage, count);
  const parts = hits.map(({ hit, count }, i): Part => ({ hit, count, damage: means[i].mean.damage }));
  return { needs, parts, perUse, total: sum(perUse), rate, dps: sum(perUse) * rate, ailments: ailmentDamage(rules, who, target, means, rate) };
}

// A skill at the level its user has it, with the stats it is used with.
export interface Used {
  skill: SkillDamage;
  who: Fighter;
  rank: number;
  topRank: number;
}

// SummonSpellCaster: the stat that adds to the chance a golem casts its spell as it attacks.
const GOLEM = { tag: 'golem', chance: 'golem_spell_chance' };

// A skill's damage against one target, used in one of the states it can be used in. A summon
// skill deals what its pets do: as many as it can keep out, all attacking the target without
// pause, with one attack of one pet for a use. `cast` has the skills its pets may cast, which the
// character casts through them at the level it has them itself.
export function skillDamage(rules: DamageRules, used: Used, target: Target, variant: SkillDamage['variants'][number], cast: Record<string, Used> = {}): Damage {
  const hitsOf = ({ who, rank, topRank }: Used, hits: SkillHit[], as: { style: string; tags: string[] }, summon?: true) =>
    hits.map((hit) => {
      const calc = rules.calcs[hit.calc];
      const amount = calcValue(rules, calc, who, rank, topRank);
      const effectiveness = leveled(calc.effectiveness, rank, topRank);
      const from: Hit = { amount, element: hit.element, bonus: false, depth: 0, style: as.style, tags: as.tags, basic: false, effectiveness, multis: [levelPenalty(who, target)], summon };
      return { hit, count: hit.count, from, by: who };
    });
  const { skill, who } = used;
  const { ticks, duration, summons } = castNumbers(rules, who, skill);
  const { pets } = skill;
  if (!pets) return dealt(rules, who, target, variant.needs, hitsOf(used, variant.hits, skill), 20 / ticks);

  // SummonPetAction: pets past what their kind allows are sent away, the oldest first.
  const out = Math.min((pets.count * Math.trunc(pets.lifeTicks * duration)) / ticks, pets.capped ? summons : Infinity);
  const chance = clamp(Math.trunc(pets.chance + (skill.tags.includes(GOLEM.tag) ? (who.own.get(GOLEM.chance)?.value ?? 0) : 0)) / 100, 0, 1);
  const spells = pets.spells.flatMap((id) =>
    hitsOf(cast[id], cast[id].skill.variants[0].hits, cast[id].skill, true).map(({ hit, count, ...rest }) => ({ ...rest, hit: { ...hit, when: 'spell' as const }, count: (count * chance) / pets.spells.length })),
  );
  const hits = [...hitsOf(used, variant.hits, pets, true), ...(chance > 0 ? spells : [])];
  return { ...dealt(rules, who, target, variant.needs, hits, (out * 20) / pets.attackTicks), pets: out };
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
  return dealt(rules, { ...who, unit: who.own }, target, [], [{ count: 1, from: hit }], rate);
}
