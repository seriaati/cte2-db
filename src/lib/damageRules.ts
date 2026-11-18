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
  // The one dealing the hit or the one taking it is under an effect.
  | { k: 'under'; effect: string; who: 'Source' | 'Target' }
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
  | { k: 'add' | 'inc' | 'dec'; num: string }
  // Sets a spell off, with the stat's value as the chance of it.
  | { k: 'proc'; spell: string }
  // Restores to the one dealing the hit the stat's value, or that percentage of what the hit deals.
  | { k: 'restore'; resource: Resource; percent?: true };

export interface Rule {
  on: 'damage' | 'cast' | 'spend' | 'restore';
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

// The projectiles a projectile action shoots together (SummonProjectileAction): `fixed` where
// stats add none, `all` where each reaches the target, or else fanned out over `apart` degrees or
// around a circle, a homing one turning to a target that comes within `reach`.
export interface Volley {
  n: number;
  fixed?: true;
  all?: true;
  apart?: number;
  nova?: true;
  reach?: number;
}

export interface SkillHit {
  calc: string;
  element: Element;
  // How many times it lands on one target each cast, for each of the projectiles it comes from
  // that hits: one of every volley, outermost first, that its caster's stats make it.
  count: number;
  when: 'cast' | 'hit' | 'tick' | 'end' | 'attack' | 'spell' | 'aura' | 'struck';
  // An effect whose stacks on the caster multiply what it starts at.
  per?: string;
  // The effect the skill leaves whose script deals it.
  effect?: string;
  volleys?: Volley[];
}

// An effect that a use of a skill leaves on its caster or on an enemy, whose own script deals
// damage as a spell of that skill (ExileEffectInstanceData): the ticks it lasts, the stats of
// its giver that make it last longer, the stacks a use adds, and its hits on an enemy: how many
// a second while it is on, as it ends, or when a basic attack hits the one holding it. A use adds
// its stacks for each projectile of `volleys` that hits, as SkillHit.count.
export interface Gift {
  effect: string;
  name: string;
  enemy: boolean;
  ticks: number;
  longer: string[];
  stacks: number;
  hits: SkillHit[];
  volleys?: Volley[];
}

// What an aura, or another effect that is kept up, deals on its own while it is on, as a spell
// of the skill that gave it: its hits on an enemy in reach and on its caster, each with how many
// times it lands a second, or for each basic attack that hits the one holding it.
export interface AuraDamage {
  style: string;
  tags: string[];
  hits: SkillHit[];
  self: SkillHit[];
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
  // What a pet's attack costs its owner, who casts it.
  cost: Cost;
}

// A skill's mana and energy cost before the caster's level scales it.
export interface Cost {
  mana: Leveled;
  energy: Leveled;
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
  // The effects whose stacks on its caster change what the skill does, with the numbers of stacks
  // of each that its script tells apart.
  asks: Record<string, number[]>;
  // One list of hits for each form the skill takes that deals damage, with the states of its
  // caster that come to it: the stacks of each effect, as its script tells them apart. `needs`
  // names the state that takes the fewest effects, and the form that takes the fewest is first.
  // One used with Retribution has `retribution`, the stacks a use spends while any are held, and
  // has by then put `marks` on its target: stats at the skill's level. `gives` has the effects it
  // leaves that deal damage themselves.
  variants: { needs: string[]; when: Record<string, number>[]; hits: SkillHit[]; retribution?: number; marks?: StatMod[]; gives?: Gift[] }[];
  pets?: Pets;
}

// A spell that stats set off (ProcSpellEffect).
export interface ProcSpell {
  name: string;
  // The ticks before it can be set off again.
  cooldownTicks: number;
  // What it does cast once, where that isn't what a use of the class skill does.
  skill?: SkillDamage;
  // For a spell no class teaches: the skill whose level it is cast at and the lowest that goes
  // (Spell.getLevelOf), the most its own level can be, the skill whose stats and support gems it
  // is cast with (StatCalculation.collectSpellStats), and its own stats.
  own?: { levelOf: string; minRank: number; maxLevel: number; supportsOf: string; stats: StatMod[] };
}

export interface Weapon {
  type: string;
  style: string;
  ranged: boolean;
  // What a basic attack with it is multiplied by, and how many swings a second it makes.
  multi: number;
  rate: number;
  // The energy a basic attack takes for its swing and for each mob it hits, before it is scaled to level.
  energy: { swing: number; hit: number };
}

export interface DamageRules {
  rules: Record<string, Rule[]>;
  // What the stats a skill puts on its target do to a hit it takes.
  taken: Record<string, Rule[]>;
  layers: Record<string, Layer>;
  calcs: Record<string, DamageCalc>;
  skills: Record<string, SkillDamage>;
  procs: Record<string, ProcSpell>;
  auras: Record<string, AuraDamage>;
  // The same for the effects that can be set to be on, by the skills that give each.
  lasting: Record<string, Record<string, AuraDamage>>;
  weapons: Record<string, Weapon>;
  // Stats whose effect on damage depends on the moment: health, the kind of mob, the time of day.
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
// The pack's server config: the energy an unarmed attack takes (UNARMED_ENERGY_COST), and what
// regeneration of anything but energy is multiplied by in combat (in_combat_regen_multi).
const UNARMED_ENERGY = 5;
const IN_COMBAT_REGEN = 1;
export const UNARMED: Weapon = { type: 'none', style: 'str', ranged: false, multi: 1, rate: VANILLA_ATTACK_SPEED, energy: { swing: 0, hit: UNARMED_ENERGY } };

export interface Fighter {
  level: number;
  // The character's stats, and the ones the skill is used with: its support gems and its own stats on top.
  own: Map<string, Total>;
  unit: Map<string, Total>;
  weapon: Weapon;
  dualWield: boolean;
  // The stacks of each effect it is under.
  effects: Record<string, number>;
}

export interface Target {
  level: number;
  // Its stats, and the effects they have on a hit it takes.
  stats: Map<string, Total>;
  rules: Record<string, Rule[]>;
  effects: Record<string, number>;
  // It is the one dealing the hit, which it then can't dodge (DamageEvent.canAvoidHit).
  self?: true;
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

// IUsableStat, in the mod's code (6.4.13): the rating that makes half at level 1, and the most the stat can come to.
const DODGE = { id: 'dodge', per: 100, max: 0.8 };
const SPELL_DODGE = { id: 'spell_dodge', per: 200, max: 0.9 };

// DodgeRating and SpellDodgeEffect: the share of hits that the one with `stats` dodges, of spells
// tagged magic or of anything else. The attacker's accuracy comes off the rating, and what is left
// counts for less as the attacker's level goes up (IUsableStat.getUsableValue).
export function dodgeShare(scaling: DamageRules['scaling'], stats: Map<string, Total>, magic: boolean, accuracy: number, level: number) {
  const { id, per, max } = magic ? SPELL_DODGE : DODGE;
  const points = Math.max(0, Math.trunc((stats.get(id)?.value ?? 0) - accuracy));
  return clamp(points / (points + per * multiplier(scaling, level)), 0, max);
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
// The chance that either of two things sets each spell off, the second weighed by `share`.
const either = (to: Record<string, number>, from: Record<string, number>, share = 1) => {
  for (const [spell, chance] of Object.entries(from)) to[spell] = 1 - (1 - (to[spell] ?? 0)) * (1 - chance * share);
};
// IsBooleanTrueCondition: a rule that asks whether the hit was dodged.
const DODGED = 'is_dodged';
const rulesOf = (rules: Record<string, Rule[]>, unit: Map<string, Total>, on: Rule['on']) =>
  [...unit]
    .filter(([, total]) => active(total))
    .flatMap(([id, total]) => (rules[id] ?? []).filter((rule) => rule.on === on).map((rule) => ({ id, total, rule })))
    .sort((a, b) => a.rule.order - b.rule.order);

// DamageEvent for one outcome of every roll: `luck` says which of the chances come through. Gives
// the damage in the hit's own element, what it adds in others, what the target takes of it as
// other elements, what an ailment it causes is made of, the chances it came across, and the
// chance of each spell it sets off: `sure` is that chance for a hit the target dodges.
function strike(rules: HitRules, who: Fighter, target: Target, hit: Hit, luck: Map<string, boolean>) {
  const bools = new Set<string>([...(hit.basic ? ['is_basic_atk'] : []), ...(hit.bonus ? ['is_bonus_element_damage'] : []), ...(hit.blocked ? ['is_blocked'] : []), ...(hit.summon ? ['is_summon_attack'] : [])]);
  const strings: Record<string, string> = { attack_type: hit.ailment ? 'dot' : hit.bonus ? 'bonus_dmg' : 'hit', style: hit.style, ailment: hit.ailment ?? '' };
  const layers = new Map<string, number>();
  const conversion = new Map<Element, number>();
  const extra = new Map<Element, number>();
  const other = new Map<Element, number>();
  const takenAs = new Map<Element, number>();
  const chances = new Map<string, number>();
  const procs: Record<string, number> = {};
  const sure: Record<string, number> = {};
  const heals: { resource: Resource; value: number; percent?: true }[] = [];
  const missed: ByResource = {};
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
        case 'under':
          return !!(cond.who === 'Target' ? target : who).effects[cond.effect];
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
    // The target's dodges are worked out apart from the hit, so what a hit restores is told apart
    // by whether it asks for one that is dodged or one that lands.
    const dodge = rule.acts.every((act) => act.k === 'restore') ? rule.ifs.find((cond) => cond.k === 'bool' && cond.id === DODGED) : undefined;
    if (!rule.ifs.every((cond) => cond === dodge || met(cond))) continue;
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
      else if (act.k === 'proc') {
        // ProcSpellEffect: several stats can set the same spell off, but its cooldown lets one do it.
        // A dodge is rolled before most of them ask about it, and what the hit adds in other
        // elements isn't dealt at all, so a dodged hit sets off only what doesn't ask.
        const chance = { [act.spell]: clamp(total.value / 100, 0, 1) };
        either(procs, chance);
        if (!hit.depth && !rule.ifs.some((cond) => cond.k === 'bool' && cond.id === DODGED)) either(sure, chance);
      } else if (act.k === 'restore') {
        // A dodged hit deals nothing, and what it adds in other elements isn't dealt at all.
        if (!dodge || dodge.not) heals.push({ ...act, value: total.value });
        if (!hit.depth && (dodge ? !dodge.not : !act.percent)) missed[act.resource] = (missed[act.resource] ?? 0) + total.value;
      }
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
  const dealt = Math.max(0, damage);
  const restores: ByResource = {};
  for (const { resource, value, percent } of heals) restores[resource] = (restores[resource] ?? 0) + (percent ? (dealt * value) / 100 : value);
  return { damage: dealt, base, other, takenAs, chances, procs, sure, restores, missed };
}

export type ByElement = Partial<Record<Element, number>>;
export type Resource = 'health' | 'magic_shield' | 'mana' | 'energy' | 'blood';
export type ByResource = Partial<Record<Resource, number>>;
export const addTo = <K extends string>(to: Partial<Record<K, number>>, from: Partial<Record<K, number>>, times = 1) => {
  for (const [key, value] of Object.entries(from) as [K, number][]) to[key] = (to[key] ?? 0) + value * times;
};

export interface Average {
  damage: ByElement;
  // For the ailments it can cause: how many hits of each element it comes to, and what they are made of.
  landed: ByElement;
  base: ByElement;
  // The chance of each spell that it sets off, and that chance when the target dodges it.
  procs: Record<string, number>;
  sure: Record<string, number>;
  // What it restores to the one dealing it before any stat acts on that, and what it does when the target dodges it.
  restores: ByResource;
  missed: ByResource;
}

// What a hit comes to on average, by element: every roll weighed by its chance, and the damage it
// adds in other elements or is taken as worked out as hits of their own
// (DamageEvent.calculateAllBonusElementalDamage). What is taken as another element gets none of
// the "more" multipliers the hit started with. Those hits come at the same moment, so a spell with
// a cooldown is set off by one of them at most.
export function average(rules: HitRules, who: Fighter, target: Target, hit: Hit): Average {
  const chances = new Map<string, number>();
  for (;;) {
    const rolls = [...chances];
    let damage = 0;
    let landed = 0;
    let base = 0;
    let found = false;
    const procs: Record<string, number> = {};
    const sure: Record<string, number> = {};
    const restores: ByResource = {};
    const missed: ByResource = {};
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
      addTo(procs, result.procs, weight);
      addTo(sure, result.sure, weight);
      addTo(restores, result.restores, weight);
      addTo(missed, result.missed, weight);
      for (const [to, amount] of result.other) other.set(to, (other.get(to) ?? 0) + weight * amount);
      for (const [to, amount] of result.takenAs) takenAs.set(to, (takenAs.get(to) ?? 0) + weight * amount);
    }
    // A roll that only showed up now wasn't weighed, so the outcomes are gone over again with it.
    if (found) continue;
    // AilmentChance.canActivate: only the attacker's own hits that aren't blocked cause ailments.
    const causes = !hit.takenAs && !hit.blocked && !hit.ailment;
    const total: Average = { damage: { [hit.element]: damage }, landed: causes ? { [hit.element]: landed } : {}, base: causes ? { [hit.element]: base } : {}, procs, sure, restores, missed };
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
        either(total.procs, added.procs);
        addTo(total.restores, added.restores);
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

// SpellStatsCalculationEvent: what the caster's stats make of the numbers of a cast of the skill,
// from what they start at, and the switches they set.
function castData(rules: DamageRules, who: Fighter, skill: Pick<SkillDamage, 'style' | 'tags' | 'pets'>, start: Record<string, number>) {
  const now = { ...start };
  const bools: Record<string, boolean> = {};
  const strings: Record<string, string> = { style: skill.style, summon_type: skill.pets?.kind ?? 'none' };
  for (const { total, rule } of rulesOf(rules.rules, who.unit, 'cast')) {
    const met = (cond: Cond): boolean => !!cond.not !== (cond.k === 'tag' ? skill.tags.includes(cond.tag) : cond.k === 'str' ? strings[cond.key] === cond.value : cond.k === 'any' && cond.ifs.some(met));
    if (!rule.ifs.every(met)) continue;
    for (const act of rule.acts) {
      if (act.k === 'add') now[act.num] = (now[act.num] ?? 0) + total.value;
      else if (act.k === 'inc') now[act.num] = ((now[act.num] ?? 0) + ((start[act.num] ?? 0) * total.value) / 100) * total.more;
      else if (act.k === 'dec') now[act.num] = (now[act.num] ?? 0) - ((start[act.num] ?? 0) * total.value) / 100;
      else if (act.k === 'bool') bools[act.id] = act.value;
    }
  }
  return { now, bools };
}

// SpellStatsCalculationEvent and SpellCastingData: how many ticks one use of a skill takes when it
// is used over and over, what its duration is multiplied by, and how many pets of its kind can be out.
function castNumbers(rules: DamageRules, who: Fighter, skill: SkillDamage) {
  const start: Record<string, number> = { cast_ticks: skill.castTicks, cast_speed_ticks: skill.recoveryTicks, cd_ticks: skill.cooldownTicks, charge_cd_ticks: skill.chargeTicks, duration_multi: 1 };
  const { now } = castData(rules, who, skill, start);
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

// Hand-picked: the target is a zombie, 0.6 blocks wide, 5 blocks away. ProjectileUtil.getEntityHitResult
// lets a projectile's path pass up to 0.3 outside a mob and still hit it.
const AIM = { distance: 5, reach: 0.6 / 2 + 0.3 };

// ProjectileCastHelper: how many projectiles of a volley are shot, with what the caster's stats
// add, and how many hit the target, aimed so that the most do. They fan out evenly, go around in
// a circle with nova, or with barrage side by side a block apart, all the same way. One hits where
// its path passes within reach of the target, a homing one where it comes within its tracking
// radius. Random spread is left out, and so are chains and piercing: a projectile hits a mob once
// (EntityData.alreadyHit), and a chain never goes back to the one it came from.
function shots(rules: DamageRules, who: Fighter, skill: Pick<SkillDamage, 'style' | 'tags' | 'pets'>) {
  const { now, bools } = castData(rules, who, skill, {});
  const one = (v: Volley) => {
    const n = Math.max(0, Math.trunc(v.n + (v.fixed ? 0 : (now.bonus_proj ?? 0))));
    if (v.all || n < 2) return [n, n];
    const reach = Math.max(AIM.reach, v.reach ?? 0);
    const nova = v.nova || bools.nova;
    // How far apart two are and how wide the stretch they hit in is, in degrees or side by side in blocks.
    const [gap, width] = !nova && bools.barrage ? [1, 2 * reach] : [(nova ? 360 : v.apart!) / n, (2 * Math.asin(Math.min(1, reach / AIM.distance)) * 180) / Math.PI];
    return [n, Math.min(n, Math.floor(width / gap + 1e-9) + 1)];
  };
  return (volleys: Volley[]) => volleys.map(one).reduce((all, [n, k]) => ({ shot: all.shot * n, hit: all.hit * k }), { shot: 1, hit: 1 });
}

export interface Part {
  hit?: SkillHit;
  // How many times it lands for each use of the skill, less what the target dodges, and what it
  // then deals on average.
  count: number;
  damage: ByElement;
  // Of the projectiles it comes from, how many are shot together and how many of them hit.
  volley?: { shot: number; hit: number };
}

// The volleys that hits come from where not all the projectiles hit, each told once.
export const volleysMissed = (parts: Part[]) => [...new Map(parts.flatMap(({ volley }) => (volley && volley.hit < volley.shot ? [[`${volley.hit}/${volley.shot}`, volley] as const] : []))).values()];

export interface Damage {
  // The effects the skill is taken to be used under.
  needs: string[];
  parts: Part[];
  // One use of the skill: what it deals by element and in all, and how many there are a second.
  perUse: ByElement;
  total: number;
  rate: number;
  dps: number;
  // The share of its hits that the target doesn't dodge.
  lands: number;
  // What the ailments its hits cause deal on top for each use, by ailment.
  ailments: Record<string, number>;
  // How many times each use would set each spell off if no cooldown held it back.
  procs: Record<string, number>;
  // What each use restores to its user by leech, before the leech cap.
  restores: ByResource;
  // For a summon skill, whose use is one attack of one pet: how many pets it keeps out, and the
  // casts a second that does.
  pets?: number;
  casts?: number;
}

const sum = (damage: ByElement) => Object.values(damage).reduce((total, value) => total + value, 0);
// SpellTags.magic: a spell with it goes against spell dodge, and any other hit against dodge.
const MAGIC = 'magic';

// AilmentChance and EntityAilmentData: what each ailment the hits cause deals for one use of a
// skill that is used over and over. An ailment's damage is worked out once, as damage over time
// of no weapon that the attacker's and the target's stats act on, and is then dealt as it is.
// Ailment strength and DOT speed, which nothing in the pack gives, are left out. A hit a pet's
// spell deals has that spell's chance to cause one; how long it lasts goes by the skill's own stats.
// The event that works an ailment's damage out can set spells off like a hit (AilmentChance.activate):
// `starts` has the chance of each for every one of `hits` that lands. What its ticks restore to
// the attacker is taken to go with the damage they deal.
function ailmentDamage(rules: HitRules, who: Fighter, target: Target, hits: { count: number; from: Hit; by: Fighter; mean: Average }[], rate: number) {
  const perUse: Record<string, number> = {};
  const restores: ByResource = {};
  const starts = hits.map((): Record<string, number> => ({}));
  for (const [id, { element, share, ticks }] of Object.entries(AILMENTS)) {
    const stat = (name: string, of = who) => of.unit.get(`${id}_${name}`)?.value ?? 0;
    let made = 0;
    let rolls = 0;
    const heal: ByResource = {};
    for (const [i, { count, from, by, mean }] of hits.entries()) {
      const landed = mean.landed[element] ?? 0;
      // AilmentReceiveChance: the target's own chance to take the ailment is rolled apart from the attacker's.
      const chance = (stat('chance', by) + (target.stats.get(`${id}_receive_chance`)?.value ?? 0)) / 100;
      if (!landed) continue;
      rolls += count * landed;
      if (chance <= 0) continue;
      const event: Hit = { ...from, amount: mean.base[element]! / landed, element, ailment: id, bonus: false, depth: 0, style: 'int', basic: false, effectiveness: 1, multis: [levelPenalty(by, target)] };
      const caused = average(rules, { ...by, weapon: UNARMED }, target, event);
      made += count * landed * chance * (caused.damage[element] ?? 0);
      either(starts[i], caused.procs, Math.min(1, landed * chance));
      leeched(rules, by, caused.restores, event.tags, count * landed * chance, heal);
    }
    const once = made;
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
    if (perUse[id]) addTo(restores, heal, perUse[id] / once);
  }
  return { perUse, starts, restores };
}

// One use of a skill or one attack: its hits on the target and the ailments they cause. A hit is
// the user's own unless it says whose it is. The target dodges its share of them: the accuracy
// of the stats a hit is made with comes off the rating, and what a hit adds in other elements
// lands or misses with it (DamageEvent.buildBonusElementEvent). Dodges are spread evenly over
// the hits taken (AvoidanceEntropyData), so each hit counts as the share of it that lands.
function dealt(rules: HitRules, who: Fighter, target: Target, needs: string[], hits: { hit?: SkillHit; count: number; from: Hit; by?: Fighter; volley?: Part['volley'] }[], rate: number): Damage {
  const means = hits.map(({ hit, count, from, by = who, volley }) => {
    const dodged = target.self ? 0 : dodgeShare(rules.scaling, target.stats, !!from.tags?.includes(MAGIC), by.unit.get('accuracy')?.value ?? 0, by.level);
    return { hit, tries: count, count: count * (1 - dodged), from, by, volley, mean: average(rules, by, target, from) };
  });
  const perUse: ByElement = {};
  for (const { count, mean } of means) addTo(perUse, mean.damage, count);
  const parts = means.map(({ hit, count, volley, mean }): Part => ({ hit, count, damage: mean.damage, ...(volley && { volley }) }));
  const tries = hits.reduce((all, { count }) => all + count, 0);
  const lands = tries ? means.reduce((all, { count }) => all + count, 0) / tries : 1;
  const ailments = ailmentDamage(rules, who, target, means, rate);
  const procs: Record<string, number> = {};
  const restores: ByResource = { ...ailments.restores };
  for (const [i, { tries, count, mean, by, from }] of means.entries()) {
    const landed = { ...mean.procs };
    either(landed, ailments.starts[i]);
    addTo(procs, landed, count);
    addTo(procs, mean.sure, tries - count);
    leeched(rules, by, mean.restores, from.tags, count, restores);
    leeched(rules, by, mean.missed, from.tags, tries - count, restores);
  }
  return { needs, parts, perUse, total: sum(perUse), rate, dps: sum(perUse) * rate, lands, ailments: ailments.perUse, procs, restores };
}

// A skill at the level its user has it, with the stats it is used with.
export interface Used {
  skill: SkillDamage;
  who: Fighter;
  rank: number;
  topRank: number;
  // Its user as it is while it holds an effect the skill leaves on it: kept up from one use to
  // the next, or gone in between.
  holding?: (gift: Gift, kept: boolean) => Fighter;
}

// DamageAction: what each hit of a skill starts as against the target, cast as a spell of `as`.
function strikes(rules: DamageRules, { who, rank, topRank }: Omit<Used, 'skill'>, target: Target, hits: SkillHit[], as: { style: string; tags: string[] }, summon?: true) {
  const fired = hits.some((hit) => hit.volleys) && shots(rules, who, as);
  return hits.map((hit) => {
    const calc = rules.calcs[hit.calc];
    // DamageAction: the stacks multiply the damage worked out, not the number of hits.
    const amount = calcValue(rules, calc, who, rank, topRank) * (hit.per ? (who.effects[hit.per] ?? 0) : 1);
    const effectiveness = leveled(calc.effectiveness, rank, topRank);
    const from: Hit = { amount, element: hit.element, bonus: false, depth: 0, style: as.style, tags: as.tags, basic: false, effectiveness, multis: [levelPenalty(who, target)], summon };
    const volley = fired && hit.volleys ? fired(hit.volleys) : undefined;
    return { hit, count: hit.count * (volley?.hit ?? 1), from, by: who, volley };
  });
}

// What the effects a use of a skill leaves deal for each use, when it is used every `gap` ticks.
// A use renews the effect (ExilePotionEvent), so one that lasts until the next ticks without
// pause and never ends, and one that doesn't deals the ticks of its life. A tick comes when the
// age of the one holding the effect allows, whatever ran the script (OnTickCondition), so a life
// that ends on such a tick deals one more as it ends. One set to be on is kept up whatever is
// used, and what it deals is worked out apart. Nothing a basic attack sets off counts: the
// skill is all that is used.
function left(rules: DamageRules, used: Used, target: Target, variant: SkillDamage['variants'][number], gap: number, summon?: true) {
  const { who } = used;
  const fired = shots(rules, who, used.skill);
  return (variant.gives ?? []).flatMap((gift) => {
    if ((gift.enemy ? target : who).effects[gift.effect]) return [];
    // IncreaseNumberByPercentEffect, on the ticks the effect is given for.
    const lasts = Math.trunc(gift.longer.reduce((ticks, id) => (ticks + (gift.ticks * (who.unit.get(id)?.value ?? 0)) / 100) * (who.unit.get(id)?.more ?? 1), gift.ticks));
    const kept = lasts >= gap;
    const hits = gift.hits.flatMap((hit): SkillHit[] => {
      const count = hit.when === 'aura' ? (hit.count / 20) * (kept ? gap : lasts + 1) : hit.when === 'end' && !kept ? hit.count : 0;
      return count ? [{ ...hit, count, when: hit.when === 'aura' ? 'tick' : hit.when, effect: gift.name }] : [];
    });
    const stacks = gift.stacks * fired(gift.volleys ?? []).hit;
    return strikes(rules, { ...used, who: used.holding?.({ ...gift, stacks }, kept) ?? who }, target, hits, used.skill, summon);
  });
}

// Spells that set each other off settle within a few rounds.
const ROUNDS = 20;

// ProcSpellEffect: what the spells deal that the hits of `from` set off, each for one cast and as
// many casts a second as it goes off. The one dealing the hit casts the spell, as `cast` gives
// it and in the form its effects call for, and its hits can set other spells off in turn. They
// are taken to land while its own cooldown still runs, so not itself. A spell set off by a pet's
// hit hits as a pet does (DamageAction). CooldownsData: a spell can't be set off again for the
// ticks of its cooldown, so one that hits would set off `tries` times a second goes off
// tries / (1 + tries × cooldown) times. What the effects it leaves deal goes with it, its casts
// being as far apart as that makes them, so such a spell is worked out again as its rate settles.
export function procDamage(rules: DamageRules, from: Damage[], target: Target, cast: (spell: string) => Used, summon?: true): Record<string, Damage> {
  const once: Record<string, (rate: number) => Damage> = {};
  const alone: Record<string, Damage> = {};
  const paced: string[] = [];
  const find = (procs: Record<string, number>) => {
    for (const id of Object.keys(procs)) {
      if (id in once) continue;
      const used = cast(id);
      const form = formOf(used.skill, used.who.effects);
      const hits = strikes(rules, used, target, form?.hits ?? [], used.skill, summon);
      once[id] = (rate) => dealt(rules, used.who, target, [], [...hits, ...(form ? left(rules, used, target, form, 20 / rate, summon) : [])], rate);
      alone[id] = once[id](0);
      if (form?.gives) paced.push(id);
      find(alone[id].procs);
    }
  };
  for (const { procs } of from) find(procs);

  const ids = Object.keys(once).filter((id) => alone[id].parts.length);
  let rates: Record<string, number> = {};
  for (let round = 0; round < ROUNDS; round++) {
    rates = Object.fromEntries(
      ids.map((id) => {
        const others = ids.filter((other) => other !== id).map((other) => ({ rate: rates[other] ?? 0, procs: alone[other].procs }));
        const tries = [...from, ...others].reduce((all, { rate, procs }) => all + rate * (procs[id] ?? 0), 0);
        return [id, tries / (1 + (tries * rules.procs[id].cooldownTicks) / 20)];
      }),
    );
    for (const id of paced) if (id in rates) alone[id] = once[id](rates[id]);
  }
  return Object.fromEntries(ids.filter((id) => rates[id] > 0).map((id) => [id, once[id](rates[id])]));
}

// What the hits of an effect's own script deal to one target while the effect is on, as a spell
// of the skill that gave it: an aura's, or those of an effect set to be on. The script runs on a
// clock of its own, so a use of it is a second.
export function effectDamage(rules: DamageRules, as: Pick<SkillDamage, 'style' | 'tags'>, hits: SkillHit[], used: Omit<Used, 'skill'>, target: Target): Damage {
  return dealt(rules, used.who, target, [], strikes(rules, used, target, hits, as), 1);
}

// CasterHasMnsEffectCondition: the form of a skill that its caster's effects call for, when it
// deals damage under them.
export function formOf(skill: SkillDamage, effects: Record<string, number>) {
  const state = Object.entries(skill.asks).map(([effect, levels]) => [effect, Math.max(...levels.filter((stacks) => stacks <= (effects[effect] ?? 0)))] as const);
  return skill.variants.find((variant) => variant.when.some((when) => state.every(([effect, stacks]) => (when[effect] ?? 0) === stacks)));
}

// SummonSpellCaster: the stat that adds to the chance a golem casts its spell as it attacks.
const GOLEM = { tag: 'golem', chance: 'golem_spell_chance' };

// A skill's damage against one target, used in one of the forms it takes, with what the effects
// it leaves deal. A summon skill deals what its pets do: as many as it can keep out, all attacking the target without
// pause, with one attack of one pet for a use. `cast` has the skills its pets may cast, which the
// character casts through them at the level it has them itself.
export function skillDamage(rules: DamageRules, used: Used, target: Target, variant: SkillDamage['variants'][number], cast: Record<string, Used> = {}): Damage {
  const { skill, who } = used;
  const { ticks, duration, summons } = castNumbers(rules, who, skill);
  const { pets } = skill;
  if (!pets) return dealt(rules, who, target, variant.needs, [...strikes(rules, used, target, variant.hits, skill), ...left(rules, used, target, variant, ticks)], 20 / ticks);

  // SummonPetAction: pets past what their kind allows are sent away, the oldest first.
  const life = Math.trunc(pets.lifeTicks * duration);
  const out = Math.min((pets.count * life) / ticks, pets.capped ? summons : Infinity);
  const chance = clamp(Math.trunc(pets.chance + (skill.tags.includes(GOLEM.tag) ? (who.own.get(GOLEM.chance)?.value ?? 0) : 0)) / 100, 0, 1);
  const spells = pets.spells.flatMap((id) =>
    strikes(rules, cast[id], target, cast[id].skill.variants[0].hits, cast[id].skill, true).map(({ hit, count, ...rest }) => ({ ...rest, hit: { ...hit, when: 'spell' as const }, count: (count * chance) / pets.spells.length })),
  );
  const hits = [...strikes(rules, used, target, variant.hits, pets, true), ...(chance > 0 ? spells : [])];
  return { ...dealt(rules, who, target, variant.needs, hits, (out * 20) / pets.attackTicks), pets: out, casts: out && (out * 20) / (pets.count * life) };
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

// EffectEvent for spending or restoring a resource: what the layers that the stats of its one
// entity, both sides of it, add make of `number`, where what each asks of the event holds.
function settle(rules: HitRules, who: Fighter, on: 'spend' | 'restore', number: number, strings: Record<string, string>, bools: string[], tags?: string[]) {
  const layers = new Map<string, number>();
  let more = 1;
  for (const { total, rule } of rulesOf(rules.rules, who.unit, on)) {
    const met = (cond: Cond): boolean =>
      !!cond.not !==
      (cond.k === 'str' ? strings[cond.key] === cond.value : cond.k === 'bool' ? bools.includes(cond.id) : cond.k === 'tag' ? !!tags?.includes(cond.tag) : cond.k === 'spell' ? !!tags : cond.k === 'any' && cond.ifs.some(met));
    if (!rule.ifs.every(met)) continue;
    for (const act of rule.acts) {
      if (act.k !== 'layer') continue;
      layers.set(act.layer, (layers.get(act.layer) ?? 0) + act.sign * (act.n ?? (act.of ? ((who.own.get(act.of)?.value ?? 0) * total.value) / 100 : total.value)));
      more *= total.more;
    }
  }
  return [...layers].sort((a, b) => rules.layers[a[0]].priority - rules.layers[b[0]].priority).reduce((n, [id, amount]) => {
    const { action, min, max } = rules.layers[id];
    return action === 'ADD' ? n + amount : n * clamp(1 + amount / 100, min, max);
  }, number) * more;
}

// RestoreResourceEvent: what restoring `amount` of a resource comes to, by resource, for one with
// `who`'s stats, `tags` being those of the spell whose hit restores it. In combat, regeneration of
// anything but energy is multiplied by the pack's in_combat_regen_multi. MagicShieldHeal and
// HealthRestorationToBloodEffect restore a share of health, before what stats add to it, as magic
// shield and, where no spell does it, as blood.
export function restore(rules: HitRules, who: Fighter, resource: Resource, type: 'regen' | 'leech', amount: number, tags?: string[]): ByResource {
  const one = (to: Resource, n: number, spell?: string[]) => settle(rules, who, 'restore', n, { resource_type: to, restore_type: type }, [], spell) * (type === 'regen' && to !== 'energy' ? IN_COMBAT_REGEN : 1);
  const share = (id: string) => (amount * (who.unit.get(id)?.value ?? 0)) / 100;
  if (resource !== 'health') return { [resource]: one(resource, amount, tags) };
  return { health: one('health', amount, tags), magic_shield: one('magic_shield', share('magic_shield_heal')), blood: tags ? 0 : one('blood', share('hp_resto_to_blood')) };
}

// What leech of `raw` comes to, `times` over, added to `to`.
function leeched(rules: HitRules, who: Fighter, raw: ByResource, tags: string[] | null, times: number, to: ByResource) {
  for (const [resource, amount] of Object.entries(raw) as [Resource, number][]) if (amount && times) addTo(to, restore(rules, who, resource, 'leech', amount, tags ?? undefined), times);
}

// OnServerTick: what is regenerated a second, once a second, of each resource but blood: its
// regeneration stat and its share of the most it can be (RegeneratePercentStat).
export function regenerated(rules: HitRules, who: Fighter): ByResource {
  const of = (id: string) => who.unit.get(id)?.value ?? 0;
  const out: ByResource = {};
  for (const resource of ['health', 'magic_shield', 'mana', 'energy'] as const) addTo(out, restore(rules, who, resource, 'regen', of(`${resource}_regen`) + (of(resource) * of(`${resource}_per_sec`)) / 100));
  return out;
}

// SpendResourceEvent: what spending `number` of mana or energy comes to after the stats add to
// it, `bools` saying which the spell costs. A blood user pays it in blood (BloodUserEffect), which
// none of them add to.
function spend(rules: HitRules, who: Fighter, resource: 'mana' | 'energy', number: number, bools: string[]): ByResource {
  const to = (who.unit.get('blood_user')?.value ?? 0) > 0 ? 'blood' : resource;
  return { [to]: settle(rules, who, 'spend', number, { resource_type: to }, bools) };
}

// Spell.getCalculatedManaCost: what one use of a skill costs, `cost` at its level as the caster's
// stats make it (SpellStatsCalculationEvent). A channelled one that costs anything costs at least
// 1 a pulse. Both are spent, with what stats add on spending, even one that comes to nothing.
export function useCost(rules: DamageRules, scaling: DamageRules['scaling'], { who, rank, topRank }: Omit<Used, 'skill'>, skill: Pick<SkillDamage, 'style' | 'tags' | 'pets'>, cost: Cost, channel: boolean): ByResource {
  const at = (value: Leveled) => f(multiplier(scaling, who.level) * leveled(value, rank, topRank));
  const { now } = castData(rules, who, skill, { mana_cost: at(cost.mana), energy_cost: at(cost.energy) });
  const bools = (['mana', 'energy'] as const).filter((resource) => cost[resource].min > 0).map((resource) => `costs_${resource}`);
  const out: ByResource = {};
  for (const resource of ['mana', 'energy'] as const) {
    const n = Math.trunc(now[`${resource}_cost`]);
    addTo(out, spend(rules, who, resource, channel && cost[resource].min > 0 ? Math.max(1, n) : n, bools));
  }
  return out;
}

// EntityData.attackWithWeapon: a basic attack takes energy for the mob it hits, and for its swing
// at most once in SWING_TICKS, scaled to level. An unarmed one takes the same every time.
const SWING_TICKS = 3;
export function attackCost(rules: HitRules, who: Fighter, rate: number): ByResource {
  const { swing, hit } = who.weapon.energy;
  return spend(rules, who, 'energy', multiplier(rules.scaling, who.level) * (hit + swing / Math.max(1, Math.ceil((SWING_TICKS * rate) / 20))), []);
}

// EntityLeechData: leech is paid out once a second, no more of a resource than its leech cap's
// share of the most it can be, and what comes in past that is lost.
const leechCap = (stats: Map<string, Total>, resource: Resource) => ((stats.get(`${resource}_leech_cap`)?.value ?? 0) / 100) * (stats.get(resource)?.value ?? 0);

// How long a skill can be used at full pace on what it costs a second, `spent`, against what comes
// back a second: regeneration, leech from hits that come whatever is used, `kept`, and leech from
// those that come with each use, `used`, which a slower pace brings down with it. `pace` is the
// share of full pace that what comes back pays for, and `dry` the resource that runs out first at
// full pace, with the seconds a full pool lasts. `held` is what comes back at that pace. Nothing
// comes back to a pool that holds nothing, which is always full (ResourceType.isFull).
export function sustain(stats: Map<string, Total>, spent: ByResource, regen: ByResource, kept: ByResource, used: ByResource) {
  const at = (pace: number) =>
    Object.fromEntries(
      (['health', 'magic_shield', 'mana', 'energy', 'blood'] as const).map((r) => [r, (stats.get(r)?.value ?? 0) > 0 ? (regen[r] ?? 0) + Math.min(leechCap(stats, r), (kept[r] ?? 0) + pace * (used[r] ?? 0)) : 0]),
    ) as Record<Resource, number>;
  const recovered = at(1);
  let pace = 1;
  let dry: { resource: Resource; after: number } | undefined;
  for (const [resource, cost] of Object.entries(spent) as [Resource, number][]) {
    if (cost <= recovered[resource]) continue;
    const [base, fixed, paced] = [regen[resource] ?? 0, kept[resource] ?? 0, used[resource] ?? 0];
    // Where leech stays under the cap, a pace k pays for itself where k × cost = base + fixed + k × paced; past the cap, where k × cost = base + cap.
    const k = Math.min((base + leechCap(stats, resource)) / cost, cost > paced ? (base + fixed) / (cost - paced) : Infinity);
    if (k < pace) {
      pace = k;
      dry = { resource, after: (stats.get(resource)?.value ?? 0) / (cost - recovered[resource]) };
    }
  }
  return { recovered, pace, dry, held: at(pace) };
}
