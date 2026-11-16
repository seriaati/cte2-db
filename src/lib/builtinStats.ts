// Some stats are defined in Mine and Slash's Java code instead of data files, so the extractor
// can't see whether they are percentages or how they scale with level. These were read from the
// 6.4.13 bytecode and need rechecking when the mod updates. Built-in stats not matched here are
// unscaled percentages.
const FLAT_SCALED = new Set([
  'armor',
  'armor_penetration',
  'blood',
  'damage_shield',
  'dodge',
  'energy',
  'energy_regen',
  'gear_defense',
  'gear_weapon_damage',
  'health',
  'health_regen',
  'magic_shield',
  'magic_shield_regen',
  'mana',
  'mana_regen',
  'spell_dodge',
  'weapon_damage',
]);
const FLAT_UNSCALED = new Set([
  'harvest_completion_bounty',
  'imprisoned_monster_double_spawn',
  'jewel_socket',
  'prophecy_double_curse',
  'shrine_double_buff',
  'spirit_cost',
]);

// Long stats print as their sentence alone, with no number in front.
const LONG = new Set(['blood_user', 'chaos_doesnt_bypass_magic_shield']);

export function builtinStat(id: string): { percent: boolean; scaling: string; long: boolean } {
  return { ...flags(id), long: LONG.has(id) };
}

function flags(id: string): { percent: boolean; scaling: string } {
  if (id === 'all_attributes') return { percent: false, scaling: 'CORE' };
  if (FLAT_SCALED.has(id) || /^flat_.+_added_(attack_|magic_)?damage$/.test(id)) return { percent: false, scaling: 'NORMAL' };
  if (FLAT_UNSCALED.has(id) || /^(plus_lvl_|learn_)|^max_.+_charges$/.test(id)) return { percent: false, scaling: 'NONE' };
  return { percent: true, scaling: 'NONE' };
}

// A stat's starting value and the limits it is kept inside. Stats not matched here start at 0 and
// run from -1000 up.
const AILMENT = '(burn|bleed|poison|freeze|electrify)';
const LIMITS: [RegExp, { base?: number; min?: number; max?: number }][] = [
  [/^spirit_cost$/, { base: 100, min: 0, max: 250 }],
  [/^jewel_socket$/, { max: 9 }],
  [/^health$/, { min: 1 }],
  [
    /^(armor|armor_penetration|battlemage_user|blood|blood_user|chaos_doesnt_bypass_magic_shield|dodge|ele_to_chaos|energy|energy_regen|gear_defense|gear_weapon_damage|health_regen|hp_resto_to_blood|magic_shield|magic_shield_heal|magic_shield_regen|mana|mana_regen|mana_shield|spell_dodge|weapon_damage)$/,
    { min: 0 },
  ],
  [/^(phys_to|phys_taken_as)_\w+$|_penetration$/, { min: 0 }],
  [/_per_sec$/, { min: 0, max: 25 }],
  [/^(extra_mob_drops|dual_wield_effectiveness)$/, { min: -100 }],
  [/^max_\w+_resist$/, { min: -100, max: 15 }],
  [/_resist$/, { min: -300, max: 500 }],
  [/^magic_find$/, { max: 150 }],
  [/^full_swing_damage$/, { min: 10 }],
  [new RegExp(`^${AILMENT}_resistance$`), { max: 100 }],
  [new RegExp(`^${AILMENT}_(proc_|receive_)?chance$`), { min: 0, max: 100 }],
  [/^max_block_chance$/, { min: 0, max: 15 }],
  [/^block_recovery$/, { min: 0, max: 200 }],
  [/^block_damage_reduction$/, { base: 100, min: 0, max: 100 }],
  [/^block_chance$/, { min: 0, max: 90 }],
];
// Stats that work through BaseDamageIncreaseEffect keep their "more" multipliers beside the value.
const MORE_APART = new RegExp(`^(summon_health|spell_damage|hit_damage|ailment_damage|${AILMENT}_damage)$`);

export function builtinLimits(id: string): { base: number; min: number; max: number; apart: boolean } {
  return { base: 0, min: -1000, max: 100000000, ...LIMITS.find(([ids]) => ids.test(id))?.[1], apart: MORE_APART.test(id) };
}

// ITransferToOtherStats: before anything is worked out, these stats hand all they hold to others.
// The "elemental" kind of each ElementalStat goes to fire, water and lightning.
const ELEMENTAL = [
  'flat_elemental_added_damage',
  'flat_elemental_added_attack_damage',
  'flat_elemental_added_magic_damage',
  'plus_phys_to_elemental',
  'elemental_weapon_damage',
  'elemental_penetration',
  'elemental_resist',
  'max_elemental_resist',
  'phys_taken_as_elemental',
  'phys_to_elemental',
];
export const transfers: Record<string, string[]> = {
  all_attributes: ['intelligence', 'strength', 'dexterity'],
  ...Object.fromEntries(ELEMENTAL.map((id) => [id, ['fire', 'water', 'lightning'].map((element) => id.replace('elemental', element))])),
};
