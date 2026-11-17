import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { flatIcon, modelIcon, type Model } from './itemIcon';

const REGISTRIES = [
  'mmorpg_affixes',
  'mmorpg_aura',
  'mmorpg_base_gear_types',
  'mmorpg_base_stats',
  'mmorpg_chaos_stat',
  'mmorpg_exile_effect',
  'mmorpg_game_balance',
  'mmorpg_gear_rarity',
  'mmorpg_gear_slot',
  'mmorpg_gems',
  'mmorpg_mob_affix',
  'mmorpg_mob_rarity',
  'mmorpg_omen',
  'mmorpg_perk',
  'mmorpg_runes',
  'mmorpg_runeword',
  'mmorpg_sets',
  'mmorpg_spell_school',
  'mmorpg_spells',
  'mmorpg_stat',
  'mmorpg_stat_compat',
  'mmorpg_stat_condition',
  'mmorpg_stat_effect',
  'mmorpg_stat_layer',
  'mmorpg_support_gem',
  'mmorpg_talent_tree',
  'mmorpg_unique_gears',
  'mmorpg_value_calc',
  'mmorpg_weapon_type',
];
const LANG = 'assets/mmorpg/lang/en_us.json';
const OUT = join(import.meta.dirname, '../src/data');

// The site's images are lossless WebP, which comes out at well under half the size of the game's PNGs.
const writeImage = async (file: string, png: Buffer) => writeFileSync(file, await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer());

// Gear icons are traced from in-game textures: most gear slots have a white glyph inside their
// "soul" item texture. The slots listed here have none, so theirs are drawn by hand to match.
const SOUL_ICON = (slot: string) => `assets/mmorpg/textures/item/stat_soul/${slot}.png`;
const DRAWN_ICONS: Record<string, string[]> = {
  elytra: ['.##..##.', '###..###', '###..###', '###..###', '###..###', '##....##', '##....##', '#......#'],
  head: ['....#...', '...##...', '..###...', '..####..', '.#####..', '########', '.######.'],
  tome: ['#######.', '#.#####.', '#.#####.', '#.#..##.', '#.#..##.', '#.#####.', '#######.', '.######.'],
  totem: ['..####..', '..#..#..', '..####..', '#.####.#', '########', '..####..', '..####..', '...##...'],
};

// Turns the lit pixels into an SVG path of one-pixel-high runs, cropped to their bounding box.
function tracePixels(width: number, height: number, lit: (x: number, y: number) => boolean) {
  const runs: [x: number, y: number, length: number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!lit(x, y)) continue;
      const start = x;
      while (x + 1 < width && lit(x + 1, y)) x++;
      runs.push([start, y, x - start + 1]);
    }
  }
  const left = Math.min(...runs.map(([x]) => x));
  const top = Math.min(...runs.map(([, y]) => y));
  return {
    d: runs.map(([x, y, n]) => `M${x - left} ${y - top}h${n}v1h-${n}z`).join(''),
    w: Math.max(...runs.map(([x, , n]) => x + n)) - left,
    h: Math.max(...runs.map(([, y]) => y)) - top + 1,
  };
}

function traceGlyph(png: Buffer) {
  const { width, height, data } = PNG.sync.read(png);
  return tracePixels(width, height, (x, y) => {
    const i = (y * width + x) * 4;
    // The coin behind the glyph has translucent white highlights; only fully opaque white is glyph.
    return data[i + 3] > 200 && Math.min(data[i], data[i + 1], data[i + 2]) >= 235;
  });
}

// pack-relative path -> lazy file content
type Layer = Map<string, () => Buffer>;

function jarLayer(path: string): Layer {
  const layer: Layer = new Map();
  for (const entry of new AdmZip(path).getEntries()) {
    if (!entry.isDirectory) layer.set(entry.entryName, () => entry.getData());
  }
  return layer;
}

function dirLayer(root: string): Layer {
  const layer: Layer = new Map();
  for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const full = join(file.parentPath, file.name);
    layer.set(relative(root, full).split(sep).join('/'), () => readFileSync(full));
  }
  return layer;
}

const list = (dir: string) => readdirSync(dir).sort().map((name) => join(dir, name));

const arg = process.argv[2];
if (!arg) {
  console.error('usage: bun run extract <path to CTE2 instance>');
  process.exit(1);
}
const mc = existsSync(join(arg, 'minecraft')) ? join(arg, 'minecraft') : arg;

// Later layers win, same as in game: mod jars first, then the pack's OpenLoader overrides.
const layers = [
  ...list(join(mc, 'mods')).filter((p) => p.endsWith('.jar')).map(jarLayer),
  ...list(join(mc, 'config/openloader/data')).map(dirLayer),
  ...list(join(mc, 'config/openloader/resources')).map(dirLayer),
];

// Talent trees hold their grid as a string with raw line breaks in it, which the game's parser
// accepts and JSON.parse doesn't.
const parse = (json: string) => JSON.parse(json.replace(/"(?:[^"\\]|\\.)*"/g, (s) => s.replace(/\r?\n/g, '\\n')));

const registryFile = /^data\/[^/]+\/(mmorpg_[a-z_]+)\/.+\.json$/;
const registries: Record<string, Record<string, unknown>> = {};
// Every other Mine and Slash registry, which is only read to see what the pack makes use of.
const unlisted: Record<string, unknown> = {};
const lang: Record<string, string> = {};

for (const layer of layers) {
  for (const [path, read] of layer) {
    if (path === LANG) Object.assign(lang, JSON.parse(read().toString()));
    const registry = registryFile.exec(path)?.[1];
    if (!registry) continue;
    if (!REGISTRIES.includes(registry)) {
      try {
        const entry = parse(read().toString());
        unlisted[`${registry}/${entry.guid ?? entry.id ?? entry.identifier ?? path}`] = entry;
      } catch {}
      continue;
    }
    const entry = parse(read().toString());
    // Entries are keyed by id, not file path: the pack moves files into subfolders but keeps ids.
    const id: string = entry.guid ?? entry.id ?? entry.identifier ?? entry.data.id;
    (registries[registry] ??= {})[id] = entry;
  }
}

const icons: Record<string, unknown> = {};
for (const slot of Object.keys(registries.mmorpg_gear_slot)) {
  const drawn = DRAWN_ICONS[slot];
  const path = SOUL_ICON(slot);
  icons[slot] = drawn
    ? tracePixels(drawn[0].length, drawn.length, (x, y) => drawn[y][x] === '#')
    : traceGlyph(layers.findLast((layer) => layer.has(path))!.get(path)!());
}

// Perk icons for the talent tree pages, packed into one row of 32px cells. Most icons are 16px
// and double cleanly; the rest are 32px, bar one that is 18px.
const TALENTS = join(import.meta.dirname, '../public/talents');
const CELL = 32;
const texture = (path: string) => layers.findLast((layer) => layer.has(path))!.get(path)!();
const perks = registries.mmorpg_perk as Record<string, { icon: string }>;
const grids = Object.values(registries.mmorpg_talent_tree).map((tree) => (tree as { perks: string }).perks);
const perkIcons = [...new Set(grids.flatMap((grid) => grid.split(/[\n,]/)).flatMap((id) => perks[id.toLowerCase()]?.icon ?? []))].sort();
const talent_icons = Object.fromEntries(perkIcons.map((icon, i) => [icon, i]));
const atlas = new PNG({ width: CELL * perkIcons.length, height: CELL });
perkIcons.forEach((icon, i) => {
  const [namespace, path] = icon.split(':');
  // A few of these files end with a second end-of-image marker, which pngjs won't read past.
  const png = texture(`assets/${namespace}/${path}`);
  const { width, data } = PNG.sync.read(png.subarray(0, png.indexOf('IEND') + 8));
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const from = (Math.floor((y * width) / CELL) * width + Math.floor((x * width) / CELL)) * 4;
      data.copy(atlas.data, (y * atlas.width + i * CELL + x) * 4, from, from + 4);
    }
  }
});
mkdirSync(TALENTS, { recursive: true });
await writeImage(join(TALENTS, 'icons.webp'), PNG.sync.write(atlas));
// The frame the game draws around each type of perk, plain and lit.
for (const frame of ['stat', 'special', 'major', 'start', 'asc'].flatMap((type) => [`${type}_off`, `${type}_on`])) {
  await writeImage(join(TALENTS, `${frame}.webp`), texture(`assets/mmorpg/textures/gui/skill_tree/borders/${frame}.png`));
}
console.log(`talent icons: ${perkIcons.length}`);

// What gives each status effect: spells and other effects through their scripts, shrines, and stats
// through their stat effects. Left out are the spells the pack has retired, the shrines that never
// spawn and the stats nothing in the pack uses, so an effect with no source is one the pack never applies.
function given(script: unknown, found = new Set<string>()) {
  if (script && typeof script === 'object') {
    const { type, map } = script as { type?: string; map?: Record<string, string> };
    if (type === 'exile_effect' && map?.potion_action === 'GIVE_STACKS') found.add(map.exile_potion_id);
    Object.values(script).forEach((value) => given(value, found));
  }
  return found;
}
const names = new Set<string>();
const collect = (value: unknown) => {
  if (typeof value === 'string') names.add(value);
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, inner]) => (names.add(key), collect(inner)));
};
const STAT_REGISTRIES = ['mmorpg_stat', 'mmorpg_stat_effect', 'mmorpg_stat_condition'];
Object.entries(unlisted).forEach(([key, entry]) => STAT_REGISTRIES.includes(key.split('/')[0]) || collect(entry));
Object.entries(registries).forEach(([registry, entries]) => STAT_REGISTRIES.includes(registry) || collect(entries));

const effect_sources: Record<string, Record<'spells' | 'effects' | 'shrines' | 'stats', string[]>> = {};
const source = (effect: string, kind: 'spells' | 'effects' | 'shrines' | 'stats', id: string) => {
  if (!(effect in registries.mmorpg_exile_effect)) return;
  (effect_sources[effect] ??= { spells: [], effects: [], shrines: [], stats: [] })[kind].push(id);
};
for (const [id, spell] of Object.entries(registries.mmorpg_spells)) {
  if (!id.endsWith('_deprecated')) given(spell).forEach((effect) => source(effect, 'spells', id));
}
for (const [id, effect] of Object.entries(registries.mmorpg_exile_effect)) given(effect).forEach((other) => other === id || source(other, 'effects', id));
for (const [key, entry] of Object.entries(unlisted)) {
  const shrine = entry as { id: string; effect_id: string; weight: number };
  if (key.startsWith('mmorpg_shrine_buff/') && shrine.weight > 0) source(shrine.effect_id, 'shrines', shrine.id);
}
const statEffect = (id: string) => registries.mmorpg_stat_effect[id] as { ser?: string; effect: string } | undefined;
for (const [id, stat] of Object.entries(registries.mmorpg_stat as Record<string, { effect?: { effects: string[] }[] }>)) {
  if (!names.has(id) || !Array.isArray(stat.effect)) continue;
  for (const gives of stat.effect.flatMap((e) => e.effects).map(statEffect)) {
    if (gives?.ser?.startsWith('give_exile_effect')) source(gives.effect, 'stats', id);
  }
}
// Folders are read in whatever order the disk lists them, so the lists are sorted to come out the same on every machine.
Object.values(effect_sources).forEach((kinds) => Object.values(kinds).forEach((ids) => ids.sort()));

// A picture of every item gear can be, for the build editor: item "roe_weapons:axe_0" ends up at
// public/gear/roe_weapons/axe_0.webp. The two vanilla items among them have no files in the pack and are left out.
const GEAR = join(import.meta.dirname, '../public/gear');
const find = (path: string) => layers.findLast((layer) => layer.has(path))?.get(path)!();
const split = (ref: string) => (ref.includes(':') ? ref.split(':') : ['minecraft', ref]);
const modelAt = (ref: string): Model | undefined => {
  const [namespace, path] = split(ref);
  const json = find(`assets/${namespace}/models/${path}.json`);
  return json && JSON.parse(json.toString());
};
const textureAt = (ref: string) => {
  const [namespace, path] = split(ref);
  const png = find(`assets/${namespace}/textures/${path}.png`);
  return png && PNG.sync.read(png);
};
const gearItems = new Set([
  ...Object.values(registries.mmorpg_base_gear_types).flatMap((base) => (base as { possible_items: { item_id: string }[] }).possible_items.map((item) => item.item_id)),
  ...Object.values(registries.mmorpg_unique_gears).flatMap((unique) => (unique as { force_item_id: string }).force_item_id || []),
]);
const gear_icons: Record<string, string> = {};
for (const item of [...gearItems].sort()) {
  const [namespace, path] = item.split(':');
  // A model takes what it doesn't say itself from its parent, and so on up.
  const model: Model = {};
  for (let part = modelAt(`${namespace}:item/${path}`); part; part = part.parent ? modelAt(part.parent) : undefined) {
    model.textures = { ...part.textures, ...model.textures };
    model.elements ??= part.elements;
    model.display ??= part.display;
  }
  const textures = Object.fromEntries(Object.entries(model.textures ?? {}).map(([key, ref]) => [key, textureAt(ref)]));
  const icon = model.elements ? modelIcon(model.elements, model.display?.gui, textures) : textures.layer0 && flatIcon(textures.layer0);
  if (!icon) continue;
  const file = join(GEAR, namespace, `${path}.webp`);
  mkdirSync(dirname(file), { recursive: true });
  await writeImage(file, PNG.sync.write(icon));
  gear_icons[item] = `/gear/${namespace}/${path}.webp`;
}
console.log(`gear icons: ${Object.keys(gear_icons).length} of ${gearItems.size}`);

// For the home page: which pack and mod version the data is from. The launcher keeps the pack's
// manifest beside the game folder; without one the pack version is left out.
const manifest = join(arg, 'flame/manifest.json');
const pack = {
  version: existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')).version as string) : '',
  mod: list(join(mc, 'mods')).flatMap((jar) => /Mine_and_Slash-[\d.]+-([\d.]+)\.jar$/.exec(jar)?.[1] ?? [])[0] ?? '',
};

const sorted = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

mkdirSync(OUT, { recursive: true });
for (const [registry, entries] of Object.entries({ ...registries, lang, icons, effect_sources, pack, talent_icons, gear_icons })) {
  const file = `${registry.replace('mmorpg_', '')}.json`;
  writeFileSync(join(OUT, file), JSON.stringify(sorted(entries), null, 2) + '\n');
  console.log(`${file}: ${Object.keys(entries).length}`);
}

// Item sprites for the rune, gem, aura, support gem and jewel pages and the build editor: item "mmorpg:runes/ano" ends up at public/items/runes/ano.webp.
const SPRITES = join(import.meta.dirname, '../public/items');
const spriteItems = [
  ...[...Object.values(registries.mmorpg_runes), ...Object.values(registries.mmorpg_gems)].map((e) => (e as { item_id: string }).item_id),
  // SkillGemsItems in Mine and Slash: an aura or support gem is one of three items, picked by its style.
  ...['aura', 'support'].flatMap((gem) => ['str', 'dex', 'int'].map((style) => `mmorpg:skill_gems/${gem}/${style}`)),
  ...['str', 'dex', 'int', 'unique_crafted', 'watcher_eye'].map((jewel) => `mmorpg:jewel/${jewel}`),
  'mmorpg:omen',
];
for (const item of spriteItems) {
  const [namespace, path] = item.split(':');
  const texture = `assets/${namespace}/textures/item/${path}.png`;
  const { width, data } = PNG.sync.read(layers.findLast((layer) => layer.has(texture))!.get(texture)!());
  // Animated textures stack their frames vertically, so the top square is the first frame.
  const frame = new PNG({ width, height: width });
  data.copy(frame.data, 0, 0, width * width * 4);
  const file = join(SPRITES, `${path}.webp`);
  mkdirSync(dirname(file), { recursive: true });
  await writeImage(file, PNG.sync.write(frame));
}
console.log(`item sprites: ${spriteItems.length}`);

// Icons for the effects page. The pack has no texture for a few effects; the game shows its missing-texture square for them.
const EFFECTS = join(import.meta.dirname, '../public/effects');
const effectIcons = Object.keys(registries.mmorpg_exile_effect)
  .map((id) => [id, `assets/mmorpg/textures/item/mob_effects/${id}.png`])
  .filter(([, path]) => layers.some((layer) => layer.has(path)));
mkdirSync(EFFECTS, { recursive: true });
for (const [id, path] of effectIcons) await writeImage(join(EFFECTS, `${id}.webp`), texture(path));
console.log(`effect icons: ${effectIcons.length}`);

// Icons for the spells page. A class lists its spells and its passives together; only the spells are in the spell registry.
const SPELLS = join(import.meta.dirname, '../public/spells');
const classPerks = Object.values(registries.mmorpg_spell_school).flatMap((school) => Object.keys((school as { perks: object }).perks));
const classSpells = classPerks.filter((id) => id in registries.mmorpg_spells);
mkdirSync(SPELLS, { recursive: true });
for (const id of classSpells) await writeImage(join(SPELLS, `${id}.webp`), texture(`assets/mmorpg/textures/gui/spells/icons/${id}.png`));
// The build editor also shows each class's passives, whose icons are named by their perks.
for (const id of classPerks.filter((id) => !classSpells.includes(id))) {
  const [namespace, path] = perks[id].icon.split(':');
  await writeImage(join(SPELLS, `${id}.webp`), texture(`assets/${namespace}/${path}`));
}

const CLASSES = join(import.meta.dirname, '../public/classes');
mkdirSync(CLASSES, { recursive: true });
for (const id of Object.keys(registries.mmorpg_spell_school)) {
  await writeImage(join(CLASSES, `${id}.webp`), texture(`assets/mmorpg/textures/gui/asc_classes/class/${id}.png`));
}
console.log(`spell icons: ${classSpells.length}`);
