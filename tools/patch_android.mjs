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

@CapacitorPlugin(name = "SaveFilePicker")
public class SaveFilePickerPlugin extends Plugin {
    @PluginMethod
    public void openSaveFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
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
