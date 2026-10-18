package dev.remoteaccess.spike;

import android.app.Instrumentation;
import android.view.KeyEvent;
import java.util.Arrays;

/** Optional emulator lab only: shell-UID key delivery, one stdin credential. */
public final class ShellPin {
    public static void main(String[] args) {
        byte[] digits=new byte[18]; int length=0;
        try {
            android.os.Looper.prepare();
            for (int n; (n=System.in.read())!=-1 && n!='\n';) {
                if (n<'0' || n>'9' || length==16) throw new IllegalArgumentException();
                digits[length++]=(byte)n;
            }
            if (length<4) throw new IllegalArgumentException();
            Instrumentation input=new Instrumentation();
            for (int i=0;i<length;i++) input.sendKeyDownUpSync(KeyEvent.KEYCODE_0+digits[i]-'0');
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER);
        } catch (Exception ignored) { System.exit(2); }
        finally { Arrays.fill(digits,(byte)0); }
    }
}
