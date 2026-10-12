package app.rezka.tv;

import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.OnBackPressedCallback;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.view.View;
import org.json.JSONArray;
import org.json.JSONObject;

public class VerificationActivity extends AppCompatActivity {
    private static WebView verifiedBrowser;
    static WebView takeVerifiedBrowser(){WebView result=verifiedBrowser;verifiedBrowser=null;return result;}
    // Pages can be larger than the 1 MB an Intent may carry, so the response is handed over in memory too.
    private static String verifiedResponse;
    static String takeVerifiedResponse(){String result=verifiedResponse;verifiedResponse=null;return result;}
    private int networkRetries;
    private WebView browser;private Button done;private TextView status;private ProgressBar checkProgress;private JSONObject request;private boolean fetching=false;private int navigationStatus=200;
    private LinearLayout cover;private long started;private boolean concealed;
    private final Handler timer=new Handler(Looper.getMainLooper());
    private final Runnable timeout=()->{setResult(RESULT_CANCELED);finish();};
    private final Runnable autoReveal=this::reveal;
    @Override public void onCreate(Bundle state){super.onCreate(state);DeviceProfile.configureOrientation(this);getWindow().getDecorView().setSystemUiVisibility(5894);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){setResult(RESULT_CANCELED);finish();}});
        try{String value=getIntent().getStringExtra("request");if(value!=null)request=new JSONObject(value);}catch(Exception ignored){}
        boolean touch=!DeviceProfile.isTV(this);
        started=System.currentTimeMillis();concealed=getSharedPreferences("verification",MODE_PRIVATE).getBoolean("concealed",true);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(0xFF17131C);
        LinearLayout actions=new LinearLayout(this);if(!DeviceProfile.isTV(this))actions.setGravity(android.view.Gravity.CENTER);actions.setPadding(dp(24),dp(12),dp(24),dp(12));
        done=button("Continue");done.setOnClickListener(v->retry());actions.addView(done,actionLayout());
        Button reload=button("Reload page");reload.setOnClickListener(v->browser.reload());actions.addView(reload,actionLayout());
        Button cancel=button("Cancel");cancel.setOnClickListener(v->{setResult(RESULT_CANCELED);finish();});actions.addView(cancel,actionLayout());root.addView(actions);
        LinearLayout statusRow=new LinearLayout(this);statusRow.setOrientation(LinearLayout.HORIZONTAL);statusRow.setGravity(android.view.Gravity.CENTER_VERTICAL);statusRow.setPadding(dp(24),0,dp(24),dp(12));
        checkProgress=new ProgressBar(this,null,android.R.attr.progressBarStyleSmall);checkProgress.setIndeterminate(true);checkProgress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(0xFFD9C5E8));LinearLayout.LayoutParams progressLayout=new LinearLayout.LayoutParams(dp(22),dp(22));progressLayout.setMarginEnd(dp(12));statusRow.addView(checkProgress,progressLayout);
        status=new TextView(this);status.setTextColor(Color.WHITE);status.setTextSize(16);status.setText("Checking website access");statusRow.addView(status,new LinearLayout.LayoutParams(0,-2,1));root.addView(statusRow);
        android.content.MutableContextWrapper browserContext=new android.content.MutableContextWrapper(this);browser=new WebView(browserContext);browser.setBackgroundColor(Color.WHITE);browser.getSettings().setJavaScriptEnabled(true);browser.getSettings().setDomStorageEnabled(true);browser.getSettings().setTextZoom(100);browser.getSettings().setUserAgentString(RezkaTVPlugin.USER_AGENT);CookieManager.getInstance().setAcceptCookie(true);browser.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){navigationStatus=200;}
            @Override public void onPageFinished(WebView view,String url){retry();}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,android.webkit.WebResourceError error){if(request.isForMainFrame()){navigationStatus=502;if(networkRetries++<3)timer.postDelayed(()->{if(!isFinishing()&&browser!=null)browser.reload();},3000);}}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame())navigationStatus=response.getStatusCode();}
        });root.addView(browser,new LinearLayout.LayoutParams(-1,0,1));
        FrameLayout frame=new FrameLayout(this);frame.addView(root,new FrameLayout.LayoutParams(-1,-1));
        if(concealed){cover=new LinearLayout(this);cover.setOrientation(LinearLayout.VERTICAL);cover.setGravity(android.view.Gravity.CENTER);cover.setBackgroundColor(0xFF17131C);cover.setPadding(dp(touch?16:32),dp(touch?16:32),dp(touch?16:32),dp(touch?16:32));ImageView icon=new ImageView(this);icon.setImageResource(R.drawable.ic_verification);icon.setColorFilter(0xFFD9C5E8);LinearLayout.LayoutParams iconLayout=new LinearLayout.LayoutParams(dp(touch?36:54),dp(touch?36:54));iconLayout.bottomMargin=dp(touch?12:24);cover.addView(icon,iconLayout);TextView message=new TextView(this);message.setText("Connecting to your catalogue");message.setTextColor(Color.WHITE);message.setTextSize(touch?18:24);message.setGravity(android.view.Gravity.CENTER);cover.addView(message);ProgressBar progress=new ProgressBar(this);progress.setIndeterminate(true);progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(0xFFD9C5E8));LinearLayout.LayoutParams progressParams=new LinearLayout.LayoutParams(dp(touch?22:30),dp(touch?22:30));progressParams.topMargin=dp(touch?12:22);cover.addView(progress,progressParams);TextView caption=new TextView(this);caption.setText("Please wait while website access is checked.");caption.setTextColor(0xFFBEB4C6);caption.setTextSize(16);caption.setGravity(android.view.Gravity.CENTER);LinearLayout.LayoutParams captionParams=new LinearLayout.LayoutParams(-2,-2);captionParams.topMargin=dp(touch?8:16);cover.addView(caption,captionParams);Button show=button("Show website check");show.setOnClickListener(v->reveal());LinearLayout.LayoutParams buttonLayout=new LinearLayout.LayoutParams(dp(300),-2);buttonLayout.topMargin=dp(touch?12:28);cover.addView(show,buttonLayout);Button stop=button("Cancel");stop.setOnClickListener(v->{setResult(RESULT_CANCELED);finish();});LinearLayout.LayoutParams cancelLayout=new LinearLayout.LayoutParams(dp(300),-2);cancelLayout.topMargin=dp(12);cover.addView(stop,cancelLayout);frame.addView(cover,new FrameLayout.LayoutParams(-1,-1));show.requestFocus();timer.postDelayed(autoReveal,25000);}
        setContentView(frame);
        String url=getIntent().getStringExtra("url");if(request!=null&&request.optString("method","GET").equals("POST"))url=request.optString("referer",url);browser.loadUrl(url);if(!concealed)browser.requestFocus();timer.postDelayed(timeout,180000);
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private Button button(String label){Button button=new Button(this);button.setText(label);button.setAllCaps(false);button.setTextSize(DeviceProfile.isTV(this)?16:14);button.setTextColor(Color.WHITE);button.setPadding(dp(DeviceProfile.isTV(this)?20:8),dp(12),dp(DeviceProfile.isTV(this)?20:8),dp(12));button.setMinHeight(dp(DeviceProfile.isTV(this)?56:44));button.setMinimumHeight(dp(DeviceProfile.isTV(this)?56:44));button.setBackground(TVControls.buttonBackground(this));return button;}
    private LinearLayout.LayoutParams actionLayout(){LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-2,-2);params.setMarginEnd(dp(DeviceProfile.isTV(this)?12:4));if(!DeviceProfile.isTV(this)){params.width=0;params.weight=1;}return params;}
    private void reveal(){if(isFinishing()||cover==null||cover.getVisibility()!=View.VISIBLE)return;cover.setVisibility(View.GONE);if(browser!=null)browser.requestFocus();}
    private void evidence(boolean success){
        if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        try{
            java.io.File file=new java.io.File(getFilesDir(),"verification-check.json");
            JSONArray checks=new JSONArray();
            if(file.exists())try(java.io.InputStream input=new java.io.FileInputStream(file)){checks=new JSONArray(new String(StreamReader.read(input),java.nio.charset.StandardCharsets.UTF_8));}
            while(checks.length()>49)checks.remove(0);
            checks.put(new JSONObject().put("success",success).put("concealedAtStart",concealed).put("concealedAtEnd",cover!=null&&cover.getVisibility()==View.VISIBLE).put("elapsedMillis",System.currentTimeMillis()-started).put("timestamp",System.currentTimeMillis()));
            try(java.io.OutputStream output=new java.io.FileOutputStream(file)){output.write(checks.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        }catch(Exception ignored){}
    }
    private void retry(){retry(true);}
    private void retry(boolean showProgress){
        if(fetching||isFinishing()||browser==null)return;fetching=true;
        done.setEnabled(false);if(showProgress){checkProgress.setVisibility(View.VISIBLE);status.setText("Checking website access");}
        if(request==null||!request.optString("method","GET").equals("POST")){checkDocument();return;}
        String url=request.optString("url"),method=request.optString("method","GET"),body=request.optString("body",null);
        // Reissue the original request inside the actual verified browser, as on iOS.
        String headers=body==null?"{}":"{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'}";
        String code="(async()=>{const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),20000);try{if(new URL("+JSONObject.quote(url)+").origin!==location.origin)throw new Error('The verification page changed its website address.');const html=document.documentElement.outerHTML;if(/anubis_challenge|\\.within\\.website|challenge-platform|cf-turnstile/i.test(html)){window.__rezkaVerifiedResponse=JSON.stringify({status:403,url:location.href,text:html});return;}const r=await fetch("+JSONObject.quote(url)+",{method:"+JSONObject.quote(method)+",credentials:'include',headers:"+headers+(body!=null?",body:"+JSONObject.quote(body):"")+",signal:abort.signal});const response={status:r.status,url:r.url,text:await r.text()};window.__rezkaVerifiedResponse=JSON.stringify(response);}catch(e){window.__rezkaVerifiedResponse=JSON.stringify({error:String(e)});}finally{clearTimeout(timeout);}})();true";
        browser.evaluateJavascript(code,ignored->timer.postDelayed(this::readResponse,300));
    }
    private void checkDocument(){if(browser==null)return;browser.evaluateJavascript("JSON.stringify({status:"+navigationStatus+",url:location.href,text:document.documentElement.outerHTML})",this::complete);}
    private void readResponse(){if(isFinishing()||browser==null)return;browser.evaluateJavascript("window.__rezkaVerifiedResponse || null",value->{if("null".equals(value)){timer.postDelayed(this::readResponse,300);return;}complete(value);});}
    private void complete(String encoded){
        if(isFinishing()||browser==null)return;
        try{
            String raw=new org.json.JSONTokener(encoded).nextValue().toString();JSONObject response=new JSONObject(raw);String html=response.optString("text");
            boolean contentDocument=html.contains("b-content__")||html.contains("b-post__");
            boolean documentRequest=request==null||!request.optString("method","GET").equals("POST");
            if(documentRequest&&!contentDocument||html.length()<100||response.has("error")||response.optInt("status")<200||response.optInt("status")>=300||html.matches("(?is).*(anubis_challenge|\\.within\\.website|challenge-platform|cf-turnstile).*")){
                waitingForCheck();browser.evaluateJavascript("delete window.__rezkaVerifiedResponse",null);timer.postDelayed(()->retry(false),1500);return;
            }
            evidence(true);timer.removeCallbacks(autoReveal);CookieManager.getInstance().flush();browser.stopLoading();((android.view.ViewGroup)browser.getParent()).removeView(browser);verifiedBrowser=browser;browser=null;verifiedResponse=request!=null?raw:null;setResult(RESULT_OK);finish();
        }catch(Exception e){android.util.Log.d("RezkaVerification",e.getClass().getSimpleName()+" "+e.getMessage()+" responseLength="+(encoded==null?0:encoded.length()));waitingForCheck();timer.postDelayed(()->retry(false),1500);}
    }
    private void waitingForCheck(){checkProgress.setVisibility(View.GONE);status.setText("Waiting for the website check. Complete it below, or reload the page to retry.");done.setEnabled(true);fetching=false;}
    @Override protected void onDestroy(){timer.removeCallbacksAndMessages(null);if(browser!=null){browser.stopLoading();browser.destroy();}super.onDestroy();}
}
