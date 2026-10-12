package app.rezka.tv;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;

final class DeviceProfile {
    private DeviceProfile() {}
    static boolean isTV(Context context) {
        // Local visual tests use a standard emulator. This debug-only override
        // lets it exercise the unchanged TV interface without changing hardware.
        if(context instanceof Activity activity && (context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0 && activity.getIntent().hasExtra("tvLayout"))return activity.getIntent().getBooleanExtra("tvLayout",false);
        UiModeManager modes=(UiModeManager)context.getSystemService(Context.UI_MODE_SERVICE);
        return modes!=null&&modes.getCurrentModeType()==Configuration.UI_MODE_TYPE_TELEVISION || context.getPackageManager().hasSystemFeature("android.software.leanback");
    }
    static void configureOrientation(Activity activity) {
        activity.setRequestedOrientation(isTV(activity)?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
    }
}
