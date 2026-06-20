const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const isLocalApp = Boolean(window.LocalNotes);
const ARCHIVE_SIGNATURE = "SIMPLE_NOTE_WEBDAV_V1";
let notes = [], settings = {categories: ["随笔", "待办", "阅读"]};
let selected = null, filter = "全部", remoteExists = false;
let activeTheme = localStorage.getItem("simple_note_theme") || "paper";
let noteSearchMatches = [], noteSearchIndex = -1;
const lastNoteKey = "simple_note_last_note";

function applyTheme(theme) {
  activeTheme = ["clean", "studio", "paper"].includes(theme) ? theme : "paper";
  document.documentElement.dataset.theme = activeTheme;
  localStorage.setItem("simple_note_theme", activeTheme);
  $$("[data-theme-choice]").forEach(button =>
    button.classList.toggle("active", button.dataset.themeChoice === activeTheme));
}
applyTheme(activeTheme);

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
function renderLocalMarkdown(value) {
  const blocks = [];
  let text = value.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    blocks.push(math);
    return `\nKATEXBLOCK${blocks.length - 1}\n`;
  });
  text = escapeHtml(text)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- \[ \] (.+)$/gm, "<div>☐ $1</div>")
    .replace(/^- \[x\] (.+)$/gim, "<div>☑ $1</div>")
    .replace(/^- (.+)$/gm, "<div>• $1</div>")
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
  const template = document.createElement("template");
  template.innerHTML = value;
  template.content.querySelectorAll("script,iframe,object,embed").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attr => {
      if (attr.name.toLowerCase().startsWith("on")) node.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
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
      preview.scrollTop = Math.max(
        0, current.offsetTop - preview.clientHeight / 2 + current.offsetHeight / 2);
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
  return withMap ? {text: text.trim(), map} : text.trim();
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
function captureEditorAnchor() {
  const source = $("#noteContent"), content = source.value;
  const sourceView = $("[data-view].active")?.dataset.view === "source";
  const active = sourceView ? source : $("#inlinePreview");
  const progress = editorScrollProgress(active);
  if (sourceView) {
    const offset = Math.round(progress * content.length);
    const lineStart = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
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
function restoreEditorAnchor(element, anchor, sourceView) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (sourceView && anchor.offset >= 0) {
      element.scrollTop = Math.max(0, sourceScrollTopForOffset(element, anchor.offset) - 8);
      return;
    }
    if (!sourceView && anchor.text) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const index = node.data.indexOf(anchor.text);
        if (index === -1) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + anchor.text.length);
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
        selected = {...selected, id: crypto.randomUUID(), title: selected.title || "新笔记", isDraft: false};
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
function insertText(text) {
  const element = $("#noteContent"), start = element.selectionStart, end = element.selectionEnd;
  element.value = element.value.slice(0, start) + text + element.value.slice(end);
  element.focus(); element.selectionStart = element.selectionEnd = start + text.length; markNoteDirty();
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
$("#addNoteTop").onclick = createAndOpenNote;
$("#search").oninput = renderNotes;
$("#noteTitle").oninput = markNoteDirty;
$("#noteContent").oninput = markNoteDirty;
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
$("#imageInput").onchange = event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => insertText(selected.format === "html"
    ? `<img src="${reader.result}" alt="${file.name}">`
    : `![${file.name}](${reader.result})`);
  reader.readAsDataURL(file);
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
  fillLoginFromCookies();
  if (credentials().url) boot(true);
}
