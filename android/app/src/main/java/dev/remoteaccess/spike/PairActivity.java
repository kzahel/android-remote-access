package dev.remoteaccess.spike;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/**
 * Grants a browser access after its QR code is scanned. Nothing is sent until
 * the owner taps Grant; the code's secret proves to the browser that this phone
 * read its screen, and the browser key is checked against the code's fingerprint.
 */
public final class PairActivity extends Activity {
    private LinearLayout page;
    private TextView title, body, status;
    private Button grant, next;
    private String id, secret, viewerFpr, viewerName;
    private final JSONArray routes=new JSONArray();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        page=new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(48,80,48,32); page.setBackgroundColor(0xfff7f7f2);
        title=text(26,0xff18352b); body=text(16,0xff263a32); status=text(15,0xff778179);
        body.setPadding(0,32,0,24);
        grant=button("Grant",v -> grant());
        next=button("Allow screen access",v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        button("Cancel",v -> finish());
        grant.setVisibility(View.GONE); next.setVisibility(View.GONE);
        setContentView(page);
        Uri data=getIntent().getData();
        if (data!=null) show(data);
        else if (state==null) scan();
    }

    private void scan() {
        title.setText("Scan the code on your computer");
        GmsBarcodeScanning.getClient(this,new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
            .startScan()
            .addOnSuccessListener(code -> { String raw=code.getRawValue(); if (raw==null) refuse("That code is not a pairing code"); else show(Uri.parse(raw)); })
            .addOnCanceledListener(this::finish)
            .addOnFailureListener(e -> refuse("The scanner is unavailable: "+e.getMessage()));
    }

    private void show(Uri code) {
        try {
            if (!"rapair".equals(code.getScheme()) || !"pair".equals(code.getHost()) || code.getEncodedFragment()==null)
                throw new IllegalArgumentException("That code is not a pairing code");
            Uri fields=Uri.parse("x://pair?"+code.getEncodedFragment());
            if (!"1".equals(fields.getQueryParameter("v"))) throw new IllegalArgumentException("This pairing code needs a newer app");
            id=fields.getQueryParameter("i"); secret=fields.getQueryParameter("s");
            viewerFpr=fields.getQueryParameter("f"); viewerName=fields.getQueryParameter("n");
            String listed=fields.getQueryParameter("r");
            if (id==null || secret==null || viewerFpr==null || viewerName==null || listed==null || viewerName.length()>60)
                throw new IllegalArgumentException("The pairing code is incomplete");
            for (String route:listed.split(",")) {
                int colon=route.lastIndexOf(':');
                String host=route.substring(0,colon);
                if (!AccessService.allowedHost(host)) throw new IllegalArgumentException("This prototype only pairs through a local or Tailscale address");
                routes.put(new JSONObject().put("host",host).put("port",Integer.parseInt(route.substring(colon+1))));
            }
        } catch (Exception e) { refuse(e.getMessage()); return; }
        title.setText("Allow “"+viewerName+"” to view and control this phone?");
        body.setText("While remote access is on, this browser can see your screen and tap and type for you, "
            +"using Android's accessibility service. Only grant access to a browser you are using yourself.\n\n"
            +"You can remove it from Remote access on this phone at any time.");
        status.setText("Connects through "+routes.optJSONObject(routes.length()-1).optString("host"));
        grant.setVisibility(View.VISIBLE);
    }

    private void grant() {
        grant.setEnabled(false); status.setText("Waiting for your browser to confirm…");
        new Thread(() -> {
            String outcome;
            try { outcome=exchange(); } catch (Exception e) { outcome=e.getMessage()==null ? "Pairing failed" : e.getMessage(); }
            String message=outcome;
            runOnUiThread(() -> done(message));
        },"pairing").start();
    }

    /** Returns null when paired, otherwise a reason for the owner. */
    private String exchange() throws Exception {
        IOException last=null;
        for (int i=0;i<routes.length();i++) {
            JSONObject route=routes.getJSONObject(i);
            try (Socket socket=new Socket()) {
                socket.connect(new InetSocketAddress(route.getString("host"),route.getInt("port")),5000); socket.setSoTimeout(10000);
                BufferedReader in=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));
                JSONObject challenge=new JSONObject(in.readLine());
                if (!"challenge".equals(challenge.optString("type"))) throw new IOException("The relay did not answer as expected");
                String phoneKey=Paired.publicKey();
                JSONObject request=new JSONObject().put("type","pair").put("id",id).put("phoneKey",phoneKey).put("name",Build.MODEL)
                    .put("mac",Paired.mac(secret,"rap1-pair-mac|"+id+"|"+phoneKey+"|"+viewerFpr))
                    .put("signature",Paired.sign("rap1-phone-pair|"+challenge.getString("nonce")+"|"+id));
                OutputStream out=socket.getOutputStream(); out.write((request+"\n").getBytes(StandardCharsets.UTF_8)); out.flush();
                // The browser confirms on its own once it has checked this phone.
                socket.setSoTimeout(5*60*1000);
                String line=in.readLine();
                if (line==null) return "The pairing code expired or the browser closed";
                JSONObject answer=new JSONObject(line);
                if (!"paired".equals(answer.optString("type"))) return answer.optString("message","The browser did not accept this phone");
                String viewerKey=answer.getString("viewerKey");
                if (!Paired.fingerprint(viewerKey).equals(viewerFpr)) return "The browser that answered is not the one that showed this code";
                Paired.addViewer(this,routes,viewerKey,viewerName);
                return null;
            } catch (IOException e) { last=e; }
        }
        throw last==null ? new IOException("No route to the relay") : new IOException("Could not reach the relay: "+last.getMessage());
    }

    private void done(String problem) {
        if (problem!=null) { status.setText(problem); grant.setVisibility(View.GONE); return; }
        title.setText("“"+viewerName+"” can now reach this phone");
        grant.setVisibility(View.GONE);
        AccessService svc=AccessService.current;
        if (svc!=null && svc.authorityReady()) {
            try { svc.arm(); body.setText("Remote access is on. Use Stop in Remote access or the notification to turn it off."); }
            catch (Exception e) { body.setText("Paired, but remote access could not start: "+e.getMessage()); }
            status.setText("");
        } else {
            body.setText("One more step: allow Remote access to see and control the screen.");
            status.setText("Open Accessibility, choose Remote access spike, and turn it on.");
            next.setVisibility(View.VISIBLE);
        }
    }

    private void refuse(String reason) { title.setText("Can't pair"); body.setText(reason); grant.setVisibility(View.GONE); }
    private TextView text(int size,int color) { TextView t=new TextView(this); t.setTextSize(size); t.setTextColor(color); page.addView(t); return t; }
    private Button button(String label,View.OnClickListener action) {
        Button b=new Button(this); b.setText(label); b.setAllCaps(false); b.setOnClickListener(action); page.addView(b); return b;
    }
}
