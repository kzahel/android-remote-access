package dev.remoteaccess.spike;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.*;
import android.content.Intent;
import android.graphics.*;
import android.hardware.HardwareBuffer;
import android.os.*;
import android.util.Base64;
import android.view.Display;
import android.view.accessibility.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Native, human-directed control. ADB is not part of this operation path. */
public final class AccessService extends AccessibilityService {
    public static volatile AccessService current;
    volatile boolean armed;
    private volatile boolean accessBound;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService compression = Executors.newSingleThreadExecutor();
    private final ThreadPoolExecutor outbound = new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16));
    private volatile Socket connection;
    private volatile OutputStream writer;
    private volatile long grant;
    private final String generation = UUID.randomUUID().toString();
    private long scene = 1;
    private int window = -1;
    private String activePackage = "";
    private long deadline;
    private boolean capturing;
    private long captureSequence;
    // A screenshot remains usable briefly while newer stills are in flight.
    // Any action, scene/rotation change, failure or credential pause revokes it.
    private final ConcurrentHashMap<String,long[]> frames = new ConcurrentHashMap<>();
    private int frameWidth, frameHeight;
    private boolean gestureBusy;
    private final TouchRelay touch = new TouchRelay(this,main);
    private boolean unlockAttempted;
    private long credentialCaptureUntil;
    private int connectionAttempt;
    private AccessibilityNodeInfo focusNode;
    private String focusToken;
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            if (!armed) return;
            if (!authorityReady()) { disarm(); return; }
            if (SystemClock.elapsedRealtime() >= deadline) { disarm(); return; }
            try { send(new JSONObject().put("type","state").put("state",state())); } catch (Exception ignored) { }
            main.postDelayed(this,1000);
        }
    };

    @Override protected void onServiceConnected() { accessBound=true; current=this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        int next = root == null ? -1 : root.getWindowId();
        String pkg = root == null ? "" : String.valueOf(root.getPackageName());
        if (next != window || !pkg.equals(activePackage)) { scene++; window=next; activePackage=pkg; focusNode=null; focusToken=null; }
        if (!getSystemService(KeyguardManager.class).isKeyguardLocked()) unlockAttempted=false;
    }
    @Override public void onInterrupt() { disarm(); }
    @Override public boolean onUnbind(Intent intent) { accessBound=false; if(current==this)current=null; disarm(); return super.onUnbind(intent); }
    @Override public void onDestroy() { accessBound=false; disarm(); if(current==this)current=null; compression.shutdownNow(); outbound.shutdownNow(); super.onDestroy(); }

    synchronized void arm() throws Exception {
        if(!authorityReady())throw new IllegalStateException("Screen access is reconnecting; start again locally");
        disarm();
        File config = new File(getFilesDir(),"pairing.json");
        JSONObject pairing = new JSONObject(new String(Files.readAllBytes(config.toPath()),StandardCharsets.UTF_8));
        String host=pairing.getString("host"); int port=pairing.getInt("port"); String token=pairing.getString("token");
        // Local emulator gateway or selected-device USB reverse; never a LAN listener.
        if (!host.equals("10.0.2.2") && !host.equals("127.0.0.1")) throw new IOException("Local demo endpoint required");
        armed=true; long session=++grant; deadline=SystemClock.elapsedRealtime()+4*60*60*1000;
        connectionAttempt=0;
        notification();
        new Thread(() -> connect(host,port,token,session),"remote-access-link").start();
        main.post(heartbeat);
    }
    synchronized void disarm() {
        if (Looper.myLooper()==Looper.getMainLooper()) touch.release("Access stopped"); else main.post(() -> touch.release("Access stopped"));
        armed=false; grant++; capturing=false; captureSequence++; main.removeCallbacks(heartbeat); frames.clear(); focusNode=null; focusToken=null;
        try { if (connection != null) connection.close(); } catch (IOException ignored) { }
        connection=null; writer=null;
        VideoService.end(this);
        getSystemService(NotificationManager.class).cancel(1);
    }
    boolean videoAllowed() { return armed && connection!=null && SystemClock.elapsedRealtime()>=credentialCaptureUntil; }
    boolean authorityReady() {
        // Framework init(null, -1) can revoke the connection before onUnbind.
        try { return accessBound && getServiceInfo()!=null; } catch(RuntimeException e) { return false; }
    }
    String connectionGeneration() { return generation+":"+grant+":"+connectionAttempt; }
    private void notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("remote_access","Remote access",NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this,SetupActivity.class).setAction("stop");
        PendingIntent action=PendingIntent.getActivity(this,1,stop,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        nm.notify(1,new Notification.Builder(this,"remote_access").setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Remote access is on").setContentText("Your paired browser can view and control this phone")
            .setOngoing(true).setContentIntent(action).addAction(new Notification.Action.Builder(null,"Stop access",action).build()).build());
    }
    private void connect(String host,int port,String token,long session) {
        while (armed && grant == session) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host,port),5000); socket.setTcpNoDelay(true); socket.setSoTimeout(15000);
                synchronized (this) { if (!armed || grant != session) return; connection=socket; writer=socket.getOutputStream();
                    connectionAttempt++;
                    send(new JSONObject().put("type","hello").put("token",token).put("generation",generation+":"+session+":"+connectionAttempt).put("state",state()));
                }
                BufferedReader in=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));
                String line;
                while (connection==socket && !socket.isClosed() && (line=readBounded(in)) != null) {
                    JSONObject command=new JSONObject(line);
                    main.post(() -> {
                        if (!armed || grant != session || connection != socket) return;
                        if (command.optString("op").equals("ping")) { reply(command,true,"Reachable",null); return; }
                        try { dispatch(command); } catch (Exception e) { reply(command,false,e.getMessage(),null); }
                    });
                }
            } catch (Exception ignored) { /* State in viewer explains loss; no actions are replayed. */ }
            synchronized(this) { if (grant == session) { writer=null; connection=null; frames.clear(); main.post(() -> touch.release("Connection ended")); } }
            if (armed && grant == session) try { Thread.sleep(1500); } catch (InterruptedException e) { return; }
        }
    }
    private String readBounded(BufferedReader in) throws IOException {
        StringBuilder line=new StringBuilder(); int c;
        while ((c=in.read()) != -1) { if (c=='\n') return line.toString(); if (line.length() >= 32768) throw new IOException("Command too large"); line.append((char)c); }
        return null;
    }
    private synchronized void send(JSONObject data) throws IOException {
        if (writer==null) return;
        OutputStream target=writer; Socket socket=connection;
        byte[] bytes=(data.toString()+"\n").getBytes(StandardCharsets.UTF_8);
        try { outbound.execute(() -> {
            try { if (target==writer && socket==connection) { target.write(bytes); target.flush(); } }
            catch (IOException ignored) { try { socket.close(); } catch (IOException unused) { } }
        }); } catch (RejectedExecutionException e) { try { socket.close(); } catch (IOException ignored) { } }
    }
    private void reply(JSONObject command,boolean ok,String message,JSONObject data) {
        try { send(new JSONObject().put("type","result").put("id",command.optString("id")).put("ok",ok)
            .put("message",message == null ? "Operation failed" : message).put("data",data == null ? new JSONObject() : data).put("state",state())); }
        catch (Exception ignored) { }
    }
    JSONObject state() throws JSONException {
        KeyguardManager km=getSystemService(KeyguardManager.class);
        PowerManager pm=getSystemService(PowerManager.class);
        android.util.DisplayMetrics dm=getResources().getDisplayMetrics();
        return new JSONObject().put("armed",armed).put("interactive",pm.isInteractive())
            .put("locked",km.isKeyguardLocked()).put("deviceLocked",km.isDeviceLocked()).put("secure",km.isKeyguardSecure())
            .put("userUnlocked",getSystemService(UserManager.class).isUserUnlocked())
            .put("api",Build.VERSION.SDK_INT).put("release",Build.VERSION.RELEASE).put("targetSdk",getApplicationInfo().targetSdkVersion)
            .put("scene",scene).put("package",activePackage).put("width",dm.widthPixels).put("height",dm.heightPixels)
            .put("rotation",getSystemService(android.hardware.display.DisplayManager.class).getDisplay(0).getRotation())
            .put("touchActive",touch.active()).put("touchRoute","Accessibility continuation batches").put("video",VideoService.status())
            .put("grantSeconds",Math.max(0,(deadline-SystemClock.elapsedRealtime())/1000))
            .put("credentialCapturePaused",SystemClock.elapsedRealtime()<credentialCaptureUntil).put("wipeThreshold",getSystemService(android.app.admin.DevicePolicyManager.class).getMaximumFailedPasswordsForWipe(null)).put("unlockAttempted",unlockAttempted).put("route","Android accessibility · outbound app connection");
    }
    private void dispatch(JSONObject c) throws Exception {
        String op=c.getString("op");
        if (SystemClock.elapsedRealtime()<credentialCaptureUntil && java.util.Arrays.asList("tap","swipe","nav","text","wake","dismiss","lock","openFixture","openApp","openTouchLab","touch","unlock").contains(op))
            throw new IllegalStateException("Credential delivery is in progress; wait for the observed result");
        if (op.equals("pauseCredentialCapture")) { credentialCaptureUntil=SystemClock.elapsedRealtime()+30000; frames.clear(); reply(c,true,"Screen capture paused for credential delivery",null); return; }
        if (op.equals("resumeCredentialCapture")) { credentialCaptureUntil=0; reply(c,true,"Credential capture pause ended",null); return; }
        if (op.equals("touchEnd")) { touch.release("Viewer ended touch"); frames.clear(); scene++; reply(c,true,"Touch contacts released",null); return; }
        if (op.equals("touch")) {
            if (gestureBusy) throw new IllegalStateException("Another gesture is still running");
            if (getSystemService(KeyguardManager.class).isKeyguardLocked()) throw new IllegalStateException("Use the explicit unlock controls for a locked phone");
            if (!touch.active()) { checkFrame(c); scene++; frames.clear(); }
            int rotation=getSystemService(android.hardware.display.DisplayManager.class).getDisplay(0).getRotation();
            touch.accept(c,frameWidth,frameHeight,rotation,window,(ok,msg,data) -> reply(c,ok,msg,data)); return;
        }
        if (touch.active() && !java.util.Arrays.asList("state","capture","inspect","stop","ping").contains(op))
            throw new IllegalStateException("Lift your fingers before using another control");
        if (op.equals("videoKeyframe")) { VideoService.keyframe(); reply(c,true,"Fresh video keyframe requested",null); return; }
        if (op.equals("openTouchLab")) {
            if (getSystemService(KeyguardManager.class).isKeyguardLocked()) throw new IllegalStateException("Unlock the phone first");
            scene++; frames.clear(); startActivity(new Intent(this,TouchLabActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP));
            reply(c,true,"Touch playground opened",null); return;
        }
        if (op.equals("state")) { reply(c,true,"Phone state observed",null); return; }
        if (op.equals("capture")) { capture(c); return; }
        if (op.equals("stop")) {
            touch.release("Access stopped"); VideoService.end(this);
            armed=false; grant++; main.removeCallbacks(heartbeat); frames.clear(); focusNode=null; focusToken=null;
            reply(c,true,"Access stopped on the phone",null);
            try { outbound.execute(() -> main.post(this::disarm)); }
            catch (RejectedExecutionException error) { disarm(); }
            return;
        }
        if (op.equals("wake") || op.equals("dismiss")) {
            startActivity(new Intent(this,WakeActivity.class).putExtra("dismiss",op.equals("dismiss")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            reply(c,true,op.equals("wake") ? "Display wake requested; checking state" : "Keyguard dismissal requested; secure locks still need a credential",null); return;
        }
        if (op.equals("lock")) { reply(c,performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN),"Screen lock requested",null); return; }
        if (op.equals("unlock")) { unlock(c); return; }
        if (op.equals("inspect")) { reply(c,true,"Visible controls (password content omitted)",inspect()); return; }
        if (op.equals("apps")) {
            JSONArray apps=new JSONArray();
            Intent launcher=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            for (android.content.pm.ResolveInfo app:getPackageManager().queryIntentActivities(launcher,0))
                if (!app.activityInfo.packageName.equals(getPackageName())) apps.put(new JSONObject().put("package",app.activityInfo.packageName).put("label",app.loadLabel(getPackageManager())));
            reply(c,true,"Launchable apps on this phone",new JSONObject().put("apps",apps)); return;
        }
        if (op.equals("openApp")) {
            if (getSystemService(KeyguardManager.class).isKeyguardLocked()) throw new IllegalStateException("Unlock the phone first");
            String pkg=c.getString("package");
            Intent launcher=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            boolean found=false;
            for (android.content.pm.ResolveInfo app:getPackageManager().queryIntentActivities(launcher,0))
                if (app.activityInfo.packageName.equals(pkg)) found=true;
            Intent launch=found ? getPackageManager().getLaunchIntentForPackage(pkg) : null;
            if (launch==null) throw new IllegalArgumentException("Choose an installed launchable app");
            scene++; frames.clear(); startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            reply(c,true,"App launch requested",null); return;
        }
        if (op.equals("openFixture")) {
            if (getSystemService(KeyguardManager.class).isKeyguardLocked()) throw new IllegalStateException("Unlock the phone first");
            startActivity(new Intent(this,StationActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            reply(c,true,"Demo power station opened",null); return;
        }
        if (op.equals("nav")) {
            scene++; frames.clear();
            int action=switch(c.getString("button")) {
                case "back" -> GLOBAL_ACTION_BACK; case "home" -> GLOBAL_ACTION_HOME; case "recents" -> GLOBAL_ACTION_RECENTS;
                case "notifications" -> GLOBAL_ACTION_NOTIFICATIONS; case "settings" -> GLOBAL_ACTION_QUICK_SETTINGS;
                default -> throw new IllegalArgumentException("Unknown navigation control"); };
            reply(c,performGlobalAction(action),"Navigation requested",null); return;
        }
        if (op.equals("text")) { editText(c); return; }
        if (op.equals("tap") || op.equals("swipe")) {
            checkFrame(c);
            Path p=new Path(); p.moveTo(coord(c,"x",frameWidth),coord(c,"y",frameHeight));
            if (op.equals("swipe")) p.lineTo(coord(c,"x2",frameWidth),coord(c,"y2",frameHeight));
            gesture(c,p,op.equals("tap") ? Math.max(40,Math.min(1200,c.optInt("duration",60))) : Math.max(100,Math.min(1200,c.optInt("duration",350)))); return;
        }
        throw new IllegalArgumentException("Unsupported operation");
    }
    private float coord(JSONObject c,String key,int max) throws Exception {
        double v=c.getDouble(key); if (!Double.isFinite(v) || v<0 || v>=max) throw new IllegalArgumentException("Pointer is outside this screen"); return (float)v;
    }
    private void checkFrame(JSONObject c) throws Exception {
        int rotation=getSystemService(android.hardware.display.DisplayManager.class).getDisplay(0).getRotation();
        long[] lease=frames.get(c.optString("frame"));
        if (lease==null || lease[1]!=scene || lease[2]!=rotation || SystemClock.elapsedRealtime()-lease[0]>5000)
            throw new IllegalStateException("Screen changed or frame expired. Refresh before acting.");
        frameWidth=(int)lease[3]; frameHeight=(int)lease[4];
    }
    private void gesture(JSONObject c,Path path,int ms) {
        if (gestureBusy) { reply(c,false,"Another gesture is still running",null); return; }
        gestureBusy=true; scene++; frames.clear();
        boolean accepted=dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,ms)).build(),new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription g) { gestureBusy=false; reply(c,true,"Gesture delivered; check the screen for its effect",null); }
            @Override public void onCancelled(GestureDescription g) { gestureBusy=false; reply(c,false,"Gesture cancelled; it will not be replayed",null); }
        },main);
        if (!accepted) { gestureBusy=false; reply(c,false,"Android refused this gesture",null); }
    }
    private void capture(JSONObject c) {
        if (SystemClock.elapsedRealtime()<credentialCaptureUntil) { frames.clear(); reply(c,false,"Screen capture is paused during credential delivery",null); return; }
        if (capturing) { reply(c,false,"A screenshot is already in progress",null); return; }
        capturing=true; long capture=++captureSequence; long capturedScene=scene; long session=grant; Socket owner=connection;
        main.postDelayed(() -> {
            if (capture==captureSequence && capturing) { capturing=false; captureSequence++; frames.clear();
                if (grant==session && connection==owner) reply(c,false,"Android capture timed out; refresh to try a fresh observation",null);
            }
        },4500);
        AccessibilityNodeInfo root=getRootInActiveWindow();
        if (Build.VERSION.SDK_INT>=34 && root!=null) {
            takeScreenshotOfWindow(root.getWindowId(),getMainExecutor(),new TakeScreenshotCallback() {
                @Override public void onSuccess(ScreenshotResult probe) { probe.getHardwareBuffer().close(); if (capture!=captureSequence) return; captureDisplay(c,capturedScene,session,owner,capture); }
                @Override public void onFailure(int code) {
                    if (capture!=captureSequence) return;
                    if (code==ERROR_TAKE_SCREENSHOT_SECURE_WINDOW) { capturing=false; frames.clear(); reply(c,false,"This screen is protected. Android blocks its screenshot.",null); }
                    else captureDisplay(c,capturedScene,session,owner,capture);
                }
            });
        } else captureDisplay(c,capturedScene,session,owner,capture);
    }
    private void captureDisplay(JSONObject c,long capturedScene,long session,Socket owner,long capture) {
        if (capture!=captureSequence) return;
        takeScreenshot(Display.DEFAULT_DISPLAY,getMainExecutor(),new TakeScreenshotCallback() {
            @Override public void onSuccess(ScreenshotResult shot) {
                HardwareBuffer buffer=shot.getHardwareBuffer();
                if (capture!=captureSequence) { buffer.close(); return; }
                Bitmap hardware=Bitmap.wrapHardwareBuffer(buffer,shot.getColorSpace());
                Bitmap bitmap=hardware == null ? null : hardware.copy(Bitmap.Config.ARGB_8888,false);
                if (hardware!=null) hardware.recycle(); buffer.close();
                if (bitmap==null) { capturing=false; reply(c,false,"Android returned no screen image",null); return; }
                int rotation=getSystemService(android.hardware.display.DisplayManager.class).getDisplay(0).getRotation();
                compression.execute(() -> {
                    JSONObject data=null;
                    try {
                        float scale=Math.min(1f,720f/Math.min(bitmap.getWidth(),bitmap.getHeight()));
                        Bitmap small=Bitmap.createScaledBitmap(bitmap,Math.round(bitmap.getWidth()*scale),Math.round(bitmap.getHeight()*scale),true);
                        ByteArrayOutputStream bytes=new ByteArrayOutputStream(); small.compress(Bitmap.CompressFormat.JPEG,76,bytes);
                        data=new JSONObject().put("image",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP))
                            .put("width",bitmap.getWidth()).put("height",bitmap.getHeight()).put("frame",UUID.randomUUID().toString()).put("scene",capturedScene);
                        if (small!=bitmap) small.recycle();
                    } catch (Exception ignored) { }
                    finally { bitmap.recycle(); }
                    JSONObject frame=data;
                    main.post(() -> {
                        if (capture!=captureSequence) return;
                        capturing=false;
                        if (!armed || grant!=session || connection!=owner) return;
                        if (SystemClock.elapsedRealtime()<credentialCaptureUntil) { frames.clear(); reply(c,false,"Screen capture is paused during credential delivery",null); return; }
                        if (frame==null || capturedScene!=scene) { frames.clear(); reply(c,false,"Screen changed during capture; refresh",null); return; }
                        long now=SystemClock.elapsedRealtime();
                        frames.entrySet().removeIf(entry -> now-entry.getValue()[0]>5000 || entry.getValue()[1]!=scene);
                        if (frames.size()>=16) frames.clear();
                        frames.put(frame.optString("frame"),new long[]{now,scene,rotation,frame.optInt("width"),frame.optInt("height")});
                        reply(c,true,"Fresh accessibility screenshot",frame);
                    });
                });
            }
            @Override public void onFailure(int code) {
                if (capture!=captureSequence) return;
                capturing=false; frames.clear();
                String message=switch(code) {
                    case ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "Capture is rate limited; wait a moment";
                    case ERROR_TAKE_SCREENSHOT_SECURE_WINDOW -> "This screen is protected. Android blocks its screenshot.";
                    case ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> "Screen access needs permission on the phone";
                    default -> "Android could not capture this screen (code " + code + ")";
                };
                reply(c,false,message,null);
            }
        });
    }
    private AccessibilityNodeInfo focused() {
        AccessibilityNodeInfo root=getRootInActiveWindow();
        if (root==null) return null;
        return root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
    }
    private void editText(JSONObject c) throws Exception {
        if (getSystemService(KeyguardManager.class).isKeyguardLocked()) throw new IllegalStateException("Use the explicit unlock experiment for the lock screen");
        AccessibilityNodeInfo field=focused();
        if (field==null || !field.isEditable()) throw new IllegalStateException("Tap a text field on the phone first");
        if (field.isPassword()) throw new IllegalStateException("Password fields are excluded from ordinary text editing");
        String text=c.getString("text"); if (text.length()>4096) throw new IllegalArgumentException("Text is too long");
        // Bind incremental edits to the actual focused view/window, never a guessed field.
        if (focusNode==null || focusToken==null || !focusToken.equals(c.optString("field")) || !focusNode.refresh() || !focusNode.equals(field))
            throw new IllegalStateException("Focused field changed. Read the field again.");
        String ref=focusToken;
        Bundle args=new Bundle(); args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,text);
        scene++; frames.clear();
        boolean accepted=field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args);
        if (accepted && c.has("start")) {
            Bundle selection=new Bundle(); selection.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT,Math.max(0,Math.min(text.length(),c.getInt("start"))));
            selection.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT,Math.max(0,Math.min(text.length(),c.optInt("end",c.getInt("start")))));
            field.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION,selection);
        }
        reply(c,accepted,accepted ? "Text edit delivered" : "Android refused text editing in this field",new JSONObject().put("field",ref));
    }
    private JSONObject inspect() throws Exception {
        JSONArray nodes=new JSONArray(); int[] count={0};
        for (AccessibilityWindowInfo w:getWindows()) walk(w.getRoot(),nodes,count,0);
        JSONObject data=new JSONObject().put("nodes",nodes);
        AccessibilityNodeInfo f=focused();
        if (f!=null && f.isEditable() && !f.isPassword() && !getSystemService(KeyguardManager.class).isKeyguardLocked()) {
            if (f.getText()!=null && f.getText().length()>4096) return data.put("editingUnavailable","This field is too long for the spike editor");
            if (focusNode==null || !focusNode.refresh() || !focusNode.equals(f)) { focusNode=f; focusToken=UUID.randomUUID().toString(); }
            data.put("focused",new JSONObject().put("field",focusToken)
                .put("text",f.isShowingHintText() ? "" : String.valueOf(f.getText()==null?"":f.getText()))
                .put("start",f.getTextSelectionStart()).put("end",f.getTextSelectionEnd()));
        } else { focusNode=null; focusToken=null; }
        return data;
    }
    private void walk(AccessibilityNodeInfo n,JSONArray out,int[] count,int depth) throws JSONException {
        if (n==null || count[0]++>160 || depth>22) return;
        if (n.isVisibleToUser()) {
            Rect r=new Rect(); n.getBoundsInScreen(r);
            String text=n.isPassword()?"[password]":String.valueOf(n.getText()==null?"":n.getText());
            String desc=n.isPassword()?"":String.valueOf(n.getContentDescription()==null?"":n.getContentDescription());
            boolean truncated=text.length()>600 || desc.length()>300;
            if (text.length()>600) text=text.substring(0,600);
            if (desc.length()>300) desc=desc.substring(0,300);
            if (!text.isEmpty() || !desc.isEmpty() || n.isClickable() || n.isEditable()) out.put(new JSONObject()
                .put("text",text).put("description",desc).put("truncated",truncated).put("id",n.getViewIdResourceName())
                .put("editable",n.isEditable()).put("clickable",n.isClickable()).put("password",n.isPassword()).put("passwordHasText",n.isPassword() && n.getText()!=null && n.getText().length()>0)
                .put("bounds",new JSONArray(new int[]{r.left,r.top,r.right,r.bottom})));
        }
        for (int i=0;i<n.getChildCount();i++) walk(n.getChild(i),out,count,depth+1);
    }
    private AccessibilityNodeInfo key(String suffix) {
        for (AccessibilityWindowInfo w:getWindows()) {
            AccessibilityNodeInfo root=w.getRoot(); if (root==null) continue;
            for (AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByViewId("com.android.systemui:id/"+suffix))
                if (n.isVisibleToUser() && n.isEnabled()) return n;
        }
        return null;
    }
    /** One explicitly requested known PIN, via observed SystemUI keypad only. */
    private void unlock(JSONObject c) throws Exception {
        KeyguardManager km=getSystemService(KeyguardManager.class);
        if (!km.isKeyguardLocked() || !km.isKeyguardSecure()) throw new IllegalStateException("A secure locked phone is required for this experiment");
        if (getSystemService(android.app.admin.DevicePolicyManager.class).getMaximumFailedPasswordsForWipe(null)>0) throw new IllegalStateException("A device wipe policy forbids this experiment");
        if (unlockAttempted) throw new IllegalStateException("An unlock was already attempted. Unlock locally before another experiment.");
        AccessibilityNodeInfo entry=key("pinEntry");
        if (entry==null || !entry.isPassword()) throw new IllegalStateException("A supported visible SystemUI PIN field is required. Request keyguard dismissal first.");
        if (entry.getText()!=null && entry.getText().length()>0) throw new IllegalStateException("The PIN field must be empty; clear it locally first");
        String value=c.optString("pin"); c.remove("pin");
        if (!value.matches("[0-9]{4,16}")) throw new IllegalArgumentException("Use a 4–16 digit known PIN");
        ArrayList<AccessibilityNodeInfo> digits=new ArrayList<>();
        for (char ch:value.toCharArray()) { AccessibilityNodeInfo k=key("key"+ch); if (k==null || !k.isClickable()) throw new IllegalStateException("SystemUI keypad is not available to this service"); digits.add(k); }
        AccessibilityNodeInfo enter=key("key_enter");
        if (enter!=null && !enter.isClickable()) throw new IllegalStateException("SystemUI PIN confirmation is unavailable");
        // Newer SystemUI may hide Enter for a six-or-more-digit auto-confirm PIN.
        // Enter digits once and observe; never guess an alternate submission.
        if (enter==null && value.length()<6) throw new IllegalStateException("No supported PIN confirmation control is visible");
        unlockAttempted=true; credentialCaptureUntil=SystemClock.elapsedRealtime()+30000; frames.clear();
        // The credential is never persisted or returned. Java/JSON strings are not guaranteed erasable.
        value=null;
        submitDigit(c,digits,enter,0,grant,connection);
    }
    private void submitDigit(JSONObject c,ArrayList<AccessibilityNodeInfo> digits,AccessibilityNodeInfo enter,int i,long session,Socket owner) {
        if (!armed || session!=grant || owner!=connection) return;
        if (i==digits.size()) {
            boolean delivered=enter==null || (enter.refresh() && enter.performAction(AccessibilityNodeInfo.ACTION_CLICK));
            observeUnlock(c,delivered,SystemClock.elapsedRealtime()+3500,session,owner);
        } else if (!digits.get(i).refresh() || !digits.get(i).performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            credentialCaptureUntil=SystemClock.elapsedRealtime()+2500;
            reply(c,false,"Android refused a PIN digit; no automatic retry",null);
        } else main.postDelayed(() -> submitDigit(c,digits,enter,i+1,session,owner),100);
    }
    private void observeUnlock(JSONObject c,boolean delivered,long until,long session,Socket owner) {
        if (!armed || grant!=session || connection!=owner) return;
        boolean locked=getSystemService(KeyguardManager.class).isKeyguardLocked();
        if (delivered && locked && SystemClock.elapsedRealtime()<until) {
            main.postDelayed(() -> observeUnlock(c,delivered,until,session,owner),100); return;
        }
        credentialCaptureUntil=SystemClock.elapsedRealtime()+2500;
        try { reply(c,delivered, !delivered ? "PIN confirmation refused; no automatic retry" : locked ? "PIN submitted once; phone is still locked. No retry." : "Unlocked · native keyguard state confirms the result",
            new JSONObject().put("delivered",delivered).put("locked",locked)); } catch(Exception ignored) { }
    }
}
