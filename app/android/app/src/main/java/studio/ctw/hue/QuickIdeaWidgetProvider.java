package studio.ctw.hue;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

public class QuickIdeaWidgetProvider extends AppWidgetProvider {
    static final String DEBUG_UPDATE_ACTION = "studio.ctw.hue.DEBUG_UPDATE_QUICK_IDEA_WIDGET";

    @Override public void onReceive(Context context, Intent intent) {
        if (BuildConfig.DEBUG && DEBUG_UPDATE_ACTION.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            onUpdate(context, manager, manager.getAppWidgetIds(new ComponentName(context, getClass())));
            return;
        }
        super.onReceive(context, intent);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.quick_idea_widget);
            views.setOnClickPendingIntent(R.id.quick_idea_widget, openPendingIntent(context));
            manager.updateAppWidget(id, views);
        }
    }

    static Intent openIntent(Context context) {
        String url = new HueDeepLinkRouter(BuildConfig.HUE_SERVER_URL, BuildConfig.DEBUG).quickCaptureUrl();
        return new Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
    }

    static PendingIntent openPendingIntent(Context context) {
        return PendingIntent.getActivity(context, 8600, openIntent(context), NotificationPolicy.PENDING_INTENT_FLAGS);
    }
}
