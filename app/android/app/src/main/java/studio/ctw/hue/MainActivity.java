package studio.ctw.hue;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static volatile String lastSafeLaunchUrl;
    private HueDeepLinkRouter router;

    @Override public void onCreate(Bundle savedInstanceState) {
        router = new HueDeepLinkRouter(BuildConfig.HUE_SERVER_URL, BuildConfig.DEBUG);
        registerPlugin(HueNativePlugin.class);
        super.onCreate(savedInstanceState);
        NativeNotifications.createChannels(this);
        lastSafeLaunchUrl = router.rootUrl();
        if (getIntent() != null && getIntent().getData() != null) route(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        route(intent);
    }

    private void route(Intent intent) {
        String target = intent == null || intent.getData() == null ? null : router.normalize(intent.getDataString());
        if (target == null) target = router.rootUrl();
        lastSafeLaunchUrl = target;
        if (!target.equals(router.rootUrl())) bridge.getWebView().loadUrl(target);
    }
}
