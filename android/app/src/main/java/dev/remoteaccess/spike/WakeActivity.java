package dev.remoteaccess.spike;

import android.app.Activity;
import android.app.KeyguardManager;
import android.os.Bundle;
import android.os.Handler;
import android.widget.TextView;

/** Ordinary app wake/dismiss request, never a credential bypass. */
public final class WakeActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); setShowWhenLocked(true); setTurnScreenOn(true);
        TextView text = new TextView(this); text.setText("Remote access requested\nYour phone lock stays in control.");
        text.setTextSize(24); text.setPadding(48,100,48,0); setContentView(text);
        Handler main=new Handler(getMainLooper());
        if (getIntent().getBooleanExtra("dismiss",false)) {
            main.postDelayed(() -> getSystemService(KeyguardManager.class).requestDismissKeyguard(this,new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { finish(); }
                @Override public void onDismissCancelled() { finish(); }
                @Override public void onDismissError() { finish(); }
            }),250);
            main.postDelayed(this::finish,60000);
        } else main.postDelayed(this::finish,1500);
    }
}
