package com.briskemerald.briskdex;

import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.zip.CRC32;

/**
 * Android version of the desktop Brisk PENSAVE backup format.
 * Every restore validates the complete save before touching current profiles.
 * Retains a recovery directory and never overwrites while a game is running.
 */
public final class BriskAndroidSaveStore {
    private BriskAndroidSaveStore() {}
    public static final int MAX_BACKUP_BYTES=400000;
    public static final int SAVE_BYTES=131072+28;
    private static final int BRISK_LAYOUT=0x42524b31;

    private static int le32(byte[] bytes,int offset) {
        return (bytes[offset]&255)|((bytes[offset+1]&255)<<8)
            |((bytes[offset+2]&255)<<16)|((bytes[offset+3]&255)<<24);
    }
    public static void validateSave(byte[] bytes) throws IOException {
        if(bytes.length!=SAVE_BYTES)throw new IOException("Incompatible native save length");
        byte[] magic="PENSAVE\0".getBytes(StandardCharsets.US_ASCII);
        for(int i=0;i<magic.length;i++)if(bytes[i]!=magic[i])
            throw new IOException("Not a native Pokémon Brisk Emerald save");
        if(le32(bytes,8)!=1||le32(bytes,12)!=64||le32(bytes,16)!=BRISK_LAYOUT||
           le32(bytes,20)!=131072)throw new IOException("Incompatible native Brisk game or save layout");
        CRC32 crc=new CRC32();
        crc.update(bytes,28,131072);
        if(((int)crc.getValue())!=le32(bytes,24))throw new IOException("Native save checksum does not match");
    }
    private static byte[] readLimited(File file,int limit) throws IOException {
        if(!file.isFile())throw new IOException("No native save exists at "+file.getName());
        if(file.length()>limit)throw new IOException("File exceeds the maximum allowed length");
        try(FileInputStream stream=new FileInputStream(file)) {
            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
            byte[] buf=new byte[8192];
            int count;
            while((count=stream.read(buf))!=-1){
                if(output.size()+count>limit)throw new IOException("File exceeds maximum length");
                output.write(buf,0,count);
            }
            return output.toByteArray();
        }
    }
    public static String validateClock(String clock) throws IOException {
        if(clock==null)return null;
        if(!clock.matches("-?[0-9]{1,16}\\n"))throw new IOException("Invalid game clock format");
        try{
            if(Math.abs(Long.parseLong(clock.trim()))>(1L<<50))
                throw new IOException("Game clock is out of supported range");
        }catch(NumberFormatException exception){throw new IOException("Invalid game clock value",exception);}
        return clock;
    }
    public static String backup(File gameDir) throws Exception {
        byte[] flash=readLimited(new File(gameDir,"pokeemerald.sav"),SAVE_BYTES);
        validateSave(flash);
        File clockFile=new File(gameDir,"pokeemerald.rtc");
        String rtc=clockFile.exists()?validateClock(
            new String(readLimited(clockFile,32),StandardCharsets.US_ASCII)):null;
        SimpleDateFormat iso=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.ROOT);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject object=new JSONObject();
        object.put("format","brisk-native-backup");
        object.put("version",1);
        object.put("profile","brisk");
        object.put("createdAt",iso.format(new Date()));
        object.put("save",Base64.encodeToString(flash,Base64.NO_WRAP));
        object.put("rtc",rtc==null?JSONObject.NULL:rtc);
        String serialized=object.toString(2)+"\n";
        if(serialized.getBytes(StandardCharsets.UTF_8).length>MAX_BACKUP_BYTES)
            throw new IOException("Native backup is too large");
        return serialized;
    }
    public static String restore(File gameDir,String backup) throws Exception {
        if(backup.getBytes(StandardCharsets.UTF_8).length>MAX_BACKUP_BYTES)
            throw new IOException("Native backup is too large");
        JSONObject object=new JSONObject(backup);
        if(!"brisk-native-backup".equals(object.optString("format"))||
           object.optInt("version")!=1||!"brisk".equals(object.optString("profile")))
            throw new IOException("Not a compatible native Brisk backup");
        String encoded=object.getString("save");
        byte[] flash;
        try{flash=Base64.decode(encoded,Base64.DEFAULT);}
        catch(IllegalArgumentException exception){throw new IOException("Invalid backup encoding",exception);}
        if(!Base64.encodeToString(flash,Base64.NO_WRAP).equals(encoded))
            throw new IOException("Noncanonical native save encoding");
        validateSave(flash);
        String rtc=object.isNull("rtc")?null:validateClock(object.getString("rtc"));

        File parent=gameDir.getParentFile();
        if(parent==null||(!parent.isDirectory()&&!parent.mkdirs()))
            throw new IOException("Cannot create Android game save root");
        File staged=new File(parent,gameDir.getName()+".restore-"+UUID.randomUUID());
        File previous=new File(parent,gameDir.getName()+".before-restore-"+UUID.randomUUID());
        if(!staged.mkdir())throw new IOException("Cannot stage restored save");
        boolean moved=false;
        try{
            writeSynced(new File(staged,"pokeemerald.sav"),flash);
            if(rtc!=null)writeSynced(new File(staged,"pokeemerald.rtc"),rtc.getBytes(StandardCharsets.US_ASCII));
            File settings=new File(gameDir,"settings.ini");
            if(settings.isFile())writeSynced(new File(staged,"settings.ini"),readLimited(settings,65536));
            if(gameDir.exists()){
                if(!gameDir.renameTo(previous))throw new IOException("Cannot preserve previous native saves");
                moved=true;
            }
            if(!staged.renameTo(gameDir)){
                if(moved&&!previous.renameTo(gameDir))
                    throw new IOException("Restore failed; previous saves retained at "+previous.getName());
                throw new IOException("Unable to activate restored native game saves");
            }
            return moved?previous.getAbsolutePath():null;
        }finally{
            if(staged.exists())deleteDirectory(staged);
        }
    }
    public static byte[] readNativeSave(File gameDir) throws IOException {
        byte[] bytes=readLimited(new File(gameDir,"pokeemerald.sav"),SAVE_BYTES);
        validateSave(bytes);
        return bytes;
    }
    private static void writeSynced(File dest,byte[] bytes) throws IOException {
        try(FileOutputStream output=new FileOutputStream(dest)){
            output.write(bytes);
            output.getFD().sync();
        }
    }
    private static void deleteDirectory(File dir) {
        File[] children=dir.listFiles();
        if(children!=null)for(File child:children){
            if(child.isDirectory())deleteDirectory(child);else child.delete();
        }
        dir.delete();
    }
}
