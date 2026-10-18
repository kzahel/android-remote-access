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
        intro.setText("EMULATOR SPIKE\n\nAllow screen access, then start a session. The paired browser can see your screen and send your actions. Stop here at any time.");
        intro.setTextSize(16); intro.setPadding(0,32,0,32); page.addView(intro);
        status = new TextView(this); status.setTextSize(16); page.addView(status);
        button(page,"1 · Allow screen access", v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        button(page,"2 · Start remote access", v -> {
            if (AccessService.current == null) { toast("Enable Remote access spike in Accessibility first"); return; }
            try { AccessService.current.arm(); refresh(); } catch (Exception e) { toast("Demo pairing is missing. Run the demo setup on your computer."); }
        });
        button(page,"Open demo power station", v -> startActivity(new Intent(this,StationActivity.class)));
        button(page,"Stop remote access", v -> { if (AccessService.current != null) AccessService.current.disarm(); refresh(); });
        setContentView(page);
        if (android.os.Build.VERSION.SDK_INT >= 33 && !getSystemService(NotificationManager.class).areNotificationsEnabled())
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
    }
    @Override public void onResume() { super.onResume(); refresh(); }
    private void refresh() {
        AccessService svc = AccessService.current;
        status.setText(svc == null ? "Screen access needs permission" : svc.armed ? "Remote access is on · use Stop to revoke" : "Screen access allowed · remote access is off");
    }
    private void button(LinearLayout parent,String text,View.OnClickListener action) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setOnClickListener(action); parent.addView(b);
    }
    private void toast(String message) { Toast.makeText(this,message,Toast.LENGTH_LONG).show(); }
}
