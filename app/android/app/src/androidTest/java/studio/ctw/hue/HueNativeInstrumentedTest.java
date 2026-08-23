package studio.ctw.hue;

import static org.junit.Assert.*;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class HueNativeInstrumentedTest {
    private Context context;

    @Before public void setup() throws Exception {
        context = ApplicationProvider.getApplicationContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        if (device.hasObject(By.text("Add to home screen")) && device.hasObject(By.text("Cancel"))) {
            device.findObject(By.text("Cancel")).click();
        }
        context.getSystemService(NotificationManager.class).cancelAll();
        context.getSystemService(ShortcutManager.class).removeAllDynamicShortcuts();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .executeShellCommand("pm grant studio.ctw.hue android.permission.POST_NOTIFICATIONS")
                .close();
        }
    }

    @Test public void mainActivityRoutesSafeIntentAndRejectsExternalIntent() {
        Intent safe = new Intent(Intent.ACTION_VIEW, Uri.parse("hue://session/session-1?project=project-1"), context, MainActivity.class);
        try (ActivityScenario<MainActivity> ignored = ActivityScenario.launch(safe)) {
            assertEquals(BuildConfig.HUE_SERVER_URL + "/?project=project-1&session=session-1", MainActivity.lastSafeLaunchUrl);
        }
        Intent unsafe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://attacker.example/?session=session-1"), context, MainActivity.class);
        try (ActivityScenario<MainActivity> ignored = ActivityScenario.launch(unsafe)) {
            assertEquals(BuildConfig.HUE_SERVER_URL + "/", MainActivity.lastSafeLaunchUrl);
        }
    }

    @Test public void configuredRemotePageHasHueNativeBridge() throws Exception {
        AtomicReference<String> bridgeResult = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                WebView webView = activity.getBridge().getWebView();
                webView.evaluateJavascript(
                    "JSON.stringify({url:location.origin,plugin:typeof window.Capacitor?.Plugins?.HueNative?.requestPinShortcut})",
                    result -> {
                        bridgeResult.set(result);
                        evaluated.countDown();
                    }
                );
            });
            assertTrue(evaluated.await(30, TimeUnit.SECONDS));
            assertTrue(bridgeResult.get(), bridgeResult.get().contains(Uri.parse(BuildConfig.HUE_SERVER_URL).getHost()));
            assertTrue(bridgeResult.get(), bridgeResult.get().contains("function"));
        }
    }

    @Test public void widgetHostSurfaceClickOpensNonSubmittingQuickCapture() throws Exception {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, QuickIdeaWidgetProvider.class);
        assertNotNull(manager.getInstalledProviders().stream().filter(info -> info.provider.equals(provider)).findFirst().orElse(null));

        AtomicReference<AppWidgetHost> hostRef = new AtomicReference<>();
        AtomicReference<Integer> appWidgetIdRef = new AtomicReference<>();
        AtomicReference<AppWidgetHostView> surfaceRef = new AtomicReference<>();
        ActivityScenario<WidgetHostActivity> scenario = ActivityScenario.launch(WidgetHostActivity.class);
        scenario.onActivity(activity -> {
            AppWidgetHost host = new AppWidgetHost(activity, 86);
            int appWidgetId = host.allocateAppWidgetId();
            assertTrue("Instrumentation setup must grant appwidget bind", manager.bindAppWidgetIdIfAllowed(appWidgetId, provider));
            host.startListening();
            AppWidgetHostView surface = host.createView(activity, appWidgetId, manager.getAppWidgetInfo(appWidgetId));
            hostRef.set(host);
            appWidgetIdRef.set(appWidgetId);
            surfaceRef.set(surface);
            activity.setContentView(surface);
        });
        new QuickIdeaWidgetProvider().onUpdate(context, manager, new int[] { appWidgetIdRef.get() });
        AtomicReference<Boolean> clickReady = new AtomicReference<>(false);
        for (int attempt = 0; attempt < 50 && !clickReady.get(); attempt++) {
            scenario.onActivity(activity -> clickReady.set(
                surfaceRef.get().findViewById(R.id.quick_idea_widget).hasOnClickListeners()
            ));
            if (!clickReady.get()) Thread.sleep(100);
        }
        assertTrue("Rendered widget surface never received PendingIntent", clickReady.get());
        scenario.onActivity(activity -> assertTrue(surfaceRef.get().findViewById(R.id.quick_idea_widget).performClick()));
        String expectedQuickCapture = BuildConfig.HUE_SERVER_URL + "/?quick-capture=1";
        for (int attempt = 0; attempt < 100 && !expectedQuickCapture.equals(MainActivity.lastSafeLaunchUrl); attempt++) {
            Thread.sleep(100);
        }
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        assertTrue(device.wait(Until.hasObject(By.pkg("studio.ctw.hue")), 10_000));
        assertEquals(expectedQuickCapture, MainActivity.lastSafeLaunchUrl);
        device.pressBack();
        scenario.close();
        hostRef.get().stopListening();
        hostRef.get().deleteAppWidgetId(appWidgetIdRef.get());
    }

    @Test public void dynamicShortcutsUpsertAndRemoveOnePerKind() {
        ShortcutService.upsert(context, "project", "project-1", null);
        ShortcutService.upsert(context, "session", "session-1", "project-1");
        List<android.content.pm.ShortcutInfo> shortcuts = context.getSystemService(ShortcutManager.class).getDynamicShortcuts();
        assertEquals(2, shortcuts.size());
        assertTrue(shortcuts.stream().anyMatch(s -> s.getShortLabel().toString().equals("HUE Project")));
        assertTrue(shortcuts.stream().anyMatch(s -> s.getShortLabel().toString().equals("HUE Session")));
        Uri configured = Uri.parse(BuildConfig.HUE_SERVER_URL);
        assertTrue(shortcuts.stream().allMatch(s -> {
            Uri data = s.getIntent().getData();
            return configured.getScheme().equals(data.getScheme()) && configured.getAuthority().equals(data.getAuthority());
        }));
        ShortcutService.remove(context, "project");
        ShortcutService.remove(context, "session");
        assertTrue(context.getSystemService(ShortcutManager.class).getDynamicShortcuts().isEmpty());
    }

    @Test public void explicitPinRequestUsesGenericShortcutAndRemovalDisablesPinnedId() throws Exception {
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        assertTrue(manager.isRequestPinShortcutSupported());
        assertTrue(ShortcutService.requestPin(context, "project", "private-project-id", null));

        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        if (device.wait(Until.hasObject(By.text("Add to home screen")), 10_000)) {
            device.findObject(By.text("Add to home screen")).click();
        }
        for (int attempt = 0; attempt < 50 && manager.getPinnedShortcuts().isEmpty(); attempt++) Thread.sleep(100);
        ShortcutInfo pinned = manager.getPinnedShortcuts().stream()
            .filter(shortcut -> shortcut.getId().startsWith("hue-project-"))
            .findFirst()
            .orElseThrow();
        assertEquals("HUE Project", pinned.getShortLabel().toString());
        assertFalse(pinned.getId().contains("private-project-id"));

        ShortcutService.removeStale(context, null, null);
        ShortcutInfo disabled = manager.getPinnedShortcuts().stream()
            .filter(shortcut -> shortcut.getId().equals(pinned.getId()))
            .findFirst()
            .orElseThrow();
        assertFalse(disabled.isEnabled());
    }

    @Test public void notificationChannelsAndDebugPayloadStayGenericAndOpenExactSession() throws Exception {
        NativeNotifications.createChannels(context);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        for (String id : NotificationPolicy.CHANNELS.keySet()) {
            NotificationChannel channel = manager.getNotificationChannel(id);
            assertNotNull(channel);
            assertTrue(NotificationPolicy.visibility(id) == Notification.VISIBILITY_PRIVATE || NotificationPolicy.visibility(id) == Notification.VISIBILITY_SECRET);
        }
        int notificationId = NativeNotifications.postDebug(context, "attention", "project-1", "session-1");
        for (int attempt = 0; attempt < 20 && manager.getActiveNotifications().length == 0; attempt++) Thread.sleep(100);
        Notification posted = manager.getActiveNotifications()[0].getNotification();
        assertEquals("HUE needs attention", posted.extras.getString(Notification.EXTRA_TITLE));
        assertEquals("Open HUE to review.", posted.extras.getString(Notification.EXTRA_TEXT));
        assertEquals(Notification.VISIBILITY_PRIVATE, posted.visibility);
        assertFalse(posted.extras.toString().contains("project-1"));
        assertFalse(posted.extras.toString().contains("session-1"));
        posted.contentIntent.send();
        Thread.sleep(300);
        assertEquals(BuildConfig.HUE_SERVER_URL + "/?project=project-1&session=session-1", MainActivity.lastSafeLaunchUrl);
        manager.cancel(notificationId);
    }
}
