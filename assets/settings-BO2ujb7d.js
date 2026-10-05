import{t as i,f,T as g,h as A,E as M,S as D,i as S,r as _,j as v,d as O,k as C,l as h,M as w,y as $,m as x,B as N}from"./index-BmnbaHkD.js";import{C as ht,o as ft,p as yt,P as vt,q as bt}from"./index-BmnbaHkD.js";function j(s,t){const e=t&&!s.some(n=>n.id===t);return`<div class="agent-form-row"><label class="agent-form-label" for="system-prompt-preset">${i("prompt.reference")}</label>
        <select id="system-prompt-preset" name="systemPromptId">
            <option value="">${i("prompt.none")}</option>
            ${e?`<option value="${f(t)}" selected>${f(i("prompt.missing",{id:t}))}</option>`:""}
            ${s.map(n=>`<option value="${f(n.id)}" ${n.id===t?"selected":""}>${f(n.name)}</option>`).join("")}
        </select>
        <p class="agent-form-help">${i("prompt.referenceHint")}</p>
        <div data-prompt-actions>
            <button type="button" class="settings-btn settings-btn--secondary settings-btn--sm" data-prompt-edit>${i("prompt.editShared")}</button>
            <button type="button" class="settings-btn settings-btn--secondary settings-btn--sm" data-prompt-copy>${i("prompt.copy")}</button>
        </div>
        <textarea class="agent-form-textarea" data-prompt-preview readonly aria-label="${i("prompt.reference")}"></textarea>
    </div>`}function R(s,t,e,n,a){const o=s.querySelector('[name="systemPromptId"]');if(!o)return;const r=s.querySelector("[data-prompt-preview]"),c=s.querySelector("[data-prompt-edit]"),d=s.querySelector("[data-prompt-copy]"),l=()=>{const m=t.find(p=>p.id===o.value);r.hidden=!o.value,r.value=m?.content.join(`

`)??(o.value?i("prompt.missing",{id:o.value}):""),c.disabled=!m||!n?.navigate,d.disabled=!m};o.addEventListener("change",l),c.addEventListener("click",()=>{Promise.resolve(n?.navigate?.({target:"toolbox",resourceId:"/prompts/"+encodeURIComponent(o.value)})).catch(m=>g.error(String(m)))}),d.addEventListener("click",()=>{d.disabled=!0,B(o,t,e,a).catch(m=>g.error(String(m))).finally(l)}),l()}async function B(s,t,e,n){const a=s.value,o=await e.getSystemPrompt(a);if(!o)throw new Error(i("prompt.missing",{id:a}));const r={...structuredClone(o),id:A(),name:i("prompt.copyName",{name:o.name})};await e.saveSystemPrompt(r),t.push(r),s.add(new Option(r.name,r.id)),s.value===a&&(s.value=r.id,n())}const F=s=>[...new Set(s.split(/[\s,]+/).filter(Boolean))];function U(s,t,e=[]){const n=s.capabilityPolicy,a=new Set(n?.skillIds??[]),o=[...new Set([...e,...t.flatMap(l=>l.tools.map(m=>m.toolId))])],r=new Set(n?.toolIds??e),c=(n?.toolIds??[]).filter(l=>!o.includes(l)),d=new Map(t.map(l=>[l.id,l]));for(const l of a)d.has(l)||d.set(l,{id:l,name:l,tools:[]});return`<div class="agent-section" data-capability-editor>
        <div class="agent-section__header">${i("agent.capabilities.title")}</div>
        <div class="agent-section__body">
            <label><input type="checkbox" name="defaultTools" ${n?.toolIds===void 0?"checked":""}> ${i("agent.capabilities.defaults")}</label>
            <p class="agent-form-help">${i("agent.capabilities.help")}</p>
            <div>${o.map(l=>`<label class="agent-mcp-item"><input type="checkbox" name="toolGrant" value="${f(l)}" ${r.has(l)?"checked":""}>${f(l)}</label>`).join("")}</div>
            <label>${i("agent.capabilities.tools")}<textarea class="agent-form-input" name="toolIds" rows="3">${f(c.join(`
`))}</textarea></label>
            <p class="agent-form-help">${i("agent.capabilities.skillHelp")}</p>
            ${[...d.values()].map(l=>`<label class="agent-mcp-item">
                <input type="checkbox" name="skillIds" value="${f(l.id)}" ${a.has(l.id)?"checked":""}>
                <span>${f(l.name)}<small> ${f(l.tools.map(m=>m.toolId).join(", "))}</small></span>
            </label>`).join("")}
        </div></div>`}function J(s,t){if(!s.querySelector("[data-capability-editor]"))return t;const e=s.querySelector('[name="defaultTools"]').checked,n=s.querySelector('[name="toolIds"]').value,a=o=>[...s.querySelectorAll(`[name="${o}"]:checked`)].map(r=>r.value);return{...t,toolIds:e?void 0:[...new Set([...a("toolGrant"),...F(n)])],skillIds:a("skillIds"),mcpProfileIds:a("mcpServers")}}function G(s,t=[]){const e=a=>{const o=a.target,r=s.querySelector('[name="defaultTools"]');(o.name==="toolGrant"||o.name==="toolIds")&&(r.checked=!1),o.name==="defaultTools"&&r.checked&&(s.querySelectorAll('[name="toolGrant"]').forEach(c=>{c.checked=t.includes(c.value)}),s.querySelector('[name="toolIds"]').value="")},n=s.querySelector("[data-capability-editor]");n?.addEventListener("input",e),n?.addEventListener("change",e)}class Y{constructor(t,e,n,a={}){this.options=e,this.service=n,this.defaultToolIds=[...new Set(a.defaultToolIds??[])]}defaultToolIds;autoSave;rendering;promptLibrary=[];container;content=null;_isDirty=!1;editorEvents=new M;originalContent="";currentTitle="";async init(t,e){this.container=t,this.container.classList.add("agent-config-editor"),this.originalContent=e||"{}",this.currentTitle=this.options.title||"",this.setText(this.originalContent),await this.rendering,this.emit("ready",void 0)}getText(){return this.content?(this.syncModelFromUI(),JSON.stringify(this.content,null,2)):"{}"}setText(t){if(!this.autoSave?.protectsInput)try{const e=JSON.parse(t),n=e.id&&e.id.trim()!==""?e.id:A(),a=this.normalizeAgentType(e.type);this.content={...e,id:n,name:e.name||"New Agent",type:a,description:e.description||"",icon:e.icon||"🤖",config:{...e.config,systemPrompt:e.config?.systemPrompt??"",mcpServers:e.config?.mcpServers||[],maxHistoryLength:e.config?.maxHistoryLength??-1,temperature:e.config?.temperature},interface:e.interface||{inputs:[],outputs:[]},defaultPrompts:this.normalizePrompts(e.defaultPrompts)},this.rendering=this.render()}catch(e){this.renderError(e.message),this.content=null}}normalizePrompts(t){return Array.isArray(t)?t.filter(e=>!!e&&typeof e=="object").map(e=>({name:typeof e.name=="string"?e.name:"",prompt:typeof e.prompt=="string"?e.prompt:""})):[]}normalizeAgentType(t){switch(t){case"agent":return"agent";case"composite":case"orchestrator":return"composite";case"tool":return"tool";case"workflow":return"workflow";default:return"agent"}}isDirty(){return this.autoSave?.isDirty??this._isDirty}setDirty(t){this._isDirty=t}async render(){if(this.autoSave&&!await this.autoSave.dispose()||!this.content)return;const t=this.content,e={...t.config,systemPrompt:t.systemPrompt??t.config.systemPrompt},n=await this.service.listSystemPrompts();this.promptLibrary=n;const a=[...await this.service.getMCPServers()];for(const r of t.capabilityPolicy?.mcpProfileIds??e.mcpServers??[])a.some(c=>c.id===r)||a.push({id:r,name:r,transport:"http",status:"error"});const o=await this.service.getSkills();this.container.innerHTML=`
            <div class="agent-editor-container">
                <!-- Header with Icon & Name -->
                <div class="agent-header">
                    <div class="agent-header__icon-picker" id="icon-picker" title="点击更换图标">
                        ${t.icon||"🤖"}
                    </div>
                    <div class="agent-header__info">
                        <input type="text" 
                               class="agent-header__name-input" 
                               name="name" 
                               value="${this.escapeHtml(t.name)}" 
                               placeholder="Agent 名称">
                        <textarea class="agent-header__desc-input" 
                                  name="description" 
                                  placeholder="描述这个 Agent 的用途..."
                                  rows="2">${this.escapeHtml(t.description||"")}</textarea>
                    </div>
                </div>

                <!-- Type Selection -->
                <div class="agent-section">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">🎯</span>
                        <span class="agent-section__title">Agent 类型</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        <div class="agent-type-selector">
                            <div class="agent-type-option ${t.type==="agent"?"selected":""}" data-type="agent">
                                <div class="agent-type-option__icon">🤖</div>
                                <div class="agent-type-option__title">Agent</div>
                                <div class="agent-type-option__desc">单一 LLM 驱动的智能体</div>
                            </div>
                            <div class="agent-type-option ${t.type==="composite"?"selected":""}" data-type="composite">
                                <div class="agent-type-option__icon">🕸️</div>
                                <div class="agent-type-option__title">Composite</div>
                                <div class="agent-type-option__desc">协调多个 Agent 协作</div>
                            </div>
                            <div class="agent-type-option ${t.type==="workflow"?"selected":""}" data-type="workflow">
                                <div class="agent-type-option__icon">📋</div>
                                <div class="agent-type-option__title">Workflow</div>
                                <div class="agent-type-option__desc">预定义的工作流程</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Agent behavior -->
                <div class="agent-section" id="llm-config-section" style="${t.type!=="agent"?"display:none":""}">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">🧠</span>
                        <span class="agent-section__title">${i("agent.behavior.title")}</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        ${j(n,e.systemPromptId)}
                        <div class="agent-form-row">
                            <label class="agent-form-label">${i("prompt.additional")}</label>
                            <textarea class="agent-form-textarea" 
                                      name="systemPrompt" 
                                      placeholder="You are a helpful assistant...">${this.escapeHtml(e.systemPrompt||"")}</textarea>
                            <p class="agent-form-help">
                                ${i("prompt.additionalHint")}
                            </p>
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                历史消息数量 <small>-1 表示不限制</small>
                            </label>
                            <input type="number"
                                   class="agent-form-input"
                                   name="maxHistoryLength"
                                   value="${e.maxHistoryLength??-1}"
                                   min="-1"
                                   style="max-width: 150px;">
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                温度 (0-2) <small>控制输出随机性</small>
                            </label>
                            <input type="number"
                                   class="agent-form-input"
                                   name="temperature"
                                   value="${e.temperature??""}"
                                   min="0" max="2" step="0.1"
                                   placeholder="未设置（使用 Provider 默认）"
                                   style="max-width: 120px;">
                            <p class="agent-form-help">
                                值越高越随机。留空则使用 Provider 默认温度。
                            </p>
                        </div>
                    </div>
                </div>

                ${U(t,o,this.defaultToolIds)}

                <!-- MCP Tools -->
                <div class="agent-section" id="mcp-section" style="${t.type!=="agent"?"display:none":""}">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">🔧</span>
                        <span class="agent-section__title">工具能力 (MCP)</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        ${a.length===0?`<div class="agent-empty-state">
                                    <div class="agent-empty-state__icon">🔌</div>
                                    <p>暂无可用的 MCP 服务器</p>
                                    <p style="font-size:0.8rem; margin-top:8px;">请在设置 → MCP Servers 中添加</p>
                               </div>`:`<p class="agent-form-help" style="margin-bottom:12px;">
                                    选择此 Agent 可以调用的工具服务
                               </p>
                               <div class="agent-mcp-list">
                                    ${a.map(r=>`
                                        <label class="agent-mcp-item">
                                            <input type="checkbox" 
                                                   name="mcpServers" 
                                                   value="${this.escapeHtml(r.id)}"
                                                   ${(t.capabilityPolicy?.mcpProfileIds??e.mcpServers??[]).includes(r.id)?"checked":""}>
                                            <div class="agent-mcp-item__info">
                                                <div class="agent-mcp-item__name">
                                                    ${r.icon||"🔌"} ${this.escapeHtml(r.name)}
                                                </div>
                                                <div class="agent-mcp-item__desc">
                                                    ${this.escapeHtml(r.description||"无描述")}
                                                </div>
                                            </div>
                                            <span class="agent-mcp-item__status ${r.status==="connected"?"connected":""}">
                                                ${r.status==="connected"?"已连接":"未连接"}
                                            </span>
                                        </label>
                                    `).join("")}
                               </div>`}
                    </div>
                </div>

                <!-- Default Prompts -->
                <div class="agent-section">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">💬</span>
                        <span class="agent-section__title">预设 Prompt</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        <p class="agent-form-help" style="margin-bottom:12px;">
                            快捷 Prompt 现在作为 System Prompt 库的一部分（presets）管理。请在 System Prompt 库中编辑。
                        </p>
                        <div class="agent-prompt-list" id="prompt-list">
                            ${(t.defaultPrompts||[]).map((r,c)=>this.renderPromptRow(r,c)).join("")}
                        </div>
                    </div>
                </div>

                <!-- Advanced Settings -->
                <div class="agent-section collapsed">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">⚙️</span>
                        <span class="agent-section__title">高级设置</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        <div class="agent-form-row">
                            <label class="agent-form-label">Agent ID</label>
                            <input type="text" 
                                   class="agent-form-input" 
                                   name="id" 
                                   value="${this.escapeHtml(t.id)}" 
                                   readonly 
                                   style="background: var(--st-bg-tertiary, #f3f4f6); cursor: not-allowed;">
                            <p class="agent-form-help">系统生成的唯一标识符，不可修改</p>
                        </div>
                    </div>
                </div>

                <!-- Hidden field for icon -->
                <input type="hidden" name="icon" value="${t.icon||"🤖"}">
            </div>
        `,this.bindEvents()}renderPromptRow(t,e){return`
            <div class="agent-prompt-item" data-index="${e}">
                <div class="agent-prompt-item__head">
                    <input type="text"
                           class="agent-form-input agent-prompt-name"
                           placeholder="名称（如：代码审查）"
                           value="${this.escapeHtml(t.name)}">
                    <div class="agent-prompt-actions">
                        <button type="button" class="agent-prompt-btn" data-action="up" title="上移">▲</button>
                        <button type="button" class="agent-prompt-btn" data-action="down" title="下移">▼</button>
                        <button type="button" class="agent-prompt-btn agent-prompt-btn--danger" data-action="remove" title="删除">✕</button>
                    </div>
                </div>
                <textarea class="agent-form-textarea agent-prompt-text"
                          rows="2"
                          placeholder="提示词内容...">${this.escapeHtml(t.prompt)}</textarea>
            </div>
        `}renderError(t){this.container.innerHTML=`
            <div class="agent-editor-container">
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">⚠️</div>
                    <h3 style="margin-bottom: 8px;">配置解析失败</h3>
                    <p style="color: #6b7280; font-size: 0.9rem;">${this.escapeHtml(t)}</p>
                    <pre style="margin-top: 16px; padding: 16px; background: #fef2f2; border-radius: 8px; text-align: left; overflow: auto; font-size: 0.8rem;">${this.escapeHtml(this.originalContent)}</pre>
                </div>
            </div>
        `}bindEvents(){if(this.options.readOnly){this.container.querySelectorAll("input, select, textarea, button").forEach(r=>{r.disabled=!0});return}G(this.container,this.defaultToolIds);const t=()=>{this._isDirty=!0,_(this.container)};this.autoSave=new D(this.container,()=>this.saveDraft(),this.container.querySelector(".agent-header")??void 0),R(this.container,this.promptLibrary,this.service,this.options.hostContext,t);const e=this.container.querySelector(".agent-header__name-input"),n=this.options.files?.fs,a=S(this.options);if(e&&n&&a){const r=this.options.language||"",c=async()=>{const d=e.value.trim();if(!d||d===this.currentTitle)return;const{filename:l}=O(d,this.currentTitle+r);try{await n.driver.rename(a,l),this.currentTitle=d}catch{e.value=this.currentTitle}};e.addEventListener("blur",c),e.addEventListener("keydown",d=>{d.key==="Enter"&&(d.preventDefault(),e.blur()),d.key==="Escape"&&(e.value=this.currentTitle,e.blur())})}this.container.querySelectorAll(".agent-section__header").forEach(r=>{r.addEventListener("click",()=>{r.closest(".agent-section")?.classList.toggle("collapsed")})}),this.container.querySelectorAll(".agent-type-option").forEach(r=>{r.addEventListener("click",()=>{const c=r.dataset.type;if(!c)return;this.container.querySelectorAll(".agent-type-option").forEach(p=>p.classList.remove("selected")),r.classList.add("selected");const d=this.container.querySelector("#llm-config-section"),l=this.container.querySelector("#mcp-section");c==="composite"||c==="workflow"?(d?.style.setProperty("display","none"),l?.style.setProperty("display","none")):(d?.style.setProperty("display","block"),l?.style.setProperty("display","block"));const m=this.normalizeAgentType(c);this.content&&(this.content.type=m),t()})});const o=this.container.querySelector("#icon-picker");o&&o.addEventListener("click",()=>this.showIconPicker()),this.bindPromptEvents(t)}bindPromptEvents(t){const e=this.container.querySelector("#prompt-list");this.container.querySelector("#prompt-add")?.addEventListener("click",()=>{this.collectPromptsToContent(),this.content?.defaultPrompts?.push({name:"",prompt:""}),this.content&&!this.content.defaultPrompts&&(this.content.defaultPrompts=[{name:"",prompt:""}]),this.rerenderPromptList(),t()}),e?.addEventListener("click",a=>{const o=a.target.closest(".agent-prompt-btn");if(!o)return;const r=o.closest(".agent-prompt-item"),c=parseInt(r?.dataset.index??"-1",10);if(c<0)return;this.collectPromptsToContent();const d=this.content?.defaultPrompts;if(!d)return;const l=o.dataset.action;if(l==="remove")d.splice(c,1);else if(l==="up"&&c>0)[d[c-1],d[c]]=[d[c],d[c-1]];else if(l==="down"&&c<d.length-1)[d[c+1],d[c]]=[d[c],d[c+1]];else return;this.rerenderPromptList(),t()}),e?.addEventListener("input",a=>{const o=a.target;(o.classList.contains("agent-prompt-name")||o.classList.contains("agent-prompt-text"))&&t()})}rerenderPromptList(){const t=this.container.querySelector("#prompt-list");if(!t)return;const e=this.content?.defaultPrompts??[];t.innerHTML=e.map((n,a)=>this.renderPromptRow(n,a)).join("")}collectPromptsToContent(){if(!this.content)return;const t=Array.from(this.container.querySelectorAll(".agent-prompt-item"));this.content.defaultPrompts=t.map(e=>({name:e.querySelector(".agent-prompt-name")?.value??"",prompt:e.querySelector(".agent-prompt-text")?.value??""}))}showIconPicker(){const t=["🤖","🧠","💡","🎯","🚀","⚡","🔥","✨","🎨","📝","📊","📈","🔍","🔧","⚙️","🛠️","💻","🖥️","📱","🌐","☁️","🔒","🔑","📡","🎭","🎪","🎬","🎮","🎲","🃏","🎵","🎸","📚","📖","✏️","🖊️","📌","📎","🗂️","📁","💬","💭","🗨️","👤","👥","🤝","👋","✋","🌟","⭐","🌙","☀️","🌈","🍀","🌸","🌺","🦾","🦿","🕸️","🔮","💎","🏆","🎖️","🥇"],e=document.createElement("div");e.className="icon-picker-overlay",e.innerHTML=`
            <div class="icon-picker-modal">
                <h3 style="margin: 0 0 16px 0; font-size: 1.1rem;">选择图标</h3>
                <div class="icon-picker-grid">
                    ${t.map(n=>`
                        <div class="icon-picker-item" data-icon="${n}">${n}</div>
                    `).join("")}
                </div>
                <div style="margin-top: 16px; text-align: right;">
                    <button class="icon-picker-cancel" style="padding: 8px 16px; border: none; background: #e5e7eb; border-radius: 6px; cursor: pointer;">取消</button>
                </div>
            </div>
        `,e.querySelectorAll(".icon-picker-item").forEach(n=>{n.addEventListener("click",()=>{const a=n.dataset.icon;if(a){const o=this.container.querySelector("#icon-picker");o&&(o.textContent=a);const r=this.container.querySelector('input[name="icon"]');r&&(r.value=a),this._isDirty=!0,_(this.container)}e.remove()})}),e.querySelector(".icon-picker-cancel")?.addEventListener("click",()=>e.remove()),e.addEventListener("click",n=>{n.target===e&&e.remove()}),document.body.appendChild(e)}syncModelFromUI(){if(!this.content||!this.container.querySelector('[name="name"]'))return;const t=a=>this.container.querySelector(`[name="${a}"]`)?.value||"",e=this.container.querySelector(".agent-type-option.selected"),n=this.normalizeAgentType(e?.dataset.type);if(this.content.name=t("name"),this.content.icon=t("icon"),this.content.description=t("description"),this.content.type=n,this.collectPromptsToContent(),this.content.defaultPrompts=(this.content.defaultPrompts??[]).filter(a=>a.name.trim()!==""||a.prompt.trim()!==""),n==="agent"){const a=parseFloat(t("temperature"));this.content.config={...this.content.config,systemPromptId:t("systemPromptId")||void 0,systemPrompt:t("systemPrompt"),maxHistoryLength:Number.isNaN(Number.parseInt(t("maxHistoryLength")))?-1:Number.parseInt(t("maxHistoryLength")),mcpServers:void 0,temperature:isNaN(a)?void 0:a},this.content.capabilityPolicy=J(this.container,this.content.capabilityPolicy),this.content.systemPrompt!==void 0&&(this.content.systemPrompt=this.content.config.systemPrompt)}}async saveDraft(){if(!this.container.querySelector('[name="name"]')?.value.trim())throw new v(i("settings.autosave.invalid"));this.syncModelFromUI();const e=structuredClone(this.content),n=this.options.hostContext?.saveContent,a=S(this.options);n&&a?await n(a,JSON.stringify(e,null,2)):await this.service.saveAgent(e),this._isDirty=!1,this.emit("saved",void 0)}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async flushPendingSave(){if(this.autoSave&&!await this.autoSave.flush())throw new Error(i("settings.autosave.leaveFailed"))}async destroy(){if(this.autoSave&&!await this.autoSave.dispose())throw new Error(i("settings.autosave.leaveFailed"));this.container.innerHTML="",this.editorEvents.clear()}getMode(){return"edit"}async switchToMode(t){}setTitle(t){}setReadOnly(t){}focus(){this.container.querySelector(".agent-header__name-input")?.focus()}get commands(){return{}}async getHeadings(){return[]}async getSearchableText(){return JSON.stringify(this.content||{})}async getSummary(){return this.content?.description||null}async navigateTo(){}async search(){return[]}gotoMatch(){}clearSearch(){}async collapseBlocks(){return{affectedCount:0,allCollapsed:!0}}async expandBlocks(){return{affectedCount:0,allCollapsed:!1}}async toggleBlocks(){return this.collapseBlocks()}async pruneAssets(){return null}on(t,e){return this.editorEvents.on(t,n=>e(n))}emit(t,e){this.editorEvents.emit(t,e)}}function W(s,t){const e=s("correctionLog").trim();return{fsRoot:s("fsRoot").trim()||void 0,referencePaths:s("referencePaths").split(`
`).map(n=>n.trim()).filter(Boolean),templatePath:s("templatePath").trim()||void 0,correctionLog:e?{path:e,root:s("correctionRoot").trim()||void 0,enabled:t("correctionEnabled")}:void 0}}function L(s,t){if(s.trim())try{const e=JSON.parse(s);if(!e||typeof e!="object"||Array.isArray(e))throw new Error(t);return e}catch{throw new v(t)}}function V(s,t){const e=s==="http",n=e?L(t("headers"),i("skill.toast.invalidHeaders")):void 0;if(n&&Object.values(n).some(o=>typeof o!="string"))throw new v(i("skill.toast.invalidHeaders"));const a=t("auth-header").trim();return{instructions:s==="prompt"?t("instructions"):"",command:s==="shell"&&t("command")||void 0,mcpServerId:s==="mcp"&&t("mcpServerId")||void 0,mcpToolName:s==="mcp"&&t("mcpToolName")||void 0,endpoint:e&&t("endpoint")||void 0,method:e?t("method")||"POST":void 0,headers:e?{...n,...a?{Authorization:a}:{}}:void 0,parameters:["prompt","mcp"].includes(s)?void 0:L(t("parameters"),i("skill.toast.invalidParams"))}}function K(s,t,e){const n=t("header-name").trim();if(!n)throw new v(i("settings.autosave.invalid"));const a=t("type"),o=t("globs").split(`
`).map(c=>c.trim()).filter(Boolean),r=Number(t("priority")||"50");if(!Number.isFinite(r))throw new v(i("settings.autosave.invalid"));return{...s,id:t("id").trim()||s.id,name:n,type:a,icon:t("header-icon")||void 0,description:t("description"),enabled:e("enabled"),...V(a,t),triggerStrategy:t("triggerStrategy")||"reference",autoLoad:e("autoLoad"),priority:r,globs:o.length?o:void 0,...W(t,e),disableModelInvocation:e("disableModelInvocation")||void 0,modifiedAt:Date.now()}}const b=s=>s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");function X(s){const t=h[s]??h.custom,e=i(`skillType.${s}`);return`<span class="settings-badge" style="background:${t.color}15;color:${t.color};
                border:1px solid ${t.color}30;font-size:.75rem">
                ${t.icon} ${e}
            </span>`}function q(s){return s?`<span class="settings-badge settings-badge--success">${i("status.enabled")}</span>`:`<span class="settings-badge" style="color:var(--st-text-tertiary)">${i("status.disabled")}</span>`}function Z(){return`
        <div class="settings-empty settings-empty--mini">
            <div class="settings-empty__icon" style="font-size:2rem">${C.skill}</div>
            <p style="margin:.5rem 0">${i("skill.empty.text")}</p>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                <button class="settings-btn settings-btn--primary settings-btn--sm" data-action="add">
                    <i class="fas fa-plus"></i> ${i("skill.empty.action")}
                </button>
                <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="import">
                    <i class="fas fa-folder-open"></i> ${i("skill.import.fileLabel")}
                </button>
            </div>
        </div>`}function Q(s,t,e){const n=s.id===t,a=e.has(s.id),o=h[s.type]??h.custom,r=i(`skillType.${s.type}`);return`
        <div class="settings-list-item ${n?"selected":""}" data-id="${s.id}" style="cursor:pointer">
            <input type="checkbox" class="settings-list-item__check" data-check-id="${s.id}"
                   ${a?"checked":""}
                   style="flex-shrink:0;margin:0;cursor:pointer;accent-color:var(--st-color-primary,#6366f1)"
                   title="Select for batch action"
                   onclick="event.stopPropagation()">
            <span class="settings-list-item__icon" style="font-size:1.25rem">${s.icon||o.icon}</span>
            <div class="settings-list-item__info" style="min-width:0">
                <div class="settings-list-item__title" data-name-for="${s.id}"
                     title="${i("tooltip.dblClickRename")}" style="cursor:text">${s.name}</div>
                <div class="settings-list-item__desc">${r}${s.endpoint?" · "+et(s.endpoint):""}</div>
                <div style="font-family:monospace;font-size:.7rem;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.id}</div>
            </div>
            ${q(s.enabled)}
        </div>`}function T(){return`
        <div class="settings-empty" style="height:100%;justify-content:center">
            <div class="settings-empty__icon">${C.skill}</div>
            <div class="settings-empty__title">${i("skill.select.title")}</div>
            <p style="color:var(--st-text-tertiary);font-size:.875rem;text-align:center;max-width:280px">
                ${i("skill.select.desc")}
            </p>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                <button class="settings-btn settings-btn--primary" data-action="add">
                    <i class="fas fa-plus"></i> ${i("skill.select.action")}
                </button>
                <button class="settings-btn settings-btn--secondary" data-action="import">
                    <i class="fas fa-folder-open"></i> ${i("skill.import.fileLabel")}
                </button>
            </div>
        </div>`}function H(s,t,e){if(!s)return"";const a=e.find(o=>o.id===s)?.tools??[];return a.length===0?`<option value="" disabled>${i("skill.hint.noMcpTools")}</option>`:a.map(o=>`<option value="${o.name}" ${t===o.name?"selected":""}>${o.name}${o.description?" — "+o.description:""}</option>`).join("")}function tt(s){if(!s)return"";const{Authorization:t,...e}=s;return Object.keys(e).length?JSON.stringify(e,null,2):""}function et(s){try{return new URL(s).hostname}catch{return s.slice(0,20)}}function E(s,t,e){const n=h[s.type]??h.custom,a=s.type==="http",o=s.type==="shell",r=s.type==="prompt",c=s.type==="mcp",d=s.parameters?JSON.stringify(s.parameters,null,2):"";return`
        <!-- ── Header ── -->
        ${e({icon:s.icon||"",fallbackIcon:n.icon,editableIcon:!0,name:s.name,namePlaceholder:i("skill.placeholder.name"),badges:`${X(s.type)} ${q(s.enabled)}`,subtitle:s.description||i("status.noDesc"),actions:`
                ${a?`
                <button class="settings-btn settings-btn--secondary" data-action="test" title="${i("tooltip.testConnection")}">
                    <i class="fas fa-vial"></i> ${i("action.test")}
                </button>`:""}

                <button class="settings-btn settings-btn--danger" data-action="delete" title="${i("action.delete")}">
                    <i class="fas fa-trash"></i>
                </button>`})}

        <!-- ── Scrollable body ── -->
        <div style="overflow-y:auto;padding:1.25rem 1.75rem 2rem">

            <!-- Basic Info -->
            <div class="settings-section">
                <h3 class="settings-section__title">${i("skill.section.basic")}</h3>
                <div class="settings-form-group">
                    <label>ID <span style="color:var(--st-text-tertiary);font-size:.8em">lowercase letters, numbers, hyphens</span></label>
                    <input class="settings-input" name="id" data-autosave-defer value="${s.id}"
                           placeholder="my-skill-id"
                           style="font-family:monospace;font-size:.875rem"
                           pattern="[a-z0-9][a-z0-9_-]*" title="Lowercase letters, numbers, hyphens">
                </div>
                <div class="settings-form-group">
                    <label>${i("form.description")}</label>
                    <textarea class="settings-textarea" name="description" rows="2"
                        placeholder="${i("skill.placeholder.desc")}">${s.description||""}</textarea>
                </div>
                <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:end">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${i("form.type")}</label>
                        <select class="settings-select" name="type">
                            <option value="prompt"  ${s.type==="prompt"?"selected":""}>${h.prompt.icon} Prompt — ${i("skillType.prompt.desc")}</option>
                            <option value="shell"   ${s.type==="shell"?"selected":""}>${h.shell.icon} Shell — ${i("skillType.shell.desc")}</option>
                            <option value="mcp"     ${s.type==="mcp"?"selected":""}>${h.mcp.icon} MCP — ${i("skillType.mcp.desc")}</option>
                            <option value="http"    ${s.type==="http"?"selected":""}>${h.http.icon} HTTP — ${i("skillType.http.desc")}</option>
                            <option value="builtin" ${s.type==="builtin"?"selected":""}>${h.builtin.icon} Builtin — ${i("skillType.builtin.desc")}</option>
                            <option value="custom"  ${s.type==="custom"?"selected":""}>${h.custom.icon} Custom — ${i("skillType.custom.desc")}</option>
                        </select>
                    </div>
                    <div class="settings-checkbox-row" style="padding-bottom:.5rem;white-space:nowrap">
                        <input type="checkbox" id="skill-enabled" name="enabled" ${s.enabled?"checked":""}>
                        <label for="skill-enabled">${i("skill.enabled.label")}</label>
                    </div>
                </div>
            </div>

            <!-- Trigger & Auto-load -->
            <div class="settings-section">
                <h3 class="settings-section__title">${i("skill.section.trigger")}</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${i("skill.trigger.strategyLabel")}</label>
                        <select class="settings-select" name="triggerStrategy" id="trigger-strategy-select">
                            <option value="reference" ${(s.triggerStrategy??"reference")==="reference"?"selected":""}>
                                📖 Reference — ${i("skill.trigger.reference.desc")}
                            </option>
                            <option value="action" ${s.triggerStrategy==="action"?"selected":""}>
                                ⚡ Action — ${i("skill.trigger.action.desc")}
                            </option>
                        </select>
                    </div>
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${i("skill.trigger.priorityLabel")}
                            <span style="color:var(--st-text-tertiary);font-size:.8em">${i("skill.trigger.priorityHint")}</span>
                        </label>
                        <input class="settings-input" type="number" name="priority"
                               value="${s.priority??50}" min="0" max="100" step="5"
                               style="font-variant-numeric:tabular-nums">
                    </div>
                </div>
                <div style="display:flex;gap:1.5rem;margin-top:.75rem;flex-wrap:wrap">
                    <div class="settings-checkbox-row">
                        <input type="checkbox" id="skill-autoload" name="autoLoad"
                               ${s.autoLoad?"checked":""}>
                        <label for="skill-autoload">${i("skill.trigger.autoLoadLabel")}</label>
                    </div>
                    <div class="settings-checkbox-row" id="disable-invocation-row"
                         style="${s.triggerStrategy==="action"?"":"display:none"}">
                        <input type="checkbox" id="skill-disable-model" name="disableModelInvocation"
                               ${s.disableModelInvocation?"checked":""}>
                        <label for="skill-disable-model">${i("skill.trigger.disableModelLabel")}</label>
                    </div>
                </div>
                <div class="settings-form-group" style="margin-top:.75rem">
                    <label>${i("skill.trigger.globsLabel")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${i("skill.trigger.globsHint")}</span>
                    </label>
                    <textarea class="settings-textarea" name="globs" rows="2"
                        style="font-family:monospace;font-size:.8125rem"
                        placeholder="src/controllers/*.ts&#10;src/**/*.handler.ts"
                        >${(s.globs??[]).join(`
`)}</textarea>
                </div>
                <div class="settings-form-group">
                    <label>${i("skill.trigger.correctionLogLabel")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${i("skill.trigger.correctionLogHint")}</span>
                    </label>
                    <input class="settings-input" name="correctionLog"
                           value="${b(s.correctionLog?.path??"")}"
                           placeholder="docs/agent-corrections.md"
                           style="font-family:monospace;font-size:.875rem">
                    <label><input type="checkbox" name="correctionEnabled" ${s.correctionLog?.enabled?"checked":""}> ${i("skill.support.correctionEnabled")}</label>
                    <label>${i("skill.support.correctionRoot")}</label>
                    <input class="settings-input" name="correctionRoot" value="${b(s.correctionLog?.root??"")}" placeholder="/workspace">
                </div>
                <div class="settings-form-group">
                    <label>${i("skill.support.root")}</label>
                    <input class="settings-input" name="fsRoot" value="${b(s.fsRoot??"")}" placeholder="/workspace/_agent/skills/review">
                    <p>${i("skill.support.hint")}</p>
                    <label>${i("skill.support.references")}</label>
                    <textarea class="settings-textarea" name="referencePaths" rows="3">${b((s.referencePaths??[]).join(`
`))}</textarea>
                    <label>${i("skill.support.template")}</label>
                    <input class="settings-input" name="templatePath" value="${b(s.templatePath??"")}" placeholder="template.md">
                </div>
            </div>

            <!-- Prompt Instructions (type=prompt) -->
            <div class="settings-section" id="prompt-section" style="${r?"":"display:none"}">
                <h3 class="settings-section__title">${i("skill.section.prompt")}</h3>
                <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                    ${i("skill.hint.prompt")}</p>
                <textarea class="settings-textarea" name="instructions" rows="14"
                    style="font-family:monospace;font-size:.8125rem;resize:vertical"
                    placeholder="${i("skill.placeholder.instructions").replace(/\\n/g,"&#10;")}"
                    >${s.instructions||""}</textarea>
            </div>

            <!-- MCP Config (type=mcp) -->
            <div class="settings-section" id="mcp-section" style="${c?"":"display:none"}">
                <h3 class="settings-section__title">${i("skill.section.mcp")}</h3>
                <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                    ${i("skill.hint.mcpDesc")}</p>
                <div class="settings-form-group">
                    <label>${i("skill.mcp.serverLabel")}</label>
                    <select class="settings-select" name="mcpServerId" id="mcp-server-select">
                        <option value="">${i("skill.mcp.serverEmpty")}</option>
                        ${t.map(l=>`
                            <option value="${l.id}" ${s.mcpServerId===l.id?"selected":""}>
                                ${l.icon||"🔌"} ${l.name}
                            </option>`).join("")}
                    </select>
                    ${t.length===0?`
                        <p style="font-size:.75rem;color:var(--st-color-warning,#f59e0b);margin:.375rem 0 0">
                            <i class="fas fa-exclamation-triangle"></i>
                            ${i("skill.hint.noMcpServer")}
                        </p>`:""}
                </div>
                <div class="settings-form-group" id="mcp-tool-group"
                     style="${s.mcpServerId?"":"display:none"}">
                    <label>${i("skill.mcp.toolLabel")}</label>
                    <select class="settings-select" name="mcpToolName" id="mcp-tool-select">
                        <option value="">${i("skill.mcp.toolEmpty")}</option>
                        ${H(s.mcpServerId,s.mcpToolName,t)}
                    </select>
                </div>
                ${s.mcpServerId&&s.mcpToolName?`
                    <div style="padding:.625rem .875rem;background:var(--st-surface-secondary,#f9fafb);
                                border-radius:6px;font-size:.8125rem;color:var(--st-text-secondary)">
                        <i class="fas fa-info-circle"></i>
                        ${i("skill.hint.mcpAutoParams")}
                    </div>`:""}
            </div>

            <!-- Shell Config (type=shell) -->
            <div class="settings-section" id="shell-section" style="${o?"":"display:none"}">
                <h3 class="settings-section__title">${i("skill.section.shell")}</h3>
                <div class="settings-form-group">
                    <label>
                        ${i("skill.shell.commandLabel")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${i("skill.shell.commandHint")}</span>
                    </label>
                    <input class="settings-input" name="command" style="font-family:monospace"
                        value="${s.command||""}"
                        placeholder="${i("skill.shell.placeholder")}">
                </div>
                <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.25rem 0 0">
                    ${i("skill.hint.shell")}</p>
            </div>

            <!-- HTTP Config (type=http) -->
            <div class="settings-section" id="http-section" style="${a?"":"display:none"}">
                <h3 class="settings-section__title">${i("skill.section.http")}</h3>
                <div class="settings-form-group">
                    <label>${i("form.endpoint")}</label>
                    <input class="settings-input" type="url" name="endpoint"
                        value="${s.endpoint||""}" placeholder="https://api.example.com/skill">
                </div>
                <div style="display:grid;grid-template-columns:120px 1fr;gap:.75rem">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${i("form.method")}</label>
                        <select class="settings-select" name="method">
                            <option value="POST" ${(s.method??"POST")==="POST"?"selected":""}>POST</option>
                            <option value="GET"  ${s.method==="GET"?"selected":""}>GET</option>
                            <option value="PUT"  ${s.method==="PUT"?"selected":""}>PUT</option>
                        </select>
                    </div>
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${i("form.auth")} <span style="color:var(--st-text-tertiary);font-size:.8em">可选</span></label>
                        <input class="settings-input" type="password" name="auth-header"
                            value="${s.headers?.Authorization||""}" placeholder="Bearer sk-...">
                    </div>
                </div>
                <div class="settings-form-group">
                    <label>
                        ${i("form.headers")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${i("form.headersHint")}</span>
                    </label>
                    <textarea class="settings-textarea" name="headers" rows="3"
                        style="font-family:monospace;font-size:.8125rem"
                        placeholder='{"X-Custom-Header": "value"}'>${tt(s.headers)}</textarea>
                </div>
            </div>

            <!-- Parameters Schema -->
            <div class="settings-section" id="params-section" style="${r||c?"display:none":""};margin-bottom:0">
                <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                    ${i("skill.section.params")}
                    <span style="font-size:.75rem;font-weight:400;color:var(--st-text-tertiary)">
                        JSON Schema
                    </span>
                </h3>
                <textarea class="settings-textarea" name="parameters" rows="10"
                    style="font-family:monospace;font-size:.8125rem;resize:vertical"
                    placeholder="${i("skill.param.placeholder")}">${d}</textarea>
                <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.375rem 0 0">
                    ${i("skill.hint.params")}</p>
            </div>
        </div>`}function st(s){const t=document.createElement("input");t.type="file",t.accept=".json,.yaml,.yml,application/json",t.multiple=!0,t.style.display="none",document.body.appendChild(t),t.addEventListener("change",async()=>{const e=Array.from(t.files??[]);if(document.body.removeChild(t),e.length===0)return;const n=await Promise.allSettled(e.map(l=>l.text())),a=[],o=[];for(let l=0;l<n.length;l++){const m=n[l];if(m.status==="rejected"){o.push(i("skill.import.readError",{filename:e[l].name}));continue}try{const p=e[l].name,y=p.endsWith(".yaml")||p.endsWith(".yml")?$.load(m.value):JSON.parse(m.value),k=Array.isArray(y)?y:[y];a.push(...k)}catch{o.push(`${e[l].name}: ${i("skill.toast.invalidJson")}`)}}if(o.length>0&&g.error(o.join(`
`)),a.length===0)return;s.importing=!0;const r=new Set((await s.service.getSkills()).map(l=>l.id));let c="",d=0;for(const l of a){let m=l.id??`skill-${x()}`;if(r.has(m)){let p=2;for(;r.has(`${m}-${p}`);)p++;const u=`${m}-${p}`;o.push(`ID "${m}" already exists → renamed to "${u}"`),m=u}l.id=m,r.add(m),l.enabled=l.enabled??!1;try{await s.service.saveSkill(l),c=l.id,d++}catch(p){o.push(`${l.name||l.id}: ${p instanceof Error?p.message:String(p)}`)}}s.importing=!1,o.length>0&&g.error(o.join(`
`)),d>0&&g.success(i("skill.toast.imported",{count:d})),c&&(s.selectedId=c),await s.render()}),t.addEventListener("cancel",()=>{t.parentNode&&document.body.removeChild(t)}),t.click()}function it(s){const t=`
        <p style="font-size:.875rem;color:var(--st-text-secondary);margin:0 0 .75rem">
            ${i("dialog.import.hint")}</p>
        <textarea class="settings-textarea" id="import-json" rows="8"
            style="font-family:monospace;font-size:.8125rem"
            placeholder='[{"name":"My Skill","type":"prompt","instructions":"..."}]'></textarea>`;new w(i("skill.import.title"),t,{confirmText:i("dialog.import.action"),onConfirm:async()=>{const e=document.getElementById("import-json")?.value??"";let n;try{const c=e.trimStart().startsWith("---")||/^[a-zA-Z_][\w]*\s*:/m.test(e.trimStart().slice(0,120))?$.load(e):JSON.parse(e);n=Array.isArray(c)?c:[c]}catch{return g.error(i("skill.toast.invalidJson")),!1}s.importing=!0;const a=[];let o=0;for(const r of n){r.id=r.id??`skill-${x()}`,r.enabled=r.enabled??!1;try{await s.service.saveSkill(r),o++}catch(c){a.push(`${r.name||r.id}: ${c instanceof Error?c.message:String(c)}`)}}s.importing=!1,a.length>0&&g.error(a.join(`
`)),o>0&&(g.success(i("skill.toast.imported",{count:o})),s.selectedId=[...n].reverse().find(r=>r.id)?.id??s.selectedId),await s.render()}}).show()}async function nt(s){const t=await s.service.getSkills();z(t,"skills.yaml")}async function at(s){const t=[...s.checkedIds];t.length!==0&&w.confirm(i("dialog.delete.title"),`Delete ${t.length} selected skill${t.length>1?"s":""}?`,async()=>{s.importing=!0;for(const e of t)await s.service.deleteSkill(e).catch(()=>{});s.importing=!1,s.checkedIds=new Set,t.includes(s.selectedId??"")&&(s.selectedId=null),await s.render()})}async function ot(s){const t=new Set(s.checkedIds);if(t.size===0)return;const n=(await s.service.getSkills()).filter(a=>t.has(a.id));z(n,n.length===1?`${n[0].id}.yaml`:"skills-export.yaml")}function z(s,t){const e=$.dump(s,{lineWidth:-1,noRefs:!0}),n=new Blob([e],{type:"text/yaml"}),a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(n),download:t});a.click(),URL.revokeObjectURL(a.href)}async function rt(s){const t={id:`skill-${x()}`,name:"New Skill",type:"prompt",enabled:!1,description:"",instructions:"",tools:[],triggerPatterns:[],autoLoad:!1,priority:50,createdAt:Date.now(),modifiedAt:Date.now()};await s.service.saveSkill(t),s.selectedId=t.id,await s.render()}function lt(s){s.selectedId&&w.confirm(i("dialog.delete.title"),i("skill.confirm.delete"),async()=>{await s.beforeDelete?.(),await s.service.deleteSkill(s.selectedId),s.selectedId=null,g.success(i("skill.toast.deleted")),await s.render()})}async function ct(s){const e=(await s.service.getSkills()).find(o=>o.id===s.selectedId);if(!e)return;if(e.type==="prompt"){g.info(i("skill.toast.testPrompt"));return}if(e.type==="mcp"){g.info(i("skill.toast.testMcp"));return}if(e.type!=="http"){g.error(i("skill.toast.testNotHttp"));return}if(!e.endpoint){g.error(i("skill.toast.testNoEndpoint"));return}const n=s.container.querySelector('[data-action="test"]');if(!n)return;const a=n.innerHTML;n.innerHTML=`<i class="fas fa-spinner fa-spin"></i> ${i("status.testing")}`,n.disabled=!0;try{const o=await fetch(e.endpoint,{method:e.method??"POST",headers:{"Content-Type":"application/json",...e.headers},body:JSON.stringify({})});o.ok?g.success(i("skill.toast.testSuccess",{status:o.status})):g.error(i("skill.toast.testFailed",{status:o.status}))}catch(o){g.error(i("skill.toast.testError",{message:o.message}))}finally{n.innerHTML=a,n.disabled=!1}}class I extends N{selectedId=null;renderedSkill;_importing=!1;_checkedIds=new Set;_formOnly=!1;static createFormOnly(t,e,n){const a=new I(t,e,n??{});return a._formOnly=!0,n&&S(n)&&(a.selectedId=S(n)??null),a}async init(t,e){if(this._formOnly&&e?.trim())try{const n=$.load(e);n?.id&&(this.selectedId=n.id)}catch{}await super.init(t,e)}getText(){return!this._formOnly||!this.renderedSkill?"":$.dump(this.readDraft(),{lineWidth:-1,noRefs:!0})}readDraft(){if(!this.renderedSkill)throw new v(i("settings.autosave.invalid"));return K(this.renderedSkill,t=>this.val(t),t=>this.chk(t))}async saveDraft(){const t=this.renderedSkill,e=structuredClone(this.readDraft()),n=await this.service.getSkills();if(e.id!==t.id&&n.some(o=>o.id===e.id))throw new v(i("settings.autosave.invalid"));await this.service.saveSkill(e),e.id!==t.id&&await this.service.deleteSkill(t.id),this.renderedSkill=e,this.selectedId===t.id&&(this.selectedId=e.id);const a=[...this.container.querySelectorAll("[data-name-for]")].find(o=>o.dataset.nameFor===t.id);a&&!a.querySelector("input")&&(a.textContent=e.name)}buildImporterDeps(){const t=this;return{service:this.service,render:()=>this.render(),get selectedId(){return t.selectedId},set selectedId(e){t.selectedId=e},get importing(){return t._importing},set importing(e){t._importing=e},get checkedIds(){return t._checkedIds},set checkedIds(e){t._checkedIds=e}}}buildOpsDeps(){const t=this;return{service:this.service,beforeDelete:()=>this.discardAutoSave(),container:this.container,render:()=>this.render(),val:e=>this.val(e),chk:e=>this.chk(e),get selectedId(){return t.selectedId},set selectedId(e){t.selectedId=e}}}async render(){if(!await this.prepareRender()||this._importing)return;if(this._formOnly)return this._renderFormOnly();const[t,e]=await Promise.all([this.service.getSkills(),this.service.getMCPServers?.()??Promise.resolve([])]);this.selectedId&&!t.find(a=>a.id===this.selectedId)&&(this.selectedId=null),!this.selectedId&&t.length>0&&(this.selectedId=t[0].id);const n=t.find(a=>a.id===this.selectedId)??null;this.captureRenderedSkill(n),this.container.innerHTML=`
            <div class="settings-split${this.selectedId?" has-detail":""}">
                <div class="settings-split__sidebar">
                    <div class="settings-split__header">
                        <h3 style="margin:0;font-size:.9375rem;font-weight:600">
                            <i class="fas fa-bolt" style="margin-right:.5rem;opacity:.7"></i>Skills
                        </h3>
                        <div class="settings-page__actions">
                            <button class="settings-btn-round" data-action="add"          title="${i("skill.addNew")}"><i class="fas fa-plus"></i></button>
                            <button class="settings-btn-round" data-action="import"       title="${i("skill.import.fileTooltip")}"><i class="fas fa-folder-open"></i></button>
                            <button class="settings-btn-round" data-action="import-paste" title="${i("skill.import.pasteTooltip")}"><i class="fas fa-clipboard"></i></button>
                            <button class="settings-btn-round" data-action="export"       title="${i("skill.exportAll")}"><i class="fas fa-file-export"></i></button>
                        </div>
                    </div>

                    ${this._checkedIds.size>0?`
                    <div style="display:flex;align-items:center;gap:.5rem;padding:.375rem .75rem;
                                background:var(--st-color-primary-bg,#eef2ff);border-bottom:1px solid var(--st-border-color)">
                        <span style="font-size:.8125rem;font-weight:500;flex:1">${this._checkedIds.size} selected</span>
                        <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="batch-export">
                            <i class="fas fa-file-export"></i> Export
                        </button>
                        <button class="settings-btn settings-btn--danger settings-btn--sm" data-action="batch-delete">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                        <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="batch-clear"
                                title="Clear selection" style="padding:.25rem .5rem">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>`:""}
                    <div class="settings-split__list">
                        ${t.length===0?Z():t.map(a=>Q(a,this.selectedId,this._checkedIds)).join("")}
                    </div>
                </div>

                <div class="settings-split__content">
                    <button class="settings-mobile-back" data-action="mobile-back">&#8592; Skills</button>
                    ${n?E(n,e,a=>this.renderEntityHeader(a)):T()}
                </div>
            </div>`,this.bindEvents(e)}bindEvents(t){this.clearListeners();const e=this.buildOpsDeps(),n=this.buildImporterDeps(),a=this.container.querySelector(".settings-split__list");a&&(this.addEventListener(a,"change",p=>{const u=p.target.closest("[data-check-id]");if(!u)return;const y=u.dataset.checkId;u.checked?this._checkedIds.add(y):this._checkedIds.delete(y),this.render()}),this.addEventListener(a,"click",p=>{if(p.target.closest(".settings-inline-rename")||p.target.closest("[data-check-id]"))return;const u=p.target.closest("[data-id]");u&&(this.selectedId=u.dataset.id,this.render())}),this.addEventListener(a,"dblclick",p=>{const u=p.target.closest("[data-name-for]");u&&this._startSkillInlineRename(u,u.dataset.nameFor)})),this.bindAction("mobile-back",()=>{this.selectedId=null,this.render()}),this.bindAction("batch-clear",()=>{this._checkedIds.clear(),this.render()}),this.bindAction("batch-delete",()=>at(n)),this.bindAction("batch-export",()=>ot(n)),this.bindEntityHeaderEvents({onIconSave:async()=>{const p=this.container.querySelector(".settings-split__content")??this.container;_(p)}});const o=this.container.querySelector("#trigger-strategy-select"),r=this.container.querySelector("#disable-invocation-row");o&&r&&this.addEventListener(o,"change",()=>{r.style.display=o.value==="action"?"":"none"}),this.bindAction("add",()=>rt(e)),this.bindAction("import",()=>st(n)),this.bindAction("import-paste",()=>it(n)),this.bindAction("export",()=>nt(n)),this.bindAction("delete",()=>lt(e)),this.bindAction("test",()=>ct(e)),this.renderedSkill&&this.bindAutoSave(this.container.querySelector(".settings-split__content")??this.container,()=>this.saveDraft());const c=this.container.querySelector('[name="type"]');c&&this.addEventListener(c,"change",()=>{const p=c.value,u=(y,k)=>{const P=this.container.querySelector(y);P&&(P.style.display=k?"":"none")};u("#prompt-section",p==="prompt"),u("#shell-section",p==="shell"),u("#mcp-section",p==="mcp"),u("#http-section",p==="http"),u("#params-section",p!=="prompt"&&p!=="mcp")});const d=this.container.querySelector("#mcp-server-select"),l=this.container.querySelector("#mcp-tool-group"),m=this.container.querySelector("#mcp-tool-select");d&&l&&m&&this.addEventListener(d,"change",()=>{const p=d.value;l.style.display=p?"":"none",m.innerHTML=`<option value="">${i("skill.mcp.toolEmpty")}</option>`+H(p,void 0,t)})}_startSkillInlineRename(t,e){this.startInlineRename(t,async n=>{const o=(await this.service.getSkills()).find(r=>r.id===e);o&&await this.service.saveSkill({...o,name:n,modifiedAt:Date.now()})},n=>{if(e!==this.selectedId)return;const a=this.container.querySelector('[name="header-name"]'),o=this.container.querySelector('[name="name"]');a&&(a.value=n,this.resizeHeaderInput(a)),o&&(o.value=n)})}bindAction(t,e){this.container.querySelectorAll(`[data-action="${t}"]`).forEach(n=>this.addEventListener(n,"click",e))}val(t){return this.container.querySelector(`[name="${t}"]`)?.value??""}chk(t){return this.container.querySelector(`[name="${t}"]`)?.checked??!1}captureRenderedSkill(t){this.renderedSkill=t?structuredClone(t):void 0}async _renderFormOnly(){const[t,e]=await Promise.all([this.service.getSkills(),this.service.getMCPServers?.()??Promise.resolve([])]),n=this.selectedId?t.find(a=>a.id===this.selectedId):null;if(this.captureRenderedSkill(n),!n){this.container.innerHTML=T(),this.bindEvents(e);return}this.container.innerHTML=E(n,e,a=>this.renderEntityHeader(a)),this.bindEvents(e)}}function pt(s){return async(t,e)=>{const n=I.createFormOnly(t,s,e);return await n.init(t,e.initialContent??""),n}}function mt(s,t={}){const e={defaultToolIds:[...t.defaultToolIds??[]]};return async(n,a)=>{const o=new Y(n,a,s,e);return await o.init(n,a.initialContent),o}}export{ht as ConnectionSettingsEditor,ft as CostEditor,yt as MCPSettingsEditor,vt as ProviderSettingsEditor,I as SkillSettingsEditor,bt as SystemPromptSettingsEditor,mt as createAgentEditorFactory,pt as createSkillsEditorFactory};
