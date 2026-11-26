package com.xtechlaboratories.xlibs;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// The page's side of PhoneService: starts and stops it, and passes messages to its worker and back as "message" events.
@CapacitorPlugin(
    name = "XLibsForegroundService",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class ForegroundServicePlugin extends Plugin {

    private final PhoneService.Listener listener = (message) -> {
        JSObject event = new JSObject();
        event.put("message", message);
        notifyListeners("message", event);
    };

    @Override
    public void load() {
        PhoneService.listen(listener);
    }

    @Override
    protected void handleOnDestroy() {
        PhoneService.forget(listener);
    }

    // ========================================================================
    // Calls
    // ========================================================================

    @PluginMethod
    public void start(PluginCall call) {
        // Android 13 and later shows the service's notification only with leave, asked once here.
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "after_notifications");
            return;
        }
        start_now(call);
    }

    @PermissionCallback
    private void after_notifications(PluginCall call) {
        // The service runs either way; without leave its notification is only hidden.
        start_now(call);
    }

    private void start_now(PluginCall call) {
        Context context = getContext();
        PhoneService.preferences(context).edit()
            .putString(PhoneService.TITLE_KEY, call.getString("title", ""))
            .putString(PhoneService.TEXT_KEY, call.getString("text", ""))
            .putString(PhoneService.WORKER_KEY, call.getString("worker", "worker.html"))
            .putBoolean(PhoneService.START_AT_BOOT_KEY, Boolean.TRUE.equals(call.getBoolean("start_at_boot", false)))
            .apply();
        try {
            PhoneService.start(context);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("the service could not start: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        PhoneService.preferences(context).edit().putBoolean(PhoneService.RUNNING_KEY, false).apply();
        context.stopService(new Intent(context, PhoneService.class));
        call.resolve();
    }

    @PluginMethod
    public void get_state(PluginCall call) {
        JSObject state = new JSObject();
        state.put("running", PhoneService.is_running());
        state.put("start_at_boot", PhoneService.preferences(getContext()).getBoolean(PhoneService.START_AT_BOOT_KEY, false));
        call.resolve(state);
    }

    @PluginMethod
    public void post(PluginCall call) {
        String message = call.getString("message");
        if (message == null) {
            call.reject("message is missing");
            return;
        }
        if (!PhoneService.post(message)) {
            call.reject("the service is not running");
            return;
        }
        call.resolve();
    }
}
