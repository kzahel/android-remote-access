package dev.remoteaccess.spike;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.*;

public final class SetupActivity extends Activity {
    private TextView status;
    private static final int SMOOTH_VIEW=42;
    private boolean remoteSmooth;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if ("stop".equals(getIntent().getAction()) && AccessService.current != null)
            AccessService.current.disarm();
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL); page.setPadding(48, 80, 48, 32);
        page.setBackgroundColor(0xfff7f7f2);
        TextView title = new TextView(this); title.setText("Your phone, within reach");
        title.setTextSize(28); title.setTextColor(0xff18352b); page.addView(title);
        TextView intro = new TextView(this);
        intro.setText("LOCAL PROTOTYPE\n\nAllow screen access, then start a session. The paired browser can see your screen and send your actions. Stop here at any time.");
        intro.setTextSize(16); intro.setPadding(0,32,0,32); page.addView(intro);
        status = new TextView(this); status.setTextSize(16); page.addView(status);
        button(page,"1 · Allow screen access", v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        button(page,"2 · Start remote access", v -> {
            if (AccessService.current == null || !AccessService.current.authorityReady()) { toast("Allow screen access first, or wait for it to reconnect"); return; }
            try { AccessService.current.arm(); refresh(); } catch (Exception e) { toast("Demo pairing is missing. Run the demo setup on your computer."); }
        });
        button(page,"Open demo power station", v -> startActivity(new Intent(this,StationActivity.class)));
        button(page,"Allow smooth screen sharing", v -> smoothView());
        button(page,"Open touch playground", v -> startActivity(new Intent(this,TouchLabActivity.class)));
        button(page,"Stop remote access", v -> { if (AccessService.current != null) AccessService.current.disarm(); refresh(); });
        Switch restart = new Switch(this);
        restart.setText("Start remote access after the phone restarts\nUnlock the phone once after a restart; access then starts by itself.");
        restart.setTextSize(15); restart.setPadding(0,24,0,0);
        restart.setChecked(AccessService.startsAfterRestart(this));
        restart.setOnCheckedChangeListener((b,on) -> AccessService.setStartAfterRestart(this,on));
        page.addView(restart);
        handle(getIntent());
        setContentView(page);
        if (android.os.Build.VERSION.SDK_INT >= 33 && !getSystemService(NotificationManager.class).areNotificationsEnabled())
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
    }
    @Override public void onResume() {
        super.onResume(); refresh();
        java.io.File request=new java.io.File(getFilesDir(),"start-request.json");
        if (BuildConfig.DEBUG && (android.os.Build.HARDWARE.equals("ranchu") || android.os.Build.HARDWARE.equals("goldfish")) && request.exists()) {
            try {
                org.json.JSONObject data=new org.json.JSONObject(new String(java.nio.file.Files.readAllBytes(request.toPath()),java.nio.charset.StandardCharsets.UTF_8));
                boolean fresh=Math.abs(System.currentTimeMillis()-data.getLong("createdAtMillis"))<60000;
                if (!request.delete()) return;
                if (fresh) startPreparedDemo(0);
            } catch (Exception ignored) { request.delete(); }
        }
    }
    private void startPreparedDemo(int attempt) {
        if (isFinishing() || isDestroyed()) return;
        if ((AccessService.current==null || !AccessService.current.authorityReady()) && attempt<30) {
            new android.os.Handler(getMainLooper()).postDelayed(() -> startPreparedDemo(attempt+1),100); return;
        }
        if (AccessService.current!=null) try { AccessService.current.arm(); refresh(); }
        catch (Exception ignored) { toast("Demo pairing is unavailable"); }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handle(intent); }
    /** A browser Smooth view request: show Android's consent, then return to the previous screen. */
    private void handle(Intent intent) {
        if (intent!=null && "smooth".equals(intent.getAction())) { remoteSmooth=true; smoothView(); }
    }
    private void refresh() {
        AccessService svc = AccessService.current;
        status.setText(svc == null || !svc.authorityReady() ? "Screen access needs permission or is reconnecting" : svc.armed ? "Remote access is on · use Stop to revoke" : "Screen access allowed · remote access is off");
    }
    private void smoothView() {
        if(AccessService.current==null || !AccessService.current.armed) {toast("Start remote access first");return;}
        if(VideoService.status().optBoolean("active")) { if(remoteSmooth){remoteSmooth=false;moveTaskToBack(true);} return; }
        android.media.projection.MediaProjectionManager manager=getSystemService(android.media.projection.MediaProjectionManager.class);
        Intent capture=android.os.Build.VERSION.SDK_INT>=34
            ?manager.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())
            :manager.createScreenCaptureIntent();
        startActivityForResult(capture,SMOOTH_VIEW);
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==SMOOTH_VIEW && result==RESULT_OK && data!=null)
            startForegroundService(new Intent(this,VideoService.class).putExtra("consent",data).putExtra("result",result));
        if(request==SMOOTH_VIEW && remoteSmooth) { remoteSmooth=false; moveTaskToBack(true); }
    }
    private void button(LinearLayout parent,String text,View.OnClickListener action) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setOnClickListener(action); parent.addView(b);
    }
    private void toast(String message) { Toast.makeText(this,message,Toast.LENGTH_LONG).show(); }
}
