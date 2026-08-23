package studio.ctw.hue;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.RequiresApi;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class ShortcutService {
    static void upsert(Context context, String kind, String id, String projectId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) throw unsupported();
        ShortcutInfo shortcut = shortcut(context, kind, id, projectId);
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        reenable(manager, shortcut.getId());
        List<ShortcutInfo> next = new ArrayList<>();
        String prefix = "hue-" + kind + "-";
        String otherPrefix = "project".equals(kind) ? "hue-session-" : "hue-project-";
        for (ShortcutInfo current : manager.getDynamicShortcuts()) {
            if (current.getId().startsWith(otherPrefix) && next.isEmpty()) next.add(current);
        }
        next.add(shortcut);
        if (!manager.setDynamicShortcuts(next)) throw new IllegalStateException("Unable to update HUE shortcuts");
    }

    static boolean requestPin(Context context, String kind, String id, String projectId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) throw new UnsupportedOperationException("Pinned shortcuts require Android 8 or newer");
        ShortcutInfo shortcut = shortcut(context, kind, id, projectId);
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        if (!manager.isRequestPinShortcutSupported()) return false;
        reenable(manager, shortcut.getId());
        return manager.requestPinShortcut(shortcut, null);
    }

    static void remove(Context context, String kind) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) throw unsupported();
        ShortcutPolicy.label(kind);
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        String prefix = "hue-" + kind + "-";
        Set<String> ids = matching(manager, shortcut -> shortcut.getId().startsWith(prefix));
        disableAndRemove(manager, ids);
    }

    static void removeStale(Context context, String projectId, String sessionId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) throw unsupported();
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        List<String> keep = new ArrayList<>();
        if (projectId != null) keep.add(ShortcutPolicy.stableId("project", projectId));
        if (sessionId != null) keep.add(ShortcutPolicy.stableId("session", sessionId));
        Set<String> stale = matching(manager, shortcut -> {
            String id = shortcut.getId();
            return (id.startsWith("hue-project-") || id.startsWith("hue-session-")) && !keep.contains(id);
        });
        disableAndRemove(manager, stale);
    }

    @RequiresApi(Build.VERSION_CODES.N_MR1)
    private static ShortcutInfo shortcut(Context context, String kind, String id, String projectId) {
        String stableId = ShortcutPolicy.stableId(kind, id);
        HueDeepLinkRouter router = new HueDeepLinkRouter(BuildConfig.HUE_SERVER_URL, BuildConfig.DEBUG);
        String url = "project".equals(kind) ? router.projectUrl(id) : router.sessionUrl(projectId, id);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return new ShortcutInfo.Builder(context, stableId)
            .setShortLabel(ShortcutPolicy.label(kind))
            .setLongLabel(ShortcutPolicy.label(kind))
            .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
            .setIntent(intent)
            .build();
    }

    @RequiresApi(Build.VERSION_CODES.N_MR1)
    private static Set<String> matching(ShortcutManager manager, java.util.function.Predicate<ShortcutInfo> predicate) {
        Set<String> ids = new LinkedHashSet<>();
        for (ShortcutInfo shortcut : manager.getDynamicShortcuts()) if (predicate.test(shortcut)) ids.add(shortcut.getId());
        for (ShortcutInfo shortcut : manager.getPinnedShortcuts()) if (predicate.test(shortcut)) ids.add(shortcut.getId());
        return ids;
    }

    @RequiresApi(Build.VERSION_CODES.N_MR1)
    private static void disableAndRemove(ShortcutManager manager, Set<String> ids) {
        if (ids.isEmpty()) return;
        List<String> list = List.copyOf(ids);
        manager.removeDynamicShortcuts(list);
        manager.disableShortcuts(list, "No longer available in HUE");
    }

    @RequiresApi(Build.VERSION_CODES.N_MR1)
    private static void reenable(ShortcutManager manager, String id) {
        if (manager.getPinnedShortcuts().stream().anyMatch(shortcut -> id.equals(shortcut.getId()) && !shortcut.isEnabled())) {
            manager.enableShortcuts(List.of(id));
        }
    }

    private static UnsupportedOperationException unsupported() {
        return new UnsupportedOperationException("Dynamic shortcuts require Android 7.1 or newer");
    }
}
