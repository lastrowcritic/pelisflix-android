package app.rezka.tv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.Charset;
import java.util.zip.GZIPInputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name="RezkaTV",requestCodes={6101,6102,6103})
public class RezkaTVPlugin extends Plugin {
    static final String USER_AGENT="Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
    private final ExecutorService requests=Executors.newFixedThreadPool(4);
    private final ConcurrentHashMap<String,String> browserResponses=new ConcurrentHashMap<>();
    private volatile JSObject pendingVerification;
    private final ConcurrentHashMap<String,JSObject> challenges=new ConcurrentHashMap<>();
    private PluginCall activityCall;
    private BrowserSession browserSession;
    private final java.util.Set<String> verifiedOrigins=ConcurrentHashMap.newKeySet();
    private BrowserSession session(){if(browserSession==null)browserSession=new BrowserSession(getActivity(),(android.view.ViewGroup)bridge.getWebView().getParent());return browserSession;}
    private static String origin(String address)throws Exception{URL url=new URL(address);return url.getProtocol()+"://"+url.getAuthority();}
    private void launch(PluginCall call,Intent intent,int code){activityCall=call;bridge.saveCall(call);getActivity().runOnUiThread(()->{try{getActivity().startActivityForResult(intent,code);}catch(Exception error){activityCall=null;call.reject(code==6103?"No file browser is installed on this TV. Add a video link instead.":"This screen could not be opened. Try again.",error);}});}
    @Override protected void handleOnActivityResult(int requestCode,int resultCode,Intent data){
        PluginCall call=activityCall;activityCall=null;if(call==null)call=getSavedCall();
        ActivityResult result=new ActivityResult(resultCode,data);
        if(requestCode==6101)playResult(call,result);else if(requestCode==6102)verificationResult(call,result);else if(requestCode==6103)fileResult(call,result);
    }
    private static String requestKey(String url,String method,String body){return method+":"+url.replaceAll("([?&])t=\\d+(&|$)","$1").replaceAll("[?&]$","")+":"+(body==null?"":body);}
    private static boolean challenge(String text){return java.util.regex.Pattern.compile("just a moment|attention required|cf-browser-verification|cf-turnstile|challenge-platform/h/|anubis_challenge|anubis|within\\.website",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text).find();}
    private static String decode(byte[] bytes){try{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}catch(Exception e){return new String(bytes,Charset.forName("windows-1251"));}}
    private static byte[] readProbe(InputStream input)throws java.io.IOException {
        java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[1024];
        while(out.size()<1024){int count=input.read(bytes,0,1024-out.size());if(count<0)break;out.write(bytes,0,count);}return out.toByteArray();
    }
    @PluginMethod public void request(PluginCall call) {
        final String address=call.getString("url"),method=call.getString("method","GET"),body=call.getString("body"),referer=call.getString("referer");
        requests.execute(()->{
            HttpURLConnection connection=null;
            try {
                String cached=browserResponses.remove(requestKey(address,method,body));
                if(cached!=null){call.resolve(new JSObject(cached));return;}
                URL url=new URL(address);
                if(verifiedOrigins.contains(origin(address))){getActivity().runOnUiThread(()->session().request(call.getData(),response->{if(challenge(response.getString("text","")))challenges.put(response.getString("url",address),call.getData());call.resolve(response);},call::reject));return;}
                if(!url.getProtocol().equals("https") || url.getUserInfo()!=null)throw new Exception("A secure content address is required.");
                connection=(HttpURLConnection)url.openConnection();int timeout=call.getInt("timeout",18000);connection.setConnectTimeout(Math.min(timeout,12000));connection.setReadTimeout(timeout);connection.setRequestMethod(method);
                connection.setRequestProperty("User-Agent",USER_AGENT);connection.setRequestProperty("Accept","*/*");connection.setRequestProperty("Accept-Language","es-ES,es;q=0.9,en;q=0.7");
                if(call.getBoolean("probe",false))connection.setRequestProperty("Range","bytes=0-1023");
                String cookies=CookieManager.getInstance().getCookie(address);if(cookies!=null)connection.setRequestProperty("Cookie",cookies);
                connection.setRequestProperty("Referer",referer!=null?referer:url.getProtocol()+"://"+url.getAuthority()+"/");
                if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/x-www-form-urlencoded; charset=UTF-8");connection.setRequestProperty("X-Requested-With","XMLHttpRequest");connection.setRequestProperty("Origin",url.getProtocol()+"://"+url.getAuthority());try(var output=connection.getOutputStream()){output.write(body.getBytes(StandardCharsets.UTF_8));}}
                int status=connection.getResponseCode();
                for(var header:connection.getHeaderFields().entrySet())if(header.getKey()!=null&&header.getKey().equalsIgnoreCase("Set-Cookie"))for(String cookie:header.getValue())CookieManager.getInstance().setCookie(connection.getURL().toString(),cookie);
                InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
                if(input!=null&&"gzip".equalsIgnoreCase(connection.getContentEncoding()))input=new GZIPInputStream(input);
                String text="";
                if(input!=null)try(InputStream responseBody=input){text=decode(call.getBoolean("probe",false)?readProbe(responseBody):StreamReader.read(responseBody));}
                if(challenge(text))challenges.put(connection.getURL().toString(),new JSObject(call.getData().toString()));
                JSObject result=new JSObject();result.put("text",text);result.put("status",status);result.put("url",connection.getURL().toString());call.resolve(result);
            } catch(Exception error){call.reject("The content source could not be reached. "+error.getMessage(),error);}finally{if(connection!=null)connection.disconnect();}
        });
    }
    @PluginMethod public void rating(PluginCall call){
        final String address=call.getString("url");try{URL url=new URL(address);if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null)throw new Exception();}catch(Exception error){call.reject("A secure content address is required.");return;}
        getActivity().runOnUiThread(()->{JSObject options=new JSObject();options.put("url",address);options.put("method","GET");session().request(options,response->{String html=response.getString("text","");if(challenge(html)){call.reject("Rating metadata is unavailable.");return;}java.util.regex.Matcher matcher=java.util.regex.Pattern.compile("(?is)b-post__info_rates[^>]*imdb.*?class=[\"']bold[\"'][^>]*>\\s*([0-9]+(?:[.,][0-9]+)?)").matcher(html);JSObject result=new JSObject();result.put("rating",matcher.find()?matcher.group(1).replace(',','.'):JSONObject.NULL);call.resolve(result);},call::reject);});
    }

    @PluginMethod public void play(PluginCall call) {
        Intent intent=new Intent(getContext(),PlayerActivity.class);intent.putExtra("tvLayout",DeviceProfile.isTV(getActivity()));intent.putExtra("payload",call.getData().toString());launch(call,intent,6101);
    }
    @PluginMethod public void debugStatus(PluginCall call) { JSObject value=new JSObject();value.put("enabled",(getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);call.resolve(value); }
    @PluginMethod public void saveTestReport(PluginCall call) {
        if((getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0){call.reject("Debug tools are disabled.");return;}
        try(var file=new java.io.FileOutputStream(new java.io.File(getContext().getFilesDir(),"native-live-check.json"))){file.write(call.getString("report").getBytes(StandardCharsets.UTF_8));call.resolve();}catch(Exception error){call.reject("Test report could not be saved.",error);}
    }
    private void playResult(PluginCall call,ActivityResult result) {
        if(call==null)return;
        Intent data=result.getData();if((getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.d("RezkaPlayer","result method="+call.getMethodName()+" data="+(data!=null)+" position="+(data==null?0:data.getDoubleExtra("position",0))+" duration="+(data==null?0:data.getDoubleExtra("duration",0)));JSObject response=new JSObject();response.put("position",data==null?0:data.getDoubleExtra("position",0));response.put("duration",data==null?0:data.getDoubleExtra("duration",0));response.put("ended",data!=null&&data.getBooleanExtra("ended",false));if(data!=null&&data.hasExtra("error"))response.put("error",data.getStringExtra("error"));call.resolve(response);
    }
    @PluginMethod public void drainProgress(PluginCall call) {
        var prefs=getContext().getSharedPreferences("rezka-progress",0);JSArray records=new JSArray();
        try{for(Object value:prefs.getAll().values())if(value instanceof String)records.put(new JSONObject((String)value));prefs.edit().clear().commit();JSObject result=new JSObject();result.put("records",records);call.resolve(result);}catch(Exception e){call.reject("Saved viewing progress could not be restored.",e);}
    }
    @PluginMethod public void verify(PluginCall call) {
        pendingVerification=call.getObject("request");
        if(pendingVerification==null)pendingVerification=challenges.remove(call.getString("url"));
        Intent intent=new Intent(getContext(),VerificationActivity.class);intent.putExtra("tvLayout",DeviceProfile.isTV(getActivity()));intent.putExtra("url",call.getString("url"));if(pendingVerification!=null)intent.putExtra("request",pendingVerification.toString());launch(call,intent,6102);
    }
    private void verificationResult(PluginCall call,ActivityResult result) {
        if(call==null)return;
        if(result.getResultCode()==Activity.RESULT_OK){
            String response=VerificationActivity.takeVerifiedResponse();if(response!=null&&pendingVerification!=null){JSObject request=pendingVerification;browserResponses.put(requestKey(request.getString("url"),request.getString("method","GET"),request.getString("body")),response);pendingVerification=null;}
            try{verifiedOrigins.add(origin(call.getString("url")));}catch(Exception ignored){}
            android.webkit.WebView verifiedBrowser=VerificationActivity.takeVerifiedBrowser();
            if(verifiedBrowser!=null)session().adopt(verifiedBrowser);
            call.resolve();
        }else call.reject("Website verification was cancelled or did not complete. You can retry when you are ready.");
    }
    @PluginMethod public void pickFile(PluginCall call) {
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("video/*");intent.addCategory(Intent.CATEGORY_OPENABLE);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);launch(call,intent,6103);
    }
    private void fileResult(PluginCall call,ActivityResult result) {
        if(call==null)return;if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){call.reject("No video file was selected.");return;}
        Uri uri=result.getData().getData();getContext().getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
        String name="Personal video";
        try(var cursor=getContext().getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}
        JSObject response=new JSObject();response.put("url",uri.toString());response.put("name",name);call.resolve(response);
    }
    @PluginMethod public void download(PluginCall call) {
        try{OfflineStore.add(getContext(),call.getData());call.resolve();}catch(Exception e){call.reject("The download could not be started.",e);}
    }
    @PluginMethod public void downloads(PluginCall call) {
        try{JSObject response=new JSObject();response.put("items",OfflineStore.list(getContext()));call.resolve(response);}catch(Exception e){call.reject("Downloads could not be read.",e);}
    }
    @PluginMethod public void removeDownload(PluginCall call) {
        try{OfflineStore.remove(getContext(),call.getString("id"));call.resolve();}catch(Exception e){call.reject("The download could not be removed.",e);}
    }
    @PluginMethod public void appInfo(PluginCall call){JSObject value=new JSObject();value.put("version",BuildConfig.VERSION_NAME);value.put("updateRepo",BuildConfig.UPDATE_REPO);call.resolve(value);}
    // Downloads a release APK from the trusted update host and hands it to the system installer, which asks the user to confirm.
    @PluginMethod public void installUpdate(PluginCall call){
        final String address=call.getString("url");
        try{URL url=new URL(address);if(!"https".equals(url.getProtocol())||!BuildConfig.UPDATE_HOST.equals(url.getHost()))throw new Exception();}catch(Exception error){call.reject("The update address is not trusted.");return;}
        if(android.os.Build.VERSION.SDK_INT>=26&&!getContext().getPackageManager().canRequestPackageInstalls()){
            Intent settings=new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName()));
            getActivity().runOnUiThread(()->{try{getActivity().startActivity(settings);}catch(Exception ignored){}});
            call.reject("Allow Rezka to install unknown apps in the system settings, then choose Update again.","INSTALL_PERMISSION");return;
        }
        requests.execute(()->{
            HttpURLConnection connection=null;java.io.File folder=new java.io.File(getContext().getCacheDir(),"updates"),apk=new java.io.File(folder,"Rezka-update.apk");
            try{
                folder.mkdirs();apk.delete();
                connection=(HttpURLConnection)new URL(address).openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setRequestProperty("User-Agent",USER_AGENT);
                if(connection.getResponseCode()!=200)throw new Exception("The update server answered "+connection.getResponseCode()+".");
                long total=connection.getContentLengthLong(),done=0;int reported=-1;byte[] buffer=new byte[65536];
                try(InputStream input=connection.getInputStream();var output=new java.io.FileOutputStream(apk)){for(int read;(read=input.read(buffer))>0;){output.write(buffer,0,read);done+=read;int percent=total>0?(int)(done*100/total):-1;if(percent!=reported){reported=percent;JSObject progress=new JSObject();progress.put("progress",percent);notifyListeners("updateProgress",progress);}}}
                var archive=getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(),0);
                if(archive==null||!getContext().getPackageName().equals(archive.packageName))throw new Exception("The downloaded file is not a Rezka update.");
                Uri uri=androidx.core.content.FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",apk);
                Intent install=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(()->{try{getActivity().startActivity(install);call.resolve();}catch(Exception error){call.reject("The system installer could not be opened.",error);}});
            }catch(Exception error){apk.delete();call.reject("The update could not be downloaded. "+error.getMessage(),error);}finally{if(connection!=null)connection.disconnect();}
        });
    }
    @PluginMethod public void exit(PluginCall call) { call.resolve();getActivity().runOnUiThread(()->getActivity().finish()); }
    @Override protected void handleOnDestroy(){requests.shutdownNow();if(browserSession!=null)browserSession.destroy();}
}
