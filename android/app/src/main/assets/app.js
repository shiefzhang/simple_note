const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let token = localStorage.getItem("simple_note_token") || "";
let notes = [], settings = {categories: []}, selected = null, filter = "全部";
let activeTheme = localStorage.getItem("simple_note_theme") || "paper";
let persistedCategories = [];
let noteSearchMatches = [], noteSearchIndex = -1;
const lastNoteKey="simple_note_last_note";
const categoryCacheKey = "simple_note_categories";

function cacheCategories(values) {
  localStorage.setItem(categoryCacheKey,JSON.stringify(values));
}

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
function resolveImageSrc(src) {
  const value=String(src||"").trim();
  if(/^images\/[^/?#]+$/i.test(value) && window.LocalNotes?.imageUrl){
    return window.LocalNotes.imageUrl(value);
  }
  return value;
}
function rewritePreviewImages(value) {
  const template=document.createElement("template");
  template.innerHTML=value;
  template.content.querySelectorAll("img[src]").forEach(img=>{
    img.setAttribute("src",resolveImageSrc(img.getAttribute("src")));
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
      const image=images[Number(index)];
      return `<img src="${escapeHtml(resolveImageSrc(image.src))}" alt="${escapeHtml(image.alt||"图片")}">`;
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
      if(attr.name.toLowerCase()==="src") node.setAttribute(attr.name,resolveImageSrc(attr.value));
    });
  });
  return rewritePreviewImages(template.innerHTML);
}
function setNoteSaveState(state) {
  const button=$("#saveNoteBtn");
  if(!button)return;
  button.classList.toggle("dirty",state==="dirty");
  button.classList.toggle("saving",state==="saving");
  button.disabled=state!=="dirty";
  button.textContent=state==="saving"?"保存中…":"保存笔记";
}
function markNoteDirty() {
  if(!selected)return;
  setNoteSaveState("dirty");
  $("#syncText").textContent="有未保存更改";
  if($("#noteSearch")?.value)runNoteSearch("nearest");
}
function setSearchMode(active) {
  const sourceView=$("[data-view].active")?.dataset.view==="source";
  $("#searchPreview").classList.toggle("hidden",!active);
  $("#noteContent").classList.toggle("hidden",active||!sourceView);
  $(".format-bar").classList.toggle("hidden",active||!sourceView);
  $("#inlinePreview").classList.toggle("hidden",active||sourceView);
}
function clearNoteSearch(clearInput=true) {
  if(clearInput)$("#noteSearch").value="";
  noteSearchMatches=[];noteSearchIndex=-1;
  $("#noteSearchCount").textContent="0/0";
  $("#searchPreview").innerHTML="";
  setSearchMode(false);
}
function runNoteSearch(action="nearest") {
  const query=$("#noteSearch").value;
  if(!query){clearNoteSearch(false);return;}
  const content=$("#noteContent").value;
  const haystack=content.toLocaleLowerCase(),needle=query.toLocaleLowerCase();
  noteSearchMatches=[];
  for(let start=0;(start=haystack.indexOf(needle,start))!==-1;start+=Math.max(needle.length,1))noteSearchMatches.push(start);
  if(!noteSearchMatches.length){
    noteSearchIndex=-1;$("#noteSearchCount").textContent="0/0";
    $("#searchPreview").textContent=content;setSearchMode(true);return;
  }
  if(action==="next")noteSearchIndex=(noteSearchIndex+1)%noteSearchMatches.length;
  else if(action==="prev")noteSearchIndex=(noteSearchIndex-1+noteSearchMatches.length)%noteSearchMatches.length;
  else{
    const cursor=$("#noteContent").selectionStart||0;
    const nearest=noteSearchMatches.findIndex(position=>position>=cursor);
    noteSearchIndex=nearest===-1?0:nearest;
  }
  let html="",offset=0;
  noteSearchMatches.forEach((position,index)=>{
    html+=escapeHtml(content.slice(offset,position));
    html+=`<mark class="${index===noteSearchIndex?"current":""}">${escapeHtml(content.slice(position,position+query.length))}</mark>`;
    offset=position+query.length;
  });
  $("#searchPreview").innerHTML=html+escapeHtml(content.slice(offset));
  $("#noteSearchCount").textContent=`${noteSearchIndex+1}/${noteSearchMatches.length}`;
  setSearchMode(true);
  requestAnimationFrame(()=>{
    const preview=$("#searchPreview"),current=preview.querySelector("mark.current");
    if(current)preview.scrollTop=Math.max(0,current.offsetTop-preview.clientHeight/2+current.offsetHeight/2);
  });
}
function editorScrollProgress(element) {
  const search=$("#searchPreview");
  const active=element||(!search.classList.contains("hidden")
    ? search
    : ($("[data-view].active")?.dataset.view==="source" ? $("#noteContent") : $("#inlinePreview")));
  const range=Math.max(0,active.scrollHeight-active.clientHeight);
  return range ? active.scrollTop/range : 0;
}
function normalizeAnchorText(value,withMap=false) {
  let text="",map=[],inTag=false,lastSpace=false;
  for(let i=0;i<value.length;i++){
    const char=value[i];
    if(char==="<"){inTag=true;continue;}
    if(inTag){if(char===">")inTag=false;continue;}
    if("#>*_`[]".includes(char))continue;
    if(/\s/.test(char)){
      if(text&&!lastSpace){text+=" ";map.push(i);lastSpace=true;}
      continue;
    }
    text+=char.toLocaleLowerCase();map.push(i);lastSpace=false;
  }
  return withMap?{text:text.trim(),map}:text.trim();
}
function visiblePreviewText(preview) {
  const rect=preview.getBoundingClientRect();
  const x=Math.min(rect.right-8,rect.left+24),y=rect.top+10;
  const caret=document.caretRangeFromPoint?.(x,y);
  if(caret?.startContainer?.nodeType===Node.TEXT_NODE){
    const value=caret.startContainer.data;
    const start=Math.max(0,Math.min(caret.startOffset,value.length-1));
    const text=value.slice(start,start+60).trim()||value.slice(Math.max(0,start-30),start+30).trim();
    if(text)return text;
  }
  const walker=document.createTreeWalker(preview,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    if(!node.data.trim())continue;
    const range=document.createRange();
    range.selectNodeContents(node);
    if(range.getBoundingClientRect().bottom>=y)return node.data.trim().slice(0,60);
  }
  return "";
}
function sourceOffsetForText(content,value,progress) {
  const source=normalizeAnchorText(content,true);
  const needle=normalizeAnchorText(value).slice(0,36);
  if(!needle)return -1;
  const expected=Math.round(progress*source.text.length);
  let best=-1,bestDistance=Infinity,start=0;
  while((start=source.text.indexOf(needle,start))!==-1){
    const distance=Math.abs(start-expected);
    if(distance<bestDistance){best=start;bestDistance=distance;}
    start+=Math.max(needle.length,1);
  }
  return best===-1?-1:(source.map[best]??-1);
}
function captureEditorAnchor() {
  const source=$("#noteContent"),content=source.value;
  const sourceView=$("[data-view].active")?.dataset.view==="source";
  const active=sourceView?source:$("#inlinePreview");
  const progress=editorScrollProgress(active);
  if(sourceView){
    const offset=Math.round(progress*content.length);
    const lineStart=content.lastIndexOf("\n",Math.max(0,offset-1))+1;
    const lineEnd=content.indexOf("\n",lineStart);
    const text=content.slice(lineStart,lineEnd===-1?content.length:lineEnd)
      .replace(/<[^>]+>|[#>*_`\-\[\]]/g," ").trim().slice(0,40);
    return {offset:lineStart,text,progress};
  }
  const text=visiblePreviewText(active);
  const offset=sourceOffsetForText(content,text,progress);
  return {offset,text,progress};
}
function sourceScrollTopForOffset(source,offset) {
  const style=getComputedStyle(source);
  const mirror=document.createElement("div");
  Object.assign(mirror.style,{
    position:"fixed",visibility:"hidden",pointerEvents:"none",
    left:"-10000px",top:"0",width:`${source.clientWidth}px`,
    padding:style.padding,border:style.border,font:style.font,
    lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,
    whiteSpace:"pre-wrap",overflowWrap:"break-word",boxSizing:"border-box"
  });
  mirror.textContent=source.value.slice(0,Math.max(0,offset));
  const marker=document.createElement("span");
  marker.textContent="\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const top=marker.offsetTop;
  mirror.remove();
  return top;
}
function restoreEditorAnchor(element,anchor,sourceView) {
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(sourceView&&anchor.offset>=0){
      element.scrollTop=Math.max(0,sourceScrollTopForOffset(element,anchor.offset)-8);
      return;
    }
    if(!sourceView&&anchor.text){
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        const index=node.data.indexOf(anchor.text);
        if(index===-1)continue;
        const range=document.createRange();
        range.setStart(node,index);range.setEnd(node,index+anchor.text.length);
        element.scrollTop+=range.getBoundingClientRect().top-element.getBoundingClientRect().top-8;
        return;
      }
    }
    const range=Math.max(0,element.scrollHeight-element.clientHeight);
    element.scrollTop=range*Math.min(1,Math.max(0,anchor.progress));
  }));
}
function switchEditorView(view, focusSource=true, anchor=captureEditorAnchor()) {
  if(!selected)return;
  const source=view==="source";
  $("#noteContent").classList.toggle("hidden",!source);
  $(".format-bar").classList.toggle("hidden",!source);
  $("#inlinePreview").classList.toggle("hidden",source);
  $$("[data-view]").forEach(button=>button.classList.toggle("active",button.dataset.view===view));
  if(source){
    if(focusSource)$("#noteContent").focus({preventScroll:true});
    restoreEditorAnchor($("#noteContent"),anchor,true);
    return;
  }
  selected.format=view;
  const preview=$("#inlinePreview");
  preview.classList.toggle("html-lines",view==="html");
  preview.innerHTML=view==="markdown"?renderLocalMarkdown($("#noteContent").value):safeHtml($("#noteContent").value);
  renderMath(preview);
  restoreEditorAnchor(preview,anchor,false);
  markNoteDirty();
}
function dateText(value) {
  const d = new Date(value); const now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}) : d.toLocaleDateString("zh-CN",{month:"short",day:"numeric"});
}
async function boot() {
  $("#loginView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  try {
    [notes, settings] = await Promise.all([api("/api/notes"), api("/api/settings")]);
    if(window.LocalNotes){
      cacheCategories(settings.categories);
    }
    persistedCategories=[...settings.categories];
    selected = notes.find(n=>n.id===localStorage.getItem(lastNoteKey)) || notes[0] || null;
    renderAll();
  } catch (error) { toast(error.message); }
}
function renderAll() { renderCategories(); renderNotes(); renderSettings(); selectNote(selected?.id); }
function visibleCategories() {
  const result = [];
  [...settings.categories, ...notes.map(n => n.category)].forEach(c => {
    if (c && !result.includes(c)) result.push(c);
  });
  return result;
}
function categoryEditorValues() {
  const values = $$("#categoryEditor input").map(i=>i.value.trim()).filter(Boolean);
  return values.length ? values : ["随笔"];
}
function syncCategoryEditor() {
  settings.categories=categoryEditorValues();
  renderCategories();
  if(selected)$("#categorySelect").value=selected.category;
}
function renderCategories() {
  const cats = ["全部", ...visibleCategories()];
  $("#categories").innerHTML = cats.map(c => {
    const compact=[...c].length>=4 ? " compact" : "";
    return `<button data-category="${escapeHtml(c)}" class="${filter===c?"active":""}${compact}">${escapeHtml(c)}</button>`;
  }).join("");
  $("#categorySelect").innerHTML = visibleCategories().map(c => `<option>${escapeHtml(c)}</option>`).join("");
  $$("#categories button").forEach(b => b.onclick = () => { filter=b.dataset.category; $("#listTitle").textContent=filter==="全部"?"全部笔记":filter; renderCategories(); renderNotes(); $("#sidebar").classList.remove("open"); });
}
function renderNotes() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = notes.filter(n => (filter==="全部" || n.category===filter) && (!q || `${n.title} ${n.content}`.toLowerCase().includes(q)));
  $("#noteList").innerHTML = rows.length ? rows.map(n => `<button class="note-item ${selected?.id===n.id?"active":""}" data-id="${n.id}"><h3>${escapeHtml(n.title||"无标题")}</h3><p>${escapeHtml(cleanText(n.content)||"空白笔记")}</p><div class="note-meta"><span>${escapeHtml(n.category)}</span><span>${dateText(n.updated_at)}</span></div></button>`).join("") : `<div class="muted" style="padding:30px;text-align:center">这里还没有笔记</div>`;
  $$(".note-item").forEach(el => el.onclick = () => selectNote(el.dataset.id, true));
}
function selectNote(id, showEditor=false) {
  clearNoteSearch();
  selected = notes.find(n => n.id===id) || selected;
  if (!selected) return;
  if(!selected.isDraft)localStorage.setItem(lastNoteKey,selected.id);
  $("#noteTitle").value = selected.title; $("#noteContent").value = selected.content;
  $("#categorySelect").value = selected.category;
  switchEditorView("source",false,{offset:0,text:"",progress:0});
  setNoteSaveState("clean");
  renderNotes();
  if(showEditor&&matchMedia("(max-width:800px)").matches)showTab("note");
}
async function createNote() {
  clearNoteSearch();
  const category = filter==="全部" ? settings.categories[0] || "随笔" : filter;
  selected={id:"draft",title:"",content:"",format:"markdown",category,isDraft:true};
  $("#noteTitle").value="";
  $("#noteContent").value="";
  $("#categorySelect").value=category;
  switchEditorView("source",false,{offset:0,text:"",progress:0});
  setNoteSaveState("dirty");
  renderNotes();
  $("#editorPane").classList.remove("hidden");
  if(!matchMedia("(max-width:800px)").matches)$("#noteTitle").focus();
}
async function saveCurrent() {
  if (!selected || $("#saveNoteBtn").disabled) return;
  setNoteSaveState("saving");
  selected.title=$("#noteTitle").value;
  selected.content=$("#noteContent").value;
  selected.category=$("#categorySelect").value;
  try {
    const body=JSON.stringify({title:selected.title||"新笔记",content:selected.content,format:selected.format,category:selected.category});
    const updated=selected.isDraft
      ? await api("/api/notes",{method:"POST",body})
      : await api(`/api/notes/${selected.id}`,{method:"PUT",body});
    if(selected.isDraft)notes.unshift(updated);
    selected=updated;
    localStorage.setItem(lastNoteKey,selected.id);
    setNoteSaveState("clean"); $("#syncText").textContent="本地已保存"; renderNotes();
  } catch(e) { setNoteSaveState("dirty"); toast(e.message); }
}
function renderSettings() {
  $("#davUrl").value=settings.webdav_url||""; $("#davUser").value=settings.webdav_username||"";
  if(window.LocalNotes) $("#davPassword").value=settings.webdav_password||"";
  $("#settingsSyncStatus").textContent=localStorage.getItem("simple_note_last_sync")||"尚未同步";
  $("#categoryEditor").innerHTML=settings.categories.map((c,i)=>`<div class="category-row"><input maxlength="4" value="${escapeHtml(c)}" data-ci="${i}"><button data-remove="${i}">删除</button></div>`).join("");
  $$("[data-remove]").forEach(b=>b.onclick=()=>{settings.categories.splice(Number(b.dataset.remove),1);renderSettings();renderCategories();});
  $$("#categoryEditor input").forEach(input=>input.oninput=syncCategoryEditor);
  applyTheme(settings.theme || activeTheme);
}
async function persistSettings(showToast = true) {
  let categories=categoryEditorValues();
  if(categories.some(c=>[...c].length>4)){toast("分类最多 4 个字");return false;}
  const davPassword=$("#davPassword").value;
  const categoryRenames={};
  if(categories.length===persistedCategories.length){
    persistedCategories.forEach((oldValue,index)=>{
      const newValue=categories[index];
      if(oldValue!==newValue && !categories.includes(oldValue) && !persistedCategories.includes(newValue)){
        categoryRenames[oldValue]=newValue;
      }
    });
  }
  try {
    const saved=await api("/api/settings",{method:"PUT",body:JSON.stringify({password:$("#newPassword").value,webdav_url:$("#davUrl").value,webdav_username:$("#davUser").value,webdav_password:davPassword,categories,category_renames:categoryRenames,theme:activeTheme})});
    if(window.LocalNotes && Array.isArray(saved.categories))categories=saved.categories;
    notes.forEach(note=>{
      if(categoryRenames[note.category])note.category=categoryRenames[note.category];
    });
    if(selected && categoryRenames[selected.category])selected.category=categoryRenames[selected.category];
    settings={...settings,webdav_url:$("#davUrl").value,webdav_username:$("#davUser").value,webdav_password:window.LocalNotes?davPassword:undefined,categories,theme:activeTheme};
    persistedCategories=[...categories];
    if(window.LocalNotes)cacheCategories(categories);
    $("#newPassword").value="";
    if(!window.LocalNotes) $("#davPassword").value="";
    renderCategories();
    if(selected)$("#categorySelect").value=selected.category;
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
    notes=await api("/api/notes");settings=await api("/api/settings");
    if(window.LocalNotes)cacheCategories(settings.categories);
    persistedCategories=[...settings.categories];
    selected=notes.find(n=>n.id===localStorage.getItem(lastNoteKey))||notes[0]||null;
    renderCategories();renderNotes();
  }catch(e){status.textContent="同步失败";toast(e.message);}
}
async function formatWebDav() {
  const davUrl=($("#davUrl").value||settings.webdav_url||"").trim()||"未配置 WebDAV 地址";
  const first=confirm(`即将格式化 WebDAV 地址：\n${davUrl}\n\n格式化会清除该 WebDAV 上的所有纸间笔记和删除记录，并写入新的文件特征码。\n\n本地笔记不会删除。确定继续吗？`);
  if(!first)return;
  const second=confirm(`请再次确认 WebDAV 地址：\n${davUrl}\n\n云端数据清除后无法从 WebDAV 恢复。\n\n确定格式化云端吗？`);
  if(!second)return;
  const status=$("#settingsSyncStatus");status.textContent="正在格式化云端…";
  if(!await persistSettings(false)){status.textContent="配置保存失败";return;}
  try{
    await api("/api/sync/format",{method:"POST"});
    const text=`${new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})} · 云端已格式化`;
    localStorage.setItem("simple_note_last_sync",text);
    status.textContent=text;
    toast("WebDAV 云端数据已清空并写入特征码");
  }catch(e){status.textContent="格式化失败";toast(e.message);}
}
function insertText(text) {
  const el=$("#noteContent"), start=el.selectionStart, end=el.selectionEnd;
  el.value=el.value.slice(0,start)+text+el.value.slice(end); el.focus();el.selectionStart=el.selectionEnd=start+text.length;markNoteDirty();
}
function showTab(tab, forceEditor=false) {
  const settingsTab=tab==="settings";
  let noteTab=tab==="note";
  if(noteTab&&!selected){
    selected=notes.find(n=>n.id===localStorage.getItem(lastNoteKey))||notes[0]||null;
    if(selected)selectNote(selected.id);
  }
  if(noteTab&&!selected){tab="list";noteTab=false;}
  $$("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  $("#settingsPane").classList.toggle("hidden",!settingsTab);
  $("#notesPane")?.classList.toggle("hidden",settingsTab);
  const hideEditor=settingsTab||(matchMedia("(max-width:800px)").matches&&!noteTab&&!forceEditor);
  $("#editorPane").classList.toggle("hidden",hideEditor);
}
async function createAndOpenNote() {
  await createNote();
  showTab("note",true);
}

$("#loginForm").onsubmit=async e=>{e.preventDefault();$("#loginError").textContent="";try{const result=await api("/api/login",{method:"POST",body:JSON.stringify({password:$("#loginPassword").value})});token=result.token;localStorage.setItem("simple_note_token",token);boot();}catch(err){$("#loginError").textContent=err.message;}};
$("#addNoteTop").onclick=createAndOpenNote;$("#search").oninput=renderNotes;
$("#noteTitle").oninput=markNoteDirty;$("#noteContent").oninput=markNoteDirty;$("#categorySelect").onchange=markNoteDirty;$("#saveNoteBtn").onclick=saveCurrent;
$$("[data-view]").forEach(button=>button.onclick=()=>{
  const anchor=captureEditorAnchor();
  const query=$("#noteSearch").value;
  clearNoteSearch(false);
  switchEditorView(button.dataset.view,false,anchor);
  if(query)runNoteSearch("nearest");
});
$("#noteSearch").oninput=()=>runNoteSearch("nearest");
$("#noteSearch").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();runNoteSearch(e.shiftKey?"prev":"next");}};
$("#noteSearchPrev").onclick=()=>runNoteSearch("prev");
$("#noteSearchNext").onclick=()=>runNoteSearch("next");
$$("[data-insert]").forEach(b=>b.onclick=()=>insertText(b.dataset.insert));
$("#imageInput").onchange=e=>{
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const response=JSON.parse(window.LocalNotes.saveImage(file.name,reader.result));
      if(!response.ok)throw new Error(response.error||"图片保存失败");
      const path=response.data.path;
      insertText(selected.format==="html"?`<img src="${path}" alt="${file.name}">`:`![${file.name}](${path})`);
      toast("图片已保存到本地，将在同步时上传 WebDAV");
    }catch(error){
      toast(error.message||"图片保存失败");
    }finally{
      e.target.value="";
    }
  };
  reader.onerror=()=>toast("图片读取失败");
  reader.readAsDataURL(file);
};
$("#deleteBtn").onclick=async()=>{if(!selected||!confirm("确定删除这篇笔记？"))return;if(!selected.isDraft)await api(`/api/notes/${selected.id}`,{method:"DELETE"});notes=notes.filter(n=>n.id!==selected.id);selected=notes[0]||null;if(selected)localStorage.setItem(lastNoteKey,selected.id);else localStorage.removeItem(lastNoteKey);renderAll();if(matchMedia("(max-width:800px)").matches)showTab("list");};
$("#openDrawer").onclick=()=>$("#sidebar").classList.add("open");$("#closeDrawer").onclick=()=>$("#sidebar").classList.remove("open");
$("#addCategory").onclick=()=>{settings.categories.push("新分类");renderSettings();renderCategories();};$("#saveSettings").onclick=saveSettings;
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
$("#formatDavBtn").onclick=formatWebDav;
$$("[data-tab]").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
const keyboardViewport=window.visualViewport;
let keyboardBaseline=keyboardViewport?.height||window.innerHeight;
let keyboardWidth=keyboardViewport?.width||window.innerWidth;
function syncKeyboardState(){
  const height=keyboardViewport?.height||window.innerHeight;
  const width=keyboardViewport?.width||window.innerWidth;
  if(Math.abs(width-keyboardWidth)>40){
    keyboardWidth=width;
    keyboardBaseline=height;
  }else{
    keyboardBaseline=Math.max(keyboardBaseline,height);
  }
  const keyboardOpen=keyboardBaseline-height>Math.max(120,keyboardBaseline*.15);
  document.documentElement.classList.toggle("keyboard-open",keyboardOpen);
}
document.addEventListener("focusin",e=>{
  if(e.target.matches("input,textarea,select"))setTimeout(syncKeyboardState,80);
});
document.addEventListener("focusout",()=>setTimeout(syncKeyboardState,80));
window.addEventListener("resize",syncKeyboardState);
keyboardViewport?.addEventListener("resize",syncKeyboardState);
if (window.LocalNotes) {
  document.documentElement.classList.add("local-app");
  token = "local-device";
  localStorage.setItem("simple_note_token", token);
  $("#loginView").classList.add("hidden");
  boot();
} else if(token) boot();
