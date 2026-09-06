const DEFAULT_ORIGIN = "http://127.0.0.1:44010";

export function resolveHueDesktopOrigin(value = DEFAULT_ORIGIN) {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      (!localHttp && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "HUE_DESKTOP_ORIGIN must be a loopback HTTP origin or an authenticated HTTPS origin",
    );
  }
}
