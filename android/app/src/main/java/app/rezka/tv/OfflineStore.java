package app.rezka.tv;

import android.content.Context;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.offline.DownloadService;
import com.getcapacitor.JSArray;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
public final class OfflineStore {
    private static DownloadManager manager;private static SimpleCache cache;
    private static final Map<String,Map<String,String>> headers=new HashMap<>();
    public static synchronized DownloadManager manager(Context context){
        if(manager!=null)return manager;Context app=context.getApplicationContext();
        var database=new StandaloneDatabaseProvider(app);cache=new SimpleCache(new File(app.getFilesDir(),"offline-video"),new NoOpCacheEvictor(),database);
        DataSource.Factory network=new DefaultDataSource.Factory(app,new DefaultHttpDataSource.Factory().setUserAgent(RezkaTVPlugin.USER_AGENT));
        var resolver=new ResolvingDataSource.Factory(network,spec->{Map<String,String> h=new HashMap<>();synchronized(headers){Map<String,String> stored=headers.get(spec.uri.getHost());if(stored!=null)h.putAll(stored);}String cookies=CookieManager.getInstance().getCookie(spec.uri.toString());if(cookies!=null)h.put("Cookie",cookies);return spec.withRequestHeaders(h);});
        manager=new DownloadManager(app,database,cache,resolver,Runnable::run);manager.setMaxParallelDownloads(2);
        try(var cursor=manager.getDownloadIndex().getDownloads()){while(cursor.moveToNext()){JSONObject data=new JSONObject(new String(cursor.getDownload().request.data,StandardCharsets.UTF_8));rememberHeaders(data);}}catch(Exception ignored){}
        return manager;
    }
    public static synchronized SimpleCache cache(Context context){manager(context);return cache;}
    private static void rememberHeaders(JSONObject data) throws Exception{
        Map<String,String> result=new HashMap<>();JSONObject fields=data.optJSONObject("headers");if(fields!=null)for(var keys=fields.keys();keys.hasNext();){String key=keys.next();result.put(key,fields.getString(key));}
        String host=Uri.parse(data.getString("url")).getHost();if(host!=null)synchronized(headers){headers.put(host,result);}
    }
    public static void add(Context context,JSONObject data)throws Exception {
        manager(context);rememberHeaders(data);String url=data.getString("url");if(url.startsWith("/"))url="asset:///public"+url;
        DownloadRequest request=new DownloadRequest.Builder(data.getString("id"),Uri.parse(url)).setData(data.toString().getBytes(StandardCharsets.UTF_8)).build();
        DownloadService.sendAddDownload(context,RezkaDownloadService.class,request,false);DownloadService.sendResumeDownloads(context,RezkaDownloadService.class,false);
    }
    public static JSArray list(Context context)throws Exception {
        JSArray items=new JSArray();try(var cursor=manager(context).getDownloadIndex().getDownloads()){while(cursor.moveToNext()){
            Download d=cursor.getDownload();JSONObject data=new JSONObject(new String(d.request.data,StandardCharsets.UTF_8));String state=d.state==Download.STATE_COMPLETED?"completed":d.state==Download.STATE_FAILED?"failed":d.state==Download.STATE_REMOVING?"removing":"downloading";
            float percent=d.getPercentDownloaded();data.put("state",state);data.put("progress",percent<0||!Float.isFinite(percent)?0:percent/100.0);data.put("url","rezka-offline:"+d.request.id);items.put(data);
        }}return items;
    }
    public static void remove(Context context,String id){DownloadService.sendRemoveDownload(context,RezkaDownloadService.class,id,false);}
}
