# HUE Desktop

HUE Desktop adds native, inspectable project previews while the existing Bun/SvelteKit server remains the only application authority.

## Local development

Start the complete local development stack:

```bash
make dev
```

This hands the canonical database from production to the development server, waits for `http://127.0.0.1:44010`, then opens Electrobun. Closing the stack stops the development server and restores production. Use `make web-dev` for browser/mobile-only development, or `make desktop` to attach Electrobun to a server that is already running.

The Project browser uses sandboxed Electrobun webviews with native developer tools and cross-origin element selection. Ordinary browsers and mobile devices continue using iframe previews.

## Local releases

Run `make release` from a clean `main` checkout after closing the development stack. It installs dependencies, builds the docs, web server, and stable desktop bundle, replaces `/Applications/HUE.app`, restarts the existing `com.ctw.hue-production` LaunchAgent, waits for port 44011, and opens HUE. The LaunchAgent must already be installed; the installed app defaults to production on port 44011. Development commands explicitly use port 44010.

Each release builds into unique temporary desktop build/artifact directories, so a concurrent ordinary desktop build cannot remove the bundle during installation. Those directories are removed when the release finishes.

`desktop/package.json` is the desktop version source. Commits since the latest reachable `vX.Y.Z` tag determine the next version: `BREAKING CHANGE:` / `BREAKING-CHANGE:` footers or `type!:` headers bump major, `feat` bumps minor, and `fix` / `perf` bump patch. The highest bump wins, including on 0.x. With no tags, all commits are considered against the current version. Other commits rebuild and reinstall without bumping.

After successful installation and server readiness, the command commits the version as `chore(release): vX.Y.Z` and creates a local annotated tag. It never pushes. A failed release restores the previous desktop bundle and uncommitted version; web build output is not rolled back. If tagging fails after the version commit, that commit remains for manual recovery.

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
