package dev.remoteaccess.spike;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.*;
import android.view.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.*;

/** Ordinary native touch consumer. Its witness records actual delivered events. */
public final class TouchLabActivity extends Activity {
    @Override public void onCreate(Bundle b) { super.onCreate(b); getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); setContentView(new Playground()); }
    final class Playground extends View {
        final Paint paint=new Paint(3);
        final JSONArray events=new JSONArray();
        float slider=.35f,scale=1,angle=0,panX=0,panY=0,scroll=0;
        float lastX,lastY,lastSpan,lastAngle;
        int mode=0,held=0,maxHeld=0,moves=0,downs=0,ups=0,cancels=0;
        long sequence=0;
        Playground() { super(TouchLabActivity.this); setContentDescription("Touch playground: slider, two-finger map and scroll list"); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES); }
        float u() { return getWidth()/1080f; }
        void text(Canvas c,String t,float x,float y,float size,int color) { paint.setColor(color);paint.setTextSize(size*u());paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));c.drawText(t,x*u(),y*u(),paint); }
        @Override protected void onDraw(Canvas c) {
            float u=u(); c.drawColor(0xfff4f6ef);
            text(c,"TOUCH PLAYGROUND",48,125,28,0xff627967);
            text(c,"A little closer to real touch.",48,205,49,0xff203c30);
            text(c,"Move the slider. Pinch and turn the map.",48,270,30,0xff637666);
            text(c,"OUTPUT LIMIT  ·  "+Math.round(slider*100)+"%",60,380,30,0xff31543d);
            paint.setColor(0xffd4dfce); c.drawRoundRect(80*u,425*u,1000*u,445*u,10*u,10*u,paint);
            paint.setColor(0xff356348);c.drawCircle((80+920*slider)*u,435*u,28*u,paint);
            paint.setColor(0xffe2eadb);c.drawRoundRect(48*u,540*u,1032*u,1330*u,24*u,24*u,paint);
            c.save();c.clipRect(48*u,540*u,1032*u,1330*u);c.translate((540+panX)*u,(935+panY)*u);c.rotate(angle);c.scale(scale,scale);
            paint.setColor(0xffc2d1bb);paint.setStrokeWidth(3*u);
            for(int i=-12;i<=12;i++) { c.drawLine(i*100*u,-1600*u,i*100*u,1600*u,paint);c.drawLine(-1600*u,i*100*u,1600*u,i*100*u,paint); }
            paint.setColor(0xff9dbba0);paint.setStrokeWidth(36*u);c.drawLine(-700*u,360*u,600*u,-260*u,paint);
            paint.setColor(0xff356348);c.drawCircle(0,0,43*u,paint);c.restore();
            text(c,String.format(java.util.Locale.ROOT,"MAP  ·  %.2f×  ·  %.0f°",scale,angle),80,610,30,0xff31543d);
            text(c,"SCROLL THE CHECKLIST",60,1430,28,0xff627967);
            c.save();c.clipRect(48*u,1470*u,1032*u,2070*u);
            for(int i=0;i<20;i++) {float y=1530+i*110-scroll; paint.setColor(0xffd7e1d1);c.drawLine(60*u,(y+35)*u,1020*u,(y+35)*u,paint);text(c,(i+1)+"   "+new String[]{"Solar panels connected","Station charging","Lights ready","Water pump checked","Windows secured"}[i%5],70,y,34,0xff35533d); }
            c.restore();text(c,held+" fingers down · "+moves+" moves · "+ups+" lifted",60,2150,28,0xff627967);
            witness();
        }
        @Override public boolean onTouchEvent(MotionEvent e) {
            int a=e.getActionMasked(); float u=u();
            int count=e.getPointerCount(); float x=0,y=0;
            for(int i=0;i<count;i++) { x+=e.getX(i)/u;y+=e.getY(i)/u; }
            x/=count;y/=count;
            float span=count>=2?(float)Math.hypot((e.getX(1)-e.getX(0))/u,(e.getY(1)-e.getY(0))/u):0;
            float theta=count>=2?(float)Math.toDegrees(Math.atan2(e.getY(1)-e.getY(0),e.getX(1)-e.getX(0))):0;
            if(a==MotionEvent.ACTION_DOWN) { downs++;mode=y<520?1:y<1380?2:3; }
            if(a==MotionEvent.ACTION_MOVE) {
                moves++;
                if(mode==1) slider=Math.max(0,Math.min(1,(e.getX(0)/u-80)/920));
                if(mode==2) {
                    if(count>=2 && lastSpan>0) {scale=Math.max(.3f,Math.min(5,scale*span/lastSpan));float delta=theta-lastAngle;while(delta>180)delta-=360;while(delta< -180)delta+=360;angle+=delta;}
                    else if(count==1) {panX+=x-lastX;panY+=y-lastY;}
                }
                if(mode==3) scroll=Math.max(0,Math.min(1700,scroll+lastY-y));
            }
            held=(a==MotionEvent.ACTION_UP||a==MotionEvent.ACTION_CANCEL)?0:count-(a==MotionEvent.ACTION_POINTER_UP?1:0);
            if(a==MotionEvent.ACTION_UP||a==MotionEvent.ACTION_POINTER_UP)ups++;
            if(a==MotionEvent.ACTION_CANCEL)cancels++;
            maxHeld=Math.max(maxHeld,held);
            lastX=x;lastY=y;lastSpan=(a==MotionEvent.ACTION_POINTER_UP)?0:span;lastAngle=theta;
            try {
                JSONArray ids=new JSONArray();for(int i=0;i<count;i++)ids.put(e.getPointerId(i));
                events.put(new JSONObject().put("sequence",++sequence).put("action",a).put("ids",ids).put("held",held).put("time",e.getEventTime()));
                while(events.length()>80)events.remove(0);
            } catch(Exception ignored) { }
            if(a==MotionEvent.ACTION_UP)performClick();
            invalidate();witness();return true;
        }
        @Override public boolean performClick() { super.performClick(); return true; }
        void witness() {
            try {
                JSONObject o=new JSONObject().put("slider",slider).put("scale",scale).put("angle",angle).put("panX",panX).put("panY",panY).put("scroll",scroll)
                    .put("held",held).put("maxHeld",maxHeld).put("moves",moves).put("downs",downs).put("ups",ups).put("cancels",cancels).put("events",events);
                Files.write(new java.io.File(getFilesDir(),"touch-fixture.json").toPath(),o.toString().getBytes(StandardCharsets.UTF_8));
            } catch(Exception ignored) { }
        }
    }
}
