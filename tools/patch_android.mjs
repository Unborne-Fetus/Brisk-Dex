import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'briskemerald', 'briskdex');
await fs.mkdir(javaDir, { recursive: true });

const plugin = `package com.briskemerald.briskdex;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.database.Cursor;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "SaveFilePicker")
public class SaveFilePickerPlugin extends Plugin {
    @PluginMethod
    public void readSaveFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new Exception("Could not read save file");
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {call.reject("Could not reopen save: " + error.getMessage());}
    }
    @PluginMethod
    public void writeSaveFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            byte[] data = Base64.decode(call.getString("data"), Base64.DEFAULT);
            if (data.length < 114688) throw new Exception("Save file is incomplete");
            // Keep a recovery copy before changing the document.
            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                 OutputStream backup = new java.io.FileOutputStream(new java.io.File(getContext().getFilesDir(), "briskdex-save.backup.sav"))) {
                if (input == null) throw new Exception("Could not back up save file");
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) backup.write(buffer, 0, count);
            }
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new Exception("This file provider does not allow writing");
                output.write(data); output.flush();
            }
            JSObject result = new JSObject(); result.put("ok", true); call.resolve(result);
        } catch (Exception error) {call.reject("Could not save file: " + error.getMessage());}
    }

    @PluginMethod
    public void openSaveFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/octet-stream",
            "application/x-gba-sav",
            "application/x-srm",
            "*/*"
        });
        startActivityForResult(call, intent, "openSaveFileResult");
    }

    @ActivityCallback
    private void openSaveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("File selection canceled.");
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("No file was selected.");
            return;
        }

        try {
            int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            String name = "save.sav";
            Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null);
            if (cursor != null) {
                try {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0 && cursor.moveToFirst()) {
                        String found = cursor.getString(nameIndex);
                        if (found != null && !found.isEmpty()) name = found;
                    }
                } finally {
                    cursor.close();
                }
            }

            InputStream input = getContext().getContentResolver().openInputStream(uri);
            if (input == null) {
                call.reject("The selected file could not be opened.");
                return;
            }

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            input.close();

            byte[] bytes = output.toByteArray();
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("name", name);
            ret.put("size", bytes.length);
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("Could not read selected save file: " + error.getMessage());
        }
    }
}
`;

const activity = `package com.briskemerald.briskdex;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveFilePickerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;

await fs.writeFile(path.join(javaDir, 'SaveFilePickerPlugin.java'), plugin);
await fs.writeFile(path.join(javaDir, 'MainActivity.java'), activity);
console.log('Installed native Android save-file picker.');

