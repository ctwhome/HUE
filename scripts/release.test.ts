import { expect, test } from "bun:test";
import { nextVersion } from "./release";

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
