package com.pyrrhus.simplenote;

import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import android.content.Context;
import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

final class LocalBridge {
    private final NoteDbHelper db;
    private final File imageDir;

    LocalBridge(NoteDbHelper db, Context context) {
        this.db = db;
        this.imageDir = new File(context.getFilesDir(), "images");
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
                JSONObject categoryRenames = input.optJSONObject("category_renames");
                if (categoryRenames != null) {
                    java.util.Iterator<String> keys = categoryRenames.keys();
                    while (keys.hasNext()) {
                        String oldValue = keys.next().trim();
                        String newValue = categoryRenames.optString(oldValue).trim();
                        if (!oldValue.isEmpty() && !newValue.isEmpty()) {
                            db.renameCategory(oldValue, newValue);
                        }
                    }
                }
                JSONArray categories = input.optJSONArray("categories");
                if (categories != null) {
                    java.util.ArrayList<String> values = new java.util.ArrayList<>();
                    for (int i = 0; i < categories.length(); i++) {
                        String value = categories.optString(i).trim();
                        if (!value.isEmpty() && value.codePointCount(0, value.length()) <= 4) values.add(value);
                    }
                    db.categories(values);
                }
                return ok(new JSONObject()
                    .put("ok", true)
                    .put("webdav_url", db.getSetting("webdav_url", ""))
                    .put("webdav_username", db.getSetting("webdav_username", ""))
                    .put("webdav_password", db.getSetting("webdav_password", ""))
                    .put("theme", db.getSetting("theme", "paper"))
                    .put("categories", new JSONArray(db.categories())));
            }
            if ("POST".equals(method) && "/api/sync/push".equals(path)) {
                try {
                    db.merge(WebDavSync.download(
                        requiredUrl(),
                        db.getSetting("webdav_username", ""),
                        db.getSetting("webdav_password", ""),
                        imageDir
                    ), false);
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
                    db.exportJson(),
                    imageDir
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
                    db.getSetting("webdav_password", ""),
                    imageDir
                ));
                return ok(new JSONObject()
                    .put("ok", true)
                    .put("count", count)
                    .put("synced_at", NoteDbHelper.now()));
            }
            if ("POST".equals(method) && "/api/sync/format".equals(path)) {
                WebDavSync.upload(
                    requiredUrl(),
                    db.getSetting("webdav_username", ""),
                    db.getSetting("webdav_password", ""),
                    db.emptyArchiveJson(),
                    imageDir
                );
                return ok(new JSONObject()
                    .put("ok", true)
                    .put("count", 0)
                    .put("synced_at", NoteDbHelper.now()));
            }
            return error("不支持的本地操作：" + method + " " + path);
        } catch (Exception error) {
            return error(error.getMessage() == null ? "操作失败" : error.getMessage());
        }
    }

    @JavascriptInterface public String imageUrl(String path) {
        try {
            String prefix = "images/";
            if (path == null || !path.startsWith(prefix)) return path == null ? "" : path;
            String filename = path.substring(prefix.length());
            if (filename.contains("/") || filename.contains("\\") || filename.startsWith(".")) return path;
            File file = new File(imageDir, filename);
            return file.isFile() ? file.toURI().toString() : path;
        } catch (Exception ignored) {
            return path == null ? "" : path;
        }
    }

    @JavascriptInterface public String saveImage(String fileName, String dataUrl) {
        try {
            if (dataUrl == null || !dataUrl.startsWith("data:image/")) {
                return error("图片格式无效");
            }
            int comma = dataUrl.indexOf(',');
            if (comma < 0) return error("图片数据无效");
            String header = dataUrl.substring(0, comma).toLowerCase(Locale.ROOT);
            String extension = extensionFromHeader(header, fileName);
            String outputName = UUID.randomUUID().toString() + extension;
            if (!imageDir.exists() && !imageDir.mkdirs()) return error("无法创建图片目录");
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            try (FileOutputStream output = new FileOutputStream(new File(imageDir, outputName))) {
                output.write(bytes);
            }
            return ok(new JSONObject().put("path", "images/" + outputName));
        } catch (Exception error) {
            return error(error.getMessage() == null ? "图片保存失败" : error.getMessage());
        }
    }

    private static String extensionFromHeader(String header, String fileName) {
        String lowerName = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lowerName.endsWith(".png")) return ".png";
        if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return ".jpg";
        if (lowerName.endsWith(".gif")) return ".gif";
        if (lowerName.endsWith(".webp")) return ".webp";
        if (lowerName.endsWith(".svg")) return ".svg";
        if (header.contains("image/png")) return ".png";
        if (header.contains("image/jpeg") || header.contains("image/jpg")) return ".jpg";
        if (header.contains("image/gif")) return ".gif";
        if (header.contains("image/webp")) return ".webp";
        if (header.contains("image/svg+xml")) return ".svg";
        return ".png";
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
