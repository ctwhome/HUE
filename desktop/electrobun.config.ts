import type { ElectrobunConfig } from "electrobun";
import { version } from "./package.json";

export default {
  app: {
    name: "HUE",
    identifier: "studio.ctw.hue.desktop",
    version,
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
