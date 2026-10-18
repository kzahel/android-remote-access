package dev.remoteaccess.spike;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.widget.TextView;

/** Ordinary app wake/dismiss request, never a credential bypass. */
public final class WakeActivity extends Activity {
    private final Handler main=new Handler();
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); setShowWhenLocked(true); setTurnScreenOn(true);
        TextView text=new TextView(this); text.setText("Remote access requested\nYour phone lock stays in control.");
        text.setTextSize(24); text.setPadding(48,100,48,0); setContentView(text);
        handleRequest();
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleRequest(); }
    private void handleRequest() {
        main.removeCallbacksAndMessages(null);
        if (getIntent().getBooleanExtra("dismiss",false)) {
            main.postDelayed(() -> getSystemService(KeyguardManager.class).requestDismissKeyguard(this,new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { finish(); }
                @Override public void onDismissCancelled() { finish(); }
                @Override public void onDismissError() { finish(); }
            }),250);
            main.postDelayed(this::finish,60000);
        } else main.postDelayed(this::finish,1500);
    }
    @Override protected void onDestroy() { main.removeCallbacksAndMessages(null); super.onDestroy(); }
}
