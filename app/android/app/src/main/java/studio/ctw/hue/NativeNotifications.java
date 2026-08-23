package studio.ctw.hue;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import java.util.concurrent.atomic.AtomicInteger;

final class NativeNotifications {
    private static final AtomicInteger NEXT_ID = new AtomicInteger(8600);

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        create(manager, "completion", NotificationManager.IMPORTANCE_DEFAULT);
        create(manager, "attention", NotificationManager.IMPORTANCE_HIGH);
        create(manager, "errors", NotificationManager.IMPORTANCE_HIGH);
    }

    static int postDebug(Context context, String channel, String projectId, String sessionId) {
        if (!BuildConfig.DEBUG) throw new SecurityException("Test notifications are debug-only");
        HueDeepLinkRouter router = new HueDeepLinkRouter(BuildConfig.HUE_SERVER_URL, true);
        NotificationPolicy.Payload payload = NotificationPolicy.payload(channel, projectId, sessionId, router);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(payload.url), context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            payload.url.hashCode(),
            open,
            NotificationPolicy.PENDING_INTENT_FLAGS
        );
        Notification notification = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_quick_idea)
            .setContentTitle(payload.title)
            .setContentText(payload.body)
            .setVisibility(NotificationPolicy.visibility(channel))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build();
        int id = NEXT_ID.incrementAndGet();
        context.getSystemService(NotificationManager.class).notify(id, notification);
        return id;
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private static void create(NotificationManager manager, String id, int importance) {
        NotificationChannel channel = new NotificationChannel(id, NotificationPolicy.CHANNELS.get(id), importance);
        channel.setDescription("Generic HUE notifications");
        channel.setLockscreenVisibility(NotificationPolicy.visibility(id));
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
}
