import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

const base = '/HUE';

export default defineConfig({
  site: 'https://ctwhome.github.io',
  base,
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
      description: 'The reviewable product contract for HUE, an open-source local-first personal agent workspace.',
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
            { label: 'Vision', slug: 'vision' },
            { label: 'Status & review protocol', slug: 'spec/00-status-and-review' },
            { label: 'Interactive prototype ↗', link: '/prototype/', attrs: { target: '_blank' } },
          ],
        },
        {
          label: 'Product experience',
          items: [
            { label: 'Problems & principles', slug: 'spec/01-problem-and-principles' },
            { label: 'Experience & journeys', slug: 'spec/02-product-experience' },
            { label: 'Information architecture', slug: 'spec/03-information-architecture' },
            { label: 'Spaces, Sessions & knowledge', slug: 'spec/03-spaces-sessions-knowledge' },
            { label: 'UI specification', slug: 'spec/04-ui-specification' },
          ],
        },
        {
          label: 'System design',
          items: [
            { label: 'System architecture', slug: 'spec/05-system-architecture' },
            { label: 'Context packs & memory', slug: 'spec/06-projects-context-memory' },
            { label: 'Orchestration & routing', slug: 'spec/07-orchestration-and-routing' },
            { label: 'Tools & computer use', slug: 'spec/08-tools-permissions-computer-use' },
            { label: 'Data model & APIs', slug: 'spec/09-data-model-and-apis' },
            { label: 'Security, privacy & trust', slug: 'spec/10-security-privacy-trust' },
            { label: 'Quality & observability', slug: 'spec/11-quality-evaluation-observability' },
            { label: 'Deployment & operations', slug: 'spec/12-deployment-operations' },
            { label: 'Notifications & attention', slug: 'spec/16-notifications-attention-delivery' },
          ],
        },
        {
          label: 'Delivery',
          items: [
            { label: 'Implementation sequence', slug: 'spec/13-roadmap' },
            { label: 'Decision register', slug: 'spec/14-decision-register' },
            { label: 'Glossary', slug: 'spec/15-glossary' },
            { label: 'Canonical issue plan', slug: 'roadmap/issues' },
            { label: 'Dependency graph', slug: 'roadmap/dependencies' },
          ],
        },
        {
          label: 'Issue briefs',
          collapsed: true,
          items: [{ autogenerate: { directory: 'roadmap/issues' } }],
        },
        {
          label: 'Project',
          items: [
            { label: 'Frontend ADR: SvelteKit', slug: 'decisions/sveltekit-shadcn-svelte' },
            { label: 'Prototype component map', slug: 'prototype/component-map' },
            { label: 'ADR template', slug: 'decisions/adr-template' },
            { label: 'Contributing', slug: 'contributing' },
          ],
        },
      ],
    }),
  ],
});
