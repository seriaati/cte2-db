// Cloudflare Pages Function: serves the MCP endpoint at /mcp next to the static site.
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { CATEGORIES, maxLevel, RARITIES, search, talentBuildLink, talentLinks } from '../src/lib/mcp';

const level = z.number().int().min(1).max(maxLevel).optional().describe(`Item or character level the stat values are worked out at. Defaults to ${maxLevel}, the highest.`);

const handler = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer({ name: 'cte2-db', version: '1.0.0' });
  server.registerTool(
    'search',
    {
      title: 'Search the Craft to Exile 2 database',
      description:
        'Look up game data for the Minecraft modpack Craft to Exile 2 (Mine and Slash): gear affixes, infusions, base gear, unique items, runes, runewords, gems, augments, talents (talent, ascendancy and atlas trees) and stat descriptions. Returns matching entries with their stats. Leave query empty to list a whole category. A talent lists the tree nodes it sits on, like [talents-412]; search for that id to find the talent on a node, and use talent_links to see what a node connects to.',
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
