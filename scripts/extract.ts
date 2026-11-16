import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { PNG } from 'pngjs';

const REGISTRIES = [
  'mmorpg_affixes',
  'mmorpg_aura',
  'mmorpg_base_gear_types',
  'mmorpg_game_balance',
  'mmorpg_gear_rarity',
  'mmorpg_gear_slot',
  'mmorpg_gems',
  'mmorpg_perk',
  'mmorpg_runes',
  'mmorpg_runeword',
  'mmorpg_stat',
  'mmorpg_support_gem',
  'mmorpg_talent_tree',
  'mmorpg_unique_gears',
];
const LANG = 'assets/mmorpg/lang/en_us.json';
const OUT = join(import.meta.dirname, '../src/data');

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

const registryFile = new RegExp(`^data/[^/]+/(${REGISTRIES.join('|')})/.+\\.json$`);
const registries: Record<string, Record<string, unknown>> = {};
const lang: Record<string, string> = {};

for (const layer of layers) {
  for (const [path, read] of layer) {
    if (path === LANG) Object.assign(lang, JSON.parse(read().toString()));
    const registry = registryFile.exec(path)?.[1];
    if (!registry) continue;
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
writeFileSync(join(TALENTS, 'icons.png'), PNG.sync.write(atlas));
// The frame the game draws around each type of perk, plain and lit.
for (const frame of ['stat', 'special', 'major', 'start', 'asc'].flatMap((type) => [`${type}_off`, `${type}_on`])) {
  writeFileSync(join(TALENTS, `${frame}.png`), texture(`assets/mmorpg/textures/gui/skill_tree/borders/${frame}.png`));
}
console.log(`talent icons: ${perkIcons.length}`);

const sorted = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

mkdirSync(OUT, { recursive: true });
for (const [registry, entries] of Object.entries({ ...registries, lang, icons, talent_icons })) {
  const file = `${registry.replace('mmorpg_', '')}.json`;
  writeFileSync(join(OUT, file), JSON.stringify(sorted(entries), null, 2) + '\n');
  console.log(`${file}: ${Object.keys(entries).length}`);
}

// Item sprites for the rune, gem, aura, support gem and jewel pages: item "mmorpg:runes/ano" ends up at public/items/runes/ano.png.
const SPRITES = join(import.meta.dirname, '../public/items');
const spriteItems = [
  ...[...Object.values(registries.mmorpg_runes), ...Object.values(registries.mmorpg_gems)].map((e) => (e as { item_id: string }).item_id),
  // SkillGemsItems in Mine and Slash: an aura or support gem is one of three items, picked by its style.
  ...['aura', 'support'].flatMap((gem) => ['str', 'dex', 'int'].map((style) => `mmorpg:skill_gems/${gem}/${style}`)),
  ...['str', 'dex', 'int', 'unique_crafted', 'watcher_eye'].map((jewel) => `mmorpg:jewel/${jewel}`),
];
for (const item of spriteItems) {
  const [namespace, path] = item.split(':');
  const texture = `assets/${namespace}/textures/item/${path}.png`;
  const { width, data } = PNG.sync.read(layers.findLast((layer) => layer.has(texture))!.get(texture)!());
  // Animated textures stack their frames vertically, so the top square is the first frame.
  const frame = new PNG({ width, height: width });
  data.copy(frame.data, 0, 0, width * width * 4);
  const file = join(SPRITES, `${path}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PNG.sync.write(frame));
}
console.log(`item sprites: ${spriteItems.length}`);
