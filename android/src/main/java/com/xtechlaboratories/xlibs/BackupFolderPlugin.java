package com.xtechlaboratories.xlibs;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.regex.Pattern;

// Keeps an X-app's backups in a folder the user picks once in the phone's storage, where file managers and sync apps can reach them.
@CapacitorPlugin(name = "XLibsBackupFolder")
public class BackupFolderPlugin extends Plugin {

    // ========================================================================
    // Chosen folder
    // ========================================================================

    private static final String PREFERENCES_NAME = "x_libs_backup_folder";
    private static final String FOLDER_URI_KEY = "folder_uri";
    private static final String INITIAL_FOLDER_ID = "primary:Documents";
    private static final String EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents";

    // Only names X-Libs' backup_naming writes are accepted, so a name from the page can never reach another file.
    private static final Pattern BACKUP_NAME_PATTERN = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9_.]*(-[A-Za-z0-9_.]+)*-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z(-auto)?\\.[A-Za-z0-9]+$");

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    // The saved folder counts only while Android still lets the app write to it.
    private Uri chosen_folder() {
        String saved = preferences().getString(FOLDER_URI_KEY, null);
        if (saved == null) return null;

        Uri folder = Uri.parse(saved);
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(folder) && permission.isWritePermission()) return folder;
        }
        return null;
    }

    private Uri folder_document(Uri folder) {
        return DocumentsContract.buildDocumentUriUsingTree(folder, DocumentsContract.getTreeDocumentId(folder));
    }

    private String folder_name(Uri folder) {
        try (Cursor cursor = resolver().query(folder_document(folder), new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        }
        return folder.getLastPathSegment();
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    // Gives back the folder, or rejects the call when none is usable.
    private Uri require_folder(PluginCall call) {
        Uri folder = chosen_folder();
        if (folder == null) call.reject("no backup folder is chosen");
        return folder;
    }

    private String require_backup_name(PluginCall call) {
        String name = call.getString("name", "");
        if (!BACKUP_NAME_PATTERN.matcher(name).matches()) {
            call.reject("not a backup name: " + name);
            return null;
        }
        return name;
    }

    // ========================================================================
    // Files in the folder
    // ========================================================================

    // Finds a file directly inside the folder by its name.
    private Uri find_file(Uri folder, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(folder, DocumentsContract.getTreeDocumentId(folder));
        String[] columns = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME };
        try (Cursor cursor = resolver().query(children, columns, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                if (name.equals(cursor.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(folder, cursor.getString(0));
            }
        }
        return null;
    }

    private static byte[] read_all(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    // ========================================================================
    // Methods for the page
    // ========================================================================

    @PluginMethod
    public void get_folder(PluginCall call) {
        Uri folder = chosen_folder();
        JSObject result = new JSObject();
        result.put("name", folder == null ? "" : folder_name(folder));
        call.resolve(result);
    }

    // Opens Android's folder picker, starting in Documents.
    @PluginMethod
    public void choose_folder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE_AUTHORITY, INITIAL_FOLDER_ID));
        }
        startActivityForResult(call, intent, "folder_chosen");
    }

    // Keeps access to the new folder across restarts, and gives up the old one; backing out of the picker keeps the old folder.
    @ActivityCallback
    private void folder_chosen(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            get_folder(call);
            return;
        }

        Uri folder = data.getData();
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        resolver().takePersistableUriPermission(folder, flags);
        for (UriPermission permission : resolver().getPersistedUriPermissions()) {
            if (!permission.getUri().equals(folder)) resolver().releasePersistableUriPermission(permission.getUri(), flags);
        }
        preferences().edit().putString(FOLDER_URI_KEY, folder.toString()).apply();
        get_folder(call);
    }

    // Lists every backup in the folder with its size.
    @PluginMethod
    public void list(PluginCall call) {
        Uri folder = require_folder(call);
        if (folder == null) return;

        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(folder, DocumentsContract.getTreeDocumentId(folder));
        String[] columns = { Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE };
        JSArray files = new JSArray();
        try (Cursor cursor = resolver().query(children, columns, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                String name = cursor.getString(0);
                if (name == null || !BACKUP_NAME_PATTERN.matcher(name).matches()) continue;
                JSObject file = new JSObject();
                file.put("name", name);
                file.put("size_bytes", cursor.getLong(1));
                files.put(file);
            }
        } catch (Exception error) {
            call.reject("could not list the backup folder", error);
            return;
        }
        JSObject result = new JSObject();
        result.put("files", files);
        call.resolve(result);
    }

    // Writes a backup, given as base64, replacing any file of that name.
    @PluginMethod
    public void write(PluginCall call) {
        Uri folder = require_folder(call);
        String name = require_backup_name(call);
        if (folder == null || name == null) return;

        try {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            Uri file = find_file(folder, name);
            if (file == null) file = DocumentsContract.createDocument(resolver(), folder_document(folder), "application/octet-stream", name);
            if (file == null) throw new IllegalStateException("the folder refused a new file");
            try (OutputStream output = resolver().openOutputStream(file, "wt")) {
                output.write(bytes);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("could not write the backup", error);
        }
    }

    // Reads a backup back as base64.
    @PluginMethod
    public void read(PluginCall call) {
        Uri folder = require_folder(call);
        String name = require_backup_name(call);
        if (folder == null || name == null) return;

        try {
            Uri file = find_file(folder, name);
            if (file == null) throw new IllegalStateException("no backup named " + name);
            try (InputStream input = resolver().openInputStream(file)) {
                JSObject result = new JSObject();
                result.put("data", Base64.encodeToString(read_all(input), Base64.NO_WRAP));
                call.resolve(result);
            }
        } catch (Exception error) {
            call.reject("could not read the backup", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        Uri folder = require_folder(call);
        String name = require_backup_name(call);
        if (folder == null || name == null) return;

        try {
            Uri file = find_file(folder, name);
            if (file != null) DocumentsContract.deleteDocument(resolver(), file);
            call.resolve();
        } catch (Exception error) {
            call.reject("could not delete the backup", error);
        }
    }
}
