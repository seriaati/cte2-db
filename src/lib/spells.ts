// Build-time only, like gear.ts. Components take the types from spellRules.ts.
import balanceData from '../data/game_balance.json';
import schoolData from '../data/spell_school.json';
import spellData from '../data/spells.json';
import calcData from '../data/value_calc.json';
import { statMod, text } from './gear';
import type { Calc, Leveled, Spell } from './spellRules';

interface RawPart {
  acts: { type: string }[];
  targets: { map: { radius?: number } }[];
}
interface RawSpell {
  identifier: string;
  max_lvl: number;
  show_other_spell_tooltip: string;
  statsForSkillGem: Parameters<typeof statMod>[0][];
  attached: { on_cast: RawPart[]; entity_components: Record<string, RawPart[]> };
  config: {
    mana_cost: Leveled;
    ene_cost: Leveled;
    castingWeapon: string;
    channel_skill: boolean;
    times_to_cast: number;
    charges: number;
    charge_regen: number;
    cooldown_ticks: number;
    cast_speed_ticks: number;
    cast_time_ticks: number;
    tags: { tags: string[] };
  };
}
interface RawCalc {
  base: Leveled;
  base_scaling_type: string;
  cap_to_wep_dmg: number;
  stat_scalings: { stat: string; multi: Leveled }[];
  target_stat_scalings: { stat: string; multi: Leveled }[];
}
const rawSpells = spellData as unknown as Record<string, RawSpell>;
const rawCalcs = calcData as Record<string, RawCalc>;
const balance = balanceData.original_balance;

export const bonusLevels = balance.MAX_BONUS_SPELL_LEVELS;
export const costScaling = { base: balance.MANA_COST_SCALING.base_scaling, perLevel: balance.MANA_COST_SCALING.per_level_scaling };

const WEAPONS: Record<string, string> = { MAGE_WEAPON: 'Mage', MELEE_WEAPON: 'Melee', NON_MAGE_WEAPON: 'Not mage', RANGED: 'Ranged', ANY_WEAPON: 'Any' };

const seconds = (ticks: number) => `${+(ticks / 20).toFixed(2)}s`;

function calc(id: string): Calc {
  const c = rawCalcs[id];
  const part = (target: boolean) => (s: RawCalc['stat_scalings'][number]) => ({ stat: text(`mmorpg.stat.${s.stat}`, s.stat), multi: s.multi, target });
  const parts = [...c.stat_scalings.map(part(false)), ...c.target_stat_scalings.map(part(true))];
  const scaling = (balance as Record<string, any>)[`${c.base_scaling_type}_STAT_SCALING`];
  return {
    parts,
    // ValueCalculation.capsToWeaponDamage: the data uses 1000 to mean no cap.
    cap: c.cap_to_wep_dmg < 50 && c.stat_scalings[0]?.stat === 'weapon_damage' && parts.length > 1 ? c.cap_to_wep_dmg : null,
    base: c.base,
    scaling: scaling ? { base: scaling.base_scaling, perLevel: scaling.per_level_scaling } : null,
  };
}

// The lines of Spell.GetTooltipString that stay the same at every level.
function facts({ config, attached }: RawSpell): Spell['facts'] {
  const recovery = Math.max(balance.GLOBAL_COOLDOWN_TICKS, config.cast_speed_ticks);
  const cast = Math.max(config.cast_time_ticks, config.channel_skill ? 1 : config.times_to_cast);
  const radii = [...attached.on_cast, ...Object.values(attached.entity_components).flat()]
    .filter((part) => part.acts.some((a) => a.type === 'damage'))
    .flatMap((part) => part.targets.flatMap((t) => t.map.radius ?? []));
  const lines: Spell['facts'] = [];
  if (config.charges > 0) lines.push(['Charges', `${config.charges}`], ['Charge regen', seconds(config.charge_regen)]);
  else if (config.cooldown_ticks > recovery) lines.push(['Cooldown', seconds(config.cooldown_ticks)]);
  lines.push(['Recovery', config.cast_speed_ticks > 0 ? seconds(recovery) : 'None']);
  if (config.channel_skill) lines.push(['Channel', `every ${seconds(cast)}`]);
  else lines.push(['Cast', (cast > 1 ? seconds(cast) : 'Instant') + (config.times_to_cast > 1 ? `, ${config.times_to_cast} times` : '')]);
  if (radii.length) lines.push(['Radius', [...new Set(radii)].map((r) => +r.toFixed(2)).join(', ')]);
  lines.push(['Weapon', WEAPONS[config.castingWeapon]]);
  return lines;
}

const desc = (id: string) => text(`spell.desc.${id}`, '');
const className = (id: string) => text(`mmorpg.asc_class.${id}`, id);

// scripts/extract.ts writes an icon for every class.
export const classIcons: Record<string, string> = Object.fromEntries(Object.keys(schoolData).map((id) => [className(id), `/classes/${id}.webp`]));

// A class lists its spells and its passives together; only the spells are in the spell registry. The registry
// also holds what mobs, mercenaries and gear cast, which no class teaches.
export const spells: Spell[] = Object.values(schoolData)
  .flatMap((school) =>
    Object.entries(school.perks as Record<string, { y: number }>)
      .filter(([id]) => id in rawSpells)
      .map(([id, { y }]) => {
        const s = rawSpells[id];
        const linked = s.show_other_spell_tooltip;
        const linkedDesc = linked ? desc(linked) : '';
        return {
          id,
          name: text(`mmorpg.spell.${id}`, id),
          icon: `/spells/${id}.webp`,
          school: className(school.id),
          // SpellSchool.getLevelNeededToAllocate: the row decides, not the spell's own min_lvl.
          level: school.lvl_reqs[y],
          maxLevel: s.max_lvl,
          desc: desc(id),
          linked: linked ? { name: text(`mmorpg.spell.${linked}`, linked), desc: linkedDesc } : null,
          calcs: Object.fromEntries([...(desc(id) + linkedDesc).matchAll(/\[calc:(\w+)\]/g)].map((m) => [m[1], calc(m[1])])),
          mana: s.config.mana_cost,
          energy: s.config.ene_cost,
          channel: s.config.channel_skill,
          facts: facts(s),
          tags: s.config.tags.tags.map((tag) => text(`mmorpg.tag.spell.${tag}`, tag)),
          stats: s.statsForSkillGem.map(statMod),
        };
      }),
  )
  .sort((a, b) => a.school.localeCompare(b.school) || a.level - b.level || a.name.localeCompare(b.name));
