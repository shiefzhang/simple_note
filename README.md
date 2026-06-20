<div align="center">

# 纸间 · 简单笔记

**本地优先、手动保存、通过 WebDAV 跨端同步的轻量笔记应用**

Android · Web · iOS 实现规范 · Markdown · HTML · LaTeX · Base64 图片

</div>

---

## 目录

- [项目定位](#项目定位)
- [当前实现](#当前实现)
- [现有客户端差异](#现有客户端差异)
- [完整功能](#完整功能)
- [交互与状态规则](#交互与状态规则)
- [数据模型](#数据模型)
- [WebDAV 文件协议](#webdav-文件协议)
- [同步算法](#同步算法)
- [分类规则](#分类规则)
- [iOS 开发规范](#ios-开发规范)
- [Android 实现说明](#android-实现说明)
- [网页版实现说明](#网页版实现说明)
- [构建与运行](#构建与运行)
- [安全与隐私](#安全与隐私)
- [测试清单](#测试清单)
- [项目结构](#项目结构)

---

## 项目定位

纸间是一款不依赖中心化笔记服务的简单笔记应用：

- Android 端以本地 SQLite 为主数据源，可完全离线使用。
- 网页版直接读取和写入用户自己的 WebDAV。
- iOS 端源码不提交到本仓库，必须依据本文档实现兼容客户端。
- WebDAV 只保存一个 JSON 文件，不依赖专用服务端、数据库或账号系统。
- 笔记以永久 UUID 标识，使用 UTC 更新时间执行 Last Write Wins 合并。
- 删除采用墓碑记录，避免离线设备把已经删除的笔记重新上传。

项目名称在所有客户端统一为：

```text
纸间 · 简单笔记
```

WebDAV 数据文件名固定为：

```text
simple-note-export.json
```

---

## 当前实现

| 客户端 | 状态 | 数据来源 | 主要技术 |
|---|---|---|---|
| Android | 已实现 | 本地 SQLite，手动同步 WebDAV | Java、WebView、SQLite、原生 WebDAV |
| Web | 已实现 | WebDAV 文件 | FastAPI、原生 JavaScript、HTML/CSS |
| iOS | 本地开发，不推送 GitHub | 应实现本地数据库 + WebDAV | 建议 SwiftUI、SwiftData/Core Data、URLSession |

> `ios-local/` 已被 `.gitignore` 排除。iOS 开发不能依赖仓库中的 iOS 源码，跨端兼容行为以本文档的“数据模型”“WebDAV 文件协议”“同步算法”和“iOS 开发规范”为准。

---

## 现有客户端差异

本文档同时承担“现状说明”和“iOS 跨端契约”两个职责。开发时必须区分：

| 项目 | Android 当前行为 | Web 当前行为 | iOS 必须行为 |
|---|---|---|---|
| 主数据源 | 本地 SQLite | WebDAV | 本地数据库 |
| 保存 | 手动保存到本地 | 手动保存并写 WebDAV | 手动保存到本地 |
| 删除墓碑 | 本地保留并上传 | 加载后过滤；再次保存可能丢失墓碑 | 必须保留并上传 |
| 旧档案 | 无特征码时接受 version 1/2 的合法结构 | 无特征码时当前只接受 version 2 | 接受 version 1/2，上传时升级 |
| 分类下载 | 下载时与本地取并集 | 使用远端分类数组 | 普通下载取有序并集 |
| 分类重命名 | 更新关联笔记并避免旧名复活 | 以整份远端数据覆盖 | 更新关联笔记并避免旧名复活 |
| 凭据 | SQLite 设置表 | 浏览器 Cookie | Keychain |

跨端协议的长期正确行为以本文档的 iOS 要求为准，尤其是：

- 保留删除墓碑；
- 接受并升级合法旧档案；
- 不因分类并集恢复已经重命名的旧名称。

网页版墓碑处理属于当前已知限制。后续修复网页版时，应保留完整 `notes` 数组用于同步，仅在 UI 层过滤 `deleted = true`。

---

## 完整功能

### 笔记列表

- 按 `updated_at` 从新到旧排列。
- 支持标题和正文的关键字搜索。
- 支持按分类筛选。
- 手机端分类常驻显示在笔记列表左侧窄栏中。
- 分类最多 4 个 Unicode 字符；四字分类在窄栏中自动缩小字号并保持单行。
- 列表项显示：
  - 标题；
  - 正文摘要；
  - 分类；
  - 更新时间。
- 已删除笔记不显示在普通列表中。

### 新建笔记

- 点击列表页右上角加号只创建内存草稿并进入编辑页。
- 未点击“保存笔记”前：
  - 不写入 SQLite；
  - 不生成正式 UUID；
  - 不进入笔记列表；
  - 不参与 WebDAV 同步。
- 首次点击“保存笔记”时才创建正式笔记。
- 空标题保存时使用“新笔记”作为标题。

### 编辑与保存

- 不自动保存。
- 标题、正文、分类或格式发生变化后，“保存笔记”按钮高亮并可点击。
- 无变化时保存按钮禁用。
- 保存过程中显示保存状态。
- 保存成功后更新 `updated_at`。
- Android 保存到本地 SQLite；网页版保存时直接写入 WebDAV。

### 内容格式

每篇笔记的 `format` 只能是：

```text
markdown
html
```

编辑页提供三个视图：

| 视图 | 含义 |
|---|---|
| Markdown | 将正文按 Markdown 渲染，并把笔记格式设为 `markdown` |
| HTML | 将正文按 HTML 渲染，并把笔记格式设为 `html` |
| 源码 | 编辑原始正文，不改变笔记当前的 `format` |

视图切换要求：

- Markdown、HTML、源码之间尽量保持当前阅读位置。
- 从预览切到源码时，应依据当前屏幕顶部可见文字定位源码附近行。
- 从源码切到预览时，应依据当前源码行定位渲染后的对应文字。
- 切换格式时页内搜索关键词不得清空。
- 切换到源码时不要自动弹出键盘，也不要因为光标在末尾而滚动到全文末尾。

### Markdown

当前轻量渲染支持：

- 一级、二级、三级标题；
- 粗体；
- 行内代码；
- 引用；
- 无序列表；
- 待办项；
- 普通换行；
- LaTeX 数学公式。

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

Android 和 Web 均内置 KaTeX 静态资源，公式渲染不依赖 CDN。

### HTML

- HTML 内容在预览前移除 `script`、`style`、`iframe`、`object`、`embed`、表单控件等不可安全保存的节点。
- 移除所有以 `on` 开头的事件属性，例如 `onclick`，并过滤危险的 `href`、`src` 协议。
- HTML 标签正常渲染。
- 原始文本中的普通换行和空格应保留，效果等价于：

```css
white-space: pre-wrap;
overflow-wrap: anywhere;
```

#### 网页版桌面端智能粘贴

桌面浏览器从网页、Word、WPS 或其他富文本编辑器复制内容后，可直接粘贴到源码编辑区：

1. 新建或打开一篇笔记；
2. 保持“源码”视图；
3. 直接粘贴富文本；
4. 网页版自动读取剪贴板中的 `text/html`，安全清理后切换到 HTML 预览；
5. 确认效果后点击“保存笔记”写入 WebDAV。

智能粘贴会：

- 删除脚本、事件处理器、表单、嵌入页面及危险链接；
- 清理 Word、WPS、Notion 等编辑器常见的冗余类名和属性；
- 只保留少量安全的文本排版样式；
- 保留标题、段落、列表、表格、链接和安全图片；
- 对空白笔记尝试使用首个标题作为笔记标题；
- 自动格式化 HTML 缩进，便于后续编辑。

源码工具栏提供四个桌面端 HTML 优化工具：

| 工具 | 作用 |
|---|---|
| 清理 HTML | 删除不安全节点、属性和危险 URL |
| 格式化 | 整理标签缩进与换行 |
| 去样式 | 移除 `style`、`class`、`id`、宽高等表现属性 |
| 转 Markdown | 将常见标题、段落、列表、链接、图片、代码、引用和表格转换为 Markdown |

纯文本剪贴板仍按普通文本粘贴，不触发 HTML 转换。智能粘贴和上述优化工具目前仅用于网页版桌面布局，不改变 Android 与 iOS 行为。

### 图片

- 从系统文件选择器选取图片。
- 图片转为 Base64 Data URL。
- Markdown 格式插入：

```markdown
![文件名](data:image/png;base64,...)
```

- HTML 格式插入：

```html
<img src="data:image/png;base64,..." alt="文件名">
```

- 图片数据直接属于笔记正文，会显著增大 WebDAV JSON 文件。
- iOS 必须兼容读取已有 Base64 Data URL，不得擅自迁移为平台私有文件路径。

### 页内搜索

编辑页顶部提供当前笔记的快捷搜索：

- 输入即搜索，不需要额外确认。
- 不区分大小写。
- 显示 `当前序号/总匹配数`。
- 当前匹配使用强调色高亮。
- 其他匹配使用较浅颜色高亮。
- 回车：下一个匹配。
- Shift + 回车：上一个匹配。
- 上、下按钮可切换匹配。
- 定位时只滚动正文容器，不能把顶部搜索框滚出屏幕。
- 切换 Markdown、HTML、源码后保留搜索词并重新定位。
- 搜索结果使用独立滚动容器，当前高亮必须完整显示，不能被编辑区边缘遮挡。

### 网页版桌面布局

桌面端采用分类、笔记列表、编辑器三栏布局：

- 分类栏和笔记列表可分别折叠或展开；
- 折叠状态保存在浏览器本地，下次打开自动恢复；
- 笔记列表标题栏提供刷新按钮，用于重新读取 WebDAV；
- 当前笔记存在未保存修改时，刷新前必须确认；
- 左侧“设置”入口打开完整设置页，可切换界面风格、管理 WebDAV 和分类；
- 设置页提供“返回笔记”入口；
- Markdown、HTML、源码切换时，依据视口顶部文本锚点尽量保持同一阅读位置。

### 分类

- 默认分类建议为：`随笔`、`待办`、`阅读`。
- 分类名称最长 4 个 Unicode 字符。
- 分类可新增、删除和重命名。
- 编辑分类输入框时，笔记编辑页的分类下拉框应立即更新。
- 保存设置后分类必须持久化。
- 分类重命名不是“新增新分类”：
  - 例如将“待办”改为“待定”；
  - 所有原属于“待办”的笔记必须同步改为“待定”；
  - 这些笔记必须刷新 `updated_at`；
  - 下次上传后旧分类不能从云端或缓存中复活。

### 主题

三套主题：

| 键值 | 显示名称 | 视觉特点 |
|---|---|---|
| `clean` | 清爽浅色 | 蓝灰强调色、白色表面 |
| `studio` | 深色工作台 | 深色背景、青绿色强调色 |
| `paper` | 暖色纸感 | 暖白纸张、陶土色强调色 |

主题必须完整覆盖：

- 页面背景；
- 分类侧栏；
- 笔记列表；
- 输入框；
- 焦点光圈；
- 选中态；
- 保存按钮；
- 同步按钮；
- 底部导航；
- 阴影与分割线。

不得让后来新增的控件固定使用暖色值。

### 手机底部导航

底部固定三个入口：

| Tab | 行为 |
|---|---|
| 列表 | 返回分类和笔记列表 |
| 笔记 | 打开当前笔记；没有当前对象时恢复最后一次打开的笔记 |
| 设置 | 打开设置页 |

补充规则：

- 最后打开笔记的 UUID 保存在本地偏好设置中。
- App 重启后优先恢复该 UUID。
- 如果该笔记已经删除，则回退到当前列表中的第一篇笔记。
- 新建笔记不占用中间 Tab；新建入口保留在列表页右上角。

### 软键盘

- Android Activity 使用 `adjustResize`。
- 键盘打开时隐藏底部导航，给编辑区域留出空间。
- 键盘关闭后必须恢复底部导航，即使输入框仍保持焦点。
- 键盘状态应依据 `visualViewport` 或可视窗口高度变化判断，不能只依赖 `focusout`。

---

## 交互与状态规则

### 笔记状态机

```text
无笔记
  └─ 点击新建
       └─ 草稿（仅内存，isDraft = true）
            ├─ 放弃/离开且未保存 -> 不产生笔记
            └─ 点击保存
                 └─ 正式笔记（UUID + created_at + updated_at）
                      ├─ 修改 -> dirty
                      ├─ 保存 -> clean
                      └─ 删除 -> tombstone
```

### 保存按钮

| 状态 | 文案 | 是否可点击 |
|---|---|---|
| clean | 保存笔记 | 否 |
| dirty | 保存笔记 | 是 |
| saving | 保存中… | 否 |
| failed | 保存笔记 | 是 |

### 本地偏好键

当前前端使用以下本地键；iOS 可采用等价的 `UserDefaults` 键：

| 键 | 用途 |
|---|---|
| `simple_note_theme` | 当前主题 |
| `simple_note_last_note` | 最后打开笔记 UUID |
| `simple_note_last_sync` | 最后同步状态文本 |
| `simple_note_categories` | Android 前端分类缓存；SQLite 仍是权威来源 |

---

## 数据模型

### Note

完整 JSON 对象：

```json
{
  "id": "6176697f-2d32-45da-b288-5cbdac310a75",
  "title": "示例笔记",
  "content": "# 标题\n\n正文",
  "format": "markdown",
  "category": "随笔",
  "created_at": "2026-06-20T01:23:45.678Z",
  "updated_at": "2026-06-20T01:25:10.142Z",
  "deleted": false
}
```

字段定义：

| 字段 | 类型 | 必需 | 规则 |
|---|---|---|---|
| `id` | String | 是 | UUID 字符串；旧数据可能是 `legacy-{number}` |
| `title` | String | 是 | 可为空；UI 保存时通常补为“新笔记” |
| `content` | String | 是 | Markdown 或 HTML 原文 |
| `format` | String | 是 | 仅允许 `markdown` 或 `html` |
| `category` | String | 是 | 最多 4 个 Unicode 字符 |
| `created_at` | String | 是 | UTC ISO 8601 |
| `updated_at` | String | 是 | UTC ISO 8601；冲突判断依据 |
| `deleted` | Boolean | 是 | `true` 表示墓碑 |

### 时间格式

新客户端必须写 UTC ISO 8601。推荐：

```text
2026-06-20T01:25:10.142Z
```

也必须能解析带时区偏移的 ISO 8601：

```text
2026-06-20T09:25:10.142+08:00
```

比较时必须解析成绝对时间，不能按本地时区字符串比较。

### Android SQLite

数据库名：

```text
simple-note.db
```

当前数据库版本：

```text
2
```

`notes` 表：

```sql
CREATE TABLE notes(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  format TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
```

`settings` 表：

```sql
CREATE TABLE settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

设置键：

```text
categories
webdav_url
webdav_username
webdav_password
theme
```

---

## WebDAV 文件协议

### 文件位置

用户设置的是 WebDAV 目录地址。客户端必须：

1. 去掉目录地址末尾所有 `/`；
2. 追加 `/simple-note-export.json`。

示例：

```text
设置地址：
https://dav.example.com/notes/

实际文件：
https://dav.example.com/notes/simple-note-export.json
```

如果未来允许用户直接填写完整文件 URL，必须避免重复追加文件名。

### HTTP 方法

| 操作 | 方法 | Content-Type |
|---|---|---|
| 下载 | `GET` | 接受 JSON |
| 上传 | `PUT` | `application/json; charset=utf-8` |

认证方式：

```text
HTTP Basic Authentication
```

超时建议：

| 类型 | Android 当前值 | iOS 建议 |
|---|---:|---:|
| 连接 | 20 秒 | 20 秒 |
| 读取/请求 | 30 秒 | 30 秒 |

### 档案根对象

```json
{
  "signature": "SIMPLE_NOTE_WEBDAV_V1",
  "version": 2,
  "exported_at": "2026-06-20T01:30:00.000Z",
  "notes": [],
  "categories": ["随笔", "待办", "阅读"]
}
```

字段：

| 字段 | 类型 | 规则 |
|---|---|---|
| `signature` | String | 固定为 `SIMPLE_NOTE_WEBDAV_V1` |
| `version` | Number | 当前固定为 `2` |
| `exported_at` | String | 每次上传时生成 UTC ISO 8601 |
| `notes` | Array | 包含活动笔记和墓碑 |
| `categories` | Array<String> | 有序、去重、每项最多 4 字 |

### 文件特征码

iOS 读取时：

1. 有 `signature` 且不等于 `SIMPLE_NOTE_WEBDAV_V1`：拒绝读取。
2. 无 `signature`：只允许按旧版档案验证。
3. 旧版验证通过后，在下一次上传时补写当前特征码。

兼容的旧版档案最低要求：

- `version` 为 `1` 或 `2`；
- `notes` 是数组；
- `categories` 是数组；
- 每条笔记至少包含 `id` 和 `updated_at`；
- `format` 是 `markdown` 或 `html`。

### 404

首次同步时 GET 返回 404，表示远端文件尚不存在：

- 不应视为账号错误；
- 使用本地数据生成新档案；
- 通过 PUT 创建文件。

### 格式化云端

“格式化云端”只覆盖 WebDAV 文件，不删除本地笔记。

写入内容：

```json
{
  "signature": "SIMPLE_NOTE_WEBDAV_V1",
  "version": 2,
  "exported_at": "当前 UTC 时间",
  "notes": [],
  "categories": []
}
```

这是危险操作，必须至少二次确认，并明确显示实际 WebDAV 地址。

---

## 同步算法

### 核心原则

同一 `id` 的冲突按 `updated_at` 决定：

```text
远端 updated_at > 本地 updated_at  -> 使用远端
远端 updated_at <= 本地 updated_at -> 保留本地
```

这就是 Last Write Wins。

### 标准双向同步

iOS 推荐把“立即同步”实现为真正的双向合并：

```text
1. 保存当前正在编辑且用户已明确点击保存的内容。
2. GET simple-note-export.json。
3. 如果 404，使用空远端集合。
4. 校验 signature、version、notes、categories。
5. 按 id 建立 localById 和 remoteById。
6. 取两边 id 的并集。
7. 每个 id：
   a. 只存在本地 -> 保留本地。
   b. 只存在远端 -> 保留远端。
   c. 两边都存在 -> 选择 updated_at 较新的对象。
8. 将合并后的全部对象写入本地数据库，包括 deleted = true 的墓碑。
9. 分类按当前操作语义处理，见“分类同步”。
10. 生成新的 exported_at。
11. PUT 完整档案。
12. UI 只展示 deleted = false 的笔记。
```

Swift 风格伪代码：

```swift
func merge(local: [Note], remote: [Note]) -> [Note] {
    var result = Dictionary(uniqueKeysWithValues: local.map { ($0.id, $0) })

    for incoming in remote {
        guard let existing = result[incoming.id] else {
            result[incoming.id] = incoming
            continue
        }

        if incoming.updatedAt > existing.updatedAt {
            result[incoming.id] = incoming
        }
    }

    return result.values.sorted { $0.updatedAt > $1.updatedAt }
}
```

### 删除

删除不能物理移除数据库记录：

```text
deleted = true
updated_at = 当前 UTC 时间
```

墓碑必须上传到 WebDAV。

如果某设备物理删除墓碑，而另一台离线设备仍保留旧活动笔记，旧笔记可能复活。因此：

- iOS 必须持久化墓碑；
- 普通列表过滤墓碑；
- 导出档案包含墓碑；
- 不要在每次同步后自动清理墓碑。

### Android 三种同步按钮

| 按钮 | 当前语义 |
|---|---|
| 立即同步 | 当前实现等同上传合并 |
| 仅下载合并 | 下载远端，按 UUID + 更新时间合并到本地，不回写 |
| 仅上传合并 | 先下载并合并笔记，再上传完整本地档案 |

Android “仅上传合并”不会把远端分类表覆盖回本地，目的是避免重命名后的旧分类复活。

### 分类同步

分类没有独立 UUID 和更新时间，因此不能使用笔记的 LWW 规则。

iOS 实现要求：

- 普通下载：本地分类与远端分类取有序并集。
- 明确重命名：以用户保存后的本地分类表为准。
- 上传前如果发生重命名，不得再从远端并集恢复旧名称。
- 重命名必须同步更新所有相关笔记的 `category` 和 `updated_at`。
- 删除分类前，应决定其笔记迁移目标；当前客户端允许分类从设置列表消失，但笔记中仍使用的分类会通过笔记数据继续显示。

推荐未来协议升级时为分类增加独立实体：

```json
{
  "id": "category-uuid",
  "name": "待办",
  "updated_at": "...",
  "deleted": false
}
```

当前版本不得擅自改变根字段 `categories` 的字符串数组格式。

---

## 分类规则

分类本身没有 UUID 和独立更新时间，因此分类操作必须通过明确的用户意图处理。

### 新增

1. 去除首尾空白。
2. 空字符串不保存。
3. 最多 4 个 Unicode 字符。
4. 与现有分类同名时去重。
5. 保存后写本地设置。
6. 下一次上传写入根字段 `categories`。

### 重命名

当分类数量不变、同一位置的旧名称被新名称替换，并且：

- 新列表中不再包含旧名称；
- 旧列表中不包含新名称；

可判定为重命名。

重命名事务必须：

```text
1. 把分类设置中的 oldName 改为 newName。
2. 找出所有 category == oldName 的活动笔记和墓碑。
3. 把这些笔记的 category 改为 newName。
4. 把这些笔记的 updated_at 改为当前 UTC 时间。
5. 保存设置和笔记。
6. 上传时以新分类表为准，不与远端旧分类名取并集。
```

### 删除

当前协议没有“分类墓碑”。删除分类时：

- 不能删除笔记；
- 笔记仍使用该分类时，客户端可从笔记数据派生并继续显示该分类；
- 更稳妥的 iOS 交互是要求用户选择迁移目标；
- 完成迁移后更新相关笔记的 `category` 和 `updated_at`。

### 顺序

`categories` 数组顺序就是 UI 顺序。客户端应保留用户设置顺序，不要按字母自动排序。

---

## iOS 开发规范

### 目标

iOS 客户端必须做到：

- 能读取 Android 和 Web 产生的现有 WebDAV 文件；
- 能写出 Android 和 Web 可继续读取的文件；
- 不依赖本仓库之外的未公开协议；
- 离线可创建、编辑、删除、搜索和分类；
- 用户主动同步时才访问 WebDAV；
- 行为尽量与 Android 一致。

### 推荐技术栈

| 能力 | 推荐实现 |
|---|---|
| UI | SwiftUI |
| 本地存储 | SwiftData；需要更低系统版本时使用 Core Data |
| 网络 | URLSession |
| 凭据 | Keychain |
| 偏好设置 | UserDefaults |
| Markdown | Apple `AttributedString(markdown:)` 或成熟 Markdown 库 |
| HTML | WKWebView 或安全的 AttributedString 转换 |
| LaTeX | 本地 KaTeX + WKWebView，禁止依赖远端 CDN |
| 图片 | PhotosPicker，转 Data URL |

### 推荐最低数据结构

```swift
enum NoteFormat: String, Codable {
    case markdown
    case html
}

struct NoteDTO: Codable, Identifiable {
    let id: String
    var title: String
    var content: String
    var format: NoteFormat
    var category: String
    var createdAt: Date
    var updatedAt: Date
    var deleted: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, content, format, category, deleted
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct ArchiveDTO: Codable {
    var signature: String
    var version: Int
    var exportedAt: Date
    var notes: [NoteDTO]
    var categories: [String]

    enum CodingKeys: String, CodingKey {
        case signature, version, notes, categories
        case exportedAt = "exported_at"
    }
}
```

日期编码器：

```swift
let formatter = ISO8601DateFormatter()
formatter.formatOptions = [
    .withInternetDateTime,
    .withFractionalSeconds
]
```

解码时必须同时兼容有无小数秒。

### 本地实体建议

```text
NoteEntity
  id: String (unique)
  title: String
  content: String
  formatRaw: String
  category: String
  createdAt: Date
  updatedAt: Date
  deleted: Bool

AppSettings
  categoriesJSON: Data/String
  webDavURL: String
  webDavUsername: String
  theme: String
```

WebDAV 密码必须放 Keychain，不应明文放 UserDefaults 或 SwiftData。

### WebDAV 客户端

请求目标：

```swift
func archiveURL(baseURL: URL) -> URL {
    if baseURL.lastPathComponent == "simple-note-export.json" {
        return baseURL
    }
    return baseURL.appendingPathComponent("simple-note-export.json")
}
```

Basic Auth：

```swift
let value = Data("\(username):\(password)".utf8).base64EncodedString()
request.setValue("Basic \(value)", forHTTPHeaderField: "Authorization")
```

上传：

```swift
request.httpMethod = "PUT"
request.setValue(
    "application/json; charset=utf-8",
    forHTTPHeaderField: "Content-Type"
)
```

### iOS 页面结构

建议使用：

```text
RootView
├─ NotesListView
│  ├─ CategoryRail
│  ├─ SearchField
│  └─ NoteRows
├─ NoteEditorView
│  ├─ FormatPicker
│  ├─ InNoteSearch
│  ├─ CategoryPicker
│  ├─ SaveButton
│  ├─ TitleField
│  └─ Source/Preview
└─ SettingsView
   ├─ ThemePicker
   ├─ WebDavSettings
   ├─ SyncActions
   └─ CategoryEditor
```

iPhone 底部 Tab：

```text
列表 | 笔记 | 设置
```

iPad 可使用 `NavigationSplitView`：

```text
分类 | 笔记列表 | 编辑器
```

### iOS 新建与保存

建议 ViewModel：

```swift
@Observable
final class EditorViewModel {
    var draft: NoteDraft?
    var isDirty = false
    var isSaving = false
}
```

规则：

1. 点击新建只创建 `NoteDraft`。
2. 草稿 UUID 可以延迟到首次保存时生成。
3. 首次保存后写入本地数据库。
4. 后续修改只标记 `isDirty`。
5. 用户点击保存后才写数据库。
6. App 进入后台时不要偷偷创建未保存草稿。
7. 可以提示未保存变更，但不得违反手动保存原则。

### iOS 搜索

列表搜索：

- 匹配 `title + content`；
- 不区分大小写；
- 分类过滤和关键字过滤同时生效。

页内搜索：

- 保存全部匹配范围；
- 当前匹配单独高亮；
- 上下切换循环；
- 格式切换保留关键词；
- 只滚动正文，不滚动整个页面；
- 预览与源码切换时以可见文字为锚点。

### iOS HTML 安全

如果使用 WKWebView：

- 禁止任意导航到外部 URL；
- 不注入不可信原生桥；
- 渲染前移除危险标签和事件属性；
- 默认不执行笔记内 JavaScript；
- Base64 图片可以显示；
- 普通文本换行使用 `white-space: pre-wrap`。

### iOS 验收矩阵

实现完成后必须用同一个 WebDAV 目录执行：

1. Android 新建 Markdown 笔记，iOS 下载并正确显示。
2. iOS 修改标题，Android 下载后得到 iOS 新版本。
3. Android 离线修改正文，iOS 离线修改同一笔记，后同步的 `updated_at` 较新版本胜出。
4. iOS 删除笔记，Android 下载后不再显示且保留墓碑。
5. Android 新增分类，iOS 下载后可选择。
6. iOS 将“待办”重命名为“待定”，Android 同步后旧分类不复活。
7. Android 插入 Base64 图片，iOS 正确显示。
8. iOS 写入 HTML 换行，Android HTML 预览保留换行。
9. Android 写入 LaTeX，iOS 离线渲染。
10. 任一客户端上传后，档案仍保留 `signature`、`version` 和墓碑。

---

## Android 实现说明

### 架构

Android 使用一个原生 Activity 承载 WebView：

```text
MainActivity
  └─ WebView
      └─ file:///android_asset/index.html?local=android
```

JavaScript 通过：

```text
window.LocalNotes.request(method, path, body)
```

调用原生 `LocalBridge`。

本地桥接接口：

| Method | Path | 作用 |
|---|---|---|
| GET | `/api/notes` | 获取未删除笔记 |
| POST | `/api/notes` | 创建笔记 |
| PUT | `/api/notes/{id}` | 更新笔记 |
| DELETE | `/api/notes/{id}` | 写入删除墓碑 |
| GET | `/api/settings` | 获取设置 |
| PUT | `/api/settings` | 保存设置和分类重命名 |
| POST | `/api/sync/push` | 下载合并笔记后上传 |
| POST | `/api/sync/pull` | 仅下载合并 |
| POST | `/api/sync/format` | 清空远端档案 |

桥接响应统一为：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": "错误信息"
}
```

### Android 配置

| 项目 | 值 |
|---|---|
| Namespace | `com.pyrrhus.simplenote` |
| Application ID | `com.pyrrhus.simplenote` |
| Debug ID | `com.pyrrhus.simplenote.dev` |
| Min SDK | 26 |
| Target SDK | 35 |
| Compile SDK | 35 |
| Java | 17 |
| Version | 1.0.0 |

Debug APK 文件名：

```text
SimpleNote-debug-1.0.0-dev.apk
```

---

## 网页版实现说明

### 架构

网页版服务端不保存笔记，只作为浏览器访问 WebDAV 的安全代理：

```text
Browser
  └─ FastAPI
      └─ WebDAV
```

FastAPI 接口：

| Method | Path | 作用 |
|---|---|---|
| GET | `/` | 返回网页 |
| POST | `/api/webdav/load` | 从 WebDAV 读取档案 |
| PUT | `/api/webdav/save` | 向 WebDAV 写入档案 |

请求凭据：

```json
{
  "url": "https://dav.example.com/notes",
  "username": "user",
  "password": "password"
}
```

保存请求：

```json
{
  "url": "https://dav.example.com/notes",
  "username": "user",
  "password": "password",
  "payload": {
    "signature": "SIMPLE_NOTE_WEBDAV_V1",
    "version": 2,
    "notes": [],
    "categories": []
  }
}
```

### SSRF 限制

FastAPI 会解析 WebDAV 主机地址，并拒绝：

- 本机；
- 私有网络；
- 保留地址；
- URL 中内嵌用户名或密码。

因此公开部署的网页版不能代理访问局域网 WebDAV。Android 原生客户端不受这个 FastAPI 限制。

### 浏览器凭据

网页版把 WebDAV 地址、用户名和密码保存到当前浏览器 Cookie：

```text
simple_note_dav_url
simple_note_dav_user
simple_note_dav_password
```

服务端不会主动持久化这些凭据，但 Cookie 中密码仍属于敏感信息。正式部署必须使用 HTTPS。

### 网页版浏览器本地状态

下列非敏感界面状态保存在 `localStorage`：

```text
simple_note_theme
simple_note_last_note
simple_note_last_sync
simple_note_sidebar_collapsed
simple_note_notes_collapsed
```

其中侧栏折叠、主题和最后打开笔记仅影响当前浏览器界面，不写入 WebDAV，也不影响 Android 或 iOS。

---

## 构建与运行

### Android

环境：

- Android SDK 35；
- JDK 17 或更高；
- Gradle Wrapper 8.13。

Windows：

```powershell
cd android
$env:JAVA_HOME = "D:\android-studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat assembleDebug
```

输出：

```text
android/app/build/outputs/apk/debug/SimpleNote-debug-1.0.0-dev.apk
```

Release：

```powershell
cd android
.\gradlew.bat assembleRelease
```

> 当前仓库未提供正式签名配置。发布前必须配置自己的 keystore。

### Web

建议 Python 3.11 或更高。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
.\run_web.ps1
```

访问：

```text
http://127.0.0.1:8000
```

依赖：

```text
fastapi==0.119.0
uvicorn[standard]==0.37.0
httpx==0.28.1
```

---

## 安全与隐私

### Android

- 笔记保存在应用私有 SQLite 数据库中。
- WebDAV 凭据保存在本地设置表中。
- 只有用户主动同步时才访问网络。
- APK 不依赖 FastAPI，可完全离线使用。
- 当前网络配置允许明文 HTTP，主要用于可信局域网兼容。
- 正式环境应优先使用受系统信任的 HTTPS 证书。

### Web

- 服务端不持久化笔记和 WebDAV 凭据。
- 浏览器 Cookie 会保存连接凭据。
- 正式部署必须使用 HTTPS。
- FastAPI 拒绝私网 WebDAV 目标，降低 SSRF 风险。

### iOS

- 笔记放应用沙盒数据库。
- 密码放 Keychain。
- App Transport Security 默认应禁止任意 HTTP。
- 如果确需局域网 HTTP，应只添加必要域名例外并向用户明确警告。
- 不要把真实 WebDAV 凭据、笔记数据库或调试导出提交到 Git。

### 敏感内容提醒

笔记可以保存密码、Token 和 API Key。截图、日志、崩溃报告、README 示例和测试数据中不得出现真实密钥。发现密钥泄露后应立即吊销并重新生成。

---

## 常见 WebDAV 错误

| 错误 | 含义 | 处理 |
|---|---|---|
| HTTP 401 | 用户名或密码错误 | 检查凭据 |
| HTTP 403 | 没有读写权限 | 修改 WebDAV 权限 |
| HTTP 404 | 文件首次不存在或目录错误 | 首次同步可创建；否则检查路径 |
| HTTP 405 | 服务端不允许 PUT/GET | 开启 WebDAV 写入 |
| TLS packet / record | 用 HTTPS 访问了 HTTP 端口 | 检查协议和端口 |
| Trust Anchor / Certificate | 证书不受系统信任 | 使用有效证书 |
| Cleartext blocked | 系统禁止 HTTP | 改用 HTTPS 或配置有限例外 |
| signature 不匹配 | 目标文件不是纸间档案 | 拒绝覆盖，检查目录 |

---

## 测试清单

### 基础

- [ ] 首次安装能创建本地数据库。
- [ ] 新建后不保存，不产生正式笔记。
- [ ] 点击保存后产生 UUID。
- [ ] 修改后按钮高亮。
- [ ] 无修改时保存按钮不可点击。
- [ ] 重启后笔记仍存在。
- [ ] 底部“笔记”恢复最后打开笔记。

### 分类

- [ ] 新增分类保存后重启不丢失。
- [ ] 新分类立即出现在编辑下拉框。
- [ ] 四字分类在窄栏中单行显示。
- [ ] 分类重命名会迁移相关笔记。
- [ ] 同步后旧分类不会复活。

### 编辑器

- [ ] Markdown 正常显示。
- [ ] HTML 保留换行。
- [ ] LaTeX 离线渲染。
- [ ] Base64 图片正常显示。
- [ ] 三种视图切换位置接近。
- [ ] 切换源码不跳到全文末尾。

### 搜索

- [ ] 列表搜索匹配标题和正文。
- [ ] 页内搜索显示匹配数量。
- [ ] 上下切换循环。
- [ ] 搜索多次后顶部搜索框仍可见。
- [ ] 格式切换后搜索词不清空。

### 键盘与布局

- [ ] 键盘弹出时保存按钮仍可访问。
- [ ] 键盘弹出时底栏隐藏。
- [ ] 键盘关闭后底栏恢复。
- [ ] 列表、笔记、设置三个 Tab 可正确切换。
- [ ] 三套主题覆盖所有新增控件。

### 同步

- [ ] 远端文件不存在时可首次创建。
- [ ] Android 上传后 Web 可读取。
- [ ] Web 修改后 Android 可下载。
- [ ] iOS 写入后 Android 和 Web 可读取。
- [ ] 同 UUID 使用较新时间版本。
- [ ] 删除墓碑不会被旧设备复活。
- [ ] 错误特征码不会被覆盖。
- [ ] 格式化云端不删除本地笔记。

---

## 项目结构

```text
simple_note/
├─ android/
│  ├─ app/build.gradle
│  └─ app/src/main/
│     ├─ AndroidManifest.xml
│     ├─ assets/
│     │  ├─ index.html
│     │  ├─ app.js
│     │  ├─ style.css
│     │  └─ vendor/katex/
│     ├─ java/com/pyrrhus/simplenote/
│     │  ├─ MainActivity.java
│     │  ├─ LocalBridge.java
│     │  ├─ Note.java
│     │  ├─ NoteDbHelper.java
│     │  └─ WebDavSync.java
│     └─ res/
├─ web/
│  ├─ main.py
│  └─ static/
│     ├─ index.html
│     ├─ app.js
│     ├─ style.css
│     └─ vendor/katex/
├─ ios-local/                 # 本地开发目录，禁止提交
├─ requirements.txt
├─ run_web.ps1
└─ README.md
```

---

## 开发约束

1. 不改变 `simple-note-export.json` 文件名。
2. 不改变 `SIMPLE_NOTE_WEBDAV_V1` 特征码。
3. 不删除版本 2 档案中的墓碑。
4. 不用平台私有路径替换 Base64 图片。
5. 不把自动保存重新引入客户端。
6. 不在点击新建时立即创建正式笔记。
7. 不让分类旧名称在重命名后通过并集合并复活。
8. 不提交 `ios-local/`、本地数据库、WebDAV 凭据或真实笔记。
9. 协议发生变更时，必须先更新本文档并增加兼容迁移说明。

---

## License

仓库当前未声明开源许可证。在添加明确许可证之前，默认保留所有权利。
