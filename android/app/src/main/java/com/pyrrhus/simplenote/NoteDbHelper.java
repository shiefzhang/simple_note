package com.pyrrhus.simplenote;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

final class NoteDbHelper extends SQLiteOpenHelper {
    private static final String DB_NAME = "simple-note.db";
    static final String ARCHIVE_SIGNATURE = "SIMPLE_NOTE_WEBDAV_V1";

    NoteDbHelper(Context context) {
        super(context, DB_NAME, null, 2);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        createNotes(db);
        db.execSQL("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
        ContentValues settings = new ContentValues();
        settings.put("key", "categories");
        settings.put("value", "[\"随笔\",\"待办\",\"阅读\"]");
        db.insert("settings", null, settings);

        Note welcome = new Note();
        welcome.id = UUID.randomUUID().toString();
        welcome.title = "欢迎使用纸间";
        welcome.content = "# 欢迎使用纸间\n\n每条笔记都有唯一 UUID，并按更新时间与 WebDAV 合并。\n\n- 支持离线使用\n- 支持 Markdown / HTML\n- WebDAV 图片会同步到本地显示";
        welcome.format = "markdown";
        welcome.category = "随笔";
        welcome.createdAt = welcome.updatedAt = now();
        welcome.deleted = false;
        save(db, welcome);
    }

    private void createNotes(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,format TEXT NOT NULL,category TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE notes RENAME TO notes_legacy");
            createNotes(db);
            try (Cursor cursor = db.query("notes_legacy", null, null, null, null, null, null)) {
                while (cursor.moveToNext()) {
                    Note note = new Note();
                    long legacyId = cursor.getLong(cursor.getColumnIndexOrThrow("id"));
                    note.id = "legacy-" + legacyId;
                    note.title = cursor.getString(cursor.getColumnIndexOrThrow("title"));
                    note.content = cursor.getString(cursor.getColumnIndexOrThrow("content"));
                    note.format = cursor.getString(cursor.getColumnIndexOrThrow("format"));
                    note.category = cursor.getString(cursor.getColumnIndexOrThrow("category"));
                    note.createdAt = cursor.getString(cursor.getColumnIndexOrThrow("created_at"));
                    note.updatedAt = cursor.getString(cursor.getColumnIndexOrThrow("updated_at"));
                    note.deleted = false;
                    save(db, note);
                }
            }
            db.execSQL("DROP TABLE notes_legacy");
        }
    }

    List<Note> all(String category, String query) {
        return query(category, query, false);
    }

    private List<Note> query(String category, String search, boolean includeDeleted) {
        List<Note> result = new ArrayList<>();
        StringBuilder where = new StringBuilder(includeDeleted ? "1=1" : "deleted=0");
        List<String> args = new ArrayList<>();
        if (category != null && !"全部".equals(category)) {
            where.append(" AND category=?");
            args.add(category);
        }
        if (search != null && !search.trim().isEmpty()) {
            where.append(" AND (title LIKE ? OR content LIKE ?)");
            String value = "%" + search.trim() + "%";
            args.add(value);
            args.add(value);
        }
        try (Cursor cursor = getReadableDatabase().query(
            "notes", null, where.toString(), args.toArray(new String[0]),
            null, null, "updated_at DESC")) {
            while (cursor.moveToNext()) result.add(read(cursor));
        }
        return result;
    }

    Note find(String id) {
        try (Cursor cursor = getReadableDatabase().query(
            "notes", null, "id=?", new String[]{id}, null, null, null)) {
            return cursor.moveToFirst() ? read(cursor) : null;
        }
    }

    void save(Note note) {
        save(getWritableDatabase(), note);
    }

    private static void save(SQLiteDatabase db, Note note) {
        ContentValues values = new ContentValues();
        values.put("id", note.id);
        values.put("title", note.title == null ? "" : note.title);
        values.put("content", note.content == null ? "" : note.content);
        values.put("format", note.format == null ? "markdown" : note.format);
        values.put("category", note.category == null ? "随笔" : note.category);
        values.put("created_at", note.createdAt);
        values.put("updated_at", note.updatedAt);
        values.put("deleted", note.deleted ? 1 : 0);
        db.insertWithOnConflict("notes", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    void delete(String id) {
        Note note = find(id);
        if (note == null) return;
        note.deleted = true;
        note.updatedAt = now();
        save(note);
    }

    String getSetting(String key, String fallback) {
        try (Cursor cursor = getReadableDatabase().query(
            "settings", new String[]{"value"}, "key=?", new String[]{key}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : fallback;
        }
    }

    void setSetting(String key, String value) {
        ContentValues values = new ContentValues();
        values.put("key", key);
        values.put("value", value == null ? "" : value);
        long result = getWritableDatabase().insertWithOnConflict(
            "settings", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        if (result == -1) throw new IllegalStateException("设置保存失败：" + key);
    }

    List<String> categories() {
        List<String> result = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(getSetting("categories", "[]"));
            for (int i = 0; i < array.length(); i++) result.add(array.getString(i));
        } catch (JSONException ignored) {}
        if (result.isEmpty()) result.add("随笔");
        return result;
    }

    void categories(List<String> categories) {
        setSetting("categories", new JSONArray(categories).toString());
    }

    void renameCategory(String oldValue, String newValue) {
        if (oldValue.equals(newValue)) return;
        ContentValues values = new ContentValues();
        values.put("category", newValue);
        values.put("updated_at", now());
        getWritableDatabase().update(
            "notes", values, "category=?", new String[]{oldValue});
    }

    JSONObject exportJson() throws JSONException {
        JSONArray notes = new JSONArray();
        for (Note note : query("全部", "", true)) notes.put(note.toJson());
        return new JSONObject()
            .put("signature", ARCHIVE_SIGNATURE)
            .put("version", 2)
            .put("exported_at", now())
            .put("notes", notes)
            .put("categories", new JSONArray(categories()));
    }

    JSONObject emptyArchiveJson() throws JSONException {
        return new JSONObject()
            .put("signature", ARCHIVE_SIGNATURE)
            .put("version", 2)
            .put("exported_at", now())
            .put("notes", new JSONArray())
            .put("categories", new JSONArray());
    }

    int merge(JSONObject payload) throws JSONException {
        return merge(payload, true);
    }

    int merge(JSONObject payload, boolean mergeCategories) throws JSONException {
        String signature = payload.optString("signature", "").trim();
        if (!signature.isEmpty() && !ARCHIVE_SIGNATURE.equals(signature)) {
            throw new JSONException("文件特征码不匹配，这不是纸间的 WebDAV 数据文件");
        }
        if (signature.isEmpty() && !isValidLegacyArchive(payload)) {
            throw new JSONException("旧版数据文件结构无效，无法确认这是纸间的 WebDAV 数据文件");
        }
        JSONArray notes = payload.optJSONArray("notes");
        int count = 0;
        if (notes != null) {
            for (int i = 0; i < notes.length(); i++) {
                Note incoming = Note.fromJson(notes.getJSONObject(i));
                Note local = find(incoming.id);
                if (local == null || isNewer(incoming.updatedAt, local.updatedAt)) {
                    save(incoming);
                    count++;
                }
            }
        }
        JSONArray categories = payload.optJSONArray("categories");
        if (mergeCategories && categories != null) {
            List<String> values = new ArrayList<>(categories());
            for (int i = 0; i < categories.length(); i++) {
                String value = categories.optString(i).trim();
                if (!value.isEmpty() && value.codePointCount(0, value.length()) <= 4 && !values.contains(value)) {
                    values.add(value);
                }
            }
            categories(values);
        }
        return count;
    }

    private static boolean isValidLegacyArchive(JSONObject payload) {
        int version = payload.optInt("version", -1);
        JSONArray notes = payload.optJSONArray("notes");
        JSONArray categories = payload.optJSONArray("categories");
        if ((version != 1 && version != 2) || notes == null || categories == null) {
            return false;
        }
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            if (note == null || !note.has("id") || !note.has("updated_at")) {
                return false;
            }
            String format = note.optString("format", "markdown");
            if (!"markdown".equals(format) && !"html".equals(format)) {
                return false;
            }
        }
        return true;
    }

    private static Note read(Cursor cursor) {
        Note note = new Note();
        note.id = cursor.getString(cursor.getColumnIndexOrThrow("id"));
        note.title = cursor.getString(cursor.getColumnIndexOrThrow("title"));
        note.content = cursor.getString(cursor.getColumnIndexOrThrow("content"));
        note.format = cursor.getString(cursor.getColumnIndexOrThrow("format"));
        note.category = cursor.getString(cursor.getColumnIndexOrThrow("category"));
        note.createdAt = cursor.getString(cursor.getColumnIndexOrThrow("created_at"));
        note.updatedAt = cursor.getString(cursor.getColumnIndexOrThrow("updated_at"));
        note.deleted = cursor.getInt(cursor.getColumnIndexOrThrow("deleted")) != 0;
        return note;
    }

    static String now() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private static boolean isNewer(String incoming, String local) {
        try {
            return java.time.Instant.parse(incoming).isAfter(java.time.Instant.parse(local));
        } catch (Exception ignored) {
            return incoming.compareTo(local) > 0;
        }
    }
}
