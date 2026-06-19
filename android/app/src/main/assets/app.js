const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let token = localStorage.getItem("simple_note_token") || "";
let notes = [], settings = {categories: []}, selected = null, filter = "全部", saveTimer;
let activeTheme = localStorage.getItem("simple_note_theme") || "paper";

function applyTheme(theme) {
  activeTheme = ["clean", "studio", "paper"].includes(theme) ? theme : "paper";
  document.documentElement.dataset.theme = activeTheme;
  localStorage.setItem("simple_note_theme", activeTheme);
  $$("[data-theme-choice]").forEach(button =>
    button.classList.toggle("active", button.dataset.themeChoice === activeTheme));
}
applyTheme(activeTheme);

async function api(path, options = {}) {
  if (window.LocalNotes) {
    if (path === "/api/login") return {token: "local-device"};
    if (path.includes("/preview")) {
      const note = notes.find(n => path.includes(`/${n.id}/`));
      if (!note) throw new Error("笔记不存在");
      if (note.format === "html") return note.content;
      return renderLocalMarkdown(note.content);
    }
    const method = options.method || "GET";
    const response = JSON.parse(window.LocalNotes.request(method, path, options.body || ""));
    if (!response.ok) throw new Error(response.error || "本地操作失败");
    return response.data;
  }
  const headers = {...(options.headers || {}), "Content-Type": "application/json"};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, {...options, headers});
  if (response.status === 401 && path !== "/api/login") logout();
  if (!response.ok) {
    let message = "请求失败";
    try { message = (await response.json()).detail || message; } catch (_) {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("json") ? response.json() : response.text();
}

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}
function logout() {
  token = ""; localStorage.removeItem("simple_note_token");
  $("#appView").classList.add("hidden"); $("#loginView").classList.remove("hidden");
}
function cleanText(value) { return value.replace(/<[^>]+>/g, " ").replace(/[#>*_`\-\[\]]/g, " ").replace(/\s+/g, " ").trim(); }
function escapeHtml(value) { const d=document.createElement("div"); d.textContent=value; return d.innerHTML; }
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
    throwOnError: false,
    strict: false
  });
}
function safeHtml(value) {
  const template=document.createElement("template");
  template.innerHTML=value;
  template.content.querySelectorAll("script,iframe,object,embed").forEach(node=>node.remove());
  template.content.querySelectorAll("*").forEach(node=>{
    [...node.attributes].forEach(attr=>{
      if(attr.name.toLowerCase().startsWith("on")) node.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
}
function switchEditorView(view) {
  if(!selected)return;
  const source=view==="source";
  $("#noteContent").classList.toggle("hidden",!source);
  $(".format-bar").classList.toggle("hidden",!source);
  $("#inlinePreview").classList.toggle("hidden",source);
  $$("[data-view]").forEach(button=>button.classList.toggle("active",button.dataset.view===view));
  if(source){
    $("#noteContent").focus();
    return;
  }
  selected.format=view;
  const preview=$("#inlinePreview");
  preview.innerHTML=view==="markdown"?renderLocalMarkdown($("#noteContent").value):safeHtml($("#noteContent").value);
  renderMath(preview);
  queueSave();
}
function dateText(value) {
  const d = new Date(value); const now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}) : d.toLocaleDateString("zh-CN",{month:"short",day:"numeric"});
}
async function boot() {
  $("#loginView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  try {
    [notes, settings] = await Promise.all([api("/api/notes"), api("/api/settings")]);
    selected = notes[0] || null; renderAll();
  } catch (error) { toast(error.message); }
}
function renderAll() { renderCategories(); renderNotes(); renderSettings(); selectNote(selected?.id); }
function renderCategories() {
  const cats = ["全部", ...settings.categories];
  $("#categories").innerHTML = cats.map(c => `<button data-category="${escapeHtml(c)}" class="${filter===c?"active":""}">${escapeHtml(c)}</button>`).join("");
  $("#categorySelect").innerHTML = settings.categories.map(c => `<option>${escapeHtml(c)}</option>`).join("");
  $$("#categories button").forEach(b => b.onclick = () => { filter=b.dataset.category; $("#listTitle").textContent=filter==="全部"?"全部笔记":filter; renderCategories(); renderNotes(); $("#sidebar").classList.remove("open"); });
}
function renderNotes() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = notes.filter(n => (filter==="全部" || n.category===filter) && (!q || `${n.title} ${n.content}`.toLowerCase().includes(q)));
  $("#noteList").innerHTML = rows.length ? rows.map(n => `<button class="note-item ${selected?.id===n.id?"active":""}" data-id="${n.id}"><h3>${escapeHtml(n.title||"无标题")}</h3><p>${escapeHtml(cleanText(n.content)||"空白笔记")}</p><div class="note-meta"><span>${escapeHtml(n.category)}</span><span>${dateText(n.updated_at)}</span></div></button>`).join("") : `<div class="muted" style="padding:30px;text-align:center">这里还没有笔记</div>`;
  $$(".note-item").forEach(el => el.onclick = () => selectNote(el.dataset.id, true));
}
function selectNote(id, showEditor=false) {
  selected = notes.find(n => n.id===id) || selected;
  if (!selected) return;
  $("#noteTitle").value = selected.title; $("#noteContent").value = selected.content;
  $("#categorySelect").value = selected.category;
  switchEditorView("source");
  renderNotes();
  if (showEditor && matchMedia("(max-width:800px)").matches) $("#editorPane").classList.remove("hidden");
}
async function createNote() {
  const category = filter==="全部" ? settings.categories[0] || "随笔" : filter;
  try {
    const note = await api("/api/notes",{method:"POST",body:JSON.stringify({title:"新笔记",content:"",format:"markdown",category})});
    notes.unshift(note); selected=note; renderAll(); $("#editorPane").classList.remove("hidden"); $("#noteTitle").focus();
  } catch(e) { toast(e.message); }
}
function queueSave() {
  if (!selected) return; $("#saveState").textContent="保存中…"; clearTimeout(saveTimer);
  selected.title=$("#noteTitle").value; selected.content=$("#noteContent").value; selected.category=$("#categorySelect").value;
  saveTimer=setTimeout(saveCurrent,600); renderNotes();
}
async function saveCurrent() {
  try {
    const updated=await api(`/api/notes/${selected.id}`,{method:"PUT",body:JSON.stringify({title:selected.title,content:selected.content,format:selected.format,category:selected.category})});
    Object.assign(selected,updated); $("#saveState").textContent="已保存"; $("#syncText").textContent="本地已保存"; renderNotes();
  } catch(e) { $("#saveState").textContent="保存失败"; toast(e.message); }
}
function renderSettings() {
  $("#davUrl").value=settings.webdav_url||""; $("#davUser").value=settings.webdav_username||"";
  if(window.LocalNotes) $("#davPassword").value=settings.webdav_password||"";
  $("#settingsSyncStatus").textContent=localStorage.getItem("simple_note_last_sync")||"尚未同步";
  $("#categoryEditor").innerHTML=settings.categories.map((c,i)=>`<div class="category-row"><input maxlength="4" value="${escapeHtml(c)}" data-ci="${i}"><button data-remove="${i}">删除</button></div>`).join("");
  $$("[data-remove]").forEach(b=>b.onclick=()=>{settings.categories.splice(Number(b.dataset.remove),1);renderSettings();});
  applyTheme(settings.theme || activeTheme);
}
async function persistSettings(showToast = true) {
  const categories=$$("#categoryEditor input").map(i=>i.value.trim()).filter(Boolean);
  if(categories.some(c=>[...c].length>4)){toast("分类最多 4 个字");return false;}
  const davPassword=$("#davPassword").value;
  try {
    await api("/api/settings",{method:"PUT",body:JSON.stringify({password:$("#newPassword").value,webdav_url:$("#davUrl").value,webdav_username:$("#davUser").value,webdav_password:davPassword,categories,theme:activeTheme})});
    settings={...settings,webdav_url:$("#davUrl").value,webdav_username:$("#davUser").value,webdav_password:window.LocalNotes?davPassword:undefined,categories,theme:activeTheme};
    $("#newPassword").value="";
    if(!window.LocalNotes) $("#davPassword").value="";
    renderCategories();
    if(showToast){renderSettings();toast("设置已保存");}
    return true;
  } catch(e){toast(e.message);return false;}
}
async function saveSettings(){await persistSettings(true);}
async function sync(direction) {
  const status=$("#settingsSyncStatus");status.textContent="正在同步…";
  if(!await persistSettings(false)){status.textContent="配置保存失败";return;}
  try{
    const result=await api(`/api/sync/${direction}`,{method:"POST"});
    const text=`${new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})} · 已处理 ${result.count} 条`;
    localStorage.setItem("simple_note_last_sync",text);status.textContent=text;
    toast("WebDAV 同步完成");
    notes=await api("/api/notes");settings=await api("/api/settings");selected=notes[0]||null;
    renderCategories();renderNotes();
  }catch(e){status.textContent="同步失败";toast(e.message);}
}
function insertText(text) {
  const el=$("#noteContent"), start=el.selectionStart, end=el.selectionEnd;
  el.value=el.value.slice(0,start)+text+el.value.slice(end); el.focus();el.selectionStart=el.selectionEnd=start+text.length;queueSave();
}

$("#loginForm").onsubmit=async e=>{e.preventDefault();$("#loginError").textContent="";try{const result=await api("/api/login",{method:"POST",body:JSON.stringify({password:$("#loginPassword").value})});token=result.token;localStorage.setItem("simple_note_token",token);boot();}catch(err){$("#loginError").textContent=err.message;}};
$("#addNoteTop").onclick=createNote;$("#newNoteTab").onclick=createNote;$("#search").oninput=renderNotes;
$("#noteTitle").oninput=queueSave;$("#noteContent").oninput=queueSave;$("#categorySelect").onchange=queueSave;
$$("[data-view]").forEach(button=>button.onclick=()=>switchEditorView(button.dataset.view));
$$("[data-insert]").forEach(b=>b.onclick=()=>insertText(b.dataset.insert));
$("#imageInput").onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>insertText(selected.format==="html"?`<img src="${reader.result}" alt="${file.name}">`:`![${file.name}](${reader.result})`);reader.readAsDataURL(file);};
$("#deleteBtn").onclick=async()=>{if(!selected||!confirm("确定删除这篇笔记？"))return;await api(`/api/notes/${selected.id}`,{method:"DELETE"});notes=notes.filter(n=>n.id!==selected.id);selected=notes[0]||null;renderAll();if(matchMedia("(max-width:800px)").matches)$("#editorPane").classList.add("hidden");};
$("#openDrawer").onclick=()=>$("#sidebar").classList.add("open");$("#closeDrawer").onclick=()=>$("#sidebar").classList.remove("open");
$("#addCategory").onclick=()=>{settings.categories.push("新分类");renderSettings();};$("#saveSettings").onclick=saveSettings;
$$("[data-theme-choice]").forEach(button => button.onclick = () => applyTheme(button.dataset.themeChoice));
$("#toggleDavPassword").onclick=()=>{
  const input=$("#davPassword"),button=$("#toggleDavPassword"),show=input.type==="password";
  input.type=show?"text":"password";
  button.textContent=show?"隐藏":"显示";
  button.setAttribute("aria-label",show?"隐藏密码":"显示密码");
  button.setAttribute("aria-pressed",String(show));
};
$("#syncNowBtn").onclick=()=>sync("push");
$("#pushBtn").onclick=()=>sync("push");$("#pullBtn").onclick=()=>sync("pull");
$$("[data-tab]").forEach(b=>b.onclick=()=>{$$("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));const settingsTab=b.dataset.tab==="settings";$("#settingsPane").classList.toggle("hidden",!settingsTab);$("#notesPane")?.classList.toggle("hidden",settingsTab);$("#editorPane").classList.toggle("hidden",settingsTab||matchMedia("(max-width:800px)").matches);});
if (window.LocalNotes) {
  document.documentElement.classList.add("local-app");
  token = "local-device";
  localStorage.setItem("simple_note_token", token);
  $("#loginView").classList.add("hidden");
  boot();
} else if(token) boot();
