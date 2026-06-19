package com.pyrrhus.simplenote;

import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

final class LocalBridge {
    private final NoteDbHelper db;

    LocalBridge(NoteDbHelper db) {
        this.db = db;
    }

    @JavascriptInterface public String request(String method, String path, String body) {
        try {
            if ("GET".equals(method) && "/api/notes".equals(path)) {
                JSONArray result = new JSONArray();
                for (Note note : db.all("全部", "")) result.put(note.toJson());
                return ok(result);
            }
            if ("GET".equals(method) && "/api/settings".equals(path)) {
                JSONObject result = new JSONObject()
                    .put("webdav_url", db.getSetting("webdav_url", ""))
                    .put("webdav_username", db.getSetting("webdav_username", ""))
                    .put("webdav_password", db.getSetting("webdav_password", ""))
                    .put("webdav_password_set", !db.getSetting("webdav_password", "").isEmpty())
                    .put("theme", db.getSetting("theme", "paper"))
                    .put("categories", new JSONArray(db.categories()));
                return ok(result);
            }
            if ("POST".equals(method) && "/api/notes".equals(path)) {
                JSONObject input = new JSONObject(body);
                Note note = Note.fromJson(input);
                note.id = java.util.UUID.randomUUID().toString();
                note.createdAt = note.updatedAt = NoteDbHelper.now();
                db.save(note);
                return ok(note.toJson());
            }
            if ("PUT".equals(method) && path.startsWith("/api/notes/")) {
                String id = path.substring("/api/notes/".length());
                Note existing = db.find(id);
                if (existing == null) return error("笔记不存在");
                JSONObject input = new JSONObject(body);
                existing.title = input.optString("title", "");
                existing.content = input.optString("content", "");
                existing.format = input.optString("format", "markdown");
                existing.category = input.optString("category", "随笔");
                existing.updatedAt = NoteDbHelper.now();
                db.save(existing);
                return ok(existing.toJson());
            }
            if ("DELETE".equals(method) && path.startsWith("/api/notes/")) {
                db.delete(path.substring("/api/notes/".length()));
                return ok(JSONObject.NULL);
            }
            if ("PUT".equals(method) && "/api/settings".equals(path)) {
                JSONObject input = new JSONObject(body);
                db.setSetting("webdav_url", input.optString("webdav_url", ""));
                db.setSetting("webdav_username", input.optString("webdav_username", ""));
                String password = input.optString("webdav_password", "");
                if (!password.isEmpty()) db.setSetting("webdav_password", password);
                db.setSetting("theme", input.optString("theme", "paper"));
                JSONArray categories = input.optJSONArray("categories");
                if (categories != null) {
                    java.util.ArrayList<String> values = new java.util.ArrayList<>();
                    for (int i = 0; i < categories.length(); i++) {
                        String value = categories.optString(i).trim();
                        if (!value.isEmpty() && value.codePointCount(0, value.length()) <= 4) values.add(value);
                    }
                    db.categories(values);
                }
                return ok(new JSONObject().put("ok", true));
            }
            if ("POST".equals(method) && "/api/sync/push".equals(path)) {
                try {
                    db.merge(WebDavSync.download(
                        requiredUrl(),
                        db.getSetting("webdav_username", ""),
                        db.getSetting("webdav_password", "")
                    ));
                } catch (Exception error) {
                    // The first sync may not have a remote file yet. Other failures must stop.
                    if (error.getMessage() == null || !error.getMessage().contains("404")) {
                        throw error;
                    }
                }
                WebDavSync.upload(
                    requiredUrl(),
                    db.getSetting("webdav_username", ""),
                    db.getSetting("webdav_password", ""),
                    db.exportJson()
                );
                return ok(new JSONObject()
                    .put("ok", true)
                    .put("count", db.all("全部", "").size())
                    .put("synced_at", NoteDbHelper.now()));
            }
            if ("POST".equals(method) && "/api/sync/pull".equals(path)) {
                int count = db.merge(WebDavSync.download(
                    requiredUrl(),
                    db.getSetting("webdav_username", ""),
                    db.getSetting("webdav_password", "")
                ));
                return ok(new JSONObject()
                    .put("ok", true)
                    .put("count", count)
                    .put("synced_at", NoteDbHelper.now()));
            }
            return error("不支持的本地操作：" + method + " " + path);
        } catch (Exception error) {
            return error(error.getMessage() == null ? "操作失败" : error.getMessage());
        }
    }

    private String requiredUrl() {
        String url = db.getSetting("webdav_url", "").trim();
        if (url.isEmpty()) throw new IllegalStateException("请先配置 WebDAV");
        return url;
    }

    private static String ok(Object data) throws Exception {
        return new JSONObject().put("ok", true).put("data", data).toString();
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("ok", false).put("error", message).toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"操作失败\"}";
        }
    }
}
