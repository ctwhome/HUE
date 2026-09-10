import { expect, test } from "bun:test";
import { resolveHueDesktopOrigin } from "./origin";

test("desktop accepts local HTTP and remote HTTPS HUE origins", () => {
  expect(resolveHueDesktopOrigin()).toBe("http://127.0.0.1:44011");
  expect(resolveHueDesktopOrigin("http://localhost:44010/")).toBe(
    "http://localhost:44010",
  );
  expect(resolveHueDesktopOrigin("https://hue.example.ts.net")).toBe(
    "https://hue.example.ts.net",
  );
});

test("desktop rejects insecure remote and non-origin URLs", () => {
  for (const value of [
    "http://192.168.1.20:44011",
    "https://user:secret@hue.example.ts.net",
    "https://hue.example.ts.net/workspace",
    "file:///tmp/hue.html",
  ]) {
    expect(() => resolveHueDesktopOrigin(value)).toThrow("HUE_DESKTOP_ORIGIN");
  }
});
