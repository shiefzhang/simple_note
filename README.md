<div align="center">

# 纸间 · Simple Note

**本地优先、支持 WebDAV 同步的 Android 笔记应用**

Markdown · HTML · LaTeX 数学公式 · Base64 图片 · 分类管理 · 多主题

</div>

---

## 功能

### Android

- 离线创建、编辑、搜索和分类笔记
- 数据保存在应用私有 SQLite 数据库
- Markdown、HTML 和源码三种查看/编辑模式
- 使用 KaTeX 离线渲染 LaTeX 数学公式
- 图片转为 Base64 Data URL，直接保存在笔记内容中
- 清爽浅色、深色工作台、暖色纸感三套主题
- WebDAV 手动同步，支持密码显示/隐藏
- 每条笔记使用永久 UUID
- 按 UTC 更新时间执行 Last Write Wins 合并
- 删除使用墓碑记录，避免旧设备恢复已删除笔记

### FastAPI 网页版

仓库同时包含 FastAPI 网页实现，可独立运行。Android 前端资源已复制到
`android/app/src/main/assets/`，本对话中的 Android 修改不会自动影响网页版。

> iOS 源码仅保存在本地，已通过 `.gitignore` 排除，不会推送到 GitHub。

## 同步协议

WebDAV 目录中保存一个文件：

```text
simple-note-export.json
```

每条笔记包含以下同步字段：

```json
{
  "id": "6176697f-2d32-45da-b288-5cbdac310a75",
  "updated_at": "2026-06-19T03:40:50.729253+00:00",
  "deleted": false
}
```

同步规则：

1. 新笔记生成 UUID，ID 永久不变。
2. 每次修改或删除都会更新 UTC 时间。
3. 相同 UUID 比较 `updated_at`，时间较新的版本胜出。
4. 上传前先读取并合并云端数据，再将合并结果写回 WebDAV。
5. 删除记录作为墓碑参与同步，避免其他设备重新上传旧笔记。

## Markdown 数学公式

行内公式：

```markdown
$E = mc^2$
```

块级公式：

```markdown
$$
\int_a^b f(x)\,dx
$$
```

KaTeX 脚本和字体已经打包进 APK，公式渲染不依赖网络。

## Android 构建

环境要求：

- Android SDK 35
- JDK 17 或更高
- Gradle Wrapper 8.13

Windows：

```powershell
cd android
$env:JAVA_HOME = "D:\android-studio\jbr"
.\gradlew.bat assembleDebug
```

生成文件：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## FastAPI 网页版

```powershell
python -m pip install -r requirements.txt
.\run_web.ps1
```

然后访问：

```text
http://127.0.0.1:8000
```

## WebDAV 配置

在 Android 的“设置”页面填写：

- WebDAV 地址
- 用户名
- 密码

协议必须与服务端端口一致：

- HTTPS 服务使用 `https://`
- 普通 HTTP 服务使用 `http://`

HTTP 会明文传输账号密码，只建议在可信局域网使用。正式部署应使用受系统信任的
HTTPS 证书。

常见错误：

| 错误 | 原因 |
|---|---|
| `unable to parse TLS packet header` | 使用 HTTPS 连接了普通 HTTP 端口 |
| HTTP 401 | 用户名或密码错误 |
| HTTP 403 | WebDAV 账户没有读写权限 |
| HTTP 404 | WebDAV 路径不存在 |
| Certificate / Trust Anchor | HTTPS 证书不受 Android 系统信任 |

## 数据与隐私

- Android 笔记保存在应用私有 SQLite 数据库中。
- WebDAV 密码保存在 Android 本地设置数据库中。
- 只有用户主动执行同步时才会访问网络。
- APK 不依赖 FastAPI 服务即可完整离线运行。
- 本地数据库、构建产物、缓存和 iOS 源码不会提交到仓库。

## 项目结构

```text
simple_note/
├─ android/                   Android 应用
│  └─ app/src/main/
│     ├─ assets/             Android 专用前端资源和 KaTeX
│     ├─ java/               SQLite、WebDAV 与本地数据桥
│     └─ res/                Android 资源
├─ web/                       FastAPI 网页版
├─ requirements.txt
└─ run_web.ps1
```

