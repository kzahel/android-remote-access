package dev.remoteaccess.spike;

import android.app.*;
import android.content.Intent;
import android.content.Context;
import android.graphics.Point;
import android.hardware.display.*;
import android.media.*;
import android.media.projection.*;
import android.os.*;
import android.util.Base64;
import android.view.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.io.*;
import org.json.*;

/** A visible, user-consented projection. Never stores or reuses consent tokens. */
public final class VideoService extends Service {
    private static volatile VideoService current;
    private static volatile String reason="Smooth view needs permission on the phone";
    private volatile boolean running,requestKeyframe;
    private volatile int pendingWidth,pendingHeight;
    private volatile Socket socket;
    private MediaProjection projection;
    private VirtualDisplay display;
    private MediaCodec encoder;
    private Surface surface;
    private int width,height,sourceWidth,sourceHeight,rotation;
    private String linkedGeneration="";
    private byte[] configuration=new byte[0];
    private String codec="avc1.42c028";
    // Viewer-chosen quality, remembered on the phone. Auto follows whether
    // Android reports the phone's active network as unmetered.
    static final java.util.List<String> MODES=java.util.Arrays.asList("auto","smooth","standard","saver");
    private volatile boolean reconfigure;
    private String profile="standard";
    private int fps=30;
    private long networkCheckedAt;
    public static JSONObject status() {
        try { VideoService s=current;return new JSONObject().put("active",s!=null&&s.running).put("message",reason)
            .put("width",s==null?0:s.width).put("height",s==null?0:s.height)
            .put("mode",mode(AccessService.current)).put("profile",s==null?"":s.profile).put("fps",s==null?0:s.fps); } catch(Exception e) {return new JSONObject();}
    }
    static String mode(Context context) {
        return context==null ? "auto" : context.getSharedPreferences("video",MODE_PRIVATE).getString("mode","auto");
    }
    static void setMode(Context context,String mode) {
        if(!MODES.contains(mode))throw new IllegalArgumentException("Unknown video quality");
        context.getSharedPreferences("video",MODE_PRIVATE).edit().putString("mode",mode).apply();
        if(current!=null)current.reconfigure=true;
    }
    private String chooseProfile() {
        String m=mode(this);
        if(!m.equals("auto"))return m;
        android.net.ConnectivityManager cm=getSystemService(android.net.ConnectivityManager.class);
        android.net.NetworkCapabilities caps=cm.getNetworkCapabilities(cm.getActiveNetwork());
        boolean unmetered=caps!=null&&(caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            ||caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED));
        return unmetered?"standard":"saver";
    }
    public static void keyframe() { if(current!=null)current.requestKeyframe=true; }
    public static void end(Context context) { if(current!=null)context.stopService(new Intent(context,VideoService.class)); }
    @Override public IBinder onBind(Intent i) { return null; }
    @Override public int onStartCommand(Intent intent,int flags,int id) {
        if(running)return START_NOT_STICKY;
        current=this;reason="Starting smooth view";
        NotificationManager nm=getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("smooth_view","Screen sharing",NotificationManager.IMPORTANCE_LOW));
        Intent stop=new Intent(this,SetupActivity.class).setAction("stop");
        PendingIntent action=PendingIntent.getActivity(this,2,stop,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(2,new Notification.Builder(this,"smooth_view").setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Your screen is being shared").setContentText("Stop remote access on the phone to end sharing")
            .setContentIntent(action).setOngoing(true).build(),android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        try {
            if(intent==null||AccessService.current==null||!AccessService.current.armed)throw new IllegalStateException("Start remote access first");
            Intent consent=intent.getParcelableExtra("consent");
            projection=getSystemService(MediaProjectionManager.class).getMediaProjection(intent.getIntExtra("result",0),consent);
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { reason="Android ended smooth view. Allow screen sharing again on the phone.";stopSelf(); }
                @Override public void onCapturedContentResize(int w,int h) { pendingWidth=w;pendingHeight=h; }
            },new Handler(getMainLooper()));
            running=true;
            new Thread(this::encode,"screen-video").start();
        } catch(Exception e) {reason="Screen sharing permission is unavailable";stopSelf();}
        return START_NOT_STICKY;
    }
    private void configure(int w,int h) throws Exception {
        if(display!=null)display.setSurface(null);
        if(encoder!=null){encoder.stop();encoder.release();encoder=null;}
        if(surface!=null){surface.release();surface=null;}
        sourceWidth=w;sourceHeight=h;
        float scale=Math.min(1,720f/Math.min(w,h));
        width=Math.round(w*scale/2)*2;height=Math.round(h*scale/2)*2;
        profile=chooseProfile();
        fps=profile.equals("smooth")?60:profile.equals("saver")?10:30;
        int bitrate=profile.equals("smooth")?4000000:profile.equals("saver")?600000:2000000;
        MediaFormat f=MediaFormat.createVideoFormat("video/avc",width,height);
        f.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        f.setInteger(MediaFormat.KEY_BIT_RATE,bitrate);f.setInteger(MediaFormat.KEY_FRAME_RATE,fps);
        // KEY_FRAME_RATE is only a hint; a 120 Hz display otherwise feeds every composition.
        f.setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER,fps);
        f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);f.setInteger(MediaFormat.KEY_PROFILE,MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline);
        f.setInteger(MediaFormat.KEY_MAX_B_FRAMES,0);
        encoder=MediaCodec.createEncoderByType("video/avc");encoder.configure(f,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
        surface=encoder.createInputSurface();encoder.start();configuration=new byte[0];
        int density=getResources().getDisplayMetrics().densityDpi;
        if(display==null)display=projection.createVirtualDisplay("Remote view",width,height,density,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,surface,null,null);
        else {display.resize(width,height,density);display.setSurface(surface);}
        rotation=getSystemService(DisplayManager.class).getDisplay(0).getRotation();
        reason="Smooth view is on";
    }
    private void encode() {
        boolean awaitKey=true;
        try {
            Point p=new Point();getSystemService(DisplayManager.class).getDisplay(0).getRealSize(p);configure(p.x,p.y);
            JSONObject pairing=new JSONObject(new String(Files.readAllBytes(new File(getFilesDir(),"pairing.json").toPath()),StandardCharsets.UTF_8));
            MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
            while(running) {
                AccessService access=AccessService.current;
                if(access==null||!access.armed)break;
                int w=pendingWidth,h=pendingHeight;
                if(w>0&&h>0&&(w!=sourceWidth||h!=sourceHeight)){configure(w,h);awaitKey=true;}
                if(SystemClock.elapsedRealtime()-networkCheckedAt>3000){networkCheckedAt=SystemClock.elapsedRealtime();if(!chooseProfile().equals(profile))reconfigure=true;}
                // Rebuild only the encoder; the projection and its consent continue.
                if(reconfigure){reconfigure=false;configure(sourceWidth,sourceHeight);awaitKey=true;}
                if(requestKeyframe){Bundle b=new Bundle();b.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME,0);encoder.setParameters(b);requestKeyframe=false;}
                int index=encoder.dequeueOutputBuffer(info,20000);
                if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat format=encoder.getOutputFormat();ByteArrayOutputStream csd=new ByteArrayOutputStream();
                    for(String name:new String[]{"csd-0","csd-1"}){ByteBuffer b=format.getByteBuffer(name);if(b!=null){byte[] bytes=new byte[b.remaining()];b.get(bytes);csd.write(bytes);}}
                    configuration=csd.toByteArray();
                    for(int i=0;i+7<configuration.length;i++)if(configuration[i]==0&&configuration[i+1]==0&&configuration[i+2]==1&&(configuration[i+3]&31)==7){codec=String.format(java.util.Locale.ROOT,"avc1.%02x%02x%02x",configuration[i+4]&255,configuration[i+5]&255,configuration[i+6]&255);break;}
                    continue;
                }
                if(index<0)continue;
                byte[] bytes=new byte[info.size];ByteBuffer buffer=encoder.getOutputBuffer(index);buffer.position(info.offset);buffer.get(bytes);encoder.releaseOutputBuffer(index,false);
                if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0){configuration=bytes;continue;}
                if(!access.videoAllowed()){awaitKey=true;continue;}
                String generation=access.connectionGeneration();
                boolean key=(info.flags&MediaCodec.BUFFER_FLAG_KEY_FRAME)!=0;
                try {
                    if(socket==null||!generation.equals(linkedGeneration)) {
                        closeSocket();InetSocketAddress route=access.link();
                        if(route==null||!AccessService.allowedHost(route.getHostString()))throw new IOException("No current remote-access route");
                        socket=new Socket();socket.connect(new InetSocketAddress(route.getHostString(),route.getPort()),3000);socket.setTcpNoDelay(true);linkedGeneration=generation;
                        write(new JSONObject().put("type","hello").put("role","video").put("token",pairing.getString("token")).put("generation",generation));awaitKey=true;requestKeyframe=true;
                    }
                    if(awaitKey&&!key){requestKeyframe=true;continue;}
                    if(key&&configuration.length>0){byte[] combined=new byte[configuration.length+bytes.length];System.arraycopy(configuration,0,combined,0,configuration.length);System.arraycopy(bytes,0,combined,configuration.length,bytes.length);bytes=combined;}
                    awaitKey=false;
                    write(new JSONObject().put("type","video").put("codec",codec).put("key",key).put("timestamp",info.presentationTimeUs)
                        .put("width",width).put("height",height).put("sourceWidth",sourceWidth).put("sourceHeight",sourceHeight).put("rotation",rotation)
                        .put("data",Base64.encodeToString(bytes,Base64.NO_WRAP)));
                } catch(IOException e){closeSocket();awaitKey=true;}
            }
        } catch(Exception e) {if(running)reason="Smooth view stopped; still frames remain available";}
        finally {cleanup();stopSelf();}
    }
    private void write(JSONObject message) throws IOException {OutputStream out=socket.getOutputStream();out.write((message.toString()+"\n").getBytes(StandardCharsets.UTF_8));out.flush();}
    private void closeSocket(){Socket s=socket;socket=null;if(s!=null)try{s.close();}catch(IOException ignored){}}
    private void cleanup(){
        closeSocket();
        if(display!=null){display.release();display=null;}
        if(encoder!=null){try{encoder.stop();encoder.release();}catch(Exception ignored){}encoder=null;}
        if(surface!=null){surface.release();surface=null;}
    }
    @Override public void onDestroy(){running=false;closeSocket();if(current==this)current=null;if(projection!=null){projection.stop();projection=null;}stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
}
