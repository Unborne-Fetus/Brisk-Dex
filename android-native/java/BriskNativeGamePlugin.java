package com.briskemerald.briskdex;

import android.util.Base64;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android bridge to a real native build of the Windows Brisk Emerald source.
 * libbriskandroid.so is the transport, libbriskgame.so is the required game.
 * Never silently replace a missing game with an emulator or remote client.
 */
@CapacitorPlugin(name="BriskNativeGame")
public class BriskNativeGamePlugin extends Plugin {
    private static final String EXPECTED_BRISK_COMMIT="__BRISK_SOURCE_COMMIT__";
    private static final boolean TRANSPORT_LOADED;
    private static final String TRANSPORT_ERROR;
    static {
        boolean found=false;
        String error="";
        try { System.loadLibrary("briskandroid");found=true; }
        catch (UnsatisfiedLinkError failure){error=failure.toString();}
        TRANSPORT_LOADED=found;TRANSPORT_ERROR=error;
    }
    private static native String nativeProbe(String sourceCommit);
    private static native int nativeRun(String saveDirectory);
    private static native boolean nativeRunning();
    private static native void nativeStop();
    private static native void nativeKeys(int mask);
    private static native int nativeConfigure(int speed,boolean paused,boolean muted);
    private static native byte[] nativeFrame(long since);

    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private volatile boolean starting=false;
    private volatile boolean stopRequested=false;
    private volatile boolean backgrounded=false;
    private volatile int configuredSpeed=1;
    private volatile boolean configuredPaused=false;
    private volatile boolean configuredMute=false;

    private String verify(){
        return TRANSPORT_LOADED?nativeProbe(EXPECTED_BRISK_COMMIT):
            "Android native bridge failed to load: "+TRANSPORT_ERROR;
    }
    @PluginMethod
    public void status(PluginCall call){
        try{
            String reason=verify();
            JSObject response=new JSObject();
            response.put("status",reason.isEmpty()?"ready":"not-installed");
            response.put("profile","brisk");
            response.put("running",TRANSPORT_LOADED&&nativeRunning());
            response.put("message",reason.isEmpty()?"Integrated Android Brisk Emerald engine is ready.":reason);
            call.resolve(response);
        }catch(Exception problem){call.reject("Unable to inspect Android game: "+problem.getMessage());}
    }
    @PluginMethod
    public void start(PluginCall call){
        try{
            String error=verify();
            if(!error.isEmpty()){
                JSObject result=new JSObject();result.put("ok",false);result.put("error",error);
                call.resolve(result);return;
            }
            if(starting||nativeRunning()){
                JSObject result=new JSObject();result.put("ok",true);result.put("alreadyRunning",true);
                call.resolve(result);return;
            }
            File saveDir=new File(getContext().getFilesDir(),"native-brisk-emerald");
            if(!saveDir.exists()&&!saveDir.mkdirs()){call.reject("Cannot create the private game save folder.");return;}
            stopRequested=false;
            starting=true;
            executor.execute(()->{
                int code=0;
                try{
                    if(!stopRequested)code=nativeRun(saveDir.getAbsolutePath());
                }
                finally{
                    starting=false;
                    JSObject state=new JSObject();state.put("running",false);
                    state.put("message",code==0?"Game stopped.":"Android game engine exited with code "+code+".");
                    notifyListeners("nativeState",state);
                }
            });
            JSObject event=new JSObject();event.put("running",true);
            event.put("message","Launching Android game engine…");
            notifyListeners("nativeState",event);
            JSObject result=new JSObject();result.put("ok",true);
            call.resolve(result);
        }catch(Exception problem){starting=false;call.reject("Unable to launch Brisk Emerald: "+problem.getMessage());}
    }
    @PluginMethod
    public void stop(PluginCall call){
        stopRequested=true;
        if(TRANSPORT_LOADED)nativeStop();
        JSObject result=new JSObject();result.put("ok",true);call.resolve(result);
    }
    @PluginMethod
    public void keys(PluginCall call){
        Integer mask=call.getInt("mask");
        if(mask==null||mask<0||mask>1023){call.reject("Invalid ten-bit input mask.");return;}
        if(TRANSPORT_LOADED)nativeKeys(mask);
        call.resolve();
    }
    @PluginMethod
    public void configure(PluginCall call){
        Integer speed=call.getInt("speed");
        Boolean paused=call.getBoolean("paused");
        Boolean mute=call.getBoolean("mute");
        if(speed==null||speed<0||speed>4||paused==null||mute==null){
            call.reject("Invalid engine settings.");return;
        }
        configuredSpeed=speed;
        configuredPaused=paused;
        configuredMute=mute;
        int code=TRANSPORT_LOADED?nativeConfigure(speed,paused||backgrounded,mute||backgrounded):-1;
        JSObject result=new JSObject();result.put("ok",code==0);
        if(code!=0)result.put("error","Android native game engine is unavailable.");
        call.resolve(result);
    }
    @PluginMethod
    public void frame(PluginCall call){
        Long since=call.getLong("since",0L);
        if(since==null||since<0){call.reject("Invalid frame cursor.");return;}
        byte[] packet=TRANSPORT_LOADED?nativeFrame(since):null;
        JSObject result=new JSObject();
        if(packet!=null&&packet.length==76808){
            long sequence=0;
            for(int i=7;i>=0;i--)sequence=(sequence<<8)|(packet[i]&255L);
            result.put("seq",sequence);
            result.put("pixels",Base64.encodeToString(packet,8,76800,Base64.NO_WRAP));
        }
        call.resolve(result);
    }
    private File saveDirectory(){
        return new File(getContext().getFilesDir(),"native-brisk-emerald");
    }
    private boolean transferAllowed(PluginCall call){
        if(starting||(TRANSPORT_LOADED&&nativeRunning())){
            JSObject result=new JSObject();
            result.put("ok",false);
            result.put("error","Save in the game and stop it before transferring native saves.");
            call.resolve(result);return false;
        }
        return true;
    }
    @PluginMethod
    public void backup(PluginCall call){
        if(!transferAllowed(call))return;
        try{
            // Keep backup generation consistent with Windows BRK1 layout.
            pendingBackup=BriskAndroidSaveSlots.backup(getContext().getFilesDir());
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE,"brisk-"+System.currentTimeMillis()+".briskbackup");
            startActivityForResult(call,intent,"backupPickerResult");
        }catch(Exception error){call.reject("Unable to back up native saves: "+error.getMessage());}
    }
    private String pendingBackup;
    @ActivityCallback
    private void backupPickerResult(PluginCall call,ActivityResult result){
        String data=pendingBackup;pendingBackup=null;
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){
            JSObject canceled=new JSObject();canceled.put("canceled",true);call.resolve(canceled);return;
        }
        if(data==null){call.reject("Backup data expired.");return;}
        try{
            Uri uri=result.getData().getData();
            if(uri==null)throw new IOException("Backup destination was not selected");
            try(OutputStream output=getContext().getContentResolver().openOutputStream(uri,"wt")){
                if(output==null)throw new IOException("Backup destination cannot be written");
                output.write(data.getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
            JSObject response=new JSObject();
            response.put("ok",true);
            response.put("message","Both Brisk Dex save slots and their game clocks were backed up.");
            call.resolve(response);
        }catch(Exception error){call.reject("Could not write native save backup: "+error.getMessage());}
    }
    @PluginMethod
    public void restore(PluginCall call){
        if(!transferAllowed(call))return;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call,intent,"restorePickerResult");
    }
    @ActivityCallback
    private void restorePickerResult(PluginCall call,ActivityResult result){
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){
            JSObject canceled=new JSObject();canceled.put("canceled",true);call.resolve(canceled);return;
        }
        if(!transferAllowed(call))return;
        try{
            Uri uri=result.getData().getData();
            if(uri==null)throw new IOException("No backup selected");
            ByteArrayOutputStream data=new ByteArrayOutputStream();
            try(InputStream input=getContext().getContentResolver().openInputStream(uri)){
                if(input==null)throw new IOException("Selected backup cannot be read");
                byte[] buffer=new byte[8192];int count;
                while((count=input.read(buffer))!=-1){
                    if(data.size()+count>BriskAndroidSaveStore.MAX_BACKUP_BYTES)
                        throw new IOException("Backup file is too large");
                    data.write(buffer,0,count);
                }
            }
            String previous=BriskAndroidSaveSlots.restore(getContext().getFilesDir(),
                new String(data.toByteArray(),StandardCharsets.UTF_8));
            JSObject response=new JSObject();
            response.put("ok",true);
            response.put("message","Native game saves restored; previous files retained as a recovery copy.");
            if(previous!=null)response.put("recoveryDirectory",previous);
            call.resolve(response);
        }catch(Exception error){call.reject("Unable to restore native saves: "+error.getMessage());}
    }
    @PluginMethod
    public void profiles(PluginCall call){
        if(!transferAllowed(call))return;
        try{
            BriskAndroidSaveSlots.Snapshot snapshot=
                BriskAndroidSaveSlots.list(getContext().getFilesDir());
            JSObject result=new JSObject();
            if(snapshot.migration!=null){
                result.put("available",false);
                result.put("requiresMigration",true);
                result.put("nativeSave",Base64.encodeToString(snapshot.migration,Base64.NO_WRAP));
            }else{
                result.put("available",true);
                result.put("activeSlot",snapshot.activeSlot);
                JSArray saves=new JSArray();
                for(byte[] save:snapshot.saves)
                    saves.put(save==null?org.json.JSONObject.NULL:
                        Base64.encodeToString(save,Base64.NO_WRAP));
                result.put("nativeSaves",saves);
            }
            call.resolve(result);
        }catch(Exception error){
            JSObject result=new JSObject();
            result.put("available",false);
            result.put("reason",error.getMessage());
            call.resolve(result);
        }
    }
    @PluginMethod
    public void updateProfile(PluginCall call){
        if(!transferAllowed(call))return;
        Integer slot=call.getInt("slot");
        Integer expectedCrc=call.getInt("expectedCrc");
        String encoded=call.getString("flash");
        if(slot==null||slot<0||slot>1||expectedCrc==null||encoded==null){
            call.reject("Invalid Android native save transfer request");return;
        }
        try{
            byte[] flash=Base64.decode(encoded,Base64.DEFAULT);
            if(flash.length!=131072||!Base64.encodeToString(flash,Base64.NO_WRAP).equals(encoded))
                throw new IOException("Invalid 128 KiB native flash encoding");
            int crc=BriskAndroidSaveSlots.updateProfile(
                getContext().getFilesDir(),slot,expectedCrc,flash);
            JSObject result=new JSObject();
            result.put("ok",true);
            result.put("crc",crc);
            call.resolve(result);
        }catch(Exception error){
            JSObject result=new JSObject();
            result.put("ok",false);
            result.put("error","Unable to update Android game save: "+error.getMessage());
            call.resolve(result);
        }
    }
    @PluginMethod
    public void selectSlot(PluginCall call){
        if(!transferAllowed(call))return;
        Integer slot=call.getInt("slot");
        if(slot==null||slot<0||slot>1){call.reject("Select native save slot 1 or 2.");return;}
        try{
            int selected=BriskAndroidSaveSlots.select(getContext().getFilesDir(),slot);
            JSObject result=new JSObject();
            result.put("ok",true);
            result.put("activeSlot",selected);
            call.resolve(result);
        }catch(Exception error){call.reject("Unable to switch native save slots: "+error.getMessage());}
    }
    @PluginMethod
    public void migrateSlots(PluginCall call){
        if(!transferAllowed(call))return;
        Integer active=call.getInt("activeSlot");
        JSArray encoded=call.getArray("saves");
        if(active==null||active<0||active>1||encoded==null||encoded.length()!=2){
            call.reject("Invalid native compact save migration.");return;
        }
        try{
            byte[][] saves=new byte[2][];
            for(int i=0;i<2;i++){
                if(encoded.isNull(i))continue;
                String value=encoded.getString(i);
                byte[] decoded=Base64.decode(value,Base64.DEFAULT);
                if(!Base64.encodeToString(decoded,Base64.NO_WRAP).equals(value))
                    throw new IOException("Noncanonical native save encoding");
                BriskAndroidSaveStore.validateSave(decoded);
                saves[i]=decoded;
            }
            BriskAndroidSaveSlots.migrate(getContext().getFilesDir(),saves,active);
            JSObject result=new JSObject();
            result.put("ok",true);result.put("activeSlot",active);
            call.resolve(result);
        }catch(Exception error){call.reject("Unable to migrate Android save slots: "+error.getMessage());}
    }

    @Override
    protected void handleOnPause(){
        backgrounded=true;
        if(TRANSPORT_LOADED){
            nativeKeys(0);
            if(starting||nativeRunning())nativeConfigure(configuredSpeed,true,true);
        }
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume(){
        super.handleOnResume();
        backgrounded=false;
        if(TRANSPORT_LOADED&&(starting||nativeRunning()))
            nativeConfigure(configuredSpeed,configuredPaused,configuredMute);
    }

    @Override
    protected void handleOnDestroy(){
        stopRequested=true;
        if(TRANSPORT_LOADED){nativeKeys(0);nativeStop();}
        executor.shutdown();
        super.handleOnDestroy();
    }
}
