package dev.remoteaccess.spike;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.view.WindowManager;
import android.widget.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;

/** Synthetic RV task; no Bluetooth, vendor app, or real telemetry. */
public final class StationActivity extends Activity {
    private final Handler handler = new Handler();
    private TextView fresh;
    private EditText name;
    private boolean secure;
    private boolean output;
    private int watts = 142;
    private long tick;
    private final Runnable clock = new Runnable() {
        @Override public void run() { if (fresh != null) { tick++; fresh.setText("Live demo · " + new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.ROOT).format(new java.util.Date())); witness(); handler.postDelayed(this,1000); } }
    };
    @Override public void onCreate(Bundle state) { super.onCreate(state); render(); }
    private void render() {
        LinearLayout p = new LinearLayout(this); p.setOrientation(LinearLayout.VERTICAL);
        p.setPadding(42,70,42,30); p.setBackgroundColor(0xfff4f6ef);
        label(p,"FIELD STATION",15,0xff56705c);
        label(p,"A little sun.\nA lot of possibility.",30,0xff203c30);
        label(p,"76%",76,0xff244e38);
        label(p,"BATTERY · DEMO DATA",13,0xff65766a);
        LinearLayout row = new LinearLayout(this); row.setPadding(0,32,0,24);
        TextView power = label(row,"☀  " + watts + " W\nSolar input",21,0xff38573c);
        p.addView(row);
        fresh = label(p,"Live demo",14,0xff69786b);
        Button details = new Button(this); details.setText("Refresh solar reading"); details.setAllCaps(false);
        details.setOnClickListener(v -> { watts += 7; power.setText("☀  " + watts + " W\nSolar input"); witness(); }); p.addView(details);
        Switch toggle = new Switch(this); toggle.setText("AC output"); toggle.setTextSize(19); toggle.setPadding(0,20,0,20); toggle.setChecked(output);
        toggle.setOnCheckedChangeListener((b,on) -> { output=on; witness(); }); p.addView(toggle);
        label(p,"STATION NAME",13,0xff65766a);
        name = new EditText(this); name.setText("RV battery"); name.setSingleLine(true); name.setContentDescription("Station name");
        name.setId(R.id.station_name); p.addView(name);
        Button save = new Button(this); save.setText("Save name"); save.setAllCaps(false); p.addView(save);
        TextView saved = label(p,"",16,0xff365d42);
        save.setOnClickListener(v -> { saved.setText("Saved · " + name.getText()); witness(); });
        Button protect = new Button(this); protect.setText("Test protected screen"); protect.setAllCaps(false);
        protect.setOnClickListener(v -> { secure=!secure;
            if (secure) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            protect.setText(secure ? "Leave protected screen" : "Test protected screen"); witness(); }); p.addView(protect);
        label(p,"Synthetic fixture · no real battery connected",12,0xff788579);
        ScrollView scroll = new ScrollView(this); scroll.addView(p); setContentView(scroll);
        handler.removeCallbacks(clock); handler.post(clock); witness();
    }
    private TextView label(LinearLayout parent,String text,int size,int color) {
        TextView t = new TextView(this); t.setText(text); t.setTextSize(size); t.setTextColor(color); parent.addView(t); return t;
    }
    private void witness() {
        try { JSONObject data = new JSONObject().put("watts",watts).put("output",output).put("name",name == null ? "" : name.getText()).put("secure",secure).put("tick",tick);
            Files.write(new java.io.File(getFilesDir(),"fixture.json").toPath(),data.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }
    @Override protected void onDestroy() { handler.removeCallbacks(clock); super.onDestroy(); }
}
