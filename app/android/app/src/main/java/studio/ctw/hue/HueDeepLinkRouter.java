package studio.ctw.hue;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

final class HueDeepLinkRouter {
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
    private final URI origin;

    HueDeepLinkRouter(String serverUrl, boolean debug) {
        origin = parseOrigin(serverUrl, debug);
    }

    String rootUrl() {
        return origin.toString() + "/";
    }

    String projectUrl(String projectId) {
        requireId(projectId);
        return rootUrl() + "?project=" + projectId;
    }

    String sessionUrl(String projectId, String sessionId) {
        requireId(sessionId);
        if (projectId == null) return rootUrl() + "?session=" + sessionId;
        requireId(projectId);
        return rootUrl() + "?project=" + projectId + "&session=" + sessionId;
    }

    String quickCaptureUrl() {
        return rootUrl() + "?quick-capture=1";
    }

    String normalize(String candidate) {
        if (candidate == null) return null;
        final URI uri;
        try {
            uri = new URI(candidate);
        } catch (URISyntaxException error) {
            return null;
        }
        if ("hue".equals(uri.getScheme())) return normalizeInternal(uri);
        if (!sameOrigin(uri) || uri.getUserInfo() != null || uri.getFragment() != null) return null;
        if (!(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) return null;
        Map<String, String> query = query(uri.getRawQuery());
        if (query == null) return null;
        if (query.isEmpty()) return rootUrl();
        if (query.size() == 1 && "1".equals(query.get("quick-capture"))) return quickCaptureUrl();
        String project = query.get("project");
        String session = query.get("session");
        if (query.size() == 1 && project != null && validId(project)) return projectUrl(project);
        if (query.size() == 1 && session != null && validId(session)) return sessionUrl(null, session);
        if (query.size() == 2 && project != null && session != null && validId(project) && validId(session)) {
            return sessionUrl(project, session);
        }
        return null;
    }

    static boolean validId(String value) {
        return value != null && ID.matcher(value).matches();
    }

    static void requireId(String value) {
        if (!validId(value)) throw new IllegalArgumentException("Invalid HUE id");
    }

    private String normalizeInternal(URI uri) {
        if (uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null) return null;
        String host = uri.getHost();
        String path = uri.getPath();
        if ("quick-capture".equals(host) && (path.isEmpty() || "/".equals(path)) && uri.getRawQuery() == null) {
            return quickCaptureUrl();
        }
        if (path == null || !path.startsWith("/") || path.indexOf('/', 1) != -1) return null;
        String id = path.substring(1);
        if (!validId(id)) return null;
        Map<String, String> query = query(uri.getRawQuery());
        if (query == null) return null;
        if ("project".equals(host) && query.isEmpty()) return projectUrl(id);
        if ("session".equals(host)) {
            if (query.isEmpty()) return sessionUrl(null, id);
            String project = query.get("project");
            if (query.size() == 1 && validId(project)) return sessionUrl(project, id);
        }
        return null;
    }

    private boolean sameOrigin(URI uri) {
        return origin.getScheme().equals(uri.getScheme())
            && origin.getHost().equalsIgnoreCase(uri.getHost() == null ? "" : uri.getHost())
            && effectivePort(origin) == effectivePort(uri);
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equals(uri.getScheme()) ? 443 : 80;
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> result = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) return result;
        for (String part : raw.split("&", -1)) {
            int separator = part.indexOf('=');
            if (separator <= 0 || separator != part.lastIndexOf('=')) return null;
            String key = part.substring(0, separator);
            String value = part.substring(separator + 1);
            if (!key.matches("[a-z-]+") || !value.matches("[A-Za-z0-9._:-]{1,128}") || result.put(key, value) != null) return null;
        }
        return result;
    }

    private static URI parseOrigin(String value, boolean debug) {
        final URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Invalid HUE server origin", error);
        }
        String scheme = uri.getScheme() == null ? null : uri.getScheme().toLowerCase(Locale.ROOT);
        String authority = uri.getRawAuthority();
        if (authority == null || authority.contains("@") || authority.contains("[") || authority.contains("]")) {
            throw new IllegalArgumentException("HUE server URL must be an origin");
        }
        int port = uri.getPort();
        String rawHost = uri.getHost();
        if (rawHost == null) {
            int separator = authority.lastIndexOf(':');
            rawHost = separator < 0 ? authority : authority.substring(0, separator);
            if (separator >= 0) {
                try {
                    port = Integer.parseInt(authority.substring(separator + 1));
                } catch (NumberFormatException error) {
                    throw new IllegalArgumentException("HUE server URL must be an origin", error);
                }
            }
        }
        String host = normalizeHost(rawHost);
        if (host == null || host.contains(":") || host.contains("%") || port > 65535
            || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
            || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) {
            throw new IllegalArgumentException("HUE server URL must be an origin");
        }
        boolean debugLoopback = debug && "http".equals(scheme)
            && ("10.0.2.2".equals(host) || "127.0.0.1".equals(host) || "localhost".equals(host));
        if (!("https".equals(scheme) || debugLoopback) || invalidHost(host)) {
            throw new IllegalArgumentException("HUE server origin must use HTTPS");
        }
        try {
            return new URI(scheme, null, host, port, null, null, null);
        } catch (URISyntaxException impossible) {
            throw new IllegalArgumentException("Invalid HUE server origin", impossible);
        }
    }

    private static String normalizeHost(String value) {
        if (value == null) return null;
        String host = value.toLowerCase(Locale.ROOT);
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        return host.isEmpty() ? null : host;
    }

    private static boolean invalidHost(String host) {
        return "invalid".equals(host) || host.endsWith(".invalid");
    }
}
