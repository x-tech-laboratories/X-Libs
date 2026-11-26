package com.xtechlaboratories.xlibs;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Starts the phone service again once the phone has booted, if the app asked for that and it was running.
public class PhoneServiceBoot extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        if (!PhoneService.preferences(context).getBoolean(PhoneService.START_AT_BOOT_KEY, false)) return;
        if (!PhoneService.preferences(context).getBoolean(PhoneService.RUNNING_KEY, false)) return;
        PhoneService.start(context);
    }
}
