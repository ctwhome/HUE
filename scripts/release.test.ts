import { expect, test } from "bun:test";
import { nextVersion } from "./release";

test("release output is isolated from ordinary desktop builds", () => {
  const result = Bun.spawnSync([process.execPath, "-e", 'import config from "./desktop/electrobun.config.ts"; console.log(JSON.stringify(config.build))'], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, HUE_RELEASE_BUILD_ID: "test-release" },
  });
  expect(result.exitCode).toBe(0);
  const build = JSON.parse(result.stdout.toString());
  expect(build.buildFolder).toBe("build/test-release");
  expect(build.artifactFolder).toBe("artifacts/test-release");
});

test("release versions follow the highest Conventional Commit bump", () => {
  expect(nextVersion("0.0.1", ["docs: update", "chore: cleanup"])).toBe("0.0.1");
  expect(nextVersion("1.2.3", ["fix(ui): repair focus", "perf: reduce work"])).toBe("1.2.4");
  expect(nextVersion("0.0.1", ["fix: repair", "feat(ui): add previews"])).toBe("0.1.0");
  expect(nextVersion("0.2.3", ["refactor!: remove old API"])).toBe("1.0.0");
  expect(nextVersion("1.2.3", ["feat: new API\n\nBREAKING CHANGE: remove old API"])).toBe("2.0.0");
  expect(nextVersion("1.2.3", ["chore: update\n\nBREAKING-CHANGE: new format"])).toBe("2.0.0");
  expect(nextVersion("1.2.3", ["docs: examples\n\nfeat: example only"])).toBe("1.2.3");
  expect(nextVersion("1.2.3", [])).toBe("1.2.3");
  expect(() => nextVersion("invalid", [])).toThrow();
});
