<p align="center">
  <img src="favicon.png" alt="HUE logo" width="180" style="border-radius: 24px;">
  <img src="hermes logo.png" alt="Hermes logo" width="180" style="border-radius: 24px;">
</p>

# HUE - Hermes Unified Environment

> **One flexible interface for AI-assisted work across Projects, Workflows, and Sessions.**

An agent harness is the software layer that connects an AI agent to its models, tools, files, terminal, and approval loop; Hermes can serve as that shared harness instead of requiring separate environments such as OpenCode, Claude Code, or Codex. HUE (Hermes Unified Environment) gives Hermes an interactive web workspace with first-class Projects and Sessions, multi-panel layouts, multiple embedded browsers, Git controls, and access to GitHub issues, milestones, and pull requests.

![Runtime](https://img.shields.io/badge/runtime-Bun-f472b6) ![Hermes](https://img.shields.io/badge/protocol-ACP%20v1-7c3aed)

## What HUE provides

- **Projects** bind Hermes to trusted local working directories.
- **Workflows** save reusable, Project-scoped prompts and launch settings.
- **Sessions** create or resume Hermes conversations with durable message delivery.
- **Workspace panels** place Sessions, files, terminals, repository tools, and web pages side by side.
- **Git and GitHub tools** support common repository commands and show open issues and pull requests; embedded browsers keep milestones and other GitHub pages in the same workspace.
- **Reliable reconnects** preserve complete message envelopes, deduplicate retries, and make uncertain delivery explicit instead of silently repeating a prompt.

HUE owns its local workspace metadata and delivery state. Hermes owns agent execution, tool use, and transcript persistence through ACP; HUE does not write Hermes databases directly or approve permission requests without user action.

## Install and run

Install these prerequisites first:

- [Bun](https://bun.sh/)
- Hermes Agent with ACP v1 support, installed and configured for the current user
- Git
- [GitHub CLI](https://cli.github.com/) authenticated with `gh auth login` for GitHub issue and pull-request panels

From the cloned repository, one command installs the locked dependencies, builds the documentation, and starts HUE:

```bash
make dev
```

Open [http://127.0.0.1:4010](http://127.0.0.1:4010). HUE uses the default Hermes profile; set `HUE_HERMES_PROFILE` before starting it to select another profile.

For a local production build:

```bash
bun install --frozen-lockfile && bun run --cwd app build && HOST=127.0.0.1 PORT=4173 HUE_DATABASE_PATH="$HOME/.hue/hue.db" bun run --cwd app start
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Why HUE should run natively

When Hermes is installed on the computer, run HUE on that same computer as the same user. HUE starts the local `hermes` executable, uses its configured profiles and Sessions, accesses real Project paths, opens local shells, and invokes the host's `git` and `gh` commands.

A Docker container cannot access those resources by default. Making it work would require mounting the Hermes profile, HUE data, repositories, credentials, and shell tooling into the container while keeping host and container paths and permissions aligned. That adds fragile configuration and broadens access to sensitive host data without providing useful isolation, because Hermes and the Projects still live outside the container.

Use a container only when Hermes, HUE, every required repository, and the supporting command-line tools all run inside the same deliberately configured container environment. Do not expose the HUE server directly to an untrusted network.

## Data and configuration

- HUE stores its SQLite database at `~/.hue/hue.db` by default.
- Hermes keeps its own profiles and Session transcripts.
- `HUE_DATABASE_PATH` changes the HUE database location.
- `HUE_HERMES_PROFILE` selects the Hermes profile; the default is `default`.
- `HUE_HERMES_COMMAND` selects a non-standard Hermes executable path.
- `HUE_ACCESS_SECRET` enables authenticated non-loopback browser access; without it, only loopback clients can access HUE data.
- Project folders and Hermes data remain local unless the user configures external services.

Remote access requires HTTPS through a trusted LAN/tailnet proxy and an exact public `ORIGIN`. See [`app/README.md`](app/README.md#authenticated-lan-or-tailnet-access) for setup and security warnings. Never expose HUE directly to the public internet.

## Development

```bash
bun test
bun run --cwd app check
bun run --cwd app build
bun run --cwd app test:e2e
```

The application lives in `app/`. Product documentation and architecture decisions live in `docs/`, and the interactive design reference lives in `prototype/`.

Read the [documentation website](https://ctwhome.github.io/HUE/), [active architecture decision](docs/decisions/0002-bun-hermes-acp-workspace.md), and [contribution guide](CONTRIBUTING.md) for more detail.

## License

An open-source license has not yet been selected. Until one is adopted, this repository is source-visible but does not grant reuse rights by implication.
