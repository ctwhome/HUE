package studio.ctw.hue;

import static org.junit.Assert.*;

import android.app.PendingIntent;
import android.app.Notification;
import java.util.Set;
import org.junit.Test;

public class NotificationPolicyTest {
    @Test public void channelsAreFixedAndGeneric() {
        assertEquals(Set.of("completion", "attention", "errors"), NotificationPolicy.CHANNELS.keySet());
        assertEquals("HUE completion", NotificationPolicy.CHANNELS.get("completion"));
        assertEquals("HUE attention", NotificationPolicy.CHANNELS.get("attention"));
        assertEquals("HUE errors", NotificationPolicy.CHANNELS.get("errors"));
        assertEquals(Notification.VISIBILITY_PRIVATE, NotificationPolicy.visibility("completion"));
        assertEquals(Notification.VISIBILITY_PRIVATE, NotificationPolicy.visibility("attention"));
        assertEquals(Notification.VISIBILITY_SECRET, NotificationPolicy.visibility("errors"));
    }

    @Test public void payloadIsGenericRedactedAndRoutesToExactSession() {
        NotificationPolicy.Payload payload = NotificationPolicy.payload("errors", "project-private", "session-private", new HueDeepLinkRouter("https://hue.example", false));
        assertEquals("HUE needs attention", payload.title);
        assertEquals("Open HUE to review.", payload.body);
        assertEquals("https://hue.example/?project=project-private&session=session-private", payload.url);
        assertFalse((payload.title + payload.body).contains("private"));
        assertEquals(PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT, NotificationPolicy.PENDING_INTENT_FLAGS);
    }

    @Test public void payloadRejectsUnknownChannelsAndInvalidIds() {
        HueDeepLinkRouter router = new HueDeepLinkRouter("https://hue.example", false);
        assertThrows(IllegalArgumentException.class, () -> NotificationPolicy.payload("other", "p", "s", router));
        assertThrows(IllegalArgumentException.class, () -> NotificationPolicy.payload("completion", "p", "bad/id", router));
    }
}
