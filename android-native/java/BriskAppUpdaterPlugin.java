package com.briskemerald.briskdex;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.UnknownHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Updates the APK itself, not just bundled web assets.
 * Only a GitHub release carrying a SHA-256 manifest and an APK signed with
 * the currently installed certificate can update the app in place.
 * Android's system installer still requires user confirmation.
 */
@CapacitorPlugin(name="BriskAppUpdater")
public class BriskAppUpdaterPlugin extends Plugin {
    // Use fixed GitHub release assets directly instead of api.github.com.
    private static final String ASSET_PREFIX =
        "https://github.com/Unborne-Fetus/Brisk-Dex/releases/download/android-updates/";
    private static final String APK_NAME="Brisk-Dex-Android.apk";
    private static final long MAX_APK=180L*1024*1024;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private volatile boolean busy=false;

    private File folder(){return new File(getContext().getFilesDir(),"brisk-app-updates");}
    private File apk(){return new File(folder(),APK_NAME);}
    private android.content.SharedPreferences prefs(){
        return getContext().getSharedPreferences("brisk-android-updates",0);
    }
    private PackageInfo installed() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),0);
    }
    private long code(PackageInfo info){
        return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;
    }
    private static String sha(byte[] data) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(data);
        return hex(digest);
    }
    private static String hex(byte[] data){
        StringBuilder out=new StringBuilder(data.length*2);
        for(byte b:data)out.append(String.format(Locale.ROOT,"%02x",b&255));
        return out.toString();
    }
    private static boolean shaFormat(String value){
        return value!=null&&value.matches("[a-f0-9]{64}");
    }
    private static byte[] read(HttpURLConnection connection,int limit) throws Exception{
        if(connection.getResponseCode()!=200)
            throw new Exception("Update server returned HTTP "+connection.getResponseCode());
        if(connection.getContentLengthLong()>limit)throw new Exception("Update metadata too large");
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        try(InputStream input=connection.getInputStream()){
            byte[] chunk=new byte[8192];int count;
            while((count=input.read(chunk))!=-1){
                if(output.size()+count>limit)throw new Exception("Update metadata too large");
                output.write(chunk,0,count);
            }
        }
        return output.toByteArray();
    }
    private static HttpURLConnection connect(String url) throws Exception{
        if(!url.startsWith("https://"))throw new Exception("Update URL must use HTTPS");
        HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
        connection.setRequestProperty("User-Agent","Pokemon-Brisk-Emerald-Android-Updater");
        connection.setRequestProperty("Accept","application/vnd.github+json");
        connection.setUseCaches(false);
        connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
        return connection;
    }
    private boolean hasInternetNetwork(){
        try{
            ConnectivityManager cm=(ConnectivityManager)getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
            if(cm==null||cm.getActiveNetwork()==null)return false;
            NetworkCapabilities cap=cm.getNetworkCapabilities(cm.getActiveNetwork());
            return cap!=null&&cap.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        }catch(Exception ignored){return true;}
    }
    private String updateError(Exception error){
        if(!hasInternetNetwork())
            return "No internet connection detected. Connect Wi-Fi or mobile data, then try Check updates again.";
        if(error instanceof UnknownHostException)
            return "Your device cannot resolve GitHub. Check Wi-Fi/mobile data, Private DNS, VPN or ad blockers. Try opening github.com in your browser, then retry.";
        if(error instanceof SocketTimeoutException)
            return "GitHub did not respond in time. Check your network and try again.";
        return "Android update unavailable: "+error.getMessage();
    }
    private static byte[] digestFile(File file) throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(FileInputStream input=new FileInputStream(file)){
            byte[] chunk=new byte[32768];int n;
            while((n=input.read(chunk))!=-1)digest.update(chunk,0,n);
        }
        return digest.digest();
    }
    private static boolean sameSignature(PackageInfo current,PackageInfo next) {
        if(Build.VERSION.SDK_INT>=28){
            if(current.signingInfo==null||next.signingInfo==null)return false;
            android.content.pm.Signature[] a=current.signingInfo.hasMultipleSigners()
                ?current.signingInfo.getApkContentsSigners():current.signingInfo.getSigningCertificateHistory();
            android.content.pm.Signature[] b=next.signingInfo.hasMultipleSigners()
                ?next.signingInfo.getApkContentsSigners():next.signingInfo.getSigningCertificateHistory();
            for(android.content.pm.Signature left:a)
                for(android.content.pm.Signature right:b)if(left.equals(right))return true;
            return false;
        }
        return current.signatures!=null&&next.signatures!=null&&
            Arrays.equals(current.signatures,next.signatures);
    }
    private void verifyApk(File candidate,long expectedCode) throws Exception {
        PackageManager pm=getContext().getPackageManager();
        int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo target=pm.getPackageArchiveInfo(candidate.getAbsolutePath(),flags);
        PackageInfo old=pm.getPackageInfo(getContext().getPackageName(),flags);
        if(target==null||!getContext().getPackageName().equals(target.packageName))
            throw new Exception("Downloaded APK has the wrong Android package ID");
        if(code(target)!=expectedCode||code(target)<=code(old))
            throw new Exception("Downloaded APK is not newer than the installed application");
        if(!sameSignature(old,target))
            throw new Exception("Installed APK uses a different signing key. An in-place update would fail. Back up app data before any reinstall.");
    }
    private String pendingVersion(){
        long expected=prefs().getLong("code",0);
        File candidate=apk();
        return expected>0&&candidate.isFile()?prefs().getString("version",null):null;
    }
    @PluginMethod
    public void status(PluginCall call){
        try{
            JSObject data=new JSObject();PackageInfo info=installed();
            data.put("version",info.versionName);data.put("versionCode",code(info));
            data.put("busy",busy);
            data.put("pending",prefs().getLong("code",0)>code(info)?pendingVersion():null);
            call.resolve(data);
        }catch(Exception error){call.reject("Could not read installed app version: "+error.getMessage());}
    }
    @PluginMethod
    public void check(PluginCall call){
        if(busy){call.resolve(message(false,"An APK update download is already running."));return;}
        busy=true;
        executor.execute(()->{
            try{
                long installedCode=code(installed());
                // Direct download avoids the API hostname while preserving APK checks.
                HttpURLConnection index=connect(ASSET_PREFIX+"android-update.json?t="+System.currentTimeMillis());
                JSONObject meta;
                try{
                    int response=index.getResponseCode();
                    if(response==404){
                        call.resolve(message(true,"No Android update has been published to the in-app channel yet."));
                        return;
                    }
                    meta=new JSONObject(new String(read(index,64*1024),StandardCharsets.UTF_8));
                }finally{index.disconnect();}
                long nextCode=meta.getLong("versionCode"),bytes=meta.getLong("bytes");
                String checksum=meta.getString("sha256"),version=meta.getString("versionName");
                if(!getContext().getPackageName().equals(meta.getString("packageName"))||
                   !shaFormat(checksum)||nextCode<1||bytes<10000||bytes>MAX_APK||
                   version.isEmpty())throw new Exception("Android release manifest is invalid");
                if(nextCode<=installedCode){
                    call.resolve(message(true,"You already have the latest published Android APK."));
                    return;
                }
                String url=ASSET_PREFIX+APK_NAME;
                File dest=apk();
                if(dest.isFile()&&dest.length()==bytes&&
                   hex(digestFile(dest)).equals(checksum)){
                    verifyApk(dest,nextCode);
                    savePending(nextCode,version,checksum);
                    JSObject result=message(true,"Android update "+version+" is ready to install.");
                    result.put("pending",version);call.resolve(result);return;
                }
                if(!folder().isDirectory()&&!folder().mkdirs())
                    throw new Exception("Cannot create the app update folder");
                File temp=new File(folder(),"download.part.apk");
                HttpURLConnection download=connect(url+"?t="+System.currentTimeMillis());
                long total=0;
                try{
                    if(download.getResponseCode()!=200)
                        throw new Exception("Android APK download returned HTTP "+download.getResponseCode());
                    MessageDigest digest=MessageDigest.getInstance("SHA-256");
                    try(InputStream input=download.getInputStream();FileOutputStream output=new FileOutputStream(temp)){
                        byte[] chunk=new byte[32768];int n;
                        while((n=input.read(chunk))!=-1){
                            total+=n;
                            if(total>MAX_APK||total>bytes)throw new Exception("APK download is larger than expected");
                            digest.update(chunk,0,n);output.write(chunk,0,n);
                        }
                        output.getFD().sync();
                    }
                    if(total!=bytes||!hex(digest.digest()).equals(checksum))
                        throw new Exception("APK download failed checksum verification");
                    verifyApk(temp,nextCode);
                    if(dest.exists()&&!dest.delete())throw new Exception("Cannot replace the previous update cache");
                    if(!temp.renameTo(dest))throw new Exception("Cannot save downloaded APK");
                    savePending(nextCode,version,checksum);
                }finally{download.disconnect();if(temp.exists())temp.delete();}
                JSObject result=message(true,"Android update "+version+" downloaded. Tap Install update and approve Android's prompt.");
                result.put("pending",version);call.resolve(result);
            }catch(Exception error){
                call.resolve(message(false,updateError(error)));
            }finally{busy=false;}
        });
    }
    private void savePending(long versionCode,String name,String digest){
        prefs().edit().putLong("code",versionCode)
            .putString("version",name).putString("sha256",digest).apply();
    }
    private static JSObject message(boolean ok,String message){
        JSObject result=new JSObject();result.put("ok",ok);result.put("message",message);return result;
    }
    @PluginMethod
    public void install(PluginCall call){
        try{
            if(busy){call.resolve(message(false,"Update download is still in progress."));return;}
            long expected=prefs().getLong("code",0);
            String hash=prefs().getString("sha256","");
            File file=apk();
            if(expected<=code(installed())||!file.isFile()||!shaFormat(hash)||
               !hex(digestFile(file)).equals(hash))
                throw new Exception("No verified APK update is downloaded. Tap Check updates first.");
            verifyApk(file,expected);
            if(Build.VERSION.SDK_INT>=26&&!getContext().getPackageManager().canRequestPackageInstalls()){
                JSObject value=message(false,"Allow app installs for Pokémon Brisk Emerald in Android settings, then tap Install update again.");
                value.put("needsPermission",true);
                call.resolve(value);return;
            }
            Uri uri=FileProvider.getUriForFile(getContext(),
                getContext().getPackageName()+".briskupdates",file);
            Intent intent=new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri,"application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().runOnUiThread(()->getActivity().startActivity(intent));
            call.resolve(message(true,"Android's installer opened. Approve the update to finish installing it."));
        }catch(Exception error){call.resolve(message(false,"Could not install update: "+error.getMessage()));}
    }
    @PluginMethod
    public void openInstallSettings(PluginCall call){
        if(Build.VERSION.SDK_INT<26){call.resolve(message(true,"Install approval is managed by Android."));return;}
        Intent intent=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:"+getContext().getPackageName()));
        getActivity().runOnUiThread(()->getActivity().startActivity(intent));
        call.resolve(message(true,"Enable installs for this app, then return and tap Install update."));
    }
    @Override
    protected void handleOnDestroy(){
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
