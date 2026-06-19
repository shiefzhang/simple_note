package com.pyrrhus.simplenote;

import android.util.Base64;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.SSLException;

final class WebDavSync {
    private WebDavSync() {}

    static void upload(String baseUrl, String username, String password, JSONObject payload) throws Exception {
        try {
            HttpURLConnection connection = open(baseUrl, username, password, "PUT");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] bytes = payload.toString(2).getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
            verify(connection);
        } catch (Exception error) {
            throw friendlyError(baseUrl, error);
        }
    }

    static JSONObject download(String baseUrl, String username, String password) throws Exception {
        try {
            HttpURLConnection connection = open(baseUrl, username, password, "GET");
            verify(connection);
            try (InputStream input = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                StringBuilder text = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) text.append(line);
                return new JSONObject(text.toString());
            }
        } catch (Exception error) {
            throw friendlyError(baseUrl, error);
        }
    }

    private static HttpURLConnection open(
        String baseUrl, String username, String password, String method) throws Exception {
        String normalized = baseUrl.trim();
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            throw new MalformedURLException("WebDAV 地址必须以 http:// 或 https:// 开头");
        }
        String target = normalized.replaceAll("/+$", "") + "/simple-note-export.json";
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
