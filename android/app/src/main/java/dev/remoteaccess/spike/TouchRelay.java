package dev.remoteaccess.spike;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Handler;
import android.os.SystemClock;
import java.util.LinkedHashMap;
import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONObject;

/** Ordered, bounded continuation batches. All methods run on the service main thread. */
final class TouchRelay {
    interface Reply { void send(boolean ok, String message, JSONObject data); }
    private static final class Finger {
        final GestureDescription.StrokeDescription stroke;
        final float x,y;
        Finger(GestureDescription.StrokeDescription stroke,float x,float y) { this.stroke=stroke; this.x=x; this.y=y; }
    }
    private final AccessibilityService service;
    private final Handler main;
    private final LinkedHashMap<Integer,Finger> fingers=new LinkedHashMap<>();
    private String owner;
    private long sequence, epoch, lastPacket, started;
    private int width,height,rotation,window;
    private boolean busy;
    private Reply pending;
    TouchRelay(AccessibilityService service,Handler main) { this.service=service; this.main=main; }
    boolean active() { return owner!=null; }
    boolean busy() { return busy; }
    private final Runnable watchdog=new Runnable() {
        @Override public void run() {
            if (!active()) return;
            if (SystemClock.elapsedRealtime()-lastPacket>700 || SystemClock.elapsedRealtime()-started>60000) {
                release("Touch ended because its viewer stopped responding"); return;
            }
            main.postDelayed(this,100);
        }
    };
    void accept(JSONObject c,int screenWidth,int screenHeight,int currentRotation,int currentWindow,Reply reply) throws Exception {
        String gesture=c.getString("gesture");
        if (!gesture.matches("[A-Za-z0-9-]{16,80}")) throw new IllegalArgumentException("Invalid touch session");
        long seq=c.getLong("sequence");
        if (busy) throw new IllegalStateException("Previous touch batch is still running");
        if (active() && (!owner.equals(gesture) || seq!=sequence+1)) throw new IllegalStateException("Touch owner or sequence changed; no replay");
        if (!active() && seq!=0) throw new IllegalStateException("Touch session ended; start again from a fresh frame");
        if (active() && (rotation!=currentRotation || window!=currentWindow)) {
            release("Phone window or rotation changed"); throw new IllegalStateException("Phone changed; lift your fingers and start again");
        }
        int duration=c.getInt("duration");
        if (duration<16 || duration>100) throw new IllegalArgumentException("Touch batch duration must be 16–100 ms");
        JSONArray points=c.getJSONArray("points");
        if (points.length()<1 || points.length()>10) throw new IllegalArgumentException("Use 1–10 fingers");
        int w=active()?width:screenWidth,h=active()?height:screenHeight;
        GestureDescription.Builder builder=new GestureDescription.Builder();
        LinkedHashMap<Integer,Finger> next=new LinkedHashMap<>();
        HashSet<Integer> included=new HashSet<>();
        boolean hasEvent=false;
        for (int i=0;i<points.length();i++) {
            JSONObject p=points.getJSONObject(i); int id=p.getInt("id");
            if (id<0 || id>1000000 || !included.add(id)) throw new IllegalArgumentException("Invalid or duplicate finger identity");
            JSONArray samples=p.getJSONArray("path");
            if (samples.length()<1 || samples.length()>24) throw new IllegalArgumentException("Touch path must contain 1–24 samples");
            Finger previous=fingers.get(id);
            if(previous==null)hasEvent=true;
            Path path=new Path();
            float x=0,y=0;
            if (previous!=null) path.moveTo(previous.x,previous.y);
            for (int j=0;j<samples.length();j++) {
                JSONArray xy=samples.getJSONArray(j);
                double dx=xy.getDouble(0),dy=xy.getDouble(1);
                if (!Double.isFinite(dx)||!Double.isFinite(dy)||dx<0||dy<0||dx>=w||dy>=h)
                    throw new IllegalArgumentException("Finger is outside this screen");
                x=(float)dx; y=(float)dy;
                if(previous!=null&&(x!=previous.x||y!=previous.y))hasEvent=true;
                if (j==0 && previous==null) path.moveTo(x,y); else path.lineTo(x,y);
            }
            boolean held=p.getBoolean("held");
            if(!held)hasEvent=true;
            int start=previous==null&&active()?1:0;
            GestureDescription.StrokeDescription stroke=previous==null
                ?new GestureDescription.StrokeDescription(path,start,duration-start,held)
                :previous.stroke.continueStroke(path,0,duration,held);
            builder.addStroke(stroke);
            if (held) next.put(id,new Finger(stroke,x,y));
        }
        if (!included.containsAll(fingers.keySet())) throw new IllegalArgumentException("Every held finger must be continued or released");
        if(!hasEvent) {
            // Android rejects a stationary continuation with no MotionEvents.
            // Keep the existing stroke IDs and renew only the viewer watchdog.
            sequence=seq;lastPacket=SystemClock.elapsedRealtime();
            reply.send(true,"Touch held",new JSONObject().put("gesture",gesture).put("sequence",seq).put("held",fingers.size()));return;
        }
        GestureDescription gestureDescription=builder.build();
        if (!active()) {
            owner=gesture; width=w; height=h; rotation=currentRotation; window=currentWindow;
            started=SystemClock.elapsedRealtime(); main.postDelayed(watchdog,100);
        }
        sequence=seq; lastPacket=SystemClock.elapsedRealtime(); busy=true; pending=reply;
        long version=++epoch;
        // Retain the dispatched endpoints so Stop/timeout can release even mid-batch.
        fingers.clear(); fingers.putAll(next);
        boolean accepted=service.dispatchGesture(gestureDescription,new AccessibilityService.GestureResultCallback() {
            @Override public void onCompleted(GestureDescription g) {
                if (version!=epoch) return;
                busy=false; pending=null;
                try { reply.send(true,"Touch batch delivered",new JSONObject().put("gesture",gesture).put("sequence",seq).put("held",fingers.size())); }
                catch (Exception ignored) { }
                if (fingers.isEmpty()) clear();
            }
            @Override public void onCancelled(GestureDescription g) {
                if (version!=epoch) return;
                busy=false; pending=null; clear();
                reply.send(false,"Android cancelled touch; lift your fingers to start again",null);
            }
        },main);
        if (!accepted) { busy=false; pending=null; clear(); reply.send(false,"Android refused touch; no replay",null); }
    }
    private void clear() {
        fingers.clear(); owner=null; busy=false; main.removeCallbacks(watchdog);
    }
    void release(String reason) {
        epoch++;
        Reply interrupted=pending; pending=null;
        // Public accessibility has no raw ACTION_CANCEL API. End continued
        // contacts at their last endpoint; do not inject an unrelated dummy tap.
        if (!fingers.isEmpty()) {
            try {
                GestureDescription.Builder b=new GestureDescription.Builder();
                for (Finger finger:fingers.values()) {
                    Path p=new Path();p.moveTo(finger.x,finger.y);
                    b.addStroke(finger.stroke.continueStroke(p,0,16,false));
                }
                service.dispatchGesture(b.build(),null,main);
            } catch (Exception ignored) { }
        }
        clear();
        if (interrupted!=null) interrupted.send(false,reason+"; no replay",null);
    }
}
