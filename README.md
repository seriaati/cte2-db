# cte2-db

Fan-made database site for the Minecraft modpack [Craft to Exile 2](https://www.curseforge.com/minecraft/modpacks/craft-to-exile-2).

Visit [cte2.seria.moe](https://cte2.seria.moe) to see it.

This project is not affiliated with the CTE2 and Mine and Slash mod team.

All site data and assets are extracted from the modpack.

## Screenshots

### Search

![Searching "blessed hammer" from the home page](docs/screenshots/home.png)

### Database pages

![The uniques page with a stat's explanation open](docs/screenshots/uniques.png)

### Gear planner

![A mythic hammer planned with three prefixes, three suffixes and a gem](docs/screenshots/planner.png)

### Talent trees

![The talent tree zoomed in on a lightning build, with a node's tooltip](docs/screenshots/talents.png)

### Build editor

![The gear tab of the build editor](docs/screenshots/build-gear.png)

![The damage tab showing a Blessed Hammer build's damage a second](docs/screenshots/build-damage.png)

![The defense tab showing effective health by element](docs/screenshots/build-defense.png)

## MCP server

AI clients can query the database through an [MCP](https://modelcontextprotocol.io) server at `https://cte2.seria.moe/mcp`.

It runs as a Cloudflare Pages Function (`functions/mcp.ts`). To try it locally, run `bun run build` and then `bunx wrangler pages dev dist`, and connect to `http://localhost:8788/mcp`.