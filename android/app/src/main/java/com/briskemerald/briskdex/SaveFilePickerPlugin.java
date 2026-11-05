package com.briskemerald.briskdex;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
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
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@CapacitorPlugin(name = "SaveFilePicker")
public class SaveFilePickerPlugin extends Plugin {
    // Reopening an external document needs a persisted system picker grant.
    private void requireDocumentGrant(Uri uri, boolean writable) {
        if (uri == null || !"content".equals(uri.getScheme()))
            throw new SecurityException("Select the external save again using Browse device files.");
        for (android.content.UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (uri.equals(permission.getUri()) && permission.isReadPermission()
                && (!writable || permission.isWritePermission())) return;
        }
        throw new SecurityException("Android document access expired. Select the external save again using Browse device files.");
    }
    @PluginMethod
    public void readSaveFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            requireDocumentGrant(uri, false);
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
            requireDocumentGrant(uri, true);
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
    public void discoverBattleRelay(PluginCall call) {
        final int port = call.getInt("port", 8787);
        final int timeoutMs = call.getInt("timeoutMs", 2200);
        CompletableFuture.runAsync(() -> {
            ExecutorService pool = Executors.newFixedThreadPool(32);
            AtomicReference<String> found = new AtomicReference<>(null);
            try {
                ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
                Network network = cm.getActiveNetwork();
                LinkProperties props = network == null ? null : cm.getLinkProperties(network);
                List<String> prefixes = new ArrayList<>();
                if (props != null) {
                    for (LinkAddress link : props.getLinkAddresses()) {
                        InetAddress address = link.getAddress();
                        if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                        byte[] b = address.getAddress();
                        prefixes.add((b[0] & 255) + "." + (b[1] & 255) + "." + (b[2] & 255) + ".");
                    }
                }
                long deadline = System.currentTimeMillis() + Math.max(500, timeoutMs);
                List<CompletableFuture<Void>> jobs = new ArrayList<>();
                for (String prefix : prefixes) {
                    for (int host = 1; host <= 254; host++) {
                        final String candidate = "http://" + prefix + host + ":" + port;
                        jobs.add(CompletableFuture.runAsync(() -> {
                            if (found.get() != null || System.currentTimeMillis() >= deadline) return;
                            HttpURLConnection conn = null;
                            try {
                                conn = (HttpURLConnection) new URL(candidate + "/health").openConnection();
                                conn.setConnectTimeout(180);
                                conn.setReadTimeout(250);
                                conn.setRequestMethod("GET");
                                int status = conn.getResponseCode();
                                if (status >= 200 && status < 300) {
                                    String server = conn.getHeaderField("Content-Type");
                                    if (server != null && server.toLowerCase().contains("application/json")) found.compareAndSet(null, candidate);
                                }
                            } catch (Exception ignored) {
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        }, pool));
                    }
                }
                for (CompletableFuture<Void> job : jobs) {
                    long left = deadline - System.currentTimeMillis();
                    if (left <= 0 || found.get() != null) break;
                    try { job.get(left, TimeUnit.MILLISECONDS); } catch (Exception ignored) {}
                }
                JSObject result = new JSObject();
                if (found.get() != null) result.put("url", found.get());
                result.put("found", found.get() != null);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not scan the local network: " + error.getMessage());
            } finally {
                pool.shutdownNow();
            }
        });
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
            int flags = result.getData().getFlags() &
                (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if ((flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0)
                throw new SecurityException("The selected file provider did not grant read access.");
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            } catch (SecurityException refusedWrite) {
                // A read-only provider may still allow viewing a save.
                getContext().getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
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
