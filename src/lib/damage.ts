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
import type { StatMod } from './affix';
import { transfers } from './builtinStats';
import { AILMENTS, type Act, type AuraDamage, type Cond, type DamageCalc, type DamageRules, type Element, type Gift, type Layer, type ProcSpell, type Rule, type SkillDamage, type SkillHit, type Volley, type Weapon } from './damageRules';
import { statMod, text } from './gear';
import type { Leveled } from './spellRules';

const balance = balanceData.original_balance;

// StatPriority: effects go in this order, and the layers are worked out at 30. What comes after
// that changes a cast's costs or restores a resource on a hit.
const ORDER: Record<string, number> = { first: 0, data_modification: 0, before_hit_prevention: 9, hit_prevention: 10, before_damage_layers: 19, damage_layers: 20, after_damage_layers: 21, after_damage_bonuses: 32 };
// Where a stat sets a spell off. One of the first priority comes after the roll for a critical
// hit, which is of the same: the game goes through a character's stats in the order of its
// HashMap, where critical_hit is ahead of the stats that ask about it once there are 97 or more.
const SETS_OFF: Record<string, number> = { data_modification: 0.5, final_damage: 100 };
// RandomRollCondition and IsNotOnCooldownCondition: how often a spell is set off is worked out
// apart from what the hit has to be.
const HOW_OFTEN = ['random_roll', 'is_not_on_cd'];
const EVENTS: Record<string, Rule['on']> = { on_damage: 'damage', on_spell_stat_calc: 'cast', on_spend_resource: 'spend', on_restore_resource: 'restore' };

type Raw = Record<string, any>;
const rawConditions = conditionData as Record<string, Raw>;
const rawEffects = effectData as Record<string, Raw>;
// IsTargetCursed: the effects that are curses.
const curses = Object.values(effectsData as unknown as Record<string, { id: string; tags: { tags: string[] } }>).flatMap((e) => (e.tags.tags.includes('curse') ? [e.id] : []));

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
    case 'is_under_exile_effect':
      return { k: 'under', effect: c.effect, who: c.side, ...not };
    case 'is_target_cursed':
      return { k: 'any', ifs: curses.map((effect) => ({ k: 'under', effect, who: 'Target' })), ...not };
    // The character the calculator works out is always fighting.
    case 'is_in_combat':
      return { k: 'never', ...(c.is === false ? {} : { not: true }) };
    // SpellHasResourceTypeCostCondition, as a switch of the spend.
    case 'spell_has_resource_type_cost':
      return { k: 'bool', id: `costs_${c.type}`, ...not };
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

// What an effect does to a hit, a cast or a spend or restore of a resource. Null where it depends
// on the moment, and nothing for what has no say in those: effects it gives.
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
    // ProcSpellEffect: the one dealing the hit casts it.
    case 'proc_spell':
      return e.source === 'Source' ? { k: 'proc', spell: e.spellId } : undefined;
    case 'restore_resource':
      return { k: 'restore', resource: e.type, ...(e.num_provider.type === 'NUMBER_PERCENT' && { percent: true as const }) };
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

// The effects stats have on a hit, on a cast and on spending or restoring a resource, for the one
// dealing the hit or the one taking it, and the stats whose effect on a hit, or on what is
// restored, depends on the moment.
export function statRules(side: 'Source' | 'Target') {
  const situational = new Set<string>();
  const healing = new Set<string>();
  const rules: Record<string, Rule[]> = {};
  for (const [id, raw] of Object.entries(rawStats)) {
    const stat = raw.data ?? raw;
    for (const effect of stat.effect ?? []) {
      const on = effect.events.map((event) => EVENTS[event]).find(Boolean);
      const acts = effect.effects.map(action).filter((act) => act !== undefined);
      const sets = acts.some((act) => act?.k === 'proc');
      // What comes after the layers doesn't change the hit, but can set a spell off.
      const order = (sets ? SETS_OFF : ORDER)[effect.order];
      if (!on || effect.side !== side || order === undefined || !acts.length) continue;
      const ifs = effect.ifs.filter((c) => !(sets && HOW_OFTEN.includes(rawConditions[c].ser))).map(condition);
      if (acts.includes(null) || ifs.includes(null)) {
        if (on === 'damage') situational.add(id);
        if (on === 'restore') healing.add(id);
        continue;
      }
      const element = effect.ifs.some((c) => rawConditions[c].ser === 'ele_match_stat') ? { element: stat.ele } : {};
      (rules[id] ??= []).push({ on, order, ...element, ifs: ifs as Cond[], acts: acts as Act[] });
    }
  }
  return { rules, situational, healing };
}
// The calculator's target has no stats of its own but the ones a skill puts on it.
const { rules, situational } = statRules('Source');
const taken = statRules('Target').rules;
// The one a resource is restored to is both sides of the restore, so its stats act on it from either.
for (const [id, list] of Object.entries(taken)) {
  const own = list.filter((rule) => rule.on === 'restore');
  if (own.length) rules[id] = [...(rules[id] ?? []), ...own];
}

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
  targets: { type: string; map: Raw }[];
  en_preds: { type: string; map: Raw }[];
}
interface RawSpell {
  default_lvl: number;
  max_lvl: number;
  lvl_based_on_spell: string;
  statsForSkillGem: Parameters<typeof statMod>[0][];
  attached: { on_cast: RawPart[]; entity_components: Record<string, RawPart[]> };
  config: {
    style: string;
    proc_cooldown_ticks: number;
    use_support_gems_from: string;
    cast_time_ticks: number;
    cast_speed_ticks: number;
    cooldown_ticks: number;
    charges: number;
    charge_regen: number;
    times_to_cast: number;
    tracking_radius: number;
    channel_skill: boolean;
    mana_cost: Leveled;
    ene_cost: Leveled;
    tags: { tags: string[] };
    summonType: string;
    summon_basic_atk: string;
    summon_spells: string[];
    summon_spell_chance: number;
  };
}
const rawSpells = spellData as unknown as Record<string, RawSpell>;
interface RawEffect {
  one_of_a_kind_id: string;
  max_stacks: number;
  stacks_affect_stats: boolean;
  stats: Parameters<typeof statMod>[0][];
  tags: { tags: string[] };
  spell?: { entity_components: Record<string, RawPart[]> };
}
const casterEffects = effectsData as unknown as Record<string, RawEffect>;
const effectName = (id: string) => text(`mmorpg.effect.${id}`, id);

const EFFECT_IF = 'caster_has_mns_effect';
// CasterHasMnsEffectCondition, for a caster with `stacks` of each effect.
const holds = (i: { map: Raw }, stacks: Record<string, number>) => (stacks[i.map.exile_potion_id] ?? 0) >= (i.map.effect_stacks ?? 1) !== !!i.map.is_false;
// An aura is a skill that leaves an effect tagged as one on its caster for good
// (ExileEffectAction.INFINITE_DURATION). While it is on, the effect's script runs on the caster:
// every so many ticks it damages enemies in reach or the caster, and renews an effect on allies,
// the caster among them, or on enemies.
const AURA = { tag: 'aura', forever: -1 };
// The Crusader's stacks. A skill spends one for something extra whenever its caster holds any, so
// it isn't among the effects a skill is picked to be used with.
const RETRIBUTION = 'retribution';
// How often a pet attacks, by vanilla's MeleeAttackGoal and by RangedBowAttackGoal as SummonEntity
// sets it up: 20 ticks to draw and 10 between shots.
const PET_ATTACK_TICKS = { melee: 20, ranged: 30 };
// What makes the entities a spell's script goes on in; pets fight on their own and aren't counted.
const SUMMONS = ['projectile', 'summon_at_sight', 'summon_block'];
// SummonProjectileAction: the degrees a volley fans out over where the spell doesn't say.
const PROJECTILES_APART = 75;

// OnTickCondition: how many times a step that runs every `tick_rate` ticks does in an entity's life.
const ticks = (life: number, { tick_rate: rate, first_tick: first = 0 }: Raw) =>
  first > life ? 0 : rate <= 0 ? 1 : first > 0 ? Math.floor((life - first) / rate) + 1 : Math.floor(life / rate);

// ExileEffect.onTick and onRemove, and DamageEvent.activate: an effect's own script runs on the one
// holding it, every so many ticks of its age, as the effect ends, and when a basic attack hits
// it, with the one who gave the effect for its caster. What it then deals an enemy and that
// caster, who has `stacks` of each effect it asks about: `self` is the caster, `target` the one
// holding the effect, and an area is around the holder, of the caster's enemies.
function script(effect: string, enemy: boolean, stacks: Record<string, number> = {}) {
  const hits: SkillHit[] = [];
  const self: SkillHit[] = [];
  for (const [entity, parts] of Object.entries(casterEffects[effect]?.spell?.entity_components ?? {})) {
    for (const part of parts) {
      const rate = part.ifs.find((i) => i.type === 'x_ticks_condition')?.map.tick_rate;
      const when = entity === 'on_entity_attacked' ? 'struck' : rate ? 'aura' : part.ifs.some((i) => i.type === 'on_entity_expire') ? 'end' : null;
      const aimed = (type: string) => part.targets.some((t) => t.type === type && (type !== 'aoe' || t.map.en_predicate === 'enemies'));
      const to = aimed('self') || (!enemy && aimed('target')) ? self : aimed('aoe') || aimed('target') ? hits : null;
      if (!when || !to || !part.ifs.every((i) => i.type !== EFFECT_IF || holds(i, stacks))) continue;
      for (const act of part.acts) {
        // DamageEvent.stopFriendlyFire: its caster takes only what is let through to it.
        if (act.type === 'damage' && (to === hits || act.map.allow_self_damage)) to.push({ calc: act.map.value_calculation, element: act.map.element, count: rate ? 20 / rate : 1, when });
      }
    }
  }
  return { hits, self };
}

// The hits of one use of a spell on a single target, with its caster holding `stacks` of each
// effect its script asks about. How many of the projectiles shot together hit goes by the
// caster's stats, so each hit names the volleys it comes from. Of what goes on over time every
// tick is taken to land. What a Retribution stack buys counts in full: every projectile it adds
// hits, and the stats it puts on the target are there by the next use. Damage that the stacks
// of an effect multiply says so, and is there with any stack of it.
// An effect it leaves whose own script deals an enemy damage is told apart: how much of that
// comes with a use depends on how often the spell is used. An aura isn't left by a use.
function hitsOf(spell: RawSpell, stacks: Record<string, number>) {
  const hits: SkillHit[] = [];
  const marks: StatMod[] = [];
  const gives: Gift[] = [];
  // SimpleProjectileEntity.tryMoveTowardsTargets: a homing one turns to an enemy within the spell's tracking radius.
  const volley = (map: Raw, bought: boolean): Volley => ({
    n: map.proj_count,
    ...(map.ignore_bonus_proj && { fixed: true }),
    ...(bought ? { all: true } : { apart: map.proj_apart ?? PROJECTILES_APART, ...(map.nova && { nova: true }), ...(map.tracks_enemies && { reach: spell.config.tracking_radius }) }),
  });
  const walk = (parts: RawPart[], count: number, life: number, seen: string[], volleys: Volley[]) => {
    for (const part of parts) {
      const asks = part.ifs.filter((i) => i.type === EFFECT_IF);
      if (!asks.every((i) => holds(i, stacks))) continue;
      const bought = asks.some((i) => i.map.exile_potion_id === RETRIBUTION && !i.map.is_false);
      const has = (type: string) => part.ifs.find((i) => i.type === type);
      const tick = has('x_ticks_condition');
      const when: SkillHit['when'] = tick ? 'tick' : has('on_entity_expire') ? 'end' : has('on_hit') ? 'hit' : 'cast';
      // SetOnCooldownAction: a step that puts what it hits on a cooldown and passes over what is
      // on it hits a target once in as many of its turns as the cooldown lasts.
      const held = part.en_preds.find((p) => p.type === 'is_not_on_cd');
      const wait = part.acts.find((act) => act.type === 'set_on_cd' && act.map.cooldown_id === held?.map.cooldown_id)?.map.cooldown_ticks;
      const turns = tick ? Math.ceil(ticks(life, tick.map) / (wait ? Math.ceil(wait / tick.map.tick_rate) : 1)) : 1;
      // HasMnsEffectCondition: a step that asks its target for stacks of an effect, where another
      // step of the spell gives one a use to a target short of them and this one takes them off,
      // comes once in that many uses and one more, and the other step in the rest of them.
      const asked = part.en_preds.find((p) => p.type === 'has_mns_effect' && p.map.effect_stacks > 1);
      const share = asked ? (asked.map.is_false ? asked.map.effect_stacks : 1) / (asked.map.effect_stacks + 1) : 1;
      // A spell cast several times in a row runs its script each time; some steps only on the first or last.
      const times = (life ? turns : has('is_first_cast') || has('is_last_cast') ? 1 : spell.config.times_to_cast) * count * share;
      const onEnemy = part.targets.some((t) => t.type !== 'self');
      const foe = !part.targets.some((t) => t.type === 'self' || t.map.en_predicate === 'allies');
      // The cooldown is on the target, so all the projectiles together hit it no more often.
      const shot = volleys.length && !wait ? { volleys } : {};
      for (const act of part.acts) {
        const per: string | undefined = act.map.multiply_by_caster_effect_stacks;
        if (act.type === 'damage' && onEnemy && (!per || stacks[per])) {
          hits.push({ calc: act.map.value_calculation, element: act.map.element, count: times, when, ...(per && { per }), ...shot });
        }
        if (bought && act.type === 'exile_effect' && act.map.potion_action === 'GIVE_STACKS' && onEnemy) {
          marks.push(...casterEffects[act.map.exile_potion_id].stats.filter((s) => s.stat in taken).map(statMod));
        }
        if (act.type === 'exile_effect' && act.map.potion_action === 'GIVE_STACKS' && part.targets.length && act.map.potion_dur !== AURA.forever) {
          const id: string = act.map.exile_potion_id;
          const dealt = script(id, foe, stacks).hits;
          if (dealt.length) gives.push({ effect: id, name: effectName(id), enemy: foe, ticks: act.map.potion_dur, longer: strength(casterEffects[id].tags.tags, 'Source', 'increase_number'), stacks: act.map.count * times, hits: dealt, ...shot });
        }
        const entity: string | undefined = act.map.entity_name;
        if (!entity || !SUMMONS.includes(act.type) || seen.includes(entity)) continue;
        walk(spell.attached.entity_components[entity] ?? [], times, Math.max(1, act.map.life_ticks ?? 1), [...seen, entity], act.type === 'projectile' ? [...volleys, volley(act.map, bought)] : volleys);
      }
    }
  };
  walk(spell.attached.on_cast, 1, 0, [], []);
  return { hits: hits.filter((hit) => hit.count > 0), marks, gives };
}

function skill(spell: RawSpell): SkillDamage | null {
  // Each effect the script asks about, and the numbers of stacks it tells apart.
  const asked = new Map<string, Set<number>>();
  const ask = (effect: string, stacks: number) => (asked.get(effect) ?? asked.set(effect, new Set([0])).get(effect)!).add(stacks);
  const parts = [...spell.attached.on_cast, ...Object.values(spell.attached.entity_components).flat()];
  // The scripts of the effects it leaves ask about its caster too.
  const left = parts.flatMap((part) => part.acts).flatMap((act) => (act.type === 'exile_effect' ? Object.values(casterEffects[act.map.exile_potion_id]?.spell?.entity_components ?? {}).flat() : []));
  for (const i of [...parts, ...left].flatMap((part) => part.ifs)) if (i.type === EFFECT_IF) ask(i.map.exile_potion_id, i.map.effect_stacks ?? 1);
  for (const effect of parts.flatMap((part) => part.acts.flatMap((act) => act.map.multiply_by_caster_effect_stacks ?? []))) ask(effect, 1);
  let states: Record<string, number>[] = [{}];
  for (const [effect, levels] of asked) states = states.flatMap((state) => [...levels].map((stacks) => ({ ...state, [effect]: stacks })));
  // Effects of one kind, like stances, push each other out.
  states = states.filter((state) => {
    const kinds = Object.keys(state).flatMap((effect) => (state[effect] && casterEffects[effect]?.one_of_a_kind_id) || []);
    return new Set(kinds).size === kinds.length;
  });

  const dealt = new Map(states.map((state) => [JSON.stringify(state), hitsOf(spell, state)]));
  const keyOf = (state: Record<string, number>) => JSON.stringify(dealt.get(JSON.stringify(state)));
  // An effect that changes nothing about the hits isn't one the skill asks about.
  const idle = [...asked.keys()].filter((effect) => states.every((state) => keyOf(state) === keyOf({ ...state, [effect]: 0 })));
  for (const effect of idle) asked.delete(effect);

  // States that come to the same hits are one form, named by the fewest effects that give it.
  const variants = new Map<string, SkillDamage['variants'][number]>();
  for (const state of states.sort((a, b) => Object.values(a).filter(Boolean).length - Object.values(b).filter(Boolean).length)) {
    const { hits, marks, gives } = dealt.get(JSON.stringify(state))!;
    if (!(hits.length || gives.length) || idle.some((effect) => state[effect])) continue;
    const when = Object.fromEntries(Object.entries(state).filter(([, stacks]) => stacks));
    const needs = Object.entries(when).flatMap(([effect, stacks]) => (effect !== RETRIBUTION ? [stacks > 1 ? `${stacks} ${effectName(effect)}` : effectName(effect)] : []));
    const form = variants.get(keyOf(state));
    if (form) form.when.push(when);
    else variants.set(keyOf(state), { needs, when: [when], hits, ...(state[RETRIBUTION] ? { retribution: true as const } : {}), ...(marks.length ? { marks } : {}), ...(gives.length ? { gives } : {}) });
  }
  const { config } = spell;
  // SummonPetAction and PetAttackUTIL: a pet's attack runs the script of the skill's basic attack.
  const summon = spell.attached.on_cast.flatMap((part) => part.acts).find((act) => act.type === 'summon_pet');
  const basic = summon && rawSpells[config.summon_basic_atk];
  if (basic) {
    const hits = basic.attached.entity_components.default_entity_name
      .flatMap((part) => part.acts)
      .filter((act) => act.type === 'damage')
      .map((act): SkillHit => ({ calc: act.map.value_calculation, element: act.map.element, count: 1, when: 'attack' }));
    variants.set('', { needs: [], when: [{}], hits });
  }
  if (!variants.size) return null;
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
    asks: Object.fromEntries([...asked].map(([effect, levels]) => [effect, [...levels]])),
    variants: [...variants.values()],
    ...(basic && {
      pets: {
        kind: config.summonType.toLowerCase(),
        capped: summon.map.counts_towards_max_summons,
        count: summon.map.count,
        lifeTicks: summon.map.life_ticks,
        attackTicks: PET_ATTACK_TICKS[basic.config.tags.tags.includes('ranged') ? 'ranged' : 'melee'],
        style: basic.config.style,
        tags: basic.config.tags.tags,
        spells: config.summon_spells,
        chance: config.summon_spell_chance,
        cost: { mana: basic.config.mana_cost, energy: basic.config.ene_cost },
      },
    }),
  };
}

const classSpells = Object.values(schoolData)
  .flatMap((school) => Object.keys(school.perks))
  .filter((id) => id in rawSpells);
const skills: Record<string, SkillDamage> = Object.fromEntries(
  classSpells.flatMap((id) => {
    const damage = skill(rawSpells[id]);
    return damage ? [[id, damage] as const] : [];
  }),
);

// Spell.getLevelOf: the spell whose level a spell goes by.
const levelOf = (id: string): string => {
  const other = rawSpells[id].lvl_based_on_spell;
  return other && rawSpells[other].lvl_based_on_spell !== other ? levelOf(other) : id;
};
// What a spell that a stat sets off does, as ProcSpellEffect casts it: once, however many times
// a use of it casts it. One that deals the enemy nothing, or does so through a pet, has no say
// in damage.
const castOnce = (id: string) => {
  const damage = skill({ ...rawSpells[id], config: { ...rawSpells[id].config, times_to_cast: 1 } });
  return damage?.pets ? null : damage;
};
const setOff = [rules, taken].flatMap((side) => Object.values(side).flatMap((list) => list.flatMap((rule) => rule.acts.flatMap((act) => (act.k === 'proc' ? [act.spell] : [])))));
const procs: Record<string, ProcSpell> = Object.fromEntries(
  [...new Set(setOff)].flatMap((id) => {
    const spell = rawSpells[id];
    const damage = castOnce(id);
    if (!damage) return [];
    const taught = classSpells.includes(id);
    const proc: ProcSpell = {
      name: text(`mmorpg.spell.${id}`, id),
      cooldownTicks: spell.config.proc_cooldown_ticks,
      ...(!(taught && spell.config.times_to_cast === 1) && { skill: damage }),
      ...(!taught && {
        own: { levelOf: levelOf(id), minRank: rawSpells[levelOf(id)].default_lvl, maxLevel: spell.max_lvl, supportsOf: spell.config.use_support_gems_from || id, stats: spell.statsForSkillGem.map(statMod) },
      }),
    };
    return [[id, proc] as const];
  }),
);
for (const side of [rules, taken]) {
  for (const [id, list] of Object.entries(side)) {
    side[id] = list.filter((rule) => rule.acts.every((act) => act.k !== 'proc' || act.spell in procs));
    if (!side[id].length) delete side[id];
  }
}
// Spells set off by a kill or a death, or by a hit the one with the stat takes: the one enemy
// here never dies, and what its hits do isn't worked out.
for (const [id, raw] of Object.entries(rawStats)) {
  const left = (raw.data ?? raw).effect?.some((effect) =>
    effect.effects.some((e) => rawEffects[e].ser === 'proc_spell' && !(effect.events.includes('on_damage') && rawEffects[e].source === 'Source') && castOnce(rawEffects[e].spellId)),
  );
  if (left) situational.add(id);
}

// ExilePotionEvent: the stats that make an effect with one of these tags stronger, of the one
// giving it or of the one it is on. Or, with `increase_number` for what they do, last longer.
function strength(tags: string[], side: 'Source' | 'Target', ser = 'modify_stat_layer') {
  return Object.entries(rawStats).flatMap(([id, raw]) => {
    const boosts = (raw.data ?? raw).effect?.some(
      (e) =>
        e.events.includes('on_exile_effect') &&
        e.side === side &&
        e.effects.some((effect) => rawEffects[effect].ser === ser) &&
        e.ifs.every((c) => rawConditions[c].ser === 'effect_has_tag' && tags.includes(rawConditions[c].tag)),
    );
    return boosts ? [id] : [];
  });
}

function aura(spell: RawSpell) {
  const acts = Object.values(spell.attached.entity_components).flatMap((parts) => parts.flatMap((part) => part.acts));
  const kept = acts.find((act) => act.type === 'exile_effect' && act.map.potion_dur === AURA.forever && casterEffects[act.map.exile_potion_id]?.tags.tags.includes(AURA.tag));
  if (!kept) return null;
  const effect: string = kept.map.exile_potion_id;
  const own = casterEffects[effect];
  // What it puts on its caster or on an enemy, and the stats that make that stronger.
  const effects = [{ enemy: false, stats: own.stats.map(statMod), given: [] as string[], onYou: [] as string[] }];
  const damage: AuraDamage = { style: spell.config.style, tags: spell.config.tags.tags, ...script(effect, false) };
  for (const part of own.spell?.entity_components.default_entity_name ?? []) {
    const rate = part.ifs.find((i) => i.type === 'x_ticks_condition')?.map.tick_rate;
    const reach = (who: string) => part.targets.some((t) => t.map.en_predicate === who);
    const self = part.targets.some((t) => t.type === 'self');
    if (!rate || !(self || reach('allies') || reach('enemies'))) continue;
    for (const act of part.acts) {
      if (act.type !== 'exile_effect' || act.map.potion_action !== 'GIVE_STACKS') continue;
      const given = casterEffects[act.map.exile_potion_id];
      effects.push({ enemy: reach('enemies'), stats: given.stats.map(statMod), given: strength(given.tags.tags, 'Source'), onYou: strength(given.tags.tags, 'Target') });
    }
  }
  return { effect, effects, damage };
}

const found = classSpells.flatMap((id) => {
  const about = aura(rawSpells[id]);
  return about ? [{ id, ...about }] : [];
});
// The effects of each aura, for working out a character's stats.
export const auraSkills = found.map(({ id, effect, effects }) => ({ id, effect, effects }));

// What class skills give with the `exile_effect` action, and to whom: their caster and its
// allies, or enemies. What a Retribution stack buys for the target is on it whenever a stack is
// held (hitsOf), so it isn't among them.
const gifts = classSpells.flatMap((id) =>
  [...rawSpells[id].attached.on_cast, ...Object.values(rawSpells[id].attached.entity_components).flat()].flatMap((part) => {
    const enemy = !part.targets.some((t) => t.type === 'self' || t.map.en_predicate === 'allies');
    const bought = enemy && part.ifs.some((i) => i.type === EFFECT_IF && i.map.exile_potion_id === RETRIBUTION && !i.map.is_false);
    return part.acts
      .filter((act) => act.type === 'exile_effect' && act.map.potion_action === 'GIVE_STACKS' && part.targets.length)
      .filter((act) => !(bought && casterEffects[act.map.exile_potion_id]?.stats.some((s) => s.stat in taken)))
      .map((act) => ({ skill: id, effect: act.map.exile_potion_id as string, enemy }));
  }),
);
// GiveExileStatusEffect and GiveExileStatusInRadius: what a stat gives, and to whom. The one with
// the stat gives it to its own side of the event, to the other, or to those around itself. The
// other side is an enemy in a hit or a kill; in the rest the one with the stat is on both.
const FOUGHT = ['on_damage', 'on_mob_kill'];
const lent = Object.entries(rawStats).flatMap(([stat, raw]) =>
  ((raw.data ?? raw).effect ?? []).flatMap((effect) =>
    effect.effects.flatMap((e) => {
      const act = rawEffects[e];
      if (act.ser !== 'give_exile_effect' && act.ser !== 'give_exile_effect_in_radius') return [];
      const other = act.ser === 'give_exile_effect' ? act.give_to !== effect.side : act.ally_or_enemy === 'enemies';
      return [{ stat, effect: act.effect as string, enemy: other && effect.events.some((event) => FOUGHT.includes(event)) }];
    }),
  ),
);
// The effects a stat asks about before it changes a hit.
const unders = (ifs: Cond[]): string[] => ifs.flatMap((cond) => (cond.k === 'under' ? [cond.effect] : cond.k === 'any' ? unders(cond.ifs) : []));
const watched = [rules, taken].flatMap((side) => Object.values(side).flatMap((list) => list.flatMap((rule) => unders(rule.ifs))));

// What an effect's script deals while the effect is kept up: nothing as it ends, which it never does.
const kept = (effect: string, enemy: boolean) => script(effect, enemy).hits.filter((hit) => hit.when !== 'end');

// The effects a build can take to be on: those a class skill gives or asks its caster about, or
// a stat gives, that change a stat, a hit or the form of a skill, or that a skill gives and
// deal damage themselves while they are on. One that skills put on enemies
// is on the enemy, even where a skill puts it on its own caster too. One that a stat puts on the
// other side from there is listed again for that side, under an id that says so. Auras and
// Retribution are set apart from them.
export const skillEffects = [...new Set([...gifts.map((gift) => gift.effect), ...Object.values(skills).flatMap((s) => Object.keys(s.asks)), ...lent.map((gift) => gift.effect)])]
  .filter((id) => id in casterEffects && id !== RETRIBUTION && !casterEffects[id].tags.tags.includes(AURA.tag))
  .flatMap((id) => {
    const effect = casterEffects[id];
    const asked = Object.keys(skills).filter((skill) => id in skills[skill].asks);
    const skilled = asked.length || gifts.some((gift) => gift.effect === id) ? [gifts.some((gift) => gift.effect === id && gift.enemy)] : [];
    return [...new Set([...skilled, ...lent.filter((gift) => gift.effect === id).map((gift) => gift.enemy)])].map((enemy, i) => ({
      id: i ? `${id}:${enemy ? 'enemy' : 'you'}` : id,
      effect: id,
      name: effectName(id),
      enemy,
      max: effect.max_stacks,
      // ExileEffect.getExactStats: its stats count once however many stacks there are.
      ...(effect.stacks_affect_stats === false && { once: true as const }),
      kind: effect.one_of_a_kind_id,
      stats: effect.stats.map(statMod),
      given: strength(effect.tags.tags, 'Source'),
      onYou: strength(effect.tags.tags, 'Target'),
      // The skills that give it, whose level makes it as strong as it is, and those that ask about it.
      from: [...new Set(gifts.filter((gift) => gift.effect === id && gift.enemy === enemy).map((gift) => gift.skill))],
      asked: i ? [] : asked,
      // The stats that give it to this side.
      by: [...new Set(lent.filter((gift) => gift.effect === id && gift.enemy === enemy).map((gift) => gift.stat))],
    }));
  })
  .filter((effect) => effect.stats.length || effect.asked.length || watched.includes(effect.effect) || (effect.from.length && kept(effect.effect, effect.enemy).length))
  .sort((a, b) => a.name.localeCompare(b.name));
// What each of those deals by its own script, as a spell of each skill that gives it.
const lasting: DamageRules['lasting'] = Object.fromEntries(
  skillEffects.flatMap((effect) => {
    const hits = kept(effect.effect, effect.enemy);
    return hits.length ? [[effect.id, Object.fromEntries(effect.from.map((id) => [id, { style: rawSpells[id].config.style, tags: rawSpells[id].config.tags.tags, hits, self: [] }]))]] : [];
  }),
);
// A pet can only cast what the calculator can work out.
for (const { pets } of Object.values(skills)) if (pets) pets.spells = pets.spells.filter((id) => id in skills);
const marked = [
  ...Object.values(skills).flatMap((s) => s.variants.flatMap((v) => v.marks?.map((mark) => mark.id) ?? [])),
  ...[...found.flatMap((a) => a.effects), ...skillEffects]
    .filter((e) => e.enemy)
    .flatMap((e) => e.stats.flatMap((s) => [s.id, ...(transfers[s.id] ?? [])]))
    .filter((id) => id in taken),
];
const usedCalcs = [
  ...new Set([
    ...[...Object.values(skills), ...Object.values(procs).flatMap((proc) => proc.skill ?? [])].flatMap((s) => s.variants.flatMap((v) => [...v.hits, ...(v.gives ?? []).flatMap((gift) => gift.hits)].map((hit) => hit.calc))),
    ...[...found.map((a) => a.damage), ...Object.values(lasting).flatMap((by) => Object.values(by))].flatMap((dealt) => [...dealt.hits, ...dealt.self].map((hit) => hit.calc)),
  ]),
];

// What the pack's own weapons (RoE Weapons 0.1.7) add to the 4 swings a second every player
// starts with, read from the lowest tier of each; higher tiers swing up to 0.3 faster. Bows and
// crossbows shoot as fast as they are drawn.
const SWING: Record<string, number> = { axe: -3, dagger: -2, gauntlet: -1.8, greatsword: -3.2, hammer: -3.1, scythe: -2.9, spear: -2.9, staff: -2.9, sword: -2.4, trident: -2.9 };
const DRAW: Record<string, number> = { bow: 1, crossbow: 0.8 };
const slots = slotData as Record<string, { weapon_data: { damage_multiplier: number; energy_cost_per_swing: number; energy_cost_per_mob_attacked: number } }>;
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
        energy: { swing: slots[base.gear_slot].weapon_data.energy_cost_per_swing, hit: slots[base.gear_slot].weapon_data.energy_cost_per_mob_attacked },
      },
    ]),
);

export const damage: DamageRules = {
  rules,
  taken: Object.fromEntries([...new Set(marked)].map((id) => [id, taken[id]])),
  layers,
  calcs: Object.fromEntries(usedCalcs.map((id) => [id, calc(id)])),
  skills,
  procs,
  auras: Object.fromEntries(found.map((a) => [a.id, a.damage])),
  lasting,
  weapons,
  situational: [...situational].sort(),
  scaling: { base: balance.NORMAL_STAT_SCALING.base_scaling, perLevel: balance.NORMAL_STAT_SCALING.per_level_scaling },
  globalCooldownTicks: balance.GLOBAL_COOLDOWN_TICKS,
  minCooldown: balance.MIN_SPELL_COOLDOWN_MULTI,
  channelSpeed: balance.CHANNEL_GENERAL_SPEED_TRANSFER,
  takenAs: layerData.damage_taken_as.priority,
};
