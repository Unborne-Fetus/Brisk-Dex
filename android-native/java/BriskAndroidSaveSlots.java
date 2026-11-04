package com.briskemerald.briskdex;

import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * App-managed native game slots. The game still sees one standard PENSAVE
 * flash file; Brisk Dex switches complete validated images while stopped.
 * State changes are crash-recoverable and old compact saves are preserved.
 */
public final class BriskAndroidSaveSlots {
    private BriskAndroidSaveSlots() {}
    private static final String SLOTS="brisk-game-slots";
    private static final String GAME="native-brisk-emerald";
    private static final String STATE="state.json";
    private static final String MIGRATION="pre-migration-compact.sav";
    private static final int COMPACT_MAGIC=0x32534b42;

    public static final class Snapshot {
        public final int activeSlot;
        public final byte[][] saves;
        public final byte[] migration;
        Snapshot(int activeSlot,byte[][] saves,byte[] migration){
            this.activeSlot=activeSlot;this.saves=saves;this.migration=migration;
        }
    }
    private static final class State {
        final int active;
        final int pending;
        State(int active,int pending){this.active=active;this.pending=pending;}
    }
    private static File game(File root){return new File(root,GAME);}
    private static File directory(File root){return new File(root,SLOTS);}
    private static File state(File root){return new File(directory(root),STATE);}
    private static File slot(File root,int index,String type){
        return new File(directory(root),"slot-"+(index+1)+"."+type);
    }
    private static void ensure(File folder) throws IOException {
        if(!folder.isDirectory()&&!folder.mkdirs())
            throw new IOException("Unable to create private Android native save directory");
    }
    private static byte[] read(File file,int limit) throws IOException {
        if(!file.isFile())return null;
        if(file.length()>limit)throw new IOException("Native save file exceeds size limit");
        try(FileInputStream input=new FileInputStream(file);
            ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] part=new byte[8192];int n;
            while((n=input.read(part))!=-1){
                if(output.size()+n>limit)throw new IOException("Native save file exceeds size limit");
                output.write(part,0,n);
            }
            return output.toByteArray();
        }
    }
    private static byte[] validated(File file) throws IOException {
        byte[] data=read(file,BriskAndroidSaveStore.SAVE_BYTES);
        if(data!=null)BriskAndroidSaveStore.validateSave(data);
        return data;
    }
    private static byte[] rtc(File file) throws IOException {
        byte[] value=read(file,32);
        if(value!=null)BriskAndroidSaveStore.validateClock(new String(value,StandardCharsets.US_ASCII));
        return value;
    }
    private static void atomic(File file,byte[] data) throws IOException {
        ensure(file.getParentFile());
        File temp=new File(file.getParentFile(),file.getName()+".tmp-"+UUID.randomUUID());
        try{
            try(FileOutputStream output=new FileOutputStream(temp)){
                output.write(data);
                output.getFD().sync();
            }
            if(!temp.renameTo(file))throw new IOException("Unable to commit Android save file "+file.getName());
        }finally{
            if(temp.exists())temp.delete();
        }
    }
    private static void discard(File file) throws IOException {
        if(file.exists()&&!file.delete())throw new IOException("Unable to remove "+file.getName());
    }
    private static void writeState(File root,int active,int pending) throws IOException {
        try{
            JSONObject data=new JSONObject();
            data.put("version",1);
            data.put("active",active);
            if(pending>=0)data.put("pending",pending);
            atomic(state(root),(data.toString()+"\n").getBytes(StandardCharsets.UTF_8));
        }catch(org.json.JSONException error){
            throw new IOException("Unable to serialize native save-slot metadata",error);
        }
    }
    private static State readState(File root) throws IOException {
        byte[] raw=read(state(root),4096);
        if(raw==null)return null;
        try{
            JSONObject value=new JSONObject(new String(raw,StandardCharsets.UTF_8));
            int active=value.getInt("active"),pending=value.has("pending")?value.getInt("pending"):-1;
            if(value.getInt("version")!=1||active<0||active>1||pending>1||pending< -1)
                throw new IOException("Invalid save-slot metadata; existing saves were not changed");
            return new State(active,pending);
        }catch(org.json.JSONException error){
            throw new IOException("Corrupt Android game slot metadata; existing saves were not changed",error);
        }
    }
    private static boolean compact(byte[] save){
        if(save==null)return false;
        for(int sector=0;sector<32;sector++){
            int i=28+sector*4096+0xff8;
            int signature=(save[i]&255)|((save[i+1]&255)<<8)|
                ((save[i+2]&255)<<16)|((save[i+3]&255)<<24);
            if(signature==COMPACT_MAGIC)return true;
        }
        return false;
    }
    private static void apply(File root,int index) throws IOException {
        byte[] save=validated(slot(root,index,"sav"));
        byte[] clock=rtc(slot(root,index,"rtc"));
        File game=game(root);
        ensure(game);
        if(save!=null)atomic(new File(game,"pokeemerald.sav"),save);
        else discard(new File(game,"pokeemerald.sav"));
        if(clock!=null)atomic(new File(game,"pokeemerald.rtc"),clock);
        else discard(new File(game,"pokeemerald.rtc"));
    }
    private static State init(File root) throws IOException {
        ensure(root);ensure(game(root));ensure(directory(root));
        State current=readState(root);
        if(current!=null){
            if(current.pending>=0){
                apply(root,current.pending);
                writeState(root,current.pending,-1);
                return new State(current.pending,-1);
            }
            return current;
        }
        if(new File(directory(root),MIGRATION).isFile())
            return null; // unfinished migration: recover from original, never guess
        byte[] live=validated(new File(game(root),"pokeemerald.sav"));
        if(compact(live))return null; // require validated, lossless one-time migration
        if(live!=null)atomic(slot(root,0,"sav"),live);
        byte[] clock=rtc(new File(game(root),"pokeemerald.rtc"));
        if(clock!=null)atomic(slot(root,0,"rtc"),clock);
        writeState(root,0,-1);
        return new State(0,-1);
    }
    private static void sync(File root,State state) throws IOException {
        byte[] live=validated(new File(game(root),"pokeemerald.sav"));
        if(compact(live))throw new IOException("The compact native save must be migrated before switching");
        if(live!=null)atomic(slot(root,state.active,"sav"),live);
        byte[] clock=rtc(new File(game(root),"pokeemerald.rtc"));
        if(clock!=null)atomic(slot(root,state.active,"rtc"),clock);
        else discard(slot(root,state.active,"rtc"));
    }
    public static synchronized Snapshot list(File root) throws IOException {
        State state=init(root);
        if(state==null){
            File preserved=new File(directory(root),MIGRATION);
            byte[] original=validated(preserved.isFile()?preserved:new File(game(root),"pokeemerald.sav"));
            if(!compact(original))throw new IOException("Interrupted compact save migration; original save is unavailable");
            return new Snapshot(0,null,original);
        }
        sync(root,state);
        return new Snapshot(state.active,new byte[][]{
            validated(slot(root,0,"sav")),validated(slot(root,1,"sav"))},null);
    }
    public static synchronized int select(File root,int requested) throws IOException {
        if(requested<0||requested>1)throw new IOException("Select save slot 1 or 2");
        State current=init(root);
        if(current==null)throw new IOException("Migrate the original dual-profile save before switching");
        sync(root,current);
        if(current.active==requested)return requested;
        writeState(root,current.active,requested);
        apply(root,requested);
        writeState(root,requested,-1);
        return requested;
    }
    /**
     * Update a single already-migrated PC profile, never the in-game compact format.
     * Caller must stop the engine first. The expected flash CRC rejects stale
     * edits made against a save that the game has since changed.
     */
    public static synchronized int updateProfile(File root,int index,int expectedCrc,byte[] flash)
            throws IOException {
        if(index<0||index>1)throw new IOException("Invalid Brisk Dex save slot");
        if(flash==null||flash.length!=131072)throw new IOException("Expected a complete 128 KiB flash image");
        // Only accept the legacy per-sector layout used by Brisk Dex-managed slots.
        boolean[] seen=new boolean[14];
        for(int physical=0;physical<14;physical++){
            int off=physical*4096;
            int signature=(flash[off+0xff8]&255)|((flash[off+0xff9]&255)<<8)|
                ((flash[off+0xffa]&255)<<16)|((flash[off+0xffb]&255)<<24);
            int section=(flash[off+0xff4]&255)|((flash[off+0xff5]&255)<<8);
            if(signature==0x08012025&&section>=0&&section<14)seen[section]=true;
        }
        for(boolean present:seen)if(!present)
            throw new IOException("Dex transfer is not a complete Generation III flash image");
        State state=init(root);
        if(state==null)throw new IOException("Migrate compact native profiles before editing");
        sync(root,state);
        File destination=slot(root,index,"sav");
        byte[] previous=validated(destination);
        if(previous==null)throw new IOException("This save slot is empty; save inside the game first");
        if(compact(previous))throw new IOException("Cannot edit an in-game compact profile");
        int currentCrc=(previous[24]&255)|((previous[25]&255)<<8)|
            ((previous[26]&255)<<16)|((previous[27]&255)<<24);
        if(currentCrc!=expectedCrc)
            throw new IOException("Save changed since it was loaded. Refresh the saved profile before transferring.");
        byte[] updated=previous.clone();
        System.arraycopy(flash,0,updated,28,flash.length);
        java.util.zip.CRC32 crc=new java.util.zip.CRC32();
        crc.update(flash);
        int nextCrc=(int)crc.getValue();
        updated[24]=(byte)nextCrc;
        updated[25]=(byte)(nextCrc>>>8);
        updated[26]=(byte)(nextCrc>>>16);
        updated[27]=(byte)(nextCrc>>>24);
        BriskAndroidSaveStore.validateSave(updated);
        // Preserve a rollback copy before either managed or live flash changes.
        atomic(new File(directory(root),"slot-"+(index+1)+".before-dex-edit.sav"),previous);
        // Active live save goes first; a crash before the slot copy is repaired
        // by sync() from the validated live save on the next launch.
        if(state.active==index)atomic(new File(game(root),"pokeemerald.sav"),updated);
        atomic(destination,updated);
        return nextCrc;
    }
    public static synchronized void migrate(File root,byte[][] saves,int active) throws IOException {
        if(active<0||active>1||saves==null||saves.length!=2||saves[active]==null)
            throw new IOException("Invalid target save profiles");
        for(byte[] save:saves)if(save!=null)BriskAndroidSaveStore.validateSave(save);
        if(readState(root)!=null)throw new IOException("Native save slots are already initialized");
        ensure(root);ensure(game(root));ensure(directory(root));
        File original=new File(directory(root),MIGRATION);
        if(!original.isFile()){
            byte[] live=validated(new File(game(root),"pokeemerald.sav"));
            if(!compact(live))throw new IOException("No compact Brisk save is available for migration");
            atomic(original,live);
        }
        byte[] preserved=validated(original);
        if(!compact(preserved))throw new IOException("Preserved compact save is invalid");
        for(int i=0;i<2;i++)
            if(saves[i]!=null)atomic(slot(root,i,"sav"),saves[i]);
            else discard(slot(root,i,"sav"));
        byte[] clock=rtc(new File(game(root),"pokeemerald.rtc"));
        if(clock!=null)for(int i=0;i<2;i++)if(saves[i]!=null)
            atomic(slot(root,i,"rtc"),clock);
        apply(root,active);
        writeState(root,active,-1);
    }
    /**
     * Backup both independent app-managed profiles and RTC offsets as one
     * validated portable file. Earlier single-profile backups stay readable.
     */
    public static synchronized String backup(File root) throws Exception {
        Snapshot snapshot=list(root);
        if(snapshot.migration!=null)
            throw new IOException("Migrate the original compact profiles before backing up");
        JSONObject backup=new JSONObject();
        backup.put("format","brisk-dex-slots-backup");
        backup.put("version",2);
        backup.put("profile","brisk");
        backup.put("activeSlot",snapshot.activeSlot);
        JSONArray profiles=new JSONArray();
        for(int i=0;i<2;i++){
            JSONObject entry=new JSONObject();
            byte[] save=snapshot.saves[i];
            // A clock without a saved profile must not create an invalid
            // backup that cannot later be restored.
            byte[] clock=save==null?null:rtc(slot(root,i,"rtc"));
            entry.put("save",save==null?JSONObject.NULL:Base64.encodeToString(save,Base64.NO_WRAP));
            entry.put("rtc",clock==null?JSONObject.NULL:new String(clock,StandardCharsets.US_ASCII));
            profiles.put(entry);
        }
        backup.put("profiles",profiles);
        String encoded=backup.toString(2)+"\n";
        if(encoded.getBytes(StandardCharsets.UTF_8).length>BriskAndroidSaveStore.MAX_BACKUP_BYTES)
            throw new IOException("Native game save backup exceeds the size limit");
        return encoded;
    }
    private static byte[] decode(String value) throws IOException {
        if(value==null)return null;
        byte[] decoded;
        try{decoded=Base64.decode(value,Base64.DEFAULT);}
        catch(IllegalArgumentException error){throw new IOException("Malformed backup encoding",error);}
        if(!Base64.encodeToString(decoded,Base64.NO_WRAP).equals(value))
            throw new IOException("Noncanonical backup encoding");
        BriskAndroidSaveStore.validateSave(decoded);
        if(compact(decoded))throw new IOException("Old compact saves must be migrated before restoration");
        return decoded;
    }
    public static synchronized String restore(File root,String backup) throws Exception {
        if(backup.getBytes(StandardCharsets.UTF_8).length>BriskAndroidSaveStore.MAX_BACKUP_BYTES)
            throw new IOException("The native save backup exceeds the size limit");
        JSONObject document=new JSONObject(backup);
        if("brisk-native-backup".equals(document.optString("format"))){
            State original=init(root);
            if(original==null)throw new IOException("Migrate the existing compact save before restoring");
            // Validate before the legacy restore mutates files.
            decode(document.getString("save"));
            String recovery=BriskAndroidSaveStore.restore(game(root),backup);
            sync(root,original);
            return recovery;
        }
        if(!"brisk-dex-slots-backup".equals(document.optString("format"))||
           document.optInt("version")!=2||!"brisk".equals(document.optString("profile")))
            throw new IOException("Not a compatible Brisk Dex save-slot backup");
        int active=document.getInt("activeSlot");
        JSONArray profiles=document.getJSONArray("profiles");
        if(active<0||active>1||profiles.length()!=2)
            throw new IOException("Invalid backup save-slot metadata");
        byte[][] saves=new byte[2][];
        byte[][] clocks=new byte[2][];
        for(int i=0;i<2;i++){
            JSONObject entry=profiles.getJSONObject(i);
            if(!entry.has("save")||!entry.has("rtc"))
                throw new IOException("A native backup slot is missing required fields");
            if(!entry.isNull("save"))saves[i]=decode(entry.getString("save"));
            if(!entry.isNull("rtc")){
                String clock=BriskAndroidSaveStore.validateClock(entry.getString("rtc"));
                if(saves[i]==null)throw new IOException("RTC exists for an empty save slot");
                clocks[i]=clock.getBytes(StandardCharsets.US_ASCII);
            }
        }
        State current=init(root);
        if(current==null)throw new IOException("Migrate the existing compact save before restoring");
        sync(root,current);
        File folder=directory(root);
        File staging=new File(root,SLOTS+".restore-"+UUID.randomUUID());
        File recovery=new File(root,SLOTS+".before-restore-"+UUID.randomUUID());
        ensure(staging);
        boolean originalMoved=false,activated=false;
        try{
            for(int i=0;i<2;i++){
                if(saves[i]!=null)atomic(new File(staging,"slot-"+(i+1)+".sav"),saves[i]);
                if(clocks[i]!=null)atomic(new File(staging,"slot-"+(i+1)+".rtc"),clocks[i]);
            }
            JSONObject state=new JSONObject();
            state.put("version",1);
            state.put("active",current.active);
            state.put("pending",active);
            atomic(new File(staging,STATE),(state.toString()+"\n").getBytes(StandardCharsets.UTF_8));
            if(!folder.renameTo(recovery))throw new IOException("Unable to preserve original save slots");
            originalMoved=true;
            if(!staging.renameTo(folder)){
                if(!recovery.renameTo(folder))
                    throw new IOException("Save-slot activation failed; recovery retained at "+recovery.getName());
                originalMoved=false;
                throw new IOException("Unable to activate restored game slots");
            }
            activated=true;
            // Pending state completes interrupted restores on the next launch.
            apply(root,active);
            writeState(root,active,-1);
            return recovery.getAbsolutePath();
        }finally{
            if(staging.exists())deleteDirectory(staging);
            if(originalMoved&&!activated&&recovery.exists()&&!folder.exists())
                recovery.renameTo(folder);
        }
    }
    private static void deleteDirectory(File dir){
        File[] files=dir.listFiles();
        if(files!=null)for(File item:files){
            if(item.isDirectory())deleteDirectory(item);
            else item.delete();
        }
        dir.delete();
    }
    public static synchronized void synchronizeAfterRestore(File root) throws IOException {
        State state=init(root);
        if(state==null)throw new IOException("Restore requires compact save migration before switching");
        sync(root,state);
    }
}