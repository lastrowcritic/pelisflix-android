package app.rezka.tv;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.util.ArrayDeque;
import java.util.function.Consumer;

/** Reuse one verified browser context for lightweight same-origin fetches. */
final class BrowserSession {
    private final Activity activity;
    private final ViewGroup parent;
    private final Handler timer=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Task> tasks=new ArrayDeque<>();
    private WebView browser;
    private Task current;
    private String origin="";
    private boolean ready;
    private long deadline;
    private static final class Task {
        final JSObject options;final Consumer<JSObject> success;final Consumer<String> failure;
        Task(JSObject options,Consumer<JSObject> success,Consumer<String> failure){this.options=options;this.success=success;this.failure=failure;}
    }
    BrowserSession(Activity activity,ViewGroup parent){this.activity=activity;this.parent=parent;}
    void request(JSObject options,Consumer<JSObject> success,Consumer<String> failure){timer.post(()->{tasks.add(new Task(options,success,failure));pump();});}
    void adopt(WebView verified){
        timer.removeCallbacksAndMessages(null);
        if(current!=null){Task replaced=current;current=null;replaced.failure.accept("The website session was renewed.");}
        if(browser!=null){parent.removeView(browser);browser.stopLoading();browser.destroy();}
        browser=verified;
        if(browser.getContext() instanceof android.content.MutableContextWrapper)((android.content.MutableContextWrapper)browser.getContext()).setBaseContext(activity);
        try{java.net.URL url=new java.net.URL(browser.getUrl());origin=url.getProtocol()+"://"+url.getAuthority();ready=true;}catch(Exception ignored){ready=false;}
        attach();pump();
    }
    private void attach(){
        browser.setFocusable(false);browser.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);browser.setAlpha(0);browser.getSettings().setLoadsImagesAutomatically(false);parent.addView(browser,0,new ViewGroup.LayoutParams(-1,-1));
                browser.setWebViewClient(new WebViewClient(){
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                        String path=request.getUrl().getPath(),host=request.getUrl().getHost();
                        boolean verification=path!=null&&(path.startsWith("/.within.website/")||path.startsWith("/cdn-cgi/"))||host!=null&&host.endsWith("challenges.cloudflare.com");
                        if(!request.isForMainFrame()&&!verification&&path!=null&&path.matches("(?i).*\\.(jpg|jpeg|png|gif|webp|avif|svg|css|js|woff2?)(/.*)?$"))return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
                        return null;
                    }
                });
    }
    private void pump(){
        if(current!=null||tasks.isEmpty())return;
        current=tasks.remove();deadline=System.currentTimeMillis()+30000;
        try{
            java.net.URL url=new java.net.URL(current.options.getString("url"));
            String nextOrigin=url.getProtocol()+"://"+url.getAuthority();
            if(browser==null){
                browser=new WebView(activity);browser.getSettings().setJavaScriptEnabled(true);browser.getSettings().setDomStorageEnabled(true);browser.getSettings().setUserAgentString(RezkaTVPlugin.USER_AGENT);attach();
            }
            if(!origin.equals(nextOrigin)||!ready){origin=nextOrigin;ready=false;browser.loadUrl(origin+"/");timer.postDelayed(this::inspect,250);}
            else fetch();
        }catch(Exception e){fail("The browser session could not be opened.");}
    }
    private void inspect(){
        if(current==null)return;
        if(System.currentTimeMillis()>deadline){fail("The website session needs another verification check.");return;}
        browser.evaluateJavascript("JSON.stringify({url:location.href,text:document.documentElement?.outerHTML||'',loaded:document.readyState!=='loading'})",value->{
            if(current==null)return;
            try{
                JSONObject result=new JSONObject(new org.json.JSONTokener(value).nextValue().toString());String text=result.optString("text"),url=result.optString("url");
                boolean challenge=text.matches("(?is).*(anubis_challenge|\\.within\\.website|challenge-platform|cf-turnstile).*" );
                if(result.optBoolean("loaded")&&url.startsWith(origin+"/")&&text.length()>100&&!challenge){ready=true;fetch();return;}
                if(challenge&&System.currentTimeMillis()>deadline-10000){JSObject response=new JSObject();response.put("status",403);response.put("url",url);response.put("text",text);complete(response);return;}
            }catch(Exception ignored){}
            timer.postDelayed(this::inspect,250);
        });
    }
    private void fetch(){
        if(current==null)return;
        String url=current.options.getString("url"),method=current.options.getString("method","GET"),body=current.options.getString("body"),referer=current.options.getString("referer");
        String headers=body==null?"{}":"{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'}";
        String code="window.__rezkaFetchResult=null;(async()=>{const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),20000);try{const r=await fetch("+JSONObject.quote(url)+",{method:"+JSONObject.quote(method)+",credentials:'include',headers:"+headers+(body==null?"":",body:"+JSONObject.quote(body))+(referer==null?"":",referrer:"+JSONObject.quote(referer))+",signal:abort.signal});const bytes=await r.arrayBuffer();if(bytes.byteLength>16777216)throw new Error('Response too large');let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(e){text=new TextDecoder('windows-1251').decode(bytes);}window.__rezkaFetchResult=JSON.stringify({status:r.status,url:r.url,text});}catch(e){window.__rezkaFetchResult=JSON.stringify({error:String(e)});}finally{clearTimeout(timeout);}})();true";
        browser.evaluateJavascript(code,ignored->timer.postDelayed(this::read,100));
    }
    private void read(){
        if(current==null)return;
        if(System.currentTimeMillis()>deadline){fail("The website request timed out.");return;}
        browser.evaluateJavascript("window.__rezkaFetchResult",value->{
            if(current==null)return;
            if(value==null||"null".equals(value)){timer.postDelayed(this::read,100);return;}
            try{JSObject response=new JSObject(new org.json.JSONTokener(value).nextValue().toString());if(response.has("error")){fail("The website request could not be completed.");return;}complete(response);}catch(Exception e){fail("The website response could not be read.");}
        });
    }
    private void complete(JSObject response){Task task=current;current=null;if(task!=null)task.success.accept(response);pump();}
    private void fail(String message){Task task=current;current=null;ready=false;if(task!=null)task.failure.accept(message);pump();}
    void invalidate(){timer.post(()->ready=false);}
    void destroy(){timer.post(()->{timer.removeCallbacksAndMessages(null);tasks.clear();current=null;if(browser!=null){parent.removeView(browser);browser.stopLoading();browser.destroy();browser=null;}});}
}
