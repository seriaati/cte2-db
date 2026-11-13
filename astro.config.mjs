// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // Canonical links, the sitemap and link previews need the public address.
  site: 'https://cte2.seria.moe',
  integrations: [react()]
});