package app.rezka.tv;

import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.OnBackPressedCallback;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.common.Tracks;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.ui.PlayerView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
public class PlayerActivity extends AppCompatActivity {
    private ExoPlayer player;private PlayerView view;private MediaSession session;private DefaultTimeBar timeBar;private View settingsButton;private Dialog settingsDialog;
    private JSONObject payload,record,source;private JSONArray streams;private int quality=0,alternative=0;
    private boolean ended=false,closing=false,testTimerStarted=false;private String error;private long savedPosition;private double savedDuration;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable checkpoint=new Runnable(){public void run(){persist();handler.postDelayed(this,5000);}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);getWindow().getDecorView().setSystemUiVisibility(5894);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){close();}});
        try{
            payload=new JSONObject(getIntent().getStringExtra("payload"));record=payload.getJSONObject("record");source=payload.getJSONObject("source");streams=source.getJSONArray("streams");savedPosition=(long)(payload.optDouble("position",0)*1000);
            String preferred=payload.optString("quality","1080p");for(int i=0;i<streams.length();i++)if(streams.getJSONObject(i).optString("quality").equals(preferred))quality=i;
            FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);view=new PlayerView(this);view.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);view.setShowFastForwardButton(true);view.setShowRewindButton(true);view.setShowSubtitleButton(false);view.setShowNextButton(false);view.setShowPreviousButton(false);view.setControllerShowTimeoutMs(5000);view.setKeepContentOnPlayerReset(true);root.addView(view,new FrameLayout.LayoutParams(-1,-1));
            if(!DeviceProfile.isTV(this)){
                android.widget.ImageButton back=new android.widget.ImageButton(this);back.setImageResource(R.drawable.ic_touch_back);back.setContentDescription("Back to title");back.setPadding(dp(12),dp(12),dp(12),dp(12));back.setBackground(TVControls.buttonBackground(this));FrameLayout.LayoutParams backLayout=new FrameLayout.LayoutParams(dp(48),dp(48),Gravity.TOP|Gravity.START);backLayout.setMargins(dp(16),dp(12),0,0);root.addView(back,backLayout);back.setOnClickListener(v->close());view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener)visibility->back.setVisibility(visibility));
                androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root,(v,insets)->{androidx.core.graphics.Insets edges=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.displayCutout());v.setPadding(edges.left,edges.top,edges.right,edges.bottom);return insets;});
            }
            setContentView(root);
            replaceTimeSeparator(view);
            timeBar=view.findViewById(androidx.media3.ui.R.id.exo_progress);if(timeBar!=null)timeBar.setKeyTimeIncrement(10000);
            settingsButton=view.findViewById(androidx.media3.ui.R.id.exo_settings);if(settingsButton!=null){settingsButton.setContentDescription("Playback settings");settingsButton.setOnClickListener(v->showSettings());}
            buildPlayer();view.requestFocus();handler.postDelayed(checkpoint,5000);
        }catch(Exception e){error="This video could not be opened. "+e.getMessage();close();}
    }
    private Map<String,String> headers() throws Exception {Map<String,String> result=new HashMap<>();JSONObject object=source.optJSONObject("headers");if(object!=null)for(var keys=object.keys();keys.hasNext();){String key=keys.next();result.put(key,object.getString(key));}return result;}
    private void buildPlayer() throws Exception {
        boolean playWhenReady=player==null||player.getPlayWhenReady();
        float speed=player==null?1f:player.getPlaybackParameters().speed;
        TrackSelectionParameters preferences=player==null?null:player.getTrackSelectionParameters().buildUpon().clearOverrides().build();
        if(session!=null){session.release();session=null;}if(player!=null){savedPosition=player.getCurrentPosition();player.release();}
        JSONObject stream=streams.getJSONObject(quality);String uri=stream.getString("url");JSONArray alternatives=stream.optJSONArray("alternatives");if(alternative>0&&alternatives!=null)uri=alternatives.getString(alternative-1);
        boolean offline=uri.startsWith("rezka-offline:");
        var http=new DefaultHttpDataSource.Factory().setDefaultRequestProperties(headers()).setAllowCrossProtocolRedirects(false);
        var network=new ResolvingDataSource.Factory(new DefaultDataSource.Factory(this,http),spec->{Map<String,String> fields=new HashMap<>(spec.httpRequestHeaders);String cookie=android.webkit.CookieManager.getInstance().getCookie(spec.uri.toString());if(cookie!=null)fields.put("Cookie",cookie);return spec.withRequestHeaders(fields);});
        DefaultMediaSourceFactory factory;
        MediaItem.Builder media=new MediaItem.Builder();
        if(offline){String id=uri.substring("rezka-offline:".length());var request=OfflineStore.manager(this).getDownloadIndex().getDownload(id).request;media=request.toMediaItem().buildUpon();factory=new DefaultMediaSourceFactory(new CacheDataSource.Factory().setCache(OfflineStore.cache(this)).setUpstreamDataSourceFactory(null).setCacheWriteDataSinkFactory(null));}
        else{if(uri.startsWith("/"))uri="asset:///public"+uri;media.setUri(uri);if(stream.has("mimeType"))media.setMimeType(stream.getString("mimeType"));factory=new DefaultMediaSourceFactory(network);}
        List<MediaItem.SubtitleConfiguration> subtitles=new ArrayList<>();JSONArray tracks=source.optJSONArray("subtitles");
        if(tracks!=null)for(int i=0;i<tracks.length();i++){JSONObject track=tracks.getJSONObject(i);String url=track.getString("url"),language=track.optString("language");subtitles.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(url)).setLabel(track.optString("label")).setLanguage(language).setMimeType(url.toLowerCase().contains(".srt")?MimeTypes.APPLICATION_SUBRIP:MimeTypes.TEXT_VTT).setSelectionFlags(language.equals(source.optString("defaultSubtitle"))?C.SELECTION_FLAG_DEFAULT:0).build());}
        media.setSubtitleConfigurations(subtitles).setMediaMetadata(new androidx.media3.common.MediaMetadata.Builder().setTitle(record.getJSONObject("item").optString("title")).build());
        player=new ExoPlayer.Builder(this).setMediaSourceFactory(factory).setSeekBackIncrementMs(10000).setSeekForwardIncrementMs(10000).build();player.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);player.setHandleAudioBecomingNoisy(true);
        player.addListener(new Player.Listener(){
            @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition,Player.PositionInfo newPosition,int reason){if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.d("RezkaPlayer","seek from="+oldPosition.positionMs+" to="+newPosition.positionMs+" reason="+reason);}
            @Override public void onPlaybackStateChanged(int state){if(state==Player.STATE_ENDED){ended=true;persist();close();}}
            @Override public void onPlayWhenReadyChanged(boolean ready,int reason){if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.d("RezkaPlayer","ready="+ready+" reason="+reason);}
            @Override public void onIsPlayingChanged(boolean playing){
                if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.d("RezkaPlayer","playing="+playing+" position="+player.getCurrentPosition()+" duration="+player.getDuration());
                if(!playing)persist();
                if(playing&&!testTimerStarted&&(getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0&&payload.optInt("testDurationSeconds",0)>0){testTimerStarted=true;handler.postDelayed(()->close(),Math.min(30,payload.optInt("testDurationSeconds"))*1000L);}
            }
            @Override public void onPlayerError(PlaybackException failure){
                if(closing)return;
                try{JSONArray alternatives=streams.getJSONObject(quality).optJSONArray("alternatives");if(alternatives!=null&&alternative<alternatives.length()){alternative++;buildPlayer();}else{error="This video could not be played. Choose another quality or mirror.";close();}}catch(Exception e){error="The alternate video source could not be played.";close();}
            }
        });
        view.setPlayer(player);session=new MediaSession.Builder(this,player).setId(java.util.UUID.randomUUID().toString()).build();player.setMediaItem(media.build(),savedPosition);player.setPlaybackSpeed(speed);if(preferences!=null)player.setTrackSelectionParameters(preferences);player.prepare();player.setPlayWhenReady(playWhenReady);
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private void replaceTimeSeparator(View root){if(root instanceof TextView label&&label.getText().toString().trim().equals("\u00b7"))label.setText("of");if(root instanceof android.view.ViewGroup group)for(int i=0;i<group.getChildCount();i++)replaceTimeSeparator(group.getChildAt(i));}
    private TextView settingsText(String text,int size){TextView label=new TextView(this);label.setText(text);label.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP,size);label.setTextColor(Color.WHITE);label.setIncludeFontPadding(false);label.setSingleLine(true);label.setEllipsize(android.text.TextUtils.TruncateAt.END);return label;}
    private void openSettings(String title,List<String> labels,int selected,java.util.function.IntConsumer choose){
        if(player==null||closing)return;
        if(settingsDialog!=null){settingsDialog.setOnDismissListener(null);settingsDialog.dismiss();}
        Dialog dialog=new Dialog(this);settingsDialog=dialog;
        boolean summary=title.equals("Playback settings");
        boolean touch=!DeviceProfile.isTV(this);int screenHeight=Math.round(getResources().getDisplayMetrics().heightPixels/getResources().getDisplayMetrics().density);int rowHeight=touch?Math.max(36,Math.min(44,(screenHeight-112)/5)):44;
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(dp(20),dp(16),dp(20),dp(16));android.graphics.drawable.GradientDrawable background=new android.graphics.drawable.GradientDrawable();background.setColor(0xFF17191F);background.setCornerRadius(dp(14));background.setStroke(dp(1),0xFF353740);panel.setBackground(background);
        TextView heading=settingsText(title,20);heading.setTypeface(android.graphics.Typeface.DEFAULT,android.graphics.Typeface.BOLD);heading.setPadding(0,0,0,dp(14));panel.addView(heading);
        LinearLayout choices=new LinearLayout(this);choices.setOrientation(LinearLayout.VERTICAL);
        if(summary)panel.addView(choices,new LinearLayout.LayoutParams(-1,-2));
        else{ScrollView scroll=new ScrollView(this);scroll.setFocusable(false);scroll.setDescendantFocusability(android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS);scroll.setVerticalScrollBarEnabled(false);scroll.setHorizontalScrollBarEnabled(false);scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);scroll.addView(choices);panel.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));}
        List<View> buttons=new ArrayList<>();
        for(int i=0;i<labels.size();i++){final int index=i;String[] parts=labels.get(i).split("\n",2);View button;
            if(summary){LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(14),0,dp(14),0);TextView name=settingsText(parts[0],15);row.addView(name,new LinearLayout.LayoutParams(0,-2,1));TextView value=settingsText(parts.length>1?parts[1]:"",14);value.setTextColor(0xFFBCBFC8);value.setMaxWidth(dp(125));value.setGravity(Gravity.END);row.addView(value,new LinearLayout.LayoutParams(-2,-2));button=row;}
            else{TextView option=settingsText(labels.get(i),15);option.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);option.setPadding(dp(14),0,dp(14),0);button=option;}
            button.setId(View.generateViewId());button.setFocusable(true);button.setFocusableInTouchMode(true);button.setClickable(true);button.setSelected(i==selected);button.setContentDescription(labels.get(i)+(i==selected?", selected":""));button.setBackground(TVControls.buttonBackground(this));LinearLayout.LayoutParams rowLayout=new LinearLayout.LayoutParams(-1,dp(summary?rowHeight:40));rowLayout.bottomMargin=dp(summary?6:4);choices.addView(button,rowLayout);buttons.add(button);button.setOnClickListener(v->choose.accept(index));
        }
        TextView back=settingsText(summary?"Done":"Back to settings",15);back.setId(View.generateViewId());back.setGravity(Gravity.CENTER);back.setFocusable(true);back.setFocusableInTouchMode(true);back.setClickable(true);back.setBackground(TVControls.buttonBackground(this));back.setOnClickListener(v->{if(summary)dialog.dismiss();else showSettings();});LinearLayout.LayoutParams backLayout=new LinearLayout.LayoutParams(-1,dp(40));backLayout.topMargin=dp(12);panel.addView(back,backLayout);
        for(int i=0;i<buttons.size();i++){View button=buttons.get(i);button.setNextFocusUpId(buttons.get(Math.max(0,i-1)).getId());button.setNextFocusDownId(i<buttons.size()-1?buttons.get(i+1).getId():back.getId());button.setNextFocusLeftId(button.getId());button.setNextFocusRightId(button.getId());}
        if(!buttons.isEmpty())back.setNextFocusUpId(buttons.get(buttons.size()-1).getId());back.setNextFocusDownId(back.getId());
        dialog.setOnKeyListener((ignored,key,event)->{if(key!=KeyEvent.KEYCODE_BACK)return false;if(event.getAction()==KeyEvent.ACTION_UP){if(summary)dialog.dismiss();else showSettings();}return true;});
        dialog.setContentView(panel);dialog.setOnDismissListener(ignored->{settingsDialog=null;if(view!=null){view.showController();if(settingsButton!=null)settingsButton.requestFocus();}});dialog.show();
        android.view.Window window=dialog.getWindow();if(window!=null){window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);WindowManager.LayoutParams params=window.getAttributes();params.dimAmount=.4f;params.gravity=Gravity.END|Gravity.CENTER_VERTICAL;params.x=dp(touch?16:28);window.setAttributes(params);int availableHeight=getWindow().getDecorView().getHeight();if(availableHeight<=0)availableHeight=getResources().getDisplayMetrics().heightPixels;window.setLayout(Math.min(dp(360),getResources().getDisplayMetrics().widthPixels-dp(touch?32:56)),summary?WindowManager.LayoutParams.WRAP_CONTENT:Math.min(dp(122+labels.size()*44),availableHeight-dp(48)));}
        if(!touch&&!buttons.isEmpty())panel.post(()->buttons.get(Math.max(0,Math.min(selected,buttons.size()-1))).requestFocus());
    }
    private void showSettings(){
        try{List<String> labels=new ArrayList<>();labels.add("Video quality\n"+streams.getJSONObject(quality).optString("quality"));labels.add("Audio\n"+selectedTrack(C.TRACK_TYPE_AUDIO));labels.add("Subtitles\n"+selectedTrack(C.TRACK_TYPE_TEXT));labels.add("Playback speed\n"+speedLabel(player.getPlaybackParameters().speed));openSettings("Playback settings",labels,-1,index->{if(index==0)chooseQuality();else if(index==1)chooseTrack(C.TRACK_TYPE_AUDIO);else if(index==2)chooseTrack(C.TRACK_TYPE_TEXT);else chooseSpeed();});}catch(Exception ignored){}
    }
    private String speedLabel(float speed){return speed==1f?"Normal":String.format(java.util.Locale.US,"%.2f",speed).replaceAll("0+$","").replaceAll("\\.$","")+" times";}
    private String trackLabel(androidx.media3.common.Format format,int index){if(format.label!=null&&!format.label.isEmpty())return format.label;if(format.language!=null&&!format.language.equals("und"))return java.util.Locale.forLanguageTag(format.language).getDisplayLanguage(java.util.Locale.ENGLISH);return "Track "+(index+1);}
    private String selectedTrack(int type){if(player.getTrackSelectionParameters().disabledTrackTypes.contains(type))return "Off";for(Tracks.Group group:player.getCurrentTracks().getGroups())if(group.getType()==type)for(int i=0;i<group.length;i++)if(group.isTrackSelected(i))return trackLabel(group.getTrackFormat(i),i);return type==C.TRACK_TYPE_TEXT?"Off":"Default";}
    private void chooseQuality(){try{List<String> labels=new ArrayList<>();for(int i=0;i<streams.length();i++)labels.add(streams.getJSONObject(i).optString("quality"));openSettings("Video quality",labels,quality,index->{if(index!=quality){quality=index;alternative=0;try{buildPlayer();}catch(Exception e){error="This quality could not be played.";close();}}showSettings();});}catch(Exception ignored){}}
    private void chooseSpeed(){float[] speeds={.5f,.75f,1f,1.25f,1.5f,2f};List<String> labels=new ArrayList<>();int selected=2;for(int i=0;i<speeds.length;i++){labels.add(speedLabel(speeds[i]));if(Math.abs(player.getPlaybackParameters().speed-speeds[i])<.01f)selected=i;}openSettings("Playback speed",labels,selected,index->{player.setPlaybackSpeed(speeds[index]);showSettings();});}
    private void chooseTrack(int type){
        List<String> labels=new ArrayList<>();List<Tracks.Group> groups=new ArrayList<>();List<Integer> indices=new ArrayList<>();int selected=-1;
        if(type==C.TRACK_TYPE_TEXT){labels.add("Off");groups.add(null);indices.add(-1);if(player.getTrackSelectionParameters().disabledTrackTypes.contains(type)||selectedTrack(type).equals("Off"))selected=0;}
        for(Tracks.Group group:player.getCurrentTracks().getGroups())if(group.getType()==type)for(int i=0;i<group.length;i++)if(group.isTrackSupported(i)){if(group.isTrackSelected(i)&&!player.getTrackSelectionParameters().disabledTrackTypes.contains(type))selected=labels.size();labels.add(trackLabel(group.getTrackFormat(i),i));groups.add(group);indices.add(i);}
        if(labels.isEmpty()){labels.add("Default audio");groups.add(null);indices.add(-1);}
        openSettings(type==C.TRACK_TYPE_TEXT?"Subtitles":"Audio",labels,selected,index->{TrackSelectionParameters.Builder parameters=player.getTrackSelectionParameters().buildUpon().clearOverridesOfType(type);Tracks.Group group=groups.get(index);parameters.setTrackTypeDisabled(type,type==C.TRACK_TYPE_TEXT&&group==null);if(group!=null){parameters.addOverride(new TrackSelectionOverride(group.getMediaTrackGroup(),indices.get(index)));String language=group.getTrackFormat(indices.get(index)).language;if(type==C.TRACK_TYPE_TEXT)parameters.setPreferredTextLanguage(language);else parameters.setPreferredAudioLanguage(language);}player.setTrackSelectionParameters(parameters.build());showSettings();});
    }
    private void persist(){
        if(player==null||record==null)return;
        try{long duration=player.getDuration();if(duration<=0||duration==C.TIME_UNSET)return;savedPosition=player.getCurrentPosition();savedDuration=duration/1000.0;record.put("position",savedPosition/1000.0);record.put("duration",savedDuration);record.put("updatedAt",System.currentTimeMillis());record.put("completed",ended);String key=record.getJSONObject("item").getString("id")+":"+record.optString("season","movie")+":"+record.optString("episode","movie");getSharedPreferences("rezka-progress",0).edit().putString(key,record.toString()).commit();}catch(Exception ignored){}
    }
    private void close(){if(closing)return;closing=true;persist();Intent result=new Intent();result.putExtra("position",savedPosition/1000.0);result.putExtra("duration",savedDuration);result.putExtra("ended",ended);if(error!=null)result.putExtra("error",error);if(settingsDialog!=null){settingsDialog.setOnDismissListener(null);settingsDialog.dismiss();settingsDialog=null;}if(session!=null){session.release();session=null;}if(player!=null){view.setPlayer(null);player.release();player=null;}setResult(RESULT_OK,result);finish();}
    @Override public boolean dispatchKeyEvent(KeyEvent event){
        if(event.getKeyCode()==KeyEvent.KEYCODE_MENU){if(event.getAction()==KeyEvent.ACTION_UP)showSettings();return true;}
        if(view!=null&&timeBar!=null&&(event.getKeyCode()==KeyEvent.KEYCODE_DPAD_LEFT||event.getKeyCode()==KeyEvent.KEYCODE_DPAD_RIGHT)&&!view.isControllerFullyVisible()){view.showController();timeBar.requestFocus();return timeBar.dispatchKeyEvent(event);}
        return view!=null&&view.dispatchKeyEvent(event)||super.dispatchKeyEvent(event);
    }
    @Override protected void onPause(){if((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.d("RezkaPlayer","activity paused");persist();if(player!=null)player.pause();super.onPause();}
    @Override protected void onStop(){persist();super.onStop();}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);persist();if(session!=null)session.release();if(player!=null)player.release();super.onDestroy();}
}
