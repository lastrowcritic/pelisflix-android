package app.rezka.tv;

import android.app.Notification;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadNotificationHelper;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.scheduler.Scheduler;
import java.util.List;

@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
public class RezkaDownloadService extends DownloadService {
    private DownloadNotificationHelper notifications;
    public RezkaDownloadService(){super(1001,1000,"rezka-downloads",R.string.download_channel,0);}
    @Override public void onCreate(){super.onCreate();notifications=new DownloadNotificationHelper(this,"rezka-downloads");}
    @Override protected DownloadManager getDownloadManager(){return OfflineStore.manager(this);}
    @Override protected Scheduler getScheduler(){return null;}
    @Override protected Notification getForegroundNotification(List<Download> downloads,int requirements){return notifications.buildProgressNotification(this,android.R.drawable.stat_sys_download,null,"Saving videos for your next evening",downloads,requirements);}
}
