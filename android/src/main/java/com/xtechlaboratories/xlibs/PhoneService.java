package com.xtechlaboratories.xlibs;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArraySet;

// An X-app's work that must go on while the app is closed, run in a foreground service with a notification that says so.
// The work is a page of the app's own, the worker, loaded in a WebView the service owns, so it outlives the app's window;
// the app's page and the worker pass each other text messages through XLibsForegroundService.
public class PhoneService extends Service {

    // ========================================================================
    // Settings kept for the next start
    // ========================================================================

    static final String PREFERENCES_NAME = "x_libs_phone_service";
    static final String TITLE_KEY = "title";
    static final String TEXT_KEY = "text";
    static final String WORKER_KEY = "worker";
    static final String START_AT_BOOT_KEY = "start_at_boot";
    static final String RUNNING_KEY = "running";

    private static final String CHANNEL_ID = "x_libs_phone_service";
    private static final int NOTIFICATION_ID = 0x5843;

    // The worker's files are the app's own page files, which Capacitor keeps under assets/public.
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ASSET_PREFIX = "https://" + ASSET_HOST + "/";

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    // Starts the service with the settings kept last, such as after the phone boots.
    static void start(Context context) {
        Intent intent = new Intent(context, PhoneService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    // ========================================================================
    // Messages to and from the worker
    // ========================================================================

    interface Listener {
        void on_message(String message);
    }

    private static final CopyOnWriteArraySet<Listener> listeners = new CopyOnWriteArraySet<>();
    private static PhoneService running;

    static void listen(Listener listener) {
        listeners.add(listener);
    }

    static void forget(Listener listener) {
        listeners.remove(listener);
    }

    static boolean is_running() {
        return running != null;
    }

    // Hands a message to the worker; false while the service is stopped.
    static boolean post(String message) {
        PhoneService service = running;
        if (service == null) return false;
        service.main.post(() -> service.deliver(message));
        return true;
    }

    // What the worker's page reaches as window.XLibsWorkerHost.
    private static final class WorkerHost {
        @JavascriptInterface
        public void post(String message) {
            for (Listener listener : listeners) listener.on_message(message);
        }
    }

    // ========================================================================
    // Service
    // ========================================================================

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView worker;
    private boolean worker_ready = false;
    private final List<String> waiting = new ArrayList<>();

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int start_id) {
        SharedPreferences settings = preferences(this);
        Notification notification = notification(settings.getString(TITLE_KEY, ""), settings.getString(TEXT_KEY, ""));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        settings.edit().putBoolean(RUNNING_KEY, true).apply();
        running = this;
        if (worker == null) open_worker(settings.getString(WORKER_KEY, "worker.html"));
        // Android starts the service again after it is killed, with the settings kept.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = null;
        if (worker != null) {
            worker.destroy();
            worker = null;
        }
        super.onDestroy();
    }

    // ========================================================================
    // Notification
    // ========================================================================

    private Notification notification(String title, String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, title.isEmpty() ? "Running" : title, NotificationManager.IMPORTANCE_MIN);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        builder.setContentTitle(title).setContentText(text).setSmallIcon(getApplicationInfo().icon).setOngoing(true);
        // A tap opens the app.
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) builder.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
        return builder.build();
    }

    // ========================================================================
    // Worker
    // ========================================================================

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void open_worker(String page) {
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        worker = new WebView(this);
        worker.getSettings().setJavaScriptEnabled(true);
        worker.getSettings().setDomStorageEnabled(true);
        worker.addJavascriptInterface(new WorkerHost(), "XLibsWorkerHost");
        worker.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                // The page files sit under public/ in the assets.
                if (ASSET_HOST.equals(url.getHost())) return loader.shouldInterceptRequest(Uri.parse(ASSET_PREFIX + "public" + url.getPath()));
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                worker_ready = true;
                for (String message : waiting) deliver(message);
                waiting.clear();
            }
        });
        // A WebView never shown on screen still runs its timers once told to.
        worker.resumeTimers();
        worker.onResume();
        worker.loadUrl(ASSET_PREFIX + page.replaceFirst("^/+", ""));
    }

    private void deliver(String message) {
        if (worker == null) return;
        if (!worker_ready) {
            waiting.add(message);
            return;
        }
        worker.evaluateJavascript("window.x_libs_worker_receive && window.x_libs_worker_receive(" + JSONObject.quote(message) + ")", null);
    }
}
