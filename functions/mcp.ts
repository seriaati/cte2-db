// Cloudflare Pages Function: serves the MCP endpoint at /mcp next to the static site.
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { AUGMENT_SLOTS, GEAR_SLOTS, HOTBAR_SLOTS, MAX_CLASSES, MAX_JEWELS, MAX_QUALITY, RARITY_TYPES, TARGETS } from '../src/lib/buildRules';
import { CATEGORIES, gearPlanLink, maxLevel, PLAN_RARITIES, RARITIES, search, talentBuildLink, talentLinks } from '../src/lib/mcp';
import { characterBuild } from '../src/lib/mcpBuild';

const level = z.number().int().min(1).max(maxLevel).optional().describe(`Item or character level the stat values are worked out at. Defaults to ${maxLevel}, the highest.`);

// A build as the build editor's files hold it, with names taken wherever a file has an id.
const top = RARITIES.at(-1);
const roll = z
  .number()
  .min(0)
  .max(100)
  .optional()
  .describe(
    "Where the value sits between the lowest the part can roll (0) and the highest (100), across every tier. Left out, it is the best the item's rarity allows. Each affix in game has a tier of its own, which can be below the item's rarity: give the roll of the value seen, e.g. 24 for a Truthful of 9.8% on a mythic hammer, as its range runs from 5% to 25%. A roll above the item rarity's best is lowered to it.",
  );
const part = z.union([z.string(), z.object({ id: z.string(), roll })]);
const parts = z.array(part).optional();
const points = z.number().int().min(0);
// Left out, a level is the character's own.
const own = z.number().int().min(1).max(maxLevel).optional();
const nodes = z.array(z.union([z.number().int(), z.string()])).describe('Node ids as the search tool gives them, e.g. "talents-412".');
const item = z.object({
  base: z.string().optional().describe('Base gear, e.g. "Staff". Not needed with a unique.'),
  unique: z.string().optional().describe('A unique item, which has no prefixes or suffixes.'),
  rarity: z.string().optional().describe(`One of ${PLAN_RARITIES.join(', ')}. Defaults to ${top}. Gear of the last has no affixes and more sockets, and forms runewords.`),
  level: own.describe("Gear above the character's level can't be worn."),
  baseRoll: roll,
  quality: z
    .number()
    .int()
    .min(0)
    .max(MAX_QUALITY)
    .optional()
    .describe(`The item's quality, from 0 (the default) to ${MAX_QUALITY}. It is added to the base roll, so 20 quality on a 100 base roll gives the base stats at 120%.`),
  implicit: part.optional().describe("One of the base's implicits. Left out, it is the likeliest one."),
  prefix: parts,
  suffix: parts,
  uniqueRolls: z.array(z.number().min(0).max(100)).optional().describe("A roll for each of the unique's stats, in order."),
  sockets: z
    .array(z.union([z.string(), z.object({ kind: z.enum(['gem', 'rune']).optional(), id: z.string(), roll })]))
    .optional()
    .describe(
      'Gems and runes in socket order, e.g. ["Ano Rune", "Grand Ruby"]. The runes of a runeword, in its order, form it. An item has at most as many sockets as its rarity gives (a unique 0 or 1), plus what corruption adds; one it could still be given shows as [Locked Socket] in game and is simply left empty here.',
    ),
  runewordRoll: roll,
  infusion: z.union([z.string(), z.object({ id: z.string(), rarity: z.enum(RARITIES).optional() })]).optional().describe('A stat the infusion gives, e.g. "Fire Damage".'),
  corruption: z.object({ kind: z.string().describe('Upgraded, Elevated or Ascended: how many affixes and sockets the corruption added.'), affixes: parts }).optional(),
  enchants: z.array(z.object({ id: z.string(), level: z.number().int().min(1).max(10) })).optional().describe('Vanilla enchantments the pack turns into stats, e.g. {"id": "Sharpness", "level": 5}.'),
});
const build = z.object({
  name: z.string().optional(),
  level: level.describe(`Character level. Defaults to ${maxLevel}, the highest.`),
  bonus: z
    .object({ talents: points, ascendancy: points, atlas: points, spells: points, passives: points, stats: points })
    .partial()
    .optional()
    .describe('Points on top of what the level gives. Defaults to none, and to the most there can be for ascendancy and atlas, which give nothing per level.'),
  trees: z.object({ talents: nodes, ascendancy: nodes, atlas: nodes }).partial().optional().describe('The talents taken in each tree.'),
  stats: z.record(z.string(), points).optional().describe('Stat points put in each attribute, e.g. {"Intelligence": 60}.'),
  classes: z.array(z.string()).max(MAX_CLASSES).optional().describe('One class or two, e.g. ["Elementalist"].'),
  perks: z.record(z.string(), points).optional().describe("Points in the classes' spells and passives, e.g. {\"Fire Ball\": 16}. Spells and passives have points of their own."),
  hotbar: z
    .array(z.object({ spell: z.string(), supports: parts.describe('Its support gems. A slot opens for every 4 points in the spell, as the character level allows.') }).nullable())
    .max(HOTBAR_SLOTS)
    .optional()
    .describe('The spells in use, each of which has points in it.'),
  gear: z.partialRecord(z.enum(GEAR_SLOTS.map((slot) => slot.id)), item).optional().describe('What is worn in each slot.'),
  codex: z
    .object({
      id: z.string().describe('e.g. "Codex of Flames".'),
      rarity: z.enum(RARITIES).optional(),
      level: own,
      pieces: z
        .object(Object.fromEntries(RARITY_TYPES.map((type) => [type, points])) as Record<(typeof RARITY_TYPES)[number], typeof points>)
        .partial()
        .optional()
        .describe(
          'How many worn pieces of each kind of rarity it asks for, as the codex in game says: normal (any rarity but unique and runeword), unique, and runed (runeword gear). A kind left out is the fewest its rarity allows, which is at least 1 of each. The codexes category of the search has the limits of each rarity.',
        ),
      slots: z.array(z.object({ slot: z.string(), type: z.enum(RARITY_TYPES) })).optional().describe('Kinds of gear it wants to be of one kind of rarity, e.g. {"slot": "Ring", "type": "unique"}.'),
      affixes: z.array(z.string()).optional().describe('Its affixes, by the id or a stat the codexes category of the search gives.'),
    })
    .nullable()
    .optional(),
  augments: z.array(part).max(AUGMENT_SLOTS).optional().describe('Each reserves augment capacity. By name or id; the ids differ from the names (Vitality Augment is "guardian"), and the search gives both.'),
  jewels: z
    .array(
      z.object({
        kind: z.string().describe('A jewel by name, or str, dex, int, crafted or eye.'),
        rarity: z.enum(RARITIES).optional(),
        level: own,
        affixes: parts,
        corruption: parts,
      }),
    )
    .max(MAX_JEWELS)
    .optional()
    .describe('One for each jewel socket, which come from talents named Jewel Sockets and from a few uniques.'),
  damage: z
    .object({
      skill: z.string().optional().describe('The spell on the hotbar whose damage is worked out. Left out, it is the basic attack.'),
      attacks: z.number().positive().max(20).optional().describe("Basic attacks a second, when not the weapon's own."),
      targets: z
        .number()
        .int()
        .min(1)
        .max(TARGETS.max)
        .optional()
        .describe(`How many enemies, all alike, the skill is used on. Its hits on an area and from projectiles that go on through enemies land on each; other hits on one. Defaults to ${TARGETS.standard}.`),
    })
    .optional(),
  enemy: z
    .object({
      level: own,
      rarity: z.string().describe('The mob\'s rarity, e.g. "Rare" or "Boss". Defaults to Common.'),
      affixes: z.array(z.string()).describe('Its affixes that change its hits or its defenses, e.g. ["of Flames", "Armored"].'),
    })
    .partial()
    .optional()
    .describe(
      "The mob the skill is used on and whose hits effective health is measured against. It has the armor, dodge and resistances the game gives a mob of its level, rarity and affixes, and dodges its share of hits once the character's Accuracy is taken off.",
    ),
  defense: z
    .object({
      hit: z.number().int().min(1).describe("What a common mob's hit is before defenses. Defaults to 1000."),
      rate: z.number().int().min(1).max(20).describe('Hits a second. Defaults to 2.'),
    })
    .partial()
    .optional()
    .describe("The enemy's hits that effective health is measured against."),
  retribution: points.optional().describe('Retribution stacks a Crusader is taken to hold. Each lowers the damage taken, and a Crusader skill that does more for a stack spends one every cast.'),
  aura: z.string().optional().describe('The aura skill that is on, one the build has points in, e.g. "Fanaticism". Only one can be on: its effect counts in every stat, and what it deals enemies or its caster is worked out.'),
  defensive: z
    .array(z.string())
    .optional()
    .describe(
      'Skills on the hotbar that heal and deal no damage, e.g. ["Encore of Life"], each taken to be cast whenever it is ready. What it heals counts in the health and magic shield that come back while fighting, its cost in what is spent, and the time spent casting it comes off the skill the damage is worked out for, where that leaves it too little. The answer lists the ones the build can set.',
    ),
  effects: z
    .record(z.string(), points)
    .optional()
    .describe(
      'The buffs and debuffs taken to be on, each with its stacks, out of those the build can put on the character or on the enemy: what the skills it has points in give, and what its stats give on a hit, on a kill, when the character is hit or every ten seconds, such as charges, e.g. {"Power Surge": 1, "Frenzy Charge": 3, "Shred": 5}. The answer lists them. One that is on is taken to be kept up the whole time: on the character it counts in every stat, on the enemy it changes what the skill deals it and what its hits deal, and one that deals damage itself, like Damnation, deals it without pause. A skill that changes with the effects on its caster is used in the form they call for.',
    ),
});

const handler = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer({ name: 'cte2-db', version: '1.0.0' });
  server.registerTool(
    'search',
    {
      title: 'Search the Craft to Exile 2 database',
      description:
        'Look up game data for the Minecraft modpack Craft to Exile 2 (Mine and Slash): gear affixes, infusions, base gear, unique items, runes, runewords, gems, augments, class spells and passives, support gems, jewel affixes, status effects (buffs, debuffs, charges and what auras put on), codexes with their affixes and the rules of each rarity, talents (talent, ascendancy and atlas trees) and stat descriptions. Returns matching entries with their stats. Leave query empty to list a whole category. A talent lists the tree nodes it sits on, like [talents-412]; search for that id to find the talent on a node, and use talent_links to see what a node connects to.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Words to look for in an entry: its name, its stats, the gear it fits. Every word has to appear, e.g. "staff fire damage".'),
        category: z.enum(CATEGORIES).optional().describe('Only search this list. Searches all of them when left out.'),
        level,
        rarity: z.enum(RARITIES).optional().describe(`Rarity tier that affix, infusion, base gear and augment values are shown at. Defaults to ${RARITIES.at(-1)}, the highest.`),
        limit: z.number().int().min(1).max(50).optional().describe('How many entries to return. Defaults to 20.'),
        offset: z.number().int().min(0).optional().describe('How many matching entries to skip, to page through long results.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => ({ content: [{ type: 'text', text: search(args) }] }),
  );
  server.registerTool(
    'talent_links',
    {
      title: 'Show what talent tree nodes link to',
      description:
        "For each node of a Craft to Exile 2 talent, ascendancy or atlas tree: the talent on it and the nodes it links to, with their talents. Node ids come from the search tool's talent entries. A character's first talent has to be an entry point; every later one has to link to a talent already taken.",
      inputSchema: z.object({
        nodes: z.array(z.string()).min(1).max(50).describe('Node ids, e.g. ["talents-412", "atlas-7"].'),
        level,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ nodes, level }) => ({ content: [{ type: 'text', text: talentLinks(nodes, level) }] }),
  );
  server.registerTool(
    'talent_build_link',
    {
      title: 'Make a shareable talent build link',
      description:
        "Turn a talent build into a link that opens it in the site's talent planner, to hand to the user. Give the nodes the build takes, all from one tree: talents, ascendancy or atlas. The build has to be one the game allows: it includes an entry point, every other node links to one already in the build, no more than one talent of a one-of-a-kind group, and no more nodes than the character has points. When it isn't, the answer says which nodes are the problem instead of giving a link. Set connect to give only the talents the build is after and have the nodes between them filled in.",
      inputSchema: z.object({
        nodes: z.array(z.string()).min(1).max(200).describe('Node ids of the talents in the build, e.g. ["talents-449", "talents-412"]: all of them, or with connect only the ones that matter.'),
        level: level.describe(`Character level, which on the talent tree sets how many points there are to spend. Defaults to ${maxLevel}, the highest.`),
        bonus: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Points the character has on top of those from its level. Defaults to 0 on the talent tree, and to the most there can be on the ascendancy and atlas trees, which give no points per level.'),
        connect: z
          .boolean()
          .optional()
          .describe('Add the nodes needed to join the given talents to an entry point and to each other, along short routes; each still costs a point. With no entry point given, the one that takes the fewest nodes is picked. The answer lists what was added. To steer a route, give a node it should pass through.'),
      }),
      annotations: { readOnlyHint: true },
    },
    // The link goes to whichever site this server is running next to, so a local or preview build links to itself.
    async ({ nodes, level, bonus, connect }) => ({ content: [{ type: 'text', text: talentBuildLink(new URL(requestInfo!.url).origin, nodes, level, bonus, connect) }] }),
  );
  server.registerTool(
    'gear_plan_link',
    {
      title: 'Make a shareable gear planner link',
      description:
        "Turn a planned piece of gear into a link that opens it in the site's gear planner, to hand to the user. Name the base gear and what goes on it, with names as the search tool gives them. The item has to be one the game allows: every affix rolls on that gear, there are no more prefixes, suffixes, sockets, gems or runes than its rarity has room for, and nothing is on it twice unless the game lets it. When it isn't, the answer says what is wrong instead of giving a link.",
      inputSchema: z.object({
        base: z.string().describe('Base gear name, e.g. "Staff" or "Cloth Boots".'),
        rarity: z.enum(PLAN_RARITIES).optional().describe(`The item's rarity, which sets how many affixes and sockets it has and how high the affixes roll. Defaults to ${RARITIES.at(-1)}. Only ${PLAN_RARITIES.at(-1)} gear forms runewords, and it has no affixes.`),
        level,
        implicit: z.string().optional().describe("Name of one of the base's implicits. Left out, the planner shows the likeliest one."),
        prefixes: z.array(z.string()).optional().describe('Prefix names, e.g. ["Scorched"].'),
        suffixes: z.array(z.string()).optional().describe('Suffix names, e.g. ["of the Drake"].'),
        sockets: z.array(z.string()).optional().describe('Gems and runes by name, in socket order, e.g. ["Ano Rune", "Grand Ruby"]. The runes of a runeword, in its order, form it.'),
        infusion: z.string().optional().describe('A stat the infusion gives, e.g. "Fire Damage". Infusions have no names.'),
        infusion_rarity: z.enum(RARITIES).optional().describe(`The infusion's own rarity. Defaults to ${RARITIES.at(-1)}.`),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ infusion_rarity, ...plan }) => ({ content: [{ type: 'text', text: gearPlanLink(new URL(requestInfo!.url).origin, { ...plan, infusionRarity: infusion_rarity }) }] }),
  );
  server.registerTool(
    'character_build',
    {
      title: 'Work out a character build',
      description:
        `Work out a whole Craft to Exile 2 character the way the site's build editor does: the points it spends and has, what one skill deals a second to an enemy mob, its effective health against that mob's hits, and every stat when asked. Use it to put a build together, to improve one, or to see what a change does; send the whole build each time. Things go by name as the search tool gives them, or by id. What has no name (passives, infusions, and the affixes of jewels, corruption and codexes) goes by the id the search gives or by a stat it gives. The build of a file exported from the editor works as it is. The build has to be one the game allows, down to the level and attributes each piece of gear asks for; when it isn't, the answer lists everything that is wrong, with the choices where there are few, instead of the numbers. Damage is one skill used over and over on an enemy mob, at the level its points and stats that add skill levels (such as +1 to all skills) give it, with chances and the enemy's dodges counted as their average, and of projectiles shot together those that would hit an enemy as big as a zombie 5 blocks away, aimed so that the most do, and for a summon skill what its pets deal attacking that enemy without pause; its hits on an area and from projectiles that go on through enemies land on each of as many enemies as damage.targets says (${TARGETS.standard} unless given), all alike, and the damage a second is what they take together, while other hits, basic attacks and pets' attacks land on one; taunts and threat are left out; of buffs and debuffs only a Crusader's Retribution stacks, the one aura set to be on and the effects set to be on count (a Crusader skill that does more with Retribution spends as many stacks a cast as its script takes, Blessed Hammer one as each of its hammers ends, and they are taken to be held again by the next cast), out of those the build's skills and stats give, each as if kept up the whole time; what an effect deals itself while it lasts counts, with the skill that leaves it or apart when it is set to be on; spells that stats set off on a hit count, as often as their chance and cooldown let them go off, but not those set off by a kill or by a hit the character takes; ailments are not counted. Damage a second is at full pace; the answer gives what the skill costs in mana, energy or blood and what comes back a second while fighting (regeneration and what its hits leech or restore, up to the leech cap), and where it costs more than comes back, how long the pool lasts and the damage a second that can be kept up after. Effective health counts no healing; the answer sets the health and magic shield that come back a second, from regeneration, leech, the skill used's own heals and the skills set in defensive, against the enemy's hits and says how long the character lasts. The editor opens builds from files, not links: set file for the file to hand to the user.`,
      inputSchema: z.object({
        build,
        connect: z
          .boolean()
          .optional()
          .describe(
            'Add the nodes needed to join the given talents to an entry point and to each other, in each tree, as talent_build_link does. The answer lists what was added. Given nodes are always kept, but the added ones are worked out anew each time and can differ once a node is added, so to keep a route give every node of the last answer (or of the file) and only add to them. Routes are short, not picked for what their nodes give: give a node to steer one.',
          ),
        allStats: z.boolean().optional().describe('Also list every stat the build comes to. (Attribute points go in build.stats.)'),
        file: z.boolean().optional().describe('Also return the build as the file the build editor imports. Ask for it once the build is settled, and pass the text on unchanged.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ build, ...options }) => ({ content: [{ type: 'text', text: characterBuild(new URL(requestInfo!.url).origin, build, options) }] }),
  );
  return server;
});

// There is no sign-in and nothing private here, so a page on any site may call this from a browser.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*' };

export const onRequest = async ({ request }: { request: Request }) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const response = await handler.fetch(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
};
