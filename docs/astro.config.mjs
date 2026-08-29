import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

const base = process.env.HUE_DOCS_BASE || '/HUE';

export default defineConfig({
  site: 'https://ctwhome.github.io',
  base,
  outDir: process.env.HUE_DOCS_OUT_DIR || './dist',
  integrations: [
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        flowchart: { curve: 'basis', htmlLabels: true },
        themeVariables: { fontSize: '15px' },
      },
    }),
    starlight({
      title: 'HUE Docs',
      description: 'The active product and architecture contract for HUE, a focused local Hermes workspace.',
      logo: {
        src: './src/assets/hue-logo.svg',
        alt: 'HUE',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/hue.css'],
      social: [
        { icon: 'github', label: 'HUE on GitHub', href: 'https://github.com/ctwhome/HUE' },
      ],
      head: [
        { tag: 'meta', attrs: { property: 'og:site_name', content: 'HUE Documentation' } },
        { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#212121' } },
      ],
      lastUpdated: true,
      pagefind: true,
      pagination: true,
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', slug: 'index' },
            { label: 'Status & review protocol', slug: 'spec/00-status-and-review' },
          ],
        },
        {
          label: 'Product contract',
          items: [
            { label: 'Focused architecture', slug: 'spec/05-system-architecture' },
            { label: 'Implementation sequence', slug: 'spec/13-roadmap' },
            { label: 'Focused notifications', slug: 'spec/16-notifications-attention-delivery' },
          ],
        },
        {
          label: 'Architecture decisions',
          collapsed: false,
          items: [
            { label: 'Decision register', slug: 'spec/14-decision-register' },
            { autogenerate: { directory: 'decisions' } },
          ],
        },
        {
          label: 'Project',
          items: [
            { label: 'Contributing', slug: 'contributing' },
          ],
        },
      ],
    }),
  ],
});
