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
const FLAT_UNSCALED = new Set(['jewel_socket', 'spirit_cost']);

// Long stats print as their sentence alone, with no number in front.
const LONG = new Set(['chaos_doesnt_bypass_magic_shield']);

export function builtinStat(id: string): { percent: boolean; scaling: string; long: boolean } {
  return { ...flags(id), long: LONG.has(id) };
}

function flags(id: string): { percent: boolean; scaling: string } {
  if (id === 'all_attributes') return { percent: false, scaling: 'CORE' };
  if (FLAT_SCALED.has(id) || /^flat_.+_added_(attack_|magic_)?damage$/.test(id)) return { percent: false, scaling: 'NORMAL' };
  if (FLAT_UNSCALED.has(id) || /^(plus_lvl_|learn_)|^max_.+_charges$/.test(id)) return { percent: false, scaling: 'NONE' };
  return { percent: true, scaling: 'NONE' };
}
