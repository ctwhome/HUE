package studio.ctw.hue;

import static org.junit.Assert.*;

import org.junit.Test;

public class HueDeepLinkRouterTest {
    private final HueDeepLinkRouter router = new HueDeepLinkRouter("https://hue.example", false);

    @Test public void acceptsOnlyKnownSameOriginWebContracts() {
        assertEquals("https://hue.example/?project=project-1", route("https://hue.example/?project=project-1"));
        assertEquals("https://hue.example/?project=project-1&session=session-1", route("https://hue.example/?session=session-1&project=project-1"));
        assertEquals("https://hue.example/?session=session-1", route("https://hue.example/?session=session-1"));
        assertEquals("https://hue.example/?quick-capture=1", route("https://hue.example/?quick-capture=1"));
    }

    @Test public void normalizesInternalIntentsToConfiguredOrigin() {
        assertEquals("https://hue.example/?project=project-1", route("hue://project/project-1"));
        assertEquals("https://hue.example/?project=project-1&session=session-1", route("hue://session/session-1?project=project-1"));
        assertEquals("https://hue.example/?quick-capture=1", route("hue://quick-capture"));
    }

    @Test public void rejectsExternalMalformedOrAuthorityBearingLinks() {
        String[] rejected = {
            "https://attacker.example/?session=session-1",
            "javascript:alert(1)", "file:///private", "content://secrets/1",
            "https://hue.example/path", "https://hue.example/?project=bad%2Fid",
            "https://hue.example/?project=p&action=approve", "hue://approve/session-1",
            "hue://session/session-1?project=p&answer=yes", "http://["
        };
        for (String value : rejected) assertNull(value, router.normalize(value));
    }

    @Test public void releaseRequiresRealHttpsOriginAndDebugHttpIsLoopbackOnly() {
        assertThrows(IllegalArgumentException.class, () -> new HueDeepLinkRouter("http://hue.example", false));
        assertThrows(IllegalArgumentException.class, () -> new HueDeepLinkRouter("https://hue.invalid", false));
        assertThrows(IllegalArgumentException.class, () -> new HueDeepLinkRouter("https://HUE.INVALID.", false));
        assertThrows(IllegalArgumentException.class, () -> new HueDeepLinkRouter("https://hue.invalid...", false));
        assertThrows(IllegalArgumentException.class, () -> new HueDeepLinkRouter("http://lan.example:4173", true));
        assertEquals("http://10.0.2.2:4173/", new HueDeepLinkRouter("http://10.0.2.2:4173", true).rootUrl());
        assertEquals("https://hue.example/", new HueDeepLinkRouter("https://HUE.Example...", false).rootUrl());
    }

    private String route(String value) {
        return router.normalize(value);
    }
}
