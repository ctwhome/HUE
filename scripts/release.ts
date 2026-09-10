import { existsSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function nextVersion(version: string, messages: string[]) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  let bump = 0;
  for (const message of messages) {
    const header = message.split("\n", 1)[0];
    if (/^[a-z]+(?:\([^\n]+\))?!: /.test(header) || /^BREAKING[ -]CHANGE: /m.test(message)) bump = 3;
    else if (/^feat(?:\([^\n]+\))?: /.test(header)) bump = Math.max(bump, 2);
    else if (/^(fix|perf)(?:\([^\n]+\))?: /.test(header)) bump = Math.max(bump, 1);
  }
  const [major, minor, patch] = version.split(".").map(Number);
  return bump === 3 ? `${major + 1}.0.0` : bump === 2 ? `${major}.${minor + 1}.0` : bump === 1 ? `${major}.${minor}.${patch + 1}` : version;
}

async function release() {
  process.chdir(resolve(import.meta.dir, ".."));
  const run = (...cmd: string[]) => {
    const result = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
    if (result.exitCode !== 0) throw new Error(`Command failed: ${cmd.join(" ")}`);
  };
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { stderr: "inherit" });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
    return result.stdout.toString().trim();
  };
  if (process.platform !== "darwin") throw new Error("Local releases require macOS.");
  if (git("branch", "--show-current") !== "main") throw new Error("Release from main.");
  if (git("status", "--porcelain")) throw new Error("Commit or stash changes before releasing.");
  git("diff");
  console.log(git("log", "--oneline", "-10"));
  const plist = `${homedir()}/Library/LaunchAgents/com.ctw.hue-production.plist`;
  if (!existsSync(plist)) throw new Error(`Production LaunchAgent is missing: ${plist}`);
  const dev = Bun.spawnSync(["lsof", "-tiTCP:44010", "-sTCP:LISTEN"]);
  if (dev.exitCode === 0) throw new Error("Close make dev / make web-dev before releasing so production can own the database.");

  const file = Bun.file("desktop/package.json");
  const original = await file.text();
  const originalLock = await Bun.file("bun.lock").text();
  const pkg = JSON.parse(original);
  const tag = git("tag", "--merged", "HEAD", "--list", "v*", "--sort=-version:refname")
    .split("\n").find((value) => /^v\d+\.\d+\.\d+$/.test(value));
  if (tag && tag.slice(1) !== pkg.version) throw new Error("Desktop version does not match the latest release tag.");
  const messages = git("log", "--format=%B%x00", tag ? `${tag}..HEAD` : "HEAD").split("\0").map((value) => value.trim()).filter(Boolean);
  const version = nextVersion(pkg.version, messages);
  const newRelease = !tag || version !== pkg.version;
  if (newRelease && git("tag", "--list", `v${version}`)) throw new Error(`Tag v${version} already exists.`);
  console.log(`Local release: ${pkg.version} → ${version}${newRelease ? "" : " (reinstall; no version bump)"}`);

  const destination = "/Applications/HUE.app";
  const staged = `/Applications/.HUE-release-${process.pid}.app`;
  const backup = `/Applications/.HUE-previous-${process.pid}.app`;
  let installed = false;
  let committed = false;
  try {
    await Bun.write(file, JSON.stringify({ ...pkg, version }, null, 2) + "\n");
    run("bun", "install", "--lockfile-only", "--ignore-scripts");
    run("make", "build");
    run("bun", "run", "--cwd", "desktop", "build");
    const bundle = `desktop/build/stable-macos-${process.arch}/HUE.app`;
    if (!existsSync(bundle)) throw new Error(`Desktop build missing: ${bundle}`);
    run("ditto", bundle, staged);
    // Ask the existing app to quit before replacing its bundle.
    run("osascript", "-e", 'tell application "System Events" to if exists process "HUE" then tell application "HUE" to quit');
    if (existsSync(destination)) renameSync(destination, backup);
    renameSync(staged, destination);
    installed = true;
    run("make", "restart-production");
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:44011/", { signal: AbortSignal.timeout(1000), redirect: "manual" });
        await response.body?.cancel();
        if (response.status < 400 || response.status === 401) { ready = true; break; }
      } catch { /* Server is still starting. */ }
      await Bun.sleep(200);
    }
    if (!ready) throw new Error("Production did not become ready on port 44011.");
    run("open", destination);
    if (newRelease) {
      run("git", "add", "--", "desktop/package.json", "bun.lock");
      // The initial baseline may already carry the chosen version.
      if (git("diff", "--cached", "--name-only")) {
        run("git", "commit", "-m", `chore(release): v${version}`);
        committed = true;
      }
      run("git", "tag", "-a", `v${version}`, "-m", `HUE v${version}`);
    }
    rmSync(backup, { recursive: true, force: true });
    console.log(`HUE ${version} installed and production restarted. No changes pushed.`);
  } catch (error) {
    if (!committed) {
      await Bun.write(file, original);
      await Bun.write("bun.lock", originalLock);
      run("git", "restore", "--staged", "--", "desktop/package.json", "bun.lock");
    }
    if (installed) rmSync(destination, { recursive: true, force: true });
    if (existsSync(backup)) renameSync(backup, destination);
    throw error;
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

if (import.meta.main) await release();
