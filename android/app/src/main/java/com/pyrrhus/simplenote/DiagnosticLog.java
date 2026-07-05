package com.pyrrhus.simplenote;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

final class DiagnosticLog {
    static final String TAG = "SimpleNoteDiag";
    private static final long MAX_BYTES = 512 * 1024;
    private final File file;

    DiagnosticLog(Context context) {
        file = new File(context.getFilesDir(), "simple-note-diagnostics.log");
    }

    synchronized void event(String event, String details) {
        String line = timestamp() + " [" + Thread.currentThread().getName() + "] "
            + event + " " + oneLine(details) + "\n";
        Log.i(TAG, line.trim());
        try {
            rotateIfNeeded();
            try (FileOutputStream output = new FileOutputStream(file, true)) {
                output.write(line.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception error) {
            Log.e(TAG, "Unable to persist diagnostic log", error);
        }
    }

    String noteSummary(Note note) {
        if (note == null) return "note=null";
        String title = note.title == null ? "" : note.title;
        String content = note.content == null ? "" : note.content;
        return "id=" + oneLine(note.id)
            + " titleLength=" + title.length()
            + " contentLength=" + content.length()
            + " titleBlank=" + title.trim().isEmpty()
            + " contentBlank=" + content.trim().isEmpty()
            + " deleted=" + note.deleted
            + " createdAt=" + oneLine(note.createdAt)
            + " updatedAt=" + oneLine(note.updatedAt);
    }

    String path() { return file.getAbsolutePath(); }

    private void rotateIfNeeded() {
        if (!file.isFile() || file.length() < MAX_BYTES) return;
        File previous = new File(file.getParentFile(), file.getName() + ".1");
        if (previous.exists() && !previous.delete()) Log.w(TAG, "Unable to delete previous log");
        if (!file.renameTo(previous)) Log.w(TAG, "Unable to rotate diagnostic log");
    }

    private static String oneLine(String value) {
        if (value == null) return "";
        return value.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ');
    }

    private static String timestamp() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }
}
