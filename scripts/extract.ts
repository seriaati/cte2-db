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
  'mmorpg_runes',
  'mmorpg_runeword',
  'mmorpg_stat',
  'mmorpg_unique_gears',
];
const LANG = 'assets/mmorpg/lang/en_us.json';
const OUT = join(import.meta.dirname, '../src/data');

// Gear icons are traced from in-game textures. Most gear slots have a white glyph inside their
// "soul" item texture; the slots listed here have none and borrow another texture.
type IconMode = 'white' | 'opaque' | 'outline';
const SOUL_ICON = (slot: string) => `assets/mmorpg/textures/item/stat_soul/${slot}.png`;
const ICON_SOURCES: Record<string, [path: string, mode: IconMode]> = {
  elytra: ['assets/curios/textures/slot/empty_elytra_slot.png', 'opaque'],
  head: ['assets/curios/textures/slot/empty_head_slot.png', 'opaque'],
  tome: ['assets/mmorpg/textures/item/offhand/tome/iron.png', 'outline'],
  totem: [SOUL_ICON('totem'), 'outline'],
};

// Turns the chosen pixels into an SVG path of one-pixel-high runs, cropped to their bounding box.
function traceIcon(png: Buffer, mode: IconMode) {
  const { width, height, data } = PNG.sync.read(png);
  const solid = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && data[(y * width + x) * 4 + 3] > 100;
  const lit = (x: number, y: number) => {
    if (!solid(x, y) || mode === 'opaque') return solid(x, y);
    const i = (y * width + x) * 4;
    // The coin behind the glyph has translucent white highlights; only fully opaque white is glyph.
    if (mode === 'white') return data[i + 3] > 200 && Math.min(data[i], data[i + 1], data[i + 2]) >= 235;
    return !(solid(x + 1, y) && solid(x - 1, y) && solid(x, y + 1) && solid(x, y - 1));
  };
  const runs: [x: number, y: number, length: number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!lit(x, y)) continue;
      const start = x;
      while (lit(x + 1, y)) x++;
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

const registryFile = new RegExp(`^data/[^/]+/(${REGISTRIES.join('|')})/.+\\.json$`);
const registries: Record<string, Record<string, unknown>> = {};
const lang: Record<string, string> = {};

for (const layer of layers) {
  for (const [path, read] of layer) {
    if (path === LANG) Object.assign(lang, JSON.parse(read().toString()));
    const registry = registryFile.exec(path)?.[1];
    if (!registry) continue;
    const entry = JSON.parse(read().toString());
    // Entries are keyed by id, not file path: the pack moves files into subfolders but keeps ids.
    const id: string = entry.guid ?? entry.id ?? entry.identifier ?? entry.data.id;
    (registries[registry] ??= {})[id] = entry;
  }
}

const icons: Record<string, unknown> = {};
for (const slot of Object.keys(registries.mmorpg_gear_slot)) {
  const [path, mode] = ICON_SOURCES[slot] ?? [SOUL_ICON(slot), 'white'];
  const read = layers.findLast((layer) => layer.has(path))!.get(path)!;
  icons[slot] = traceIcon(read(), mode);
}

const sorted = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

mkdirSync(OUT, { recursive: true });
for (const [registry, entries] of Object.entries({ ...registries, lang, icons })) {
  const file = `${registry.replace('mmorpg_', '')}.json`;
  writeFileSync(join(OUT, file), JSON.stringify(sorted(entries), null, 2) + '\n');
  console.log(`${file}: ${Object.keys(entries).length}`);
}

// Item sprites for the rune, gem and aura pages: item "mmorpg:runes/ano" ends up at public/items/runes/ano.png.
const SPRITES = join(import.meta.dirname, '../public/items');
const spriteItems = [
  ...[...Object.values(registries.mmorpg_runes), ...Object.values(registries.mmorpg_gems)].map((e) => (e as { item_id: string }).item_id),
  // SkillGemsItems in Mine and Slash: an aura gem is one of three items, picked by the aura's style.
  ...['str', 'dex', 'int'].map((style) => `mmorpg:skill_gems/aura/${style}`),
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
