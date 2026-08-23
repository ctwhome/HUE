package studio.ctw.hue;

import android.app.PendingIntent;
import android.app.Notification;
import java.util.LinkedHashMap;
import java.util.Map;

final class NotificationPolicy {
    static final Map<String, String> CHANNELS = channels();
    static final int PENDING_INTENT_FLAGS = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;

    static Payload payload(String channel, String projectId, String sessionId, HueDeepLinkRouter router) {
        if (!CHANNELS.containsKey(channel)) throw new IllegalArgumentException("Unknown notification channel");
        HueDeepLinkRouter.requireId(sessionId);
        if (projectId != null) HueDeepLinkRouter.requireId(projectId);
        return new Payload(
            "completion".equals(channel) ? "HUE completed work" : "HUE needs attention",
            "Open HUE to review.",
            router.sessionUrl(projectId, sessionId)
        );
    }

    static int visibility(String channel) {
        if (!CHANNELS.containsKey(channel)) throw new IllegalArgumentException("Unknown notification channel");
        return "errors".equals(channel) ? Notification.VISIBILITY_SECRET : Notification.VISIBILITY_PRIVATE;
    }

    private static Map<String, String> channels() {
        Map<String, String> channels = new LinkedHashMap<>();
        channels.put("completion", "HUE completion");
        channels.put("attention", "HUE attention");
        channels.put("errors", "HUE errors");
        return Map.copyOf(channels);
    }

    static final class Payload {
        final String title;
        final String body;
        final String url;

        Payload(String title, String body, String url) {
            this.title = title;
            this.body = body;
            this.url = url;
        }
    }
}
