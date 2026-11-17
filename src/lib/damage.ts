// Build-time only: what the damage calculator needs to know about stats, skills and weapons.
// Components take the types from damageRules.ts.
import baseData from '../data/base_gear_types.json';
import balanceData from '../data/game_balance.json';
import slotData from '../data/gear_slot.json';
import schoolData from '../data/spell_school.json';
import spellData from '../data/spells.json';
import statData from '../data/stat.json';
import conditionData from '../data/stat_condition.json';
import effectData from '../data/stat_effect.json';
import layerData from '../data/stat_layer.json';
import effectsData from '../data/exile_effect.json';
import calcData from '../data/value_calc.json';
import weaponData from '../data/weapon_type.json';
import { AILMENTS, type Act, type Cond, type DamageCalc, type DamageRules, type Element, type Layer, type Rule, type SkillDamage, type SkillHit, type Weapon } from './damageRules';
import { text } from './gear';
import type { Leveled } from './spellRules';

const balance = balanceData.original_balance;

// StatPriority: effects go in this order, and the layers are worked out at 30.
const ORDER: Record<string, number> = { first: 0, data_modification: 0, before_hit_prevention: 9, hit_prevention: 10, before_damage_layers: 19, damage_layers: 20, after_damage_layers: 21 };
const EVENTS: Record<string, Rule['on']> = { on_damage: 'damage', on_spell_stat_calc: 'cast' };

type Raw = Record<string, any>;
const rawConditions = conditionData as Record<string, Raw>;
const rawEffects = effectData as Record<string, Raw>;

// A condition the calculator can check, or null for one that depends on the moment.
function condition(id: string): Cond | null {
  const c = rawConditions[id];
  const not = c.is === false ? ({ not: true } as const) : {};
  switch (c.ser) {
    case 'string_matches':
      return { k: 'str', key: c.string_key, value: c.string_id, ...not };
    case 'is_bool_true':
      return { k: 'bool', id: c.bool_id, ...not };
    case 'spell_has_tag':
      return { k: 'tag', tag: c.tag.id, ...not };
    case 'wep_type_match':
      return { k: 'wep', type: c.type, ...not };
    case 'ele_match_stat':
      return { k: 'ele', ...not };
    case 'is_elemental_damage':
      return { k: 'elemental', ...not };
    case 'is_spell':
      return { k: 'spell', ...not };
    case 'is_ranged_weapon':
      return { k: 'ranged', ...not };
    case 'is_dual_wielding':
      return { k: 'dual', ...not };
    case 'random_roll':
      return { k: 'roll', ...not };
    case 'is_ailment':
      return { k: 'str', key: 'ailment', value: c.ailment, ...not };
    // A hit is never the attacker's own.
    case 'source_is_target':
      return { k: 'never', ...not };
    case 'either_is_true': {
      const ifs = (c.ifs as string[]).map(condition);
      return ifs.includes(null) ? null : { k: 'any', ifs: ifs as Cond[], ...not };
    }
    default:
      return null;
  }
}

// What an effect does to a hit or a cast, where that changes damage. Null where it depends on
// the moment, and nothing for what has no say in damage: leech, effects it gives, spells it sets off.
function action(id: string): Act | null | undefined {
  const e = rawEffects[id];
  switch (e.ser) {
    case 'modify_stat_layer': {
      const { type, calc } = e.number_provider;
      const scaled = e.number_modifiers.length ? ({ scaled: true } as const) : {};
      const from = type === 'SPECIFIC_NUMBER' ? { n: +calc } : type === 'STAT_PERCENT' ? { of: calc as string } : {};
      return type === 'NUMBER_PERCENT' ? undefined : { k: 'layer', layer: e.layer, sign: e.modification === 'REDUCE' ? -1 : 1, ...from, ...scaled };
    }
    case 'set_bool':
      return { k: 'bool', id: e.bool_id, value: e.bool };
    case 'add_to_number':
      return e.num_provider.type === 'STAT_DATA' ? { k: 'add', num: e.number_id } : undefined;
    case 'increase_number':
      return { k: 'inc', num: e.num_id };
    case 'decrease_num':
      return { k: 'dec', num: e.num_id };
    case 'missing_resource_scaling':
    case 'increase_number_per_curse_on_target':
      return null;
    default:
      return undefined;
  }
}

interface RawStat {
  ele?: Element;
  effect?: { events: string[]; order: string; side: string; ifs: string[]; effects: string[] }[];
  data?: RawStat;
}
const rawStats = statData as unknown as Record<string, RawStat>;

// The effects stats have on a hit and on a cast, for the one dealing the hit or the one taking it,
// and the stats whose effect on a hit depends on the moment.
export function statRules(side: 'Source' | 'Target') {
  const situational = new Set<string>();
  const rules: Record<string, Rule[]> = {};
  for (const [id, raw] of Object.entries(rawStats)) {
    const stat = raw.data ?? raw;
    for (const effect of stat.effect ?? []) {
      const on = effect.events.map((event) => EVENTS[event]).find(Boolean);
      const acts = effect.effects.map(action).filter((act) => act !== undefined);
      // What comes after the layers doesn't change the hit.
      if (!on || effect.side !== side || !(effect.order in ORDER) || !acts.length) continue;
      const ifs = effect.ifs.map(condition);
      if (acts.includes(null) || ifs.includes(null)) {
        if (on === 'damage') situational.add(id);
        continue;
      }
      const element = effect.ifs.some((c) => rawConditions[c].ser === 'ele_match_stat') ? { element: stat.ele } : {};
      (rules[id] ??= []).push({ on, order: ORDER[effect.order], ...element, ifs: ifs as Cond[], acts: acts as Act[] });
    }
  }
  return { rules, situational };
}
// The calculator's target has no stats of its own.
const { rules, situational } = statRules('Source');

// Stats built into the mod, whose effects are in its code (6.4.13) and need rechecking when it updates.
const HIT: Cond = { k: 'str', key: 'attack_type', value: 'hit' };
const OWN: Cond = { k: 'bool', id: 'is_bonus_element_damage', not: true };
const CONVERTS: Cond[] = [{ k: 'any', ifs: [HIT, { k: 'str', key: 'attack_type', value: 'bonus_dmg' }] }, { k: 'shallow' }];
const builtin = (id: string, order: number, ifs: Cond[], act: Act) => (rules[id] = [{ on: 'damage', order, ifs, acts: [act] }]);
const MORE_DAMAGE: Act = { k: 'layer', layer: 'additive_damage', sign: 1 };
builtin('spell_damage', 19, [{ k: 'spell' }], MORE_DAMAGE);
builtin('hit_damage', 19, [{ k: 'str', key: 'ailment', value: '' }], MORE_DAMAGE);
builtin('ailment_damage', 19, [{ k: 'str', key: 'ailment', value: '', not: true }], MORE_DAMAGE);
for (const id of Object.keys(AILMENTS)) builtin(`${id}_damage`, 19, [{ k: 'str', key: 'ailment', value: id }], MORE_DAMAGE);
builtin('armor_penetration', 19, [{ k: 'is', element: 'Physical' }], { k: 'pen' });
builtin('ele_to_chaos', 20, [{ k: 'single' }, ...CONVERTS], { k: 'convert', to: 'Shadow' });
const SINGLE: [Element, string][] = [
  ['Physical', 'physical'],
  ['Fire', 'fire'],
  ['Cold', 'water'],
  ['Nature', 'lightning'],
  ['Shadow', 'chaos'],
];
for (const [element, id] of SINGLE) {
  builtin(`flat_${id}_added_damage`, 19, [HIT, OWN], { k: 'flat', to: element, scaled: true });
  builtin(`flat_${id}_added_attack_damage`, 19, [HIT, OWN, { k: 'str', key: 'style', value: 'int', not: true }], { k: 'flat', to: element, scaled: true });
  builtin(`flat_${id}_added_magic_damage`, 19, [HIT, OWN, { k: 'tag', tag: 'magic' }], { k: 'flat', to: element, scaled: true });
  builtin(`${id}_weapon_damage`, 19, [{ k: 'bool', id: 'is_basic_atk' }, HIT], { k: 'flat', to: element, scaled: false });
  if (element === 'Physical') continue;
  builtin(`${id}_penetration`, 19, [{ k: 'is', element }], { k: 'pen' });
  builtin(`plus_phys_to_${id}`, 19, [{ k: 'is', element: 'Physical' }, ...CONVERTS], { k: 'extra', to: element });
  builtin(`phys_to_${id}`, 20, [{ k: 'is', element: 'Physical' }, ...CONVERTS], { k: 'convert', to: element });
}
// Converts to an element picked at random each hit.
situational.add('phys_to_random');

const layers: Record<string, Layer> = Object.fromEntries(
  Object.values(layerData)
    .filter((l) => l.action === 'ADD' || l.action === 'MULTIPLY')
    .map((l) => [l.id, { action: l.action as Layer['action'], priority: l.priority, min: l.min_multi, max: l.max_multi }]),
);

interface RawCalc {
  base: Leveled;
  cap_to_wep_dmg: number;
  dmg_effectiveness: { multi: Leveled };
  stat_scalings: { stat: string; multi: Leveled }[];
}
const rawCalcs = calcData as unknown as Record<string, RawCalc>;

// What the target's own stats add is left out: the calculator's target has none.
const calc = (id: string): DamageCalc => {
  const c = rawCalcs[id];
  // ValueCalculation.capsToWeaponDamage: the data uses 1000 to mean no cap.
  return { base: c.base, parts: c.stat_scalings, cap: c.cap_to_wep_dmg < 50 ? c.cap_to_wep_dmg : null, effectiveness: c.dmg_effectiveness.multi };
};

interface RawPart {
  acts: { type: string; map: Raw }[];
  ifs: { type: string; map: Raw }[];
  targets: { type: string }[];
}
interface RawSpell {
  attached: { on_cast: RawPart[]; entity_components: Record<string, RawPart[]> };
  config: {
    style: string;
    cast_time_ticks: number;
    cast_speed_ticks: number;
    cooldown_ticks: number;
    charges: number;
    charge_regen: number;
    times_to_cast: number;
    channel_skill: boolean;
    tags: { tags: string[] };
  };
}
const rawSpells = spellData as unknown as Record<string, RawSpell>;
const casterEffects = effectsData as unknown as Record<string, { one_of_a_kind_id: string; max_stacks: number }>;
const effectName = (id: string) => text(`mmorpg.effect.${id}`, id);

const EFFECT_IF = 'caster_has_mns_effect';
// What makes the entities a spell's script goes on in; pets fight on their own and aren't counted.
const SUMMONS = ['projectile', 'summon_at_sight', 'summon_block'];

// OnTickCondition: how many times a step that runs every `tick_rate` ticks does in an entity's life.
const ticks = (life: number, { tick_rate: rate, first_tick: first = 0 }: Raw) =>
  first > life ? 0 : rate <= 0 ? 1 : first > 0 ? Math.floor((life - first) / rate) + 1 : Math.floor(life / rate);

// The hits of one use of a spell on a single target, with its caster holding `stacks` of each
// effect its script asks about. Of projectiles shot together one is taken to hit, and of what
// goes on over time every tick is taken to land.
function hitsOf(spell: RawSpell, stacks: Record<string, number>): SkillHit[] {
  const hits: SkillHit[] = [];
  const walk = (parts: RawPart[], count: number, life: number, seen: string[]) => {
    for (const part of parts) {
      if (!part.ifs.filter((i) => i.type === EFFECT_IF).every((i) => (stacks[i.map.exile_potion_id] ?? 0) >= (i.map.effect_stacks ?? 1) !== !!i.map.is_false)) continue;
      const has = (type: string) => part.ifs.find((i) => i.type === type);
      const tick = has('x_ticks_condition');
      const when: SkillHit['when'] = tick ? 'tick' : has('on_entity_expire') ? 'end' : has('on_hit') ? 'hit' : 'cast';
      // A spell cast several times in a row runs its script each time; some steps only on the first or last.
      const times = (life ? (tick ? ticks(life, tick.map) : 1) : has('is_first_cast') || has('is_last_cast') ? 1 : spell.config.times_to_cast) * count;
      for (const act of part.acts) {
        // DamageAction: some damage is multiplied by the stacks of an effect on the caster.
        const multiplied = act.map.multiply_by_caster_effect_stacks ? (stacks[act.map.multiply_by_caster_effect_stacks] ?? 0) : 1;
        if (act.type === 'damage' && multiplied && part.targets.some((t) => t.type !== 'self')) {
          hits.push({ calc: act.map.value_calculation, element: act.map.element, count: times * multiplied, when });
        }
        const entity: string | undefined = act.map.entity_name;
        if (!entity || !SUMMONS.includes(act.type) || seen.includes(entity)) continue;
        walk(spell.attached.entity_components[entity] ?? [], times, Math.max(1, act.map.life_ticks ?? 1), [...seen, entity]);
      }
    }
  };
  walk(spell.attached.on_cast, 1, 0, []);
  return hits.filter((hit) => hit.count > 0);
}

function skill(spell: RawSpell): SkillDamage | null {
  // Each effect the script asks about, and the numbers of stacks it tells apart. Where stacks
  // multiply damage, the caster has none or all of them.
  const asked = new Map<string, Set<number>>();
  const ask = (effect: string, stacks: number) => (asked.get(effect) ?? asked.set(effect, new Set([0])).get(effect)!).add(stacks);
  const parts = [...spell.attached.on_cast, ...Object.values(spell.attached.entity_components).flat()];
  for (const i of parts.flatMap((part) => part.ifs)) if (i.type === EFFECT_IF) ask(i.map.exile_potion_id, i.map.effect_stacks ?? 1);
  for (const effect of parts.flatMap((part) => part.acts.flatMap((act) => act.map.multiply_by_caster_effect_stacks ?? []))) asked.set(effect, new Set([0, casterEffects[effect].max_stacks]));
  let states: Record<string, number>[] = [{}];
  for (const [effect, levels] of asked) states = states.flatMap((state) => [...levels].map((stacks) => ({ ...state, [effect]: stacks })));
  // Effects of one kind, like stances, push each other out.
  states = states.filter((state) => {
    const kinds = Object.keys(state).flatMap((effect) => (state[effect] && casterEffects[effect]?.one_of_a_kind_id) || []);
    return new Set(kinds).size === kinds.length;
  });

  // States that come to the same hits are one, told by the fewest effects that give them.
  const variants = new Map<string, SkillDamage['variants'][number]>();
  for (const state of states.sort((a, b) => Object.values(a).filter(Boolean).length - Object.values(b).filter(Boolean).length)) {
    const hits = hitsOf(spell, state);
    const key = JSON.stringify(hits);
    const needs = Object.entries(state).flatMap(([effect, stacks]) => (stacks ? [stacks > 1 ? `${stacks} ${effectName(effect)}` : effectName(effect)] : []));
    if (hits.length && !variants.has(key)) variants.set(key, { needs, hits });
  }
  if (!variants.size) return null;
  const { config } = spell;
  return {
    style: config.style,
    tags: config.tags.tags,
    castTicks: config.cast_time_ticks,
    recoveryTicks: config.cast_speed_ticks,
    cooldownTicks: config.cooldown_ticks,
    charges: config.charges,
    chargeTicks: config.charge_regen,
    times: config.times_to_cast,
    channel: config.channel_skill,
    variants: [...variants.values()],
  };
}

const skills: Record<string, SkillDamage> = Object.fromEntries(
  Object.values(schoolData)
    .flatMap((school) => Object.keys(school.perks))
    .flatMap((id) => {
      const damage = id in rawSpells && skill(rawSpells[id]);
      return damage ? [[id, damage] as const] : [];
    }),
);
const usedCalcs = [...new Set(Object.values(skills).flatMap((s) => s.variants.flatMap((v) => v.hits.map((hit) => hit.calc))))];

// What the pack's own weapons (RoE Weapons 0.1.7) add to the 4 swings a second every player
// starts with, read from the lowest tier of each; higher tiers swing up to 0.3 faster. Bows and
// crossbows shoot as fast as they are drawn.
const SWING: Record<string, number> = { axe: -3, dagger: -2, gauntlet: -1.8, greatsword: -3.2, hammer: -3.1, scythe: -2.9, spear: -2.9, staff: -2.9, sword: -2.4, trident: -2.9 };
const DRAW: Record<string, number> = { bow: 1, crossbow: 0.8 };
const slots = slotData as Record<string, { weapon_data: { damage_multiplier: number } }>;
const weaponTypes = weaponData as Record<string, { range: string }>;

const weapons: Record<string, Weapon> = Object.fromEntries(
  Object.values(baseData)
    .filter((base) => base.weapon_type in weaponTypes && base.weapon_type !== 'none')
    .map((base) => [
      base.guid,
      {
        type: base.weapon_type,
        style: base.style.toLowerCase(),
        ranged: weaponTypes[base.weapon_type].range === 'RANGED',
        multi: slots[base.gear_slot].weapon_data.damage_multiplier,
        rate: DRAW[base.gear_slot] ?? 4 + (SWING[base.gear_slot] ?? -2.4),
      },
    ]),
);

export const damage: DamageRules = {
  rules,
  layers,
  calcs: Object.fromEntries(usedCalcs.map((id) => [id, calc(id)])),
  skills,
  weapons,
  situational: [...situational].sort(),
  scaling: { base: balance.NORMAL_STAT_SCALING.base_scaling, perLevel: balance.NORMAL_STAT_SCALING.per_level_scaling },
  globalCooldownTicks: balance.GLOBAL_COOLDOWN_TICKS,
  minCooldown: balance.MIN_SPELL_COOLDOWN_MULTI,
  channelSpeed: balance.CHANNEL_GENERAL_SPEED_TRANSFER,
  takenAs: layerData.damage_taken_as.priority,
};
