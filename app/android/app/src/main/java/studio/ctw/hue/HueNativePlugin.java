package studio.ctw.hue;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HueNative")
public class HueNativePlugin extends Plugin {
    @PluginMethod public void upsertShortcut(PluginCall call) {
        try {
            ShortcutService.upsert(getContext(), call.getString("kind"), call.getString("id"), call.getString("projectId"));
            call.resolve();
        } catch (RuntimeException error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod public void requestPinShortcut(PluginCall call) {
        try {
            boolean accepted = ShortcutService.requestPin(getContext(), call.getString("kind"), call.getString("id"), call.getString("projectId"));
            JSObject result = new JSObject();
            result.put("accepted", accepted);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod public void removeShortcut(PluginCall call) {
        try {
            ShortcutService.remove(getContext(), call.getString("kind"));
            call.resolve();
        } catch (RuntimeException error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod public void removeStaleShortcuts(PluginCall call) {
        try {
            ShortcutService.removeStale(getContext(), call.getString("projectId"), call.getString("sessionId"));
            call.resolve();
        } catch (RuntimeException error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod public void createNotificationChannels(PluginCall call) {
        NativeNotifications.createChannels(getContext());
        call.resolve();
    }

    @PluginMethod public void postTestNotification(PluginCall call) {
        try {
            int id = NativeNotifications.postDebug(
                getContext(),
                call.getString("channel"),
                call.getString("projectId"),
                call.getString("sessionId")
            );
            JSObject result = new JSObject();
            result.put("id", id);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject(error.getMessage());
        }
    }
}
