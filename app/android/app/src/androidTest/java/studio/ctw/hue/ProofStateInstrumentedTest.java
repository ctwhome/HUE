package studio.ctw.hue;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutManager;
import android.net.Uri;
import android.os.Build;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ProofStateInstrumentedTest {
    private final Context context = ApplicationProvider.getApplicationContext();

    @Test public void seedGenericProofState() throws Exception {
        assumeTrue("seed".equals(argument()));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .executeShellCommand("pm grant studio.ctw.hue android.permission.POST_NOTIFICATIONS")
                    .close();
            } catch (java.io.IOException error) {
                throw new AssertionError(error);
            }
        }
        NativeNotifications.createChannels(context);
        ShortcutService.upsert(context, "project", "project-1", null);
        ShortcutService.upsert(context, "session", "session-1", "project-1");
        NativeNotifications.postDebug(context, "attention", "project-1", "session-1");
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        for (int attempt = 0; attempt < 20 && notifications.getActiveNotifications().length == 0; attempt++) Thread.sleep(100);
        assertEquals(2, context.getSystemService(ShortcutManager.class).getDynamicShortcuts().size());
        assertEquals(1, notifications.getActiveNotifications().length);
    }

    @Test public void clearGenericProofState() {
        assumeTrue("clear".equals(argument()));
        ShortcutService.remove(context, "project");
        ShortcutService.remove(context, "session");
        context.getSystemService(NotificationManager.class).cancelAll();
        assertTrue(context.getSystemService(ShortcutManager.class).getDynamicShortcuts().isEmpty());
    }

    @Test public void quickCaptureWebViewIsDraftOnly() throws Exception {
        assumeTrue("webview".equals(argument()));
        String expected = BuildConfig.HUE_SERVER_URL + "/?quick-capture=1";
        assertLoaded(QuickIdeaWidgetProvider.openIntent(context), expected);
    }

    @Test public void configuredHttpsProjectAndSessionAppLinksLoadHue() throws Exception {
        assumeTrue("https".equals(argument()));
        assertEquals("https", Uri.parse(BuildConfig.HUE_SERVER_URL).getScheme());
        assertLoaded(
            new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.HUE_SERVER_URL + "/?project=project-1"), context, MainActivity.class),
            BuildConfig.HUE_SERVER_URL + "/?project=project-1"
        );
        assertLoaded(
            new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.HUE_SERVER_URL + "/?project=project-1&session=session-1"), context, MainActivity.class),
            BuildConfig.HUE_SERVER_URL + "/?project=project-1&session=session-1"
        );
    }

    private void assertLoaded(Intent intent, String expectedUrl) throws Exception {
        AtomicReference<String> state = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(intent)) {
            assertEquals(expectedUrl, MainActivity.lastSafeLaunchUrl);
            for (int attempt = 0; attempt < 100; attempt++) {
                scenario.onActivity(activity -> {
                    if (expectedUrl.equals(activity.getBridge().getWebView().getUrl())) {
                        activity.getBridge().getWebView().evaluateJavascript(
                            "document.title + '|' + location.href",
                            value -> {
                                state.set(value);
                                evaluated.countDown();
                            }
                        );
                    }
                });
                if (evaluated.await(100, TimeUnit.MILLISECONDS)) break;
            }
        }
        assertTrue("Remote HUE page did not load: " + state.get(), evaluated.getCount() == 0);
        assertTrue(state.get(), state.get().contains("HUE"));
        assertTrue(state.get(), state.get().contains(expectedUrl.replace("&", "\\u0026")) || state.get().contains(expectedUrl));
    }

    private String argument() {
        return InstrumentationRegistry.getArguments().getString("proof", "");
    }
}
