package dev.remoteaccess.spike;

import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONArray;
import org.json.JSONObject;

/** Selected-device shell observation. No screenshots, mutations or password text. */
public final class ShellUi {
    private static final JSONArray nodes=new JSONArray();
    private static int count;
    public static void main(String[] args) {
        Looper.prepareMainLooper();
        HandlerThread thread=new HandlerThread("emulator-ui-observer");thread.start();
        UiAutomation automation=null;
        try {
            Object connection=Class.forName("android.app.UiAutomationConnection").getConstructor().newInstance();
            automation=(UiAutomation)UiAutomation.class.getConstructor(Looper.class,Class.forName("android.app.IUiAutomationConnection")).newInstance(thread.getLooper(),connection);
            UiAutomation.class.getMethod("connect",int.class).invoke(automation,UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            android.accessibilityservice.AccessibilityServiceInfo info=automation.getServiceInfo();
            info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS | android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            automation.setServiceInfo(info);
            try { automation.waitForIdle(200,2000); } catch (java.util.concurrent.TimeoutException ignored) { }
            AccessibilityNodeInfo root=automation.getRootInActiveWindow();
            for(int attempt=0; root==null && attempt<15; attempt++) {
                automation.getWindows(); android.os.SystemClock.sleep(100); if (android.os.Build.VERSION.SDK_INT>=34) automation.clearCache();
                root=automation.getRootInActiveWindow();
            }
            walk(root,0);
            System.out.println(new JSONObject().put("nodes",nodes).toString());
        } catch (Exception error) { System.err.println("Shell UI unavailable: "+error.getClass().getSimpleName()); System.exit(2); }
        finally {
            if (automation!=null) try { UiAutomation.class.getMethod("disconnect").invoke(automation); } catch (Exception ignored) { }
            thread.quitSafely();
        }
    }
    private static String bounded(CharSequence value) { return value==null ? "" : value.subSequence(0,Math.min(value.length(),600)).toString(); }
    private static void walk(AccessibilityNodeInfo n,int depth) throws Exception {
        if (n==null || count++>300 || depth>30) return;
        if (n.isVisibleToUser()) {
            Rect r=new Rect();n.getBoundsInScreen(r);
            // Never write password characters, including transient last-digit text.
            nodes.put(new JSONObject().put("text",n.isPassword()?"":bounded(n.getText()))
                .put("description",n.isPassword()?"":bounded(n.getContentDescription()))
                .put("id",n.getViewIdResourceName()).put("password",n.isPassword())
                .put("hasText",n.isPassword() && n.getText()!=null && n.getText().length()>0)
                .put("enabled",n.isEnabled()).put("bounds",new JSONArray(new int[]{r.left,r.top,r.right,r.bottom})));
        }
        for(int i=0;i<n.getChildCount();i++)walk(n.getChild(i),depth+1);
    }
}
