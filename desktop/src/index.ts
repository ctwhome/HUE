import { BrowserWindow } from "electrobun/main";
import { resolveHueDesktopOrigin } from "./origin";

const origin = resolveHueDesktopOrigin(process.env.HUE_DESKTOP_ORIGIN);

new BrowserWindow({
  title: "HUE",
  url: origin,
  frame: { width: 1440, height: 900 },
  navigationRules: JSON.stringify(["^*", `${origin}/*`]),
});
