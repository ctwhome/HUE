import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "HUE",
    identifier: "studio.ctw.hue.desktop",
    version: "0.0.1",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/index.ts",
    },
    mac: { bundleCEF: false },
    win: { bundleCEF: false },
    linux: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
