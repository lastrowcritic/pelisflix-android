package app.rezka.tv;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.content.Intent;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(RezkaTVPlugin.class);
        registerPlugin(PelisflixSyncPlugin.class);
        super.onCreate(state);
        DeviceProfile.configureOrientation(this);
        bridge.getWebView().getSettings().setUserAgentString(bridge.getWebView().getSettings().getUserAgentString()+ (DeviceProfile.isTV(this)?" RezkaDeviceTV":" RezkaDeviceTouch"));
        // CSS already scales with the TV viewport. Applying the system font
        // multiplier again inflates fixed TV layouts and clips their controls.
        bridge.getWebView().getSettings().setTextZoom(100);
        if(DeviceProfile.isTV(this)){bridge.getWebView().getSettings().setUseWideViewPort(true);bridge.getWebView().getSettings().setLoadWithOverviewMode(true);}
        if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0 && getIntent().getBooleanExtra("preview",false))bridge.getWebView().loadUrl("https://localhost/?preview=1");
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if(imeVisible()){((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(bridge.getWebView().getWindowToken(),0);return;}
                sendKey("Escape");
            }
        });
        immersive();
    }
    private void immersive() { if(!DeviceProfile.isTV(this)){getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);getWindow().getDecorView().setBackgroundColor(0xFF111216);findViewById(android.R.id.content).setBackgroundColor(0xFF111216);androidx.core.view.WindowInsetsControllerCompat bars=new androidx.core.view.WindowInsetsControllerCompat(getWindow(),getWindow().getDecorView());bars.setAppearanceLightStatusBars(false);bars.setAppearanceLightNavigationBars(false);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content),(view,insets)->{androidx.core.graphics.Insets edges=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()|androidx.core.view.WindowInsetsCompat.Type.displayCutout());view.setPadding(edges.left,edges.top,edges.right,edges.bottom);return insets;});androidx.core.view.ViewCompat.requestApplyInsets(findViewById(android.R.id.content));return;}getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE); }
    @Override public void onConfigurationChanged(android.content.res.Configuration configuration) { super.onConfigurationChanged(configuration); immersive(); }
    @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if(focus) immersive(); }
    @Override public void onDetachedFromWindow() {
        // A fullscreen native player can detach the TV window temporarily. Capacitor's
        // default hook destroys its WebView, so only run that cleanup when finishing.
        if(isFinishing())super.onDetachedFromWindow();
    }
    private boolean imeVisible() { return android.os.Build.VERSION.SDK_INT >= 30 && getWindow().getDecorView().getRootWindowInsets()!=null && getWindow().getDecorView().getRootWindowInsets().isVisible(android.view.WindowInsets.Type.ime()); }
    private void sendKey(String key) { bridge.getWebView().evaluateJavascript("(document.activeElement || window).dispatchEvent(new KeyboardEvent('keydown',{key:'"+key+"',bubbles:true,cancelable:true}))",null); }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if(bridge==null||(getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        if(intent.getBooleanExtra("freshVerification",false)){getSharedPreferences("verification",MODE_PRIVATE).edit().putBoolean("concealed",true).apply();android.webkit.CookieManager.getInstance().removeAllCookies(ignored->{android.webkit.CookieManager.getInstance().flush();bridge.getWebView().evaluateJavascript("(()=>{const s=JSON.parse(localStorage.getItem('pelisflix.v1')||'{}');s.settings={...s.settings,mode:'live',mirror:'https://pelisflix1.dog/'};localStorage.setItem('pelisflix.v1',JSON.stringify(s));location.href='https://localhost';})()",null);});}
        if(intent.getBooleanExtra("snapshot",false))bridge.getWebView().evaluateJavascript("(()=>{const s=JSON.parse(localStorage.getItem('pelisflix.v1')||'{}');return JSON.stringify({url:location.href,body:document.body.innerText.slice(0,1200),focus:document.activeElement?.dataset?.focusId,settings:s.settings,history:s.history?.map(r=>({id:r.item.id,season:r.season,episode:r.episode,translator:r.translator,position:r.position,duration:r.duration,completed:r.completed})),favorites:s.favorites?.map(i=>i.id)});})()",value->android.util.Log.d("RezkaTest",value));
        if(intent.getBooleanExtra("live",false))bridge.getWebView().evaluateJavascript("(()=>{const s=JSON.parse(localStorage.getItem('pelisflix.v1')||'{}');s.settings={...s.settings,mode:'live'};localStorage.setItem('pelisflix.v1',JSON.stringify(s));location.href='https://localhost';})()",null);
        String mirror=intent.getStringExtra("mirror");if(mirror!=null)bridge.getWebView().evaluateJavascript("(()=>{const s=JSON.parse(localStorage.getItem('pelisflix.v1')||'{}');s.settings={...s.settings,mode:'live',mirror:"+org.json.JSONObject.quote(mirror)+"};localStorage.setItem('pelisflix.v1',JSON.stringify(s));location.href='https://localhost';})()",null);
        if(intent.getBooleanExtra("audit",false))bridge.getWebView().evaluateJavascript("window.dispatchEvent(new Event('rezka-test-live'))",null);
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        String key = switch(event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft";
            case KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight";
            case KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp";
            case KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown";
            default -> null;
        };
        // Let the platform IME handle text editing while it owns focus.
        if (DeviceProfile.isTV(this) && key!=null && !imeVisible()) {
            // Let WebView turn the platform key into a DOM key event directly.
            // evaluateJavascript adds a renderer-process round trip for every
            // remote repeat and makes horizontal shelves feel delayed.
            if(event.getAction()==KeyEvent.ACTION_DOWN) bridge.getWebView().dispatchKeyEvent(event);
            return true;
        }
        if(DeviceProfile.isTV(this)&&event.getKeyCode()==KeyEvent.KEYCODE_DPAD_CENTER && !imeVisible()) {
            if(event.getAction()==KeyEvent.ACTION_DOWN && event.getRepeatCount()==0)bridge.getWebView().evaluateJavascript("(()=>{const el=document.activeElement;el?.click();return el?.matches('input,textarea')||false;})()",value->{if("true".equals(value))((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(bridge.getWebView(),android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);});
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
