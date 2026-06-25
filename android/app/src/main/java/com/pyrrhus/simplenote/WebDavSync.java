package com.pyrrhus.simplenote;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.SSLException;

final class WebDavSync {
    private static final String DAV_FILENAME = "simple-note-export.json";
    private static final String NOTE_FILE_SUFFIX = ".json";
    private static final String IMAGE_DIR = "images";
    private static final Pattern IMAGE_REF = Pattern.compile("images/([^\\s)\"'<>]+)");

    private WebDavSync() {}

    static void upload(
        String baseUrl, String username, String password, JSONObject payload, File localImageDir
    ) throws Exception {
        try {
            JSONArray notes = payload.optJSONArray("notes");
            JSONArray noteIds = new JSONArray();
            if (notes != null) {
                for (int i = 0; i < notes.length(); i++) {
                    JSONObject note = notes.getJSONObject(i);
                    String noteId = note.optString("id", "").trim();
                    if (noteId.isEmpty()) throw new IllegalStateException("笔记 ID 不能为空");
                    uploadReferencedImages(baseUrl, username, password, localImageDir, note.optString("content", ""));
                    noteIds.put(noteId);
                    putJson(baseUrl, username, password, noteId + NOTE_FILE_SUFFIX, note);
                }
            }
            JSONObject index = new JSONObject()
                .put("signature", NoteDbHelper.ARCHIVE_SIGNATURE)
                .put("version", 3)
                .put("exported_at", payload.optString("exported_at", NoteDbHelper.now()))
                .put("notes", noteIds)
                .put("categories", payload.optJSONArray("categories") == null
                    ? new JSONArray()
                    : payload.optJSONArray("categories"));
            putJson(baseUrl, username, password, DAV_FILENAME, index);
        } catch (Exception error) {
            throw friendlyError(baseUrl, error);
        }
    }

    static JSONObject download(String baseUrl, String username, String password, File localImageDir) throws Exception {
        try {
            JSONObject index = getJson(baseUrl, username, password, DAV_FILENAME);
            JSONArray remoteNotes = index.optJSONArray("notes");
            if (remoteNotes == null || remoteNotes.length() == 0 ||
                remoteNotes.opt(0) instanceof JSONObject) {
                downloadReferencedImages(baseUrl, username, password, localImageDir, remoteNotes);
                return index;
            }
            JSONArray notes = new JSONArray();
            for (int i = 0; i < remoteNotes.length(); i++) {
                String noteId = remoteNotes.getString(i).trim();
                if (!noteId.isEmpty()) {
                    JSONObject note = getJson(baseUrl, username, password, noteId + NOTE_FILE_SUFFIX);
                    if (!note.has("id")) note.put("id", noteId);
                    notes.put(note);
                }
            }
            index.put("notes", notes);
            downloadReferencedImages(baseUrl, username, password, localImageDir, notes);
            return index;
        } catch (Exception error) {
            throw friendlyError(baseUrl, error);
        }
    }

    private static JSONObject getJson(String baseUrl, String username, String password, String fileName)
        throws Exception {
        HttpURLConnection connection = open(baseUrl, username, password, "GET", fileName);
        verify(connection);
        try (InputStream input = connection.getInputStream();
             BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line);
            return new JSONObject(text.toString());
        }
    }

    private static void putJson(
        String baseUrl, String username, String password, String fileName, JSONObject payload) throws Exception {
        byte[] bytes = payload.toString(2).getBytes(StandardCharsets.UTF_8);
        putBytes(baseUrl, username, password, fileName, bytes, "application/json; charset=utf-8");
    }

    private static void putBytes(
        String baseUrl, String username, String password, String fileName, byte[] bytes, String contentType
    ) throws Exception {
        HttpURLConnection connection = open(baseUrl, username, password, "PUT", fileName);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", contentType);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
        verify(connection);
    }

    private static byte[] getBytes(String baseUrl, String username, String password, String fileName)
        throws Exception {
        HttpURLConnection connection = open(baseUrl, username, password, "GET", fileName);
        verify(connection);
        try (InputStream input = connection.getInputStream();
             java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private static void ensureImageDir(String baseUrl, String username, String password) throws Exception {
        HttpURLConnection connection = open(baseUrl, username, password, "MKCOL", IMAGE_DIR);
        int code = connection.getResponseCode();
        if (code != 201 && code != 405) verify(connection);
    }

    private static void uploadReferencedImages(
        String baseUrl, String username, String password, File localImageDir, String content) throws Exception {
        if (localImageDir == null) return;
        Set<String> refs = imageRefs(content);
        if (refs.isEmpty()) return;
        ensureImageDir(baseUrl, username, password);
        for (String filename : refs) {
            File image = new File(localImageDir, filename);
            if (!image.isFile()) continue;
            byte[] bytes = readLocalFile(image);
            putBytes(baseUrl, username, password, IMAGE_DIR + "/" + filename, bytes, contentType(filename));
        }
    }

    private static byte[] readLocalFile(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file);
             java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private static void downloadReferencedImages(
        String baseUrl, String username, String password, File localImageDir, JSONArray notes) throws Exception {
        if (notes == null || localImageDir == null) return;
        if (!localImageDir.exists() && !localImageDir.mkdirs()) return;
        Set<String> filenames = new LinkedHashSet<>();
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            if (note != null) filenames.addAll(imageRefs(note.optString("content", "")));
        }
        for (String filename : filenames) {
            File target = new File(localImageDir, filename);
            if (target.isFile()) continue;
            try (FileOutputStream output = new FileOutputStream(target)) {
                output.write(getBytes(baseUrl, username, password, IMAGE_DIR + "/" + filename));
            } catch (Exception ignored) {
                // Keep note sync usable even when one referenced image is missing remotely.
            }
        }
    }

    private static Set<String> imageRefs(String content) {
        Set<String> result = new LinkedHashSet<>();
        Matcher matcher = IMAGE_REF.matcher(content == null ? "" : content);
        while (matcher.find()) {
            String filename = matcher.group(1);
            if (!filename.contains("/") && !filename.contains("\\") && !filename.startsWith(".")) {
                result.add(filename);
            }
        }
        return result;
    }

    private static String contentType(String filename) {
        String lower = filename.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private static HttpURLConnection open(
        String baseUrl, String username, String password, String method, String fileName) throws Exception {
        String normalized = baseUrl.trim();
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            throw new MalformedURLException("WebDAV 地址必须以 http:// 或 https:// 开头");
        }
        String base = normalized.replaceAll("/+$", "");
        if (base.endsWith("/" + DAV_FILENAME)) {
            base = base.substring(0, base.length() - DAV_FILENAME.length() - 1);
        }
        String target = base + "/" + encodePath(fileName);
        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        if (!username.isEmpty()) {
            String credential = username + ":" + password;
            connection.setRequestProperty("Authorization", "Basic " +
                Base64.encodeToString(credential.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
        }
        return connection;
    }

    private static String encodePath(String value) throws Exception {
        String[] segments = value.split("/");
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < segments.length; i++) {
            if (i > 0) result.append("/");
            result.append(encodeFileName(segments[i]));
        }
        return result.toString();
    }

    private static String encodeFileName(String value) throws Exception {
        return java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20");
    }

    private static void verify(HttpURLConnection connection) throws Exception {
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            if (code == 401) throw new IllegalStateException("WebDAV 用户名或密码错误（HTTP 401）");
            if (code == 403) throw new IllegalStateException("WebDAV 没有读写权限（HTTP 403）");
            if (code == 404) throw new IllegalStateException("WebDAV 路径不存在（HTTP 404）");
            if (code == 405) throw new IllegalStateException("服务器不允许此 WebDAV 操作（HTTP 405）");
            throw new IllegalStateException("WebDAV 返回 HTTP " + code);
        }
    }

    private static Exception friendlyError(String baseUrl, Exception error) {
        String message = error.getMessage() == null ? "" : error.getMessage();
        String lower = message.toLowerCase(java.util.Locale.ROOT);
        if (error instanceof SSLException &&
            (lower.contains("tls packet") || lower.contains("record") || lower.contains("ssl"))) {
            return new IllegalStateException(
                "TLS 协议不匹配：该端口可能是 HTTP，却填写了 https://。请核对 WebDAV 地址、协议和端口。",
                error
            );
        }
        if (lower.contains("trust anchor") || lower.contains("certpath") ||
            lower.contains("certificate")) {
            return new IllegalStateException(
                "HTTPS 证书不受手机信任。请使用有效证书，或把证书安装到系统信任列表。",
                error
            );
        }
        if (lower.contains("cleartext")) {
            return new IllegalStateException(
                "服务器使用 HTTP 明文连接。请确认地址以 http:// 开头；建议优先使用 HTTPS。",
                error
            );
        }
        return error;
    }
}
