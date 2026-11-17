// Cloudflare Pages Function: serves the MCP endpoint at /mcp next to the static site.
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { AUGMENT_SLOTS, GEAR_SLOTS, HOTBAR_SLOTS, MAX_CLASSES, MAX_JEWELS, RARITY_TYPES } from '../src/lib/buildRules';
import { CATEGORIES, gearPlanLink, maxLevel, PLAN_RARITIES, RARITIES, search, talentBuildLink, talentLinks } from '../src/lib/mcp';
import { characterBuild } from '../src/lib/mcpBuild';

const level = z.number().int().min(1).max(maxLevel).optional().describe(`Item or character level the stat values are worked out at. Defaults to ${maxLevel}, the highest.`);

// A build as the build editor's files hold it, with names taken wherever a file has an id.
const top = RARITIES.at(-1);
const roll = z.number().min(0).max(100).optional();
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
  implicit: part.optional().describe("One of the base's implicits. Left out, it is the likeliest one."),
  prefix: parts,
  suffix: parts,
  uniqueRolls: z.array(z.number().min(0).max(100)).optional().describe("A roll for each of the unique's stats, in order."),
  sockets: z
    .array(z.union([z.string(), z.object({ kind: z.enum(['gem', 'rune']).optional(), id: z.string(), roll })]))
    .optional()
    .describe('Gems and runes in socket order, e.g. ["Ano Rune", "Grand Ruby"]. The runes of a runeword, in its order, form it.'),
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
      pieces: z.object(Object.fromEntries(RARITY_TYPES.map((type) => [type, points])) as Record<(typeof RARITY_TYPES)[number], typeof points>).partial().optional().describe('How many worn pieces of each kind of rarity it asks for. It gives its stats while they are worn.'),
      slots: z.array(z.object({ slot: z.string(), type: z.enum(RARITY_TYPES) })).optional().describe('Kinds of gear it wants to be of one kind of rarity, e.g. {"slot": "Ring", "type": "unique"}.'),
      affixes: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  augments: z.array(part).max(AUGMENT_SLOTS).optional().describe('Each reserves augment capacity.'),
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
      under: z.string().optional().describe('The effect the skill is used with, where it has more than one state, e.g. "Combo Starter". The answer lists them.'),
      attacks: z.number().positive().max(20).optional().describe("Basic attacks a second, when not the weapon's own."),
      target: z
        .object({
          level: own,
          armor: points,
          resists: z.object({ fire: z.number(), water: z.number(), lightning: z.number(), chaos: z.number() }).partial().describe('In percent, from -300 to 75. Water is cold.'),
        })
        .partial()
        .optional()
        .describe("The enemy hit. Defaults to one of the character's level with no armor and no resistances."),
    })
    .optional(),
  defense: z
    .object({
      level: own,
      rarity: z.string().describe('The mob\'s rarity, e.g. "Rare" or "Boss". Defaults to Common.'),
      affixes: z.array(z.string()).describe('Its affixes that change its hits, e.g. ["of Flames"].'),
      hit: z.number().int().min(1).describe("What a common mob's hit is before defenses. Defaults to 1000."),
      rate: z.number().int().min(1).max(20).describe('Hits a second. Defaults to 2.'),
    })
    .partial()
    .optional()
    .describe('The mob whose hits effective health is measured against.'),
  retribution: points.optional().describe('Retribution stacks a Crusader is taken to hold. Each lowers the damage taken, and a Crusader skill that does more for a stack spends one every cast.'),
});

const handler = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer({ name: 'cte2-db', version: '1.0.0' });
  server.registerTool(
    'search',
    {
      title: 'Search the Craft to Exile 2 database',
      description:
        'Look up game data for the Minecraft modpack Craft to Exile 2 (Mine and Slash): gear affixes, infusions, base gear, unique items, runes, runewords, gems, augments, class spells and passives, support gems, jewel affixes, talents (talent, ascendancy and atlas trees) and stat descriptions. Returns matching entries with their stats. Leave query empty to list a whole category. A talent lists the tree nodes it sits on, like [talents-412]; search for that id to find the talent on a node, and use talent_links to see what a node connects to.',
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
        "Work out a whole Craft to Exile 2 character the way the site's build editor does: the points it spends and has, what one skill deals a second to a target, its effective health against a mob's hits, and every stat when asked. Use it to put a build together, to improve one, or to see what a change does; send the whole build each time. Things go by name as the search tool gives them, or by id. What has no name (passives, infusions, and the affixes of jewels, corruption and codexes) goes by the id the search gives or by a stat it gives. The build of a file exported from the editor works as it is. The build has to be one the game allows; when it isn't, the answer lists everything that is wrong, with the choices where there are few, instead of the numbers. Damage is one skill used over and over on one enemy, with chances counted as their average, and for a summon skill what its pets deal attacking that enemy without pause; buffs other than a Crusader's Retribution stacks, curses, ailments and spells set off by other effects are not counted, and neither are regeneration and leech in effective health. The editor opens builds from files, not links: set file for the file to hand to the user.",
      inputSchema: z.object({
        build,
        connect: z.boolean().optional().describe('Add the nodes needed to join the given talents to an entry point and to each other, in each tree, as talent_build_link does. The answer lists what was added.'),
        stats: z.boolean().optional().describe('Also list every stat the build comes to.'),
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
