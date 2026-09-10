# HUE Desktop

HUE Desktop adds native, inspectable project previews while the existing Bun/SvelteKit server remains the only application authority.

## Local development

Start the complete local development stack:

```bash
make dev
```

This hands the canonical database from production to the development server, waits for `http://127.0.0.1:44010`, then opens Electrobun. Closing the stack stops the development server and restores production. Use `make web-dev` for browser/mobile-only development, or `make desktop` to attach Electrobun to a server that is already running.

The Project browser uses sandboxed Electrobun webviews with native developer tools and cross-origin element selection. Ordinary browsers and mobile devices continue using iframe previews.

## Remote HUE server

The shell may load an existing HUE deployment over authenticated HTTPS:

```bash
HUE_DESKTOP_ORIGIN=https://hue.example.ts.net bun run --cwd desktop dev
```

Sign in with the server's `HUE_ACCESS_SECRET`. Plain remote HTTP origins are rejected. The shell grants no authentication bypass and allows its main view to navigate only within the configured HUE origin.

Preview addresses are resolved by the computer running HUE Desktop. To inspect a development server running on another computer, forward that port first:

```bash
ssh -N -L 5173:127.0.0.1:5173 user@development-computer
```

Then open `http://127.0.0.1:5173` in the Project browser. The SSH connection may run over Tailscale. Alternatively, expose the development server only on a trusted Tailnet address and open that address directly. Do not expose HUE or development servers directly to the public internet.

HUE does not proxy preview traffic, stream native webviews, or remotely control another computer's inspector.
