const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const isLocalApp = Boolean(window.LocalNotes);
const ARCHIVE_SIGNATURE = "SIMPLE_NOTE_WEBDAV_V1";
let notes = [], settings = {categories: ["随笔", "待办", "阅读"]};
let selected = null, filter = "全部", remoteExists = false;
let activeTheme = localStorage.getItem("simple_note_theme") || "paper";
let noteSearchMatches = [], noteSearchIndex = -1;
let editorSelection = {start: 0, end: 0};
const lastNoteKey = "simple_note_last_note";
const sidebarCollapsedKey = "simple_note_sidebar_collapsed";
const notesCollapsedKey = "simple_note_notes_collapsed";

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function applyTheme(theme) {
  activeTheme = ["clean", "studio", "paper"].includes(theme) ? theme : "paper";
  document.documentElement.dataset.theme = activeTheme;
  localStorage.setItem("simple_note_theme", activeTheme);
  $$("[data-theme-choice]").forEach(button =>
    button.classList.toggle("active", button.dataset.themeChoice === activeTheme));
}
applyTheme(activeTheme);

function setPaneCollapsed(pane, collapsed) {
  const isSidebar = pane === "sidebar";
  const className = isSidebar ? "sidebar-collapsed" : "notes-collapsed";
  const button = $(isSidebar ? "#toggleSidebar" : "#toggleNotesPane");
  const label = isSidebar ? "分类" : "列表";
  $("#appView").classList.toggle(className, collapsed);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", `${collapsed ? "展开" : "收起"}${label}`);
  localStorage.setItem(isSidebar ? sidebarCollapsedKey : notesCollapsedKey, String(collapsed));
}

function restorePaneLayout() {
  setPaneCollapsed("sidebar", localStorage.getItem(sidebarCollapsedKey) === "true");
  setPaneCollapsed("notes", localStorage.getItem(notesCollapsedKey) === "true");
}

function setCookie(name, value, days = 30) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${days * 86400}; Path=/; SameSite=Strict${secure}`;
}
function getCookie(name) {
  const prefix = `${name}=`;
  const item = document.cookie.split("; ").find(row => row.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}
function clearConnectionCookies() {
  ["simple_note_dav_url", "simple_note_dav_user", "simple_note_dav_password"]
    .forEach(name => { document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Strict`; });
}
function credentials() {
  return {
    url: getCookie("simple_note_dav_url"),
    username: getCookie("simple_note_dav_user"),
    password: getCookie("simple_note_dav_password")
  };
}
function saveCredentials(url, username, password) {
  setCookie("simple_note_dav_url", url.trim());
  setCookie("simple_note_dav_user", username);
  setCookie("simple_note_dav_password", password);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {"Content-Type": "application/json", ...(options.headers || {})}
  });
  if (!response.ok) {
    let message = "请求失败";
    try { message = (await response.json()).detail || message; } catch (_) {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("json") ? response.json() : response.text();
}

async function uploadWebDavImage(file) {
  if (isLocalApp) {
    throw new Error("本地版请先保存图片到本地后同步");
  }
  const davCredentials = credentials();
  if (!davCredentials.url) {
    throw new Error("请先连接 WebDAV");
  }
  const response = await fetch("/api/webdav/images", {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || "image")
    }
  });
  if (!response.ok) {
    let message = "图片上传失败";
    try { message = (await response.json()).detail || message; } catch (_) {}
    throw new Error(message);
  }
  return response.json();
}

async function localApi(path, options = {}) {
  if (path.includes("/preview")) {
    const note = notes.find(n => path.includes(`/${n.id}/`));
    if (!note) throw new Error("笔记不存在");
    return note.format === "html" ? note.content : renderLocalMarkdown(note.content);
  }
  const method = options.method || "GET";
  const response = JSON.parse(window.LocalNotes.request(method, path, options.body || ""));
  if (!response.ok) throw new Error(response.error || "本地操作失败");
  return response.data;
}

function payload() {
  return {
    signature: ARCHIVE_SIGNATURE,
    version: 2,
    exported_at: new Date().toISOString(),
    notes,
    categories: settings.categories
  };
}
async function loadRemote() {
  const result = await request("/api/webdav/load", {
    method: "POST",
    body: JSON.stringify(credentials())
  });
  remoteExists = result.exists;
  notes = (result.payload.notes || []).filter(note => !note.deleted);
  settings.categories = result.payload.categories?.length
    ? result.payload.categories
    : ["随笔", "待办", "阅读"];
  if (result.legacy) {
    await saveRemote();
    toast("旧版数据已升级并加入特征码");
  }
  return result;
}
async function saveRemote() {
  const result = await request("/api/webdav/save", {
    method: "PUT",
    body: JSON.stringify({...credentials(), payload: payload()})
  });
  remoteExists = true;
  const text = `${new Date().toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"})} · 已写入 ${result.count} 条`;
  localStorage.setItem("simple_note_last_sync", text);
  $("#settingsSyncStatus").textContent = text;
  $("#syncText").textContent = "WebDAV 已保存";
  return result;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}
function logout() {
  if (!isLocalApp) clearConnectionCookies();
  notes = []; selected = null;
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
  fillLoginFromCookies();
}
function cleanText(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/[#>*_`\-\[\]]/g, " ")
    .replace(/\s+/g, " ").trim();
}
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
function resolveImageSrc(src) {
  const value = String(src || "").trim();
  if (/^images\/[^/?#]+$/i.test(value)) {
    return `/api/webdav/images/${encodeURIComponent(value.slice("images/".length))}`;
  }
  return value;
}
function rewritePreviewImages(value) {
  const template = document.createElement("template");
  template.innerHTML = value;
  template.content.querySelectorAll("img[src]").forEach(img => {
    img.setAttribute("src", resolveImageSrc(img.getAttribute("src")));
  });
  return template.innerHTML;
}
function renderLocalMarkdown(value) {
  const blocks = [];
  const images = [];
  let text = value.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    blocks.push(math);
    return `\nKATEXBLOCK${blocks.length - 1}\n`;
  }).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    images.push({alt, src});
    return `MARKDOWNIMAGE${images.length - 1}`;
  });
  text = escapeHtml(text)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- \[ \] (.+)$/gm, "<div>☐ $1</div>")
    .replace(/^- \[x\] (.+)$/gim, "<div>☑ $1</div>")
    .replace(/^- (.+)$/gm, "<div>• $1</div>")
    .replace(/MARKDOWNIMAGE(\d+)/g, (_, index) => {
      const image = images[Number(index)];
      return `<img src="${escapeHtml(resolveImageSrc(image.src))}" alt="${escapeHtml(image.alt || "图片")}">`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
  blocks.forEach((math, index) => {
    text = text.replace(`KATEXBLOCK${index}`, `$$${math}$$`);
  });
  return `<div class="markdown-preview"><p>${text}</p></div>`;
}
function renderMath(root) {
  if (!window.renderMathInElement || !root) return;
  renderMathInElement(root, {
    delimiters: [
      {left: "$$", right: "$$", display: true},
      {left: "\\[", right: "\\]", display: true},
      {left: "$", right: "$", display: false},
      {left: "\\(", right: "\\)", display: false}
    ],
    throwOnError: false, strict: false
  });
}
function safeHtml(value) {
  return rewritePreviewImages(sanitizeHtml(value));
}
function sanitizeHtml(value, stripStyles = false) {
  const template = document.createElement("template");
  template.innerHTML = value;
  template.content.querySelectorAll(
    "script,style,iframe,object,embed,form,input,button,textarea,select,meta,link,base,svg,math"
  ).forEach(node => node.remove());
  const allowedAttributes = new Set([
    "href", "src", "alt", "title", "colspan", "rowspan", "scope", "target", "rel",
    "style", "class", "id", "width", "height", "datetime"
  ]);
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (!allowedAttributes.has(name) || name.startsWith("on") ||
          ["contenteditable", "spellcheck", "tabindex", "role"].includes(name) ||
          name.startsWith("data-") || name.startsWith("aria-")) {
        node.removeAttribute(attr.name);
        return;
      }
      const compactValue = value.replace(/[\u0000-\u0020]/g, "");
      if (name === "href" &&
          !/^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(compactValue)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === "src" &&
          !/^(?:https?:|data:image\/(?:png|gif|jpeg|jpg|webp);base64,|blob:|\/|\.\/|\.\.\/|images\/)/i.test(compactValue)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (stripStyles && ["style", "class", "id", "width", "height"].includes(name)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === "style") {
        const allowed = value.split(";").map(rule => rule.trim()).filter(rule =>
          /^(?:text-align|font-weight|font-style|text-decoration|vertical-align|white-space)\s*:/i.test(rule));
        if (allowed.length) node.setAttribute("style", allowed.join("; "));
        else node.removeAttribute("style");
      }
      if (name === "class" && /^(?:Mso|Apple-|docs-|notion-|ql-)/i.test(value)) {
        node.removeAttribute("class");
      }
    });
    if (node.getAttribute("target") === "_blank") {
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return template.innerHTML;
}
const htmlBlockTags = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET", "FIGCAPTION",
  "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR",
  "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "UL"
]);
const htmlVoidTags = new Set(["AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK", "META", "SOURCE", "TRACK", "WBR"]);
function formatHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeHtml(value);
  const lines = [];
  function serialize(node, depth = 0) {
    const indent = "  ".repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.data.replace(/\s+/g, " ").trim();
      if (text) lines.push(`${indent}${text}`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    const attrs = [...node.attributes]
      .map(attr => ` ${attr.name}="${attr.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
    if (htmlVoidTags.has(node.tagName)) {
      lines.push(`${indent}<${tag}${attrs}>`);
      return;
    }
    const children = [...node.childNodes];
    const inlineOnly = children.length &&
      children.every(child => child.nodeType === Node.TEXT_NODE ||
        (child.nodeType === Node.ELEMENT_NODE && !htmlBlockTags.has(child.tagName)));
    if (!children.length) {
      lines.push(`${indent}<${tag}${attrs}></${tag}>`);
    } else if (inlineOnly) {
      lines.push(`${indent}<${tag}${attrs}>${node.innerHTML.trim()}</${tag}>`);
    } else {
      lines.push(`${indent}<${tag}${attrs}>`);
      children.forEach(child => serialize(child, depth + 1));
      lines.push(`${indent}</${tag}>`);
    }
  }
  [...template.content.childNodes].forEach(node => serialize(node));
  return lines.join("\n").trim();
}
function htmlToMarkdown(value) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeHtml(value, true);
  function convert(node, listDepth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.data.trim() ? node.data.replace(/\s+/g, " ") : "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const content = [...node.childNodes].map(child => convert(child, listDepth)).join("");
    switch (node.tagName) {
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
        return `${"#".repeat(Number(node.tagName[1]))} ${content.trim()}\n\n`;
      case "P": case "DIV": case "SECTION": case "ARTICLE":
        return `${content.trim()}\n\n`;
      case "BR": return "\n";
      case "STRONG": case "B": return `**${content.trim()}**`;
      case "EM": case "I": return `*${content.trim()}*`;
      case "DEL": case "S": return `~~${content.trim()}~~`;
      case "CODE": return node.parentElement?.tagName === "PRE" ? content : `\`${content.trim()}\``;
      case "PRE": return `\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
      case "BLOCKQUOTE": return `${content.trim().split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
      case "A": return node.getAttribute("href") ? `[${content.trim() || node.href}](${node.getAttribute("href")})` : content;
      case "IMG": return `![${node.getAttribute("alt") || "图片"}](${node.getAttribute("src") || ""})`;
      case "UL": case "OL": return `${[...node.children].map(child => convert(child, listDepth + 1)).join("")}\n`;
      case "LI": {
        const parent = node.parentElement?.tagName;
        const index = parent === "OL" ? [...node.parentElement.children].indexOf(node) + 1 : "-";
        return `${"  ".repeat(Math.max(0, listDepth - 1))}${index}${parent === "OL" ? "." : ""} ${content.trim()}\n`;
      }
      case "HR": return "\n---\n\n";
      case "TABLE": {
        const rows = [...node.querySelectorAll("tr")].map(row =>
          [...row.querySelectorAll("th,td")].map(cell => cell.textContent.trim()));
        if (!rows.length) return "";
        const width = Math.max(...rows.map(row => row.length));
        const normalized = rows.map(row => [...row, ...Array(width - row.length).fill("")]);
        return `${normalized.map(row => `| ${row.join(" | ")} |`).join("\n")
          .replace("\n", `\n| ${Array(width).fill("---").join(" | ")} |\n`)}\n\n`;
      }
      default: return content;
    }
  }
  return [...template.content.childNodes].map(node => convert(node)).join("")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function replaceEditorContent(value, format, message) {
  const editor = $("#noteContent");
  editor.value = value;
  selected.format = format;
  markNoteDirty();
  switchEditorView("source", false, {offset: 0, text: "", progress: 0});
  toast(message);
}
function optimizeCurrentHtml(action) {
  if (!selected) return;
  const value = $("#noteContent").value;
  if (!/<[a-z][\s\S]*>/i.test(value)) {
    toast("当前内容不是 HTML");
    return;
  }
  if (action === "clean") replaceEditorContent(sanitizeHtml(value), "html", "HTML 已安全清理");
  if (action === "format") replaceEditorContent(formatHtml(value), "html", "HTML 已格式化");
  if (action === "strip") replaceEditorContent(sanitizeHtml(value, true), "html", "HTML 样式已移除");
  if (action === "markdown") replaceEditorContent(htmlToMarkdown(value), "markdown", "已转换为 Markdown");
  $("#htmlToolsMenu").removeAttribute("open");
}
function stripSelectedHtmlTags() {
  const editor = $("#noteContent");
  const currentStart = editor.selectionStart;
  const currentEnd = editor.selectionEnd;
  const start = currentStart !== currentEnd ? currentStart : editorSelection.start;
  const end = currentStart !== currentEnd ? currentEnd : editorSelection.end;
  if (start === end) {
    toast("请先在源码中选中要去除标签的文本");
    editor.focus();
    return;
  }
  const selectedText = editor.value.slice(start, end);
  if (!/<[a-z!/][\s\S]*>/i.test(selectedText)) {
    toast("选中文本中没有 HTML 标签");
    editor.focus();
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = sanitizeHtml(selectedText, true)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|aside|blockquote|pre|h[1-6]|li|tr)>/gi, "\n");
  const plainText = (template.content.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  editor.setRangeText(plainText, start, end, "select");
  editorSelection = {start, end: start + plainText.length};
  markNoteDirty();
  editor.focus();
  $("#htmlToolsMenu").removeAttribute("open");
  toast("已去除选中文本中的 HTML 标签");
}
function setNoteSaveState(state) {
  const button = $("#saveNoteBtn");
  if (!button) return;
  button.classList.toggle("dirty", state === "dirty");
  button.classList.toggle("saving", state === "saving");
  button.disabled = state !== "dirty";
  button.textContent = state === "saving" ? "保存中…" : "保存笔记";
}
function markNoteDirty() {
  if (!selected) return;
  setNoteSaveState("dirty");
  $("#syncText").textContent = isLocalApp ? "有未保存更改" : "等待写入 WebDAV…";
  if ($("#noteSearch")?.value) runNoteSearch("nearest");
}
function setSearchMode(active) {
  const sourceView = $("[data-view].active")?.dataset.view === "source";
  $("#searchPreview").classList.toggle("hidden", !active);
  $("#noteContent").classList.toggle("hidden", active || !sourceView);
  $(".format-bar").classList.toggle("hidden", active || !sourceView);
  $("#inlinePreview").classList.toggle("hidden", active || sourceView);
}
function clearNoteSearch(clearInput = true) {
  if (clearInput) $("#noteSearch").value = "";
  noteSearchMatches = [];
  noteSearchIndex = -1;
  $("#noteSearchCount").textContent = "0/0";
  $("#searchPreview").innerHTML = "";
  setSearchMode(false);
}
function runNoteSearch(action = "nearest") {
  const query = $("#noteSearch").value;
  if (!query) {
    clearNoteSearch(false);
    return;
  }
  const content = $("#noteContent").value;
  const haystack = content.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  noteSearchMatches = [];
  for (let start = 0; (start = haystack.indexOf(needle, start)) !== -1;
       start += Math.max(needle.length, 1)) {
    noteSearchMatches.push(start);
  }
  if (!noteSearchMatches.length) {
    noteSearchIndex = -1;
    $("#noteSearchCount").textContent = "0/0";
    $("#searchPreview").textContent = content;
    setSearchMode(true);
    return;
  }
  if (action === "next") {
    noteSearchIndex = (noteSearchIndex + 1) % noteSearchMatches.length;
  } else if (action === "prev") {
    noteSearchIndex = (noteSearchIndex - 1 + noteSearchMatches.length) % noteSearchMatches.length;
  } else {
    const cursor = $("#noteContent").selectionStart || 0;
    const nearest = noteSearchMatches.findIndex(position => position >= cursor);
    noteSearchIndex = nearest === -1 ? 0 : nearest;
  }
  let html = "", offset = 0;
  noteSearchMatches.forEach((position, index) => {
    html += escapeHtml(content.slice(offset, position));
    html += `<mark class="${index === noteSearchIndex ? "current" : ""}">${escapeHtml(content.slice(position, position + query.length))}</mark>`;
    offset = position + query.length;
  });
  $("#searchPreview").innerHTML = html + escapeHtml(content.slice(offset));
  $("#noteSearchCount").textContent = `${noteSearchIndex + 1}/${noteSearchMatches.length}`;
  setSearchMode(true);
  requestAnimationFrame(() => {
    const preview = $("#searchPreview");
    const current = preview.querySelector("mark.current");
    if (current) {
      const previewRect = preview.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      preview.scrollTop += currentRect.top - previewRect.top
        - preview.clientHeight / 2 + currentRect.height / 2;
    }
  });
}
function editorScrollProgress(element) {
  const search = $("#searchPreview");
  const active = element || (!search.classList.contains("hidden")
    ? search
    : ($("[data-view].active")?.dataset.view === "source"
      ? $("#noteContent") : $("#inlinePreview")));
  const range = Math.max(0, active.scrollHeight - active.clientHeight);
  return range ? active.scrollTop / range : 0;
}
function normalizeAnchorText(value, withMap = false) {
  let text = "", map = [], inTag = false, lastSpace = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "<") {
      inTag = true;
      continue;
    }
    if (inTag) {
      if (char === ">") inTag = false;
      continue;
    }
    if ("#>*_`[]".includes(char)) continue;
    if (/\s/.test(char)) {
      if (text && !lastSpace) {
        text += " ";
        map.push(index);
        lastSpace = true;
      }
      continue;
    }
    text += char.toLocaleLowerCase();
    map.push(index);
    lastSpace = false;
  }
  const leading = text.length - text.trimStart().length;
  const normalized = text.trim();
  return withMap
    ? {text: normalized, map: map.slice(leading, leading + normalized.length)}
    : normalized;
}
function visiblePreviewText(preview) {
  const rect = preview.getBoundingClientRect();
  const x = Math.min(rect.right - 8, rect.left + 24);
  const y = rect.top + 10;
  const caret = document.caretRangeFromPoint?.(x, y);
  if (caret?.startContainer?.nodeType === Node.TEXT_NODE) {
    const value = caret.startContainer.data;
    const start = Math.max(0, Math.min(caret.startOffset, value.length - 1));
    const text = value.slice(start, start + 60).trim() ||
      value.slice(Math.max(0, start - 30), start + 30).trim();
    if (text) return text;
  }
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.data.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (range.getBoundingClientRect().bottom >= y) return node.data.trim().slice(0, 60);
  }
  return "";
}
function sourceOffsetForText(content, value, progress) {
  const source = normalizeAnchorText(content, true);
  const needle = normalizeAnchorText(value).slice(0, 36);
  if (!needle) return -1;
  const expected = Math.round(progress * source.text.length);
  let best = -1, bestDistance = Infinity, start = 0;
  while ((start = source.text.indexOf(needle, start)) !== -1) {
    const distance = Math.abs(start - expected);
    if (distance < bestDistance) {
      best = start;
      bestDistance = distance;
    }
    start += Math.max(needle.length, 1);
  }
  return best === -1 ? -1 : (source.map[best] ?? -1);
}
function sourceOffsetAtScrollTop(source) {
  const target = Math.max(0, source.scrollTop + 4);
  let low = 0, high = source.value.length;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (sourceScrollTopForOffset(source, middle) <= target) low = middle;
    else high = middle - 1;
  }
  return source.value.lastIndexOf("\n", Math.max(0, low - 1)) + 1;
}
function captureEditorAnchor() {
  const source = $("#noteContent"), content = source.value;
  const sourceView = $("[data-view].active")?.dataset.view === "source";
  const active = sourceView ? source : $("#inlinePreview");
  const progress = editorScrollProgress(active);
  if (sourceView) {
    const lineStart = sourceOffsetAtScrollTop(source);
    const lineEnd = content.indexOf("\n", lineStart);
    const text = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd)
      .replace(/<[^>]+>|[#>*_`\-\[\]]/g, " ").trim().slice(0, 40);
    return {offset: lineStart, text, progress};
  }
  const text = visiblePreviewText(active);
  return {offset: sourceOffsetForText(content, text, progress), text, progress};
}
function sourceScrollTopForOffset(source, offset) {
  const style = getComputedStyle(source);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed", visibility: "hidden", pointerEvents: "none",
    left: "-10000px", top: "0", width: `${source.clientWidth}px`,
    padding: style.padding, border: style.border, font: style.font,
    lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
    whiteSpace: "pre-wrap", overflowWrap: "break-word", boxSizing: "border-box"
  });
  mirror.textContent = source.value.slice(0, Math.max(0, offset));
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}
function previewRangeForText(element, value) {
  const needle = normalizeAnchorText(value).slice(0, 36);
  if (!needle) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let combined = "", map = [], node;
  while ((node = walker.nextNode())) {
    const normalized = normalizeAnchorText(node.data, true);
    for (let index = 0; index < normalized.text.length; index++) {
      combined += normalized.text[index];
      map.push({node, offset: normalized.map[index] ?? 0});
    }
    if (combined && !combined.endsWith(" ")) {
      combined += " ";
      map.push({node, offset: node.data.length});
    }
  }
  const start = combined.indexOf(needle);
  if (start === -1 || !map[start]) return null;
  const end = Math.min(map.length - 1, start + needle.length - 1);
  const range = document.createRange();
  range.setStart(map[start].node, Math.min(map[start].offset, map[start].node.data.length));
  range.setEnd(map[end].node, Math.min(map[end].offset + 1, map[end].node.data.length));
  return range;
}
function restoreEditorAnchor(element, anchor, sourceView) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (sourceView && anchor.offset >= 0) {
      element.scrollTop = Math.max(0, sourceScrollTopForOffset(element, anchor.offset) - 8);
      return;
    }
    if (!sourceView && anchor.text) {
      const range = previewRangeForText(element, anchor.text);
      if (range) {
        element.scrollTop += range.getBoundingClientRect().top -
          element.getBoundingClientRect().top - 8;
        return;
      }
    }
    const range = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = range * Math.min(1, Math.max(0, anchor.progress));
  }));
}
function switchEditorView(view, focusSource = true, anchor = captureEditorAnchor()) {
  if (!selected) return;
  const source = view === "source";
  $("#noteContent").classList.toggle("hidden", !source);
  $(".format-bar").classList.toggle("hidden", !source);
  $("#inlinePreview").classList.toggle("hidden", source);
  $$("[data-view]").forEach(button =>
    button.classList.toggle("active", button.dataset.view === view));
  if (source) {
    if (focusSource) $("#noteContent").focus({preventScroll: true});
    restoreEditorAnchor($("#noteContent"), anchor, true);
    return;
  }
  selected.format = view;
  const preview = $("#inlinePreview");
  preview.classList.toggle("html-lines", view === "html");
  preview.innerHTML = view === "markdown"
    ? renderLocalMarkdown($("#noteContent").value)
    : safeHtml($("#noteContent").value);
  renderMath(preview);
  restoreEditorAnchor(preview, anchor, false);
  markNoteDirty();
}
function dateText(value) {
  const date = new Date(value), now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"})
    : date.toLocaleDateString("zh-CN", {month: "short", day: "numeric"});
}
async function boot(load = true) {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  try {
    if (isLocalApp) {
      [notes, settings] = await Promise.all([
        localApi("/api/notes"), localApi("/api/settings")
      ]);
    } else if (load) {
      await loadRemote();
    }
    selected = notes.find(note => note.id === localStorage.getItem(lastNoteKey)) ||
      notes[0] || null;
    renderAll();
    if (!isLocalApp && !remoteExists) {
      await saveRemote();
      toast("已在 WebDAV 中创建笔记文件");
    }
  } catch (error) {
    $("#appView").classList.add("hidden");
    $("#loginView").classList.remove("hidden");
    $("#loginError").textContent = error.message;
  }
}
function renderAll() {
  renderCategories(); renderNotes(); renderSettings(); selectNote(selected?.id);
}
function visibleCategories() {
  const result = [];
  [...settings.categories, ...notes.map(note => note.category)].forEach(category => {
    if (category && !result.includes(category)) result.push(category);
  });
  return result;
}
function categoryEditorValues() {
  const values = $$("#categoryEditor input").map(input => input.value.trim()).filter(Boolean);
  return values.length ? values : ["随笔"];
}
function syncCategoryEditor() {
  settings.categories = categoryEditorValues();
  renderCategories();
  if (selected) $("#categorySelect").value = selected.category;
}
function renderCategories() {
  const categories = ["全部", ...visibleCategories()];
  $("#categories").innerHTML = categories.map(category =>
    `<button data-category="${escapeHtml(category)}" class="${filter === category ? "active" : ""}">${escapeHtml(category)}</button>`
  ).join("");
  $("#categorySelect").innerHTML = visibleCategories().map(category =>
    `<option>${escapeHtml(category)}</option>`).join("");
  $$("#categories button").forEach(button => button.onclick = () => {
    filter = button.dataset.category;
    $("#listTitle").textContent = filter === "全部" ? "全部笔记" : filter;
    renderCategories(); renderNotes(); $("#sidebar").classList.remove("open");
  });
}
function renderNotes() {
  const query = $("#search").value.trim().toLowerCase();
  const rows = notes.filter(note =>
    (filter === "全部" || note.category === filter) &&
    (!query || `${note.title} ${note.content}`.toLowerCase().includes(query)));
  $("#noteList").innerHTML = rows.length ? rows.map(note =>
    `<button class="note-item ${selected?.id === note.id ? "active" : ""}" data-id="${note.id}">
      <h3>${escapeHtml(note.title || "无标题")}</h3>
      <p>${escapeHtml(cleanText(note.content) || "空白笔记")}</p>
      <div class="note-meta"><span>${escapeHtml(note.category)}</span><span>${dateText(note.updated_at)}</span></div>
    </button>`).join("") : `<div class="muted" style="padding:30px;text-align:center">这里还没有笔记</div>`;
  $$(".note-item").forEach(element =>
    element.onclick = () => selectNote(element.dataset.id, true));
}
function selectNote(id, showEditor = false) {
  clearNoteSearch();
  selected = notes.find(note => note.id === id) || selected;
  if (!selected) {
    $("#editorPane").classList.add("hidden");
    return;
  }
  if (!selected.isDraft) localStorage.setItem(lastNoteKey, selected.id);
  $("#noteTitle").value = selected.title;
  $("#noteContent").value = selected.content;
  $("#categorySelect").value = selected.category;
  $("#editorPane").classList.remove("hidden");
  switchEditorView("source", false, {offset: 0, text: "", progress: 0});
  setNoteSaveState("clean");
  renderNotes();
  if (showEditor && matchMedia("(max-width:800px)").matches) showTab("note");
}
async function createNote() {
  clearNoteSearch();
  const now = new Date().toISOString();
  const category = filter === "全部" ? settings.categories[0] || "随笔" : filter;
  selected = {
    id: "draft", title: "", content: "", format: "markdown",
    category, created_at: now, updated_at: now, deleted: 0, isDraft: true
  };
  $("#noteTitle").value = "";
  $("#noteContent").value = "";
  $("#categorySelect").value = category;
  switchEditorView("source", false, {offset: 0, text: "", progress: 0});
  setNoteSaveState("dirty");
  renderNotes();
  $("#editorPane").classList.remove("hidden");
  if (!matchMedia("(max-width:800px)").matches) $("#noteTitle").focus();
}
async function saveCurrent() {
  if (!selected || $("#saveNoteBtn").disabled) return;
  setNoteSaveState("saving");
  selected.title = $("#noteTitle").value;
  selected.content = $("#noteContent").value;
  selected.category = $("#categorySelect").value;
  selected.updated_at = new Date().toISOString();
  try {
    if (isLocalApp) {
      const body = JSON.stringify({
        title: selected.title || "新笔记", content: selected.content,
        format: selected.format, category: selected.category
      });
      const updated = selected.isDraft
        ? await localApi("/api/notes", {method: "POST", body})
        : await localApi(`/api/notes/${selected.id}`, {method: "PUT", body});
      if (selected.isDraft) notes.unshift(updated);
      selected = updated;
      localStorage.setItem(lastNoteKey, selected.id);
    } else {
      if (selected.isDraft) {
        selected = {...selected, id: createUuid(), title: selected.title || "新笔记", isDraft: false};
        notes.unshift(selected);
      }
      await saveRemote();
      localStorage.setItem(lastNoteKey, selected.id);
    }
    setNoteSaveState("clean");
    renderNotes();
  } catch (error) {
    setNoteSaveState("dirty");
    $("#syncText").textContent = "WebDAV 写入失败";
    toast(error.message);
  }
}
function renderSettings() {
  const dav = credentials();
  $("#davUrl").value = isLocalApp ? settings.webdav_url || "" : dav.url;
  $("#davUser").value = isLocalApp ? settings.webdav_username || "" : dav.username;
  $("#davPassword").value = isLocalApp ? settings.webdav_password || "" : dav.password;
  $("#settingsSyncStatus").textContent =
    localStorage.getItem("simple_note_last_sync") || "本次连接尚未写入";
  $("#categoryEditor").innerHTML = settings.categories.map((category, index) =>
    `<div class="category-row"><input maxlength="4" value="${escapeHtml(category)}" data-ci="${index}"><button data-remove="${index}">删除</button></div>`
  ).join("");
  $$("[data-remove]").forEach(button => button.onclick = () => {
    settings.categories.splice(Number(button.dataset.remove), 1); renderSettings(); renderCategories();
  });
  $$("#categoryEditor input").forEach(input => input.oninput = syncCategoryEditor);
  applyTheme(activeTheme);
}
async function persistSettings(showToast = true) {
  let categories = categoryEditorValues();
  if (categories.some(category => [...category].length > 4)) {
    toast("分类最多 4 个字"); return false;
  }
  settings.categories = categories;
  try {
    if (isLocalApp) {
      await localApi("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          password: "", webdav_url: $("#davUrl").value,
          webdav_username: $("#davUser").value, webdav_password: $("#davPassword").value,
          categories, theme: activeTheme
        })
      });
    } else {
      saveCredentials($("#davUrl").value, $("#davUser").value, $("#davPassword").value);
      await saveRemote();
    }
    renderCategories();
    if (selected) $("#categorySelect").value = selected.category;
    if (showToast) { renderSettings(); toast("设置已保存"); }
    return true;
  } catch (error) {
    toast(error.message); return false;
  }
}
async function sync(direction) {
  const status = $("#settingsSyncStatus");
  status.textContent = direction === "pull" ? "正在重新读取…" : "正在写入…";
  try {
    if (isLocalApp) {
      await persistSettings(false);
      const result = await localApi(`/api/sync/${direction}`, {method: "POST"});
      const text = `${new Date().toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"})} · 已处理 ${result.count} 条`;
      localStorage.setItem("simple_note_last_sync", text);
      [notes, settings] = await Promise.all([localApi("/api/notes"), localApi("/api/settings")]);
    } else if (direction === "pull") {
      saveCredentials($("#davUrl").value, $("#davUser").value, $("#davPassword").value);
      await loadRemote();
    } else {
      await persistSettings(false);
    }
    selected = notes.find(note => note.id === localStorage.getItem(lastNoteKey)) ||
      notes[0] || null;
    renderAll(); toast(direction === "pull" ? "已从 WebDAV 重新读取" : "已写入 WebDAV");
  } catch (error) {
    status.textContent = "操作失败"; toast(error.message);
  }
}

async function refreshNotes() {
  if ($("#saveNoteBtn").classList.contains("dirty") &&
      !confirm("当前笔记有未保存修改。刷新会重新读取 WebDAV，确定继续吗？")) {
    return;
  }
  const button = $("#refreshNotes");
  button.disabled = true;
  button.classList.add("refreshing");
  button.setAttribute("aria-label", "正在刷新笔记");
  try {
    await sync("pull");
  } finally {
    button.disabled = false;
    button.classList.remove("refreshing");
    button.setAttribute("aria-label", "刷新笔记");
  }
}

function insertText(text) {
  const element = $("#noteContent"), start = element.selectionStart, end = element.selectionEnd;
  element.value = element.value.slice(0, start) + text + element.value.slice(end);
  element.focus(); element.selectionStart = element.selectionEnd = start + text.length; markNoteDirty();
}
function looksLikeMarkdown(text) {
  if (!text?.trim()) return false;
  const patterns = [
    /^#{1,6}\s+\S/m,
    /^>\s+\S/m,
    /^\s*[-*+]\s+\S/m,
    /^\s*\d+\.\s+\S/m,
    /^\s*[-*+]\s+\[[ xX]\]\s+\S/m,
    /^```[\s\S]*```$/m,
    /!\[[^\]]*]\([^)]+\)/,
    /\[[^\]]+]\([^)]+\)/,
    /^\s*\|.+\|\s*$/m,
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m,
    /(?:^|[^\w])\*\*[^*\n]+\*\*(?:$|[^\w])/,
    /(?:^|[^\w])`[^`\n]+`(?:$|[^\w])/
  ];
  return patterns.some(pattern => pattern.test(text));
}
function insertMarkdownFromClipboard(text) {
  insertText(text);
  selected.format = "markdown";
  toast("已按 Markdown 原文粘贴");
}
function insertHtmlFromClipboard(html) {
  const cleaned = formatHtml(html);
  if (!cleaned) {
    toast("剪贴板中没有可保存的 HTML 内容");
    return;
  }
  const editor = $("#noteContent");
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n" : "";
  editor.value = before + prefix + cleaned + suffix + after;
  selected.format = "html";
  if (!$("#noteTitle").value.trim()) {
    const template = document.createElement("template");
    template.innerHTML = cleaned;
    const heading = template.content.querySelector("h1,h2,h3,title");
    if (heading?.textContent.trim()) $("#noteTitle").value = heading.textContent.trim().slice(0, 200);
  }
  markNoteDirty();
  clearNoteSearch();
  switchEditorView("html", false, {
    offset: start + prefix.length,
    text: cleanText(cleaned).slice(0, 40),
    progress: 0
  });
  toast("HTML 已安全清理并载入，可预览后保存");
}
function togglePassword(inputSelector, buttonSelector) {
  const input = $(inputSelector), button = $(buttonSelector), show = input.type === "password";
  input.type = show ? "text" : "password";
  button.textContent = show ? "隐藏" : "显示";
  button.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
  button.setAttribute("aria-pressed", String(show));
}
function fillLoginFromCookies() {
  const dav = credentials();
  $("#loginDavUrl").value = dav.url;
  $("#loginDavUser").value = dav.username;
  $("#loginDavPassword").value = dav.password;
}
function showTab(tab, forceEditor = false) {
  const settingsTab = tab === "settings";
  let noteTab = tab === "note";
  if (noteTab && !selected) {
    selected = notes.find(note => note.id === localStorage.getItem(lastNoteKey)) ||
      notes[0] || null;
    if (selected) selectNote(selected.id);
  }
  if (noteTab && !selected) {
    tab = "list";
    noteTab = false;
  }
  $$("[data-tab]").forEach(button =>
    button.classList.toggle("active", button.dataset.tab === tab));
  $("#settingsPane").classList.toggle("hidden", !settingsTab);
  $("#notesPane").classList.toggle("hidden", settingsTab);
  const hideEditor = settingsTab ||
    (matchMedia("(max-width:800px)").matches && !noteTab && !forceEditor);
  $("#editorPane").classList.toggle("hidden", hideEditor);
}
async function createAndOpenNote() {
  await createNote();
  showTab("note", true);
}

$("#loginForm").onsubmit = async event => {
  event.preventDefault();
  const button = $("#loginSubmit");
  $("#loginError").textContent = "";
  button.disabled = true; button.textContent = "正在连接…";
  saveCredentials($("#loginDavUrl").value, $("#loginDavUser").value, $("#loginDavPassword").value);
  try { await boot(true); }
  catch (error) { $("#loginError").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "连接并进入"; }
};
$("#toggleLoginPassword").onclick = () => togglePassword("#loginDavPassword", "#toggleLoginPassword");
$("#toggleDavPassword").onclick = () => togglePassword("#davPassword", "#toggleDavPassword");
$("#refreshNotes").onclick = refreshNotes;
$("#addNoteTop").onclick = createAndOpenNote;
$("#search").oninput = renderNotes;
$("#noteTitle").oninput = markNoteDirty;
$("#noteContent").oninput = markNoteDirty;
["select", "keyup", "mouseup", "focus"].forEach(eventName =>
  $("#noteContent").addEventListener(eventName, () => {
    editorSelection = {
      start: $("#noteContent").selectionStart,
      end: $("#noteContent").selectionEnd
    };
  }));
$("#noteContent").onpaste = event => {
  if (matchMedia("(max-width:800px)").matches) return;
  const text = event.clipboardData?.getData("text/plain") || "";
  const html = event.clipboardData?.getData("text/html");
  if (looksLikeMarkdown(text)) {
    event.preventDefault();
    insertMarkdownFromClipboard(text);
    return;
  }
  if (!html) return;
  event.preventDefault();
  insertHtmlFromClipboard(html);
};
$("#categorySelect").onchange = markNoteDirty;
$("#saveNoteBtn").onclick = saveCurrent;
$$("[data-view]").forEach(button => button.onclick = () => {
  const anchor = captureEditorAnchor();
  const query = $("#noteSearch").value;
  clearNoteSearch(false);
  switchEditorView(button.dataset.view, false, anchor);
  if (query) runNoteSearch("nearest");
});
$("#noteSearch").oninput = () => runNoteSearch("nearest");
$("#noteSearch").onkeydown = event => {
  if (event.key === "Enter") {
    event.preventDefault();
    runNoteSearch(event.shiftKey ? "prev" : "next");
  }
};
$("#noteSearchPrev").onclick = () => runNoteSearch("prev");
$("#noteSearchNext").onclick = () => runNoteSearch("next");
$$("[data-insert]").forEach(button => button.onclick = () => insertText(button.dataset.insert));
$("#cleanHtmlBtn").onclick = () => optimizeCurrentHtml("clean");
$("#formatHtmlBtn").onclick = () => optimizeCurrentHtml("format");
$("#stripHtmlStylesBtn").onclick = () => optimizeCurrentHtml("strip");
$("#stripSelectedTagsBtn").onmousedown = event => event.preventDefault();
$("#stripSelectedTagsBtn").onclick = stripSelectedHtmlTags;
$("#htmlToMarkdownBtn").onclick = () => optimizeCurrentHtml("markdown");
$("#imageInput").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    toast("正在上传图片…");
    const result = await uploadWebDavImage(file);
    insertText(selected.format === "html"
      ? `<img src="${result.path}" alt="${escapeHtml(file.name)}">`
      : `![${file.name}](${result.path})`);
    toast("图片已保存到 WebDAV");
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = "";
  }
};
$("#deleteBtn").onclick = async () => {
  if (!selected || !confirm("确定删除这篇笔记？")) return;
  if (!selected.isDraft && isLocalApp) await localApi(`/api/notes/${selected.id}`, {method: "DELETE"});
  notes = notes.filter(note => note.id !== selected.id);
  if (!selected?.isDraft && !isLocalApp) await saveRemote();
  selected = notes[0] || null;
  if (selected) localStorage.setItem(lastNoteKey, selected.id);
  else localStorage.removeItem(lastNoteKey);
  renderAll();
};
$("#openDrawer").onclick = () => $("#sidebar").classList.add("open");
$("#closeDrawer").onclick = () => $("#sidebar").classList.remove("open");
$("#toggleSidebar").onclick = () =>
  setPaneCollapsed("sidebar", !$("#appView").classList.contains("sidebar-collapsed"));
$("#toggleNotesPane").onclick = () =>
  setPaneCollapsed("notes", !$("#appView").classList.contains("notes-collapsed"));
$("#openThemeSettings").onclick = () => showTab("settings");
$("#closeSettings").onclick = () => showTab("list");
$("#addCategory").onclick = () => { settings.categories.push("新分类"); renderSettings(); renderCategories(); };
$("#saveSettings").onclick = () => persistSettings(true);
$("#syncNowBtn").onclick = () => sync("push");
$("#pullBtn").onclick = () => sync("pull");
$("#logoutBtn").onclick = () => {
  if (confirm("清除当前浏览器保存的 WebDAV 连接信息并退出？")) logout();
};
$$("[data-theme-choice]").forEach(button =>
  button.onclick = () => applyTheme(button.dataset.themeChoice));
$$("[data-tab]").forEach(button => button.onclick = () => showTab(button.dataset.tab));

if (isLocalApp) {
  document.documentElement.classList.add("local-app");
  $("#loginView").classList.add("hidden");
  boot();
} else {
  restorePaneLayout();
  fillLoginFromCookies();
  if (credentials().url) boot(true);
}
