import{t as s,M as g,S as v,T as f,N as ee,q as $,O as T,P as F,Q as j,R,U as x,V as E,G as b,W as ce,X as te,z as ne,Y as de,Z as pe,$ as P,a0 as ue,a1 as y,a2 as C,a3 as N,a4 as ge}from"./index-Col0Z2Gh.js";import{a5 as ft,a6 as vt,a7 as bt,a8 as yt,a9 as $t}from"./index-Col0Z2Gh.js";import{i as he}from"./image-processing-9Ok0r_gP.js";function me(n){const e=n?.resize?.mode??"inherit";return`<div class="agent-form-row agent-image-settings"><div class="agent-form-grid">
        <label class="agent-form-field"><span class="agent-form-label">${s("agent.inputImage.title")}</span>
        <select class="agent-form-input" name="imageResizeMode" aria-label="${s("agent.inputImage.title")}">
            <option value="inherit" ${e==="inherit"?"selected":""}>${s("image.agentDefault")}</option>
            <option value="original" ${e==="original"?"selected":""}>${s("image.original")}</option>
            <option value="max-edge" ${e==="max-edge"?"selected":""}>${s("image.custom")}</option>
        </select></label>
        <label class="agent-form-field"><span class="agent-form-label">${s("image.maxEdge")}</span>
        <input class="agent-form-input" name="imageMaxEdge" type="number" min="1" max="32768" step="1"
            ${e==="max-edge"?"":"disabled"}
            aria-label="${s("image.maxEdge")}" value="${g(String(n?.resize?.mode==="max-edge"?n.resize.maxEdge:1024))}"></label></div>
        <p class="agent-form-help">${s("agent.inputImage.hint")}</p></div>`}function fe(n){const e=n.querySelector('[name="imageResizeMode"]'),t=n.querySelector('[name="imageMaxEdge"]');e?.addEventListener("change",()=>{t&&(t.disabled=e.value!=="max-edge")})}function ve(n){const e=n.querySelector("[name=imageResizeMode]")?.value;if(!e||e==="inherit")return;const t=e==="original"?{mode:"original"}:{mode:"max-edge",maxEdge:Number(n.querySelector("[name=imageMaxEdge]")?.value)};if(!he(t))throw new v(s("image.invalid"));return{resize:t}}function be(n,e){const t=e&&!n.some(i=>i.id===e);return`<div class="agent-form-row"><label class="agent-form-label" for="system-prompt-preset">${s("prompt.reference")}</label>
        <select class="agent-form-select" id="system-prompt-preset" name="systemPromptId">
            <option value="">${s("prompt.none")}</option>
            ${t?`<option value="${g(e)}" selected>${g(s("prompt.missing",{id:e}))}</option>`:""}
            ${n.map(i=>`<option value="${g(i.id)}" ${i.id===e?"selected":""}>${g(i.name)}</option>`).join("")}
        </select>
        <p class="agent-form-help">${s("prompt.referenceHint")}</p>
        <div class="agent-prompt-reference-actions" data-prompt-actions>
            <button type="button" class="settings-btn settings-btn--secondary settings-btn--sm" data-prompt-edit>${s("prompt.editShared")}</button>
            <button type="button" class="settings-btn settings-btn--secondary settings-btn--sm" data-prompt-copy>${s("prompt.copy")}</button>
        </div>
        <textarea class="agent-form-textarea agent-prompt-preview" data-prompt-preview readonly aria-label="${s("prompt.reference")}"></textarea>
    </div>`}function z(n,e,t,i,a){const o=n.querySelector('[name="systemPromptId"]');if(!o)return;const r=n.querySelector("[data-prompt-preview]"),l=n.querySelector("[data-prompt-edit]"),c=n.querySelector("[data-prompt-copy]"),d=()=>{const u=e.find(p=>p.id===o.value);r.hidden=!o.value,r.value=u?.content.join(`

`)??(o.value?s("prompt.missing",{id:o.value}):""),l.disabled=!u||!i?.navigate,c.disabled=!u};o.addEventListener("change",d),l.addEventListener("click",()=>{Promise.resolve(i?.navigate?.({target:"toolbox",resourceId:"/prompts/"+encodeURIComponent(o.value)})).catch(u=>f.error(String(u)))}),c.addEventListener("click",()=>{c.disabled=!0,ye(o,e,t,a).catch(u=>f.error(String(u))).finally(d)}),d()}async function ye(n,e,t,i){const a=n.value,o=await t.getSystemPrompt(a);if(!o)throw new Error(s("prompt.missing",{id:a}));const r={...structuredClone(o),id:ee(),name:s("prompt.copyName",{name:o.name})};await t.saveSystemPrompt(r),e.push(r),n.add(new Option(r.name,r.id)),n.value===a&&(n.value=r.id,i())}const I=n=>typeof n=="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(n)?n:void 0,L=n=>typeof n=="string"&&/^[a-zA-Z0-9_.:@/-]{1,160}$/.test(n)?n:void 0;function $e(n,e,t,i,a){return{operationId:n,agentId:L(e)??"[invalid-id]",flowId:L(t)??(t?"[invalid-id]":""),requestedRevision:i?/^[1-9]\d{0,8}$/.test(i)?Number(i):"invalid":"latest",flowCount:a}}function A(n,e,t){return Object.assign(new Error(n instanceof Error?n.message:"Flow configuration unavailable",{cause:n}),{failureStage:e,code:t})}function B(n){const e=n;let t=e?.cause??n;const i={};for(let a=0;t&&typeof t=="object"&&a<4;a++){const o=t;I(o.code)&&(i.causeCode=I(o.code)),I(o.remoteCode)&&(i.remoteCode=I(o.remoteCode)),L(o.requestId)&&(i.requestId=L(o.requestId)),["Error","TypeError","RangeError","AbortError","FSError","DOMException"].includes(String(o.name))&&(i.errorName=o.name),["committed","not-committed","unknown"].includes(String(o.outcome))&&(i.outcome=o.outcome),t=o.cause}return{...i,stage:e?.failureStage??"render",code:I(e?.code)??"FLOW_CONFIGURATION_RENDER_FAILED"}}function S(n,e,t,i){const a={operation:"agent.flow.configuration",...e,...i,durationMs:Math.round(performance.now()-t)};i.result==="failure"?console.error(n,a):console.info(n,a)}async function we(n,e,t,i=()=>!0){const[a,o]=await Promise.all([e?n.get(e):void 0,n.targets()]);if(!i())return;if(e&&!a?.connection)throw new Error("HARNESS_CONNECTION_MISSING");const r=a?.connection??{id:$(),name:"",kind:"harness",nodeConnectionId:"",projectId:"",profileId:"",enabled:!0},l=xe(o);new T(s(e?"agent.execution.harnessEdit":"agent.execution.harnessCreate"),Se(r,l),{confirmText:s("action.save"),cancelText:s("action.cancel"),onConfirm:c=>i()?_e(n,c,r,a,l,t):!0}).show()}function xe(n){return n.filter(e=>e.available).flatMap(e=>e.profiles.map(t=>({nodeConnectionId:e.nodeConnectionId,projectId:e.projectId,profileId:t.id,label:`${e.projectName} / ${t.name||t.id}`})))}function Se(n,e){const t=e.findIndex(i=>i.nodeConnectionId===n.nodeConnectionId&&i.projectId===n.projectId&&i.profileId===n.profileId);return`<label class="agent-form-field">${s("agent.execution.harnessName")}<input class="agent-form-input" name="harnessName" value="${g(n.name)}" required></label>
        <label class="agent-form-field">${s("agent.execution.harnessTarget")}<select class="agent-form-select" name="harnessTarget" required>
        <option value="" ${t<0?"selected":""}>${s("agent.execution.harnessTargetRequired")}</option>
        ${e.map((i,a)=>`<option value="${a}" ${a===t?"selected":""}>${g(i.label)}</option>`).join("")}</select></label>
        <label class="agent-form-field"><input type="checkbox" name="harnessEnabled" ${n.enabled!==!1?"checked":""}>${s("agent.execution.harnessEnabled")}</label>
        <p class="agent-form-help">${s("agent.execution.harnessTargetHint")}</p><p class="agent-form-help" data-harness-save-status role="alert"></p>`}async function _e(n,e,t,i,a,o){const r=e.querySelector("[data-harness-save-status]"),l=e.querySelector("[name=harnessName]").value.trim(),c=e.querySelector("[name=harnessTarget]").value,d=c===""?void 0:a[Number(c)];if(!l||!d)return r.textContent=s("agent.execution.harnessFieldsRequired"),!1;const u=$(),p=performance.now();try{return await n.save({...t,name:l,nodeConnectionId:d.nodeConnectionId,projectId:d.projectId,profileId:d.profileId,enabled:e.querySelector("[name=harnessEnabled]").checked},i?.revision??0),console.info("agent.harness.connection.saved",{operation:"harness.connection.save",operationId:u,stage:"persist",result:"success",connectionId:t.id,durationMs:Math.round(performance.now()-p)}),o(t.id),!0}catch{return r.textContent=s("agent.execution.harnessSaveFailed"),console.error("agent.harness.connection.failed",{operation:"harness.connection.save",operationId:u,stage:"persist",result:"failure",code:"HARNESS_CONNECTION_SAVE_FAILED",durationMs:Math.round(performance.now()-p)}),!1}}function Ie(n,e){const t=n.composition,i=e.filter(o=>o.id!==n.id&&!o.composition&&o.execution?.kind!=="flow"),a=new Set(t?.memberAgentIds??[]);for(const o of[t?.coordinatorAgentId,...a])o&&!i.some(r=>r.id===o)&&i.push({id:o,name:s("agent.composition.missing",{id:o})});return`<fieldset class="agent-flow-fields__group" data-agent-composition ${t?"":"hidden disabled"}>
        <label class="agent-form-field"><span class="agent-form-label">${s("agent.composition.coordinator")}</span>
            <select class="agent-form-select" name="compositionCoordinator" required><option value="">${s("agent.composition.chooseCoordinator")}</option>
                ${i.map(o=>`<option value="${g(o.id)}" ${t?.coordinatorAgentId===o.id?"selected":""} ${o.execution?.kind==="harness"?"disabled":""}>${g(o.name)}</option>`).join("")}</select></label>
        <div class="agent-capability-group"><span class="agent-form-label">${s("agent.composition.members")}</span>
            <p class="agent-form-help">${s("agent.composition.membersHint")}</p><div class="agent-mcp-list">
                ${i.map(o=>`<label class="agent-mcp-item"><input type="checkbox" name="compositionMember" value="${g(o.id)}" ${a.has(o.id)?"checked":""}>
                    <span class="agent-mcp-item__info"><span class="agent-mcp-item__name">${g(o.name)}</span><small class="agent-mcp-item__desc">${g(o.description??"")}</small></span></label>`).join("")}
                ${i.length?"":`<p class="agent-form-help">${s("agent.composition.noAgents")}</p>`}</div></div>
        <div class="agent-form-grid"><label class="agent-form-field"><span class="agent-form-label">${s("agent.composition.maxDelegations")}</span>
            <input class="agent-form-input" type="number" name="compositionMaxDelegations" min="1" step="1" value="${t?.maxDelegations??""}" placeholder="${s("flow.settings.runtimeDefault")}"></label>
            <label class="agent-form-field"><span class="agent-form-label">${s("agent.composition.maxConcurrency")}</span>
            <input class="agent-form-input" type="number" name="compositionMaxConcurrency" min="1" step="1" value="${t?.maxConcurrency??""}" placeholder="${s("flow.settings.runtimeDefault")}"></label></div>
        <p class="agent-form-help" data-agent-composition-status role="status"></p>
    </fieldset>`}function ie(n){if(n.querySelector('[name="executionKind"]')?.value!=="composite")return;const e=n.querySelector('[name="compositionCoordinator"]')?.value??"",t=[...n.querySelectorAll('[name="compositionMember"]:checked')].map(a=>a.value);if(!e||n.querySelector("[name=compositionCoordinator]")?.selectedOptions[0]?.disabled)throw new v(s("agent.composition.chooseCoordinator"));if(!t.length)throw new v(s("agent.composition.membersRequired"));if(t.includes(e))throw new v(s("agent.composition.coordinatorInMembers"));const i={coordinatorAgentId:e,memberAgentIds:t};for(const[a,o]of[["maxDelegations","compositionMaxDelegations"],["maxConcurrency","compositionMaxConcurrency"]]){const r=n.querySelector(`[name="${o}"]`)?.value.trim();if(!r)continue;const l=Number(r);if(!Number.isSafeInteger(l)||l<1)throw new v(s("agent.composition.invalidLimit"));i[a]=l}return i}function ke(n){const e=n.querySelector('[name="compositionCoordinator"]'),t=()=>{for(const i of n.querySelectorAll('[name="compositionMember"]')){const a=i.value===e?.value;a&&(i.checked=!1),i.disabled=a}};e?.addEventListener("change",t),t()}const U=n=>g(JSON.stringify(n));function Ee(n,e,t){const i=n.parameters??[],a=Ae(n.connections??[],t),o=j(i,q(e.parameters,"agentFlowParameter:")),r=j(a,{...q(e.connectionBindings,"agentFlowConnection:"),optionLabel:l=>t.find(c=>c.id===l)?.name??s("connection.unavailable",{id:String(l)})});return`<div data-agent-flow-fields-editor data-flow-field-defaults="${U(e)}" data-flow-field-definition="${U({parameters:i,slots:a})}">
        ${V("parameters",o)}${V("connections",r)}
    </div>`}function V(n,e){const t=n==="parameters"?"data-agent-flow-parameters":"data-agent-flow-bindings";return`<fieldset class="agent-flow-fields__group"><legend>${s(`agent.execution.fields.${n}`)}</legend>
        <p class="agent-form-help">${s(`agent.execution.fields.${n}Help`)}</p>
        <div class="agent-form-grid" ${t}>${e||`<p class="agent-form-help">${s(`agent.execution.fields.${n}Empty`)}</p>`}</div>
    </fieldset>`}function q(n,e){return{mode:"defaults",values:n,namePrefix:e,classes:{field:"agent-form-row",label:"agent-form-label",help:"agent-form-help",input:"agent-form-input",select:"agent-form-select",textarea:"agent-form-textarea",wide:"agent-form-row--wide"},labels:{inherit:s("agent.execution.fields.inherit"),on:s("agent.execution.fields.on"),off:s("agent.execution.fields.off"),required:s("agent.execution.fields.requiredAtRun"),unavailableOption:s("agent.execution.fields.unavailableOption"),defaultValue:t=>s("agent.execution.fields.flowDefault",{value:t})},error:Ce}}function Ce(n,e){const t=e.label?.trim()||e.name;if(n==="json")return s("agent.execution.fields.invalidJson",{name:t});if(n==="number")return s("agent.execution.fields.invalidNumber",{name:t});if(n!=="range")return s("agent.execution.fields.invalidValue",{name:t});const i=[e.integer?s("agent.execution.fields.integer"):void 0,e.minimum!==void 0?s("agent.execution.fields.minimum",{value:e.minimum}):void 0,e.maximum!==void 0?s("agent.execution.fields.maximum",{value:e.maximum}):void 0].filter(Boolean).join(" · ");return s("agent.execution.fields.invalidRange",{name:t,constraints:i})}function Ae(n,e){return n.map(t=>({name:t.name,type:"string",widget:"select",required:t.required!==!1,description:[t.description,t.connectionId?s("agent.execution.fields.inheritConnection",{name:e.find(i=>i.id===t.connectionId)?.name??t.connectionId}):void 0].filter(Boolean).join(" · "),options:e.map(i=>i.id)}))}function se(n){const e=n.matches("[data-agent-flow-fields-editor]")?n:n.querySelector("[data-agent-flow-fields-editor]");if(!e)return{parameters:{},connectionBindings:{}};const t=JSON.parse(e.dataset.flowFieldDefaults??"{}"),i=JSON.parse(e.dataset.flowFieldDefinition);try{const a=F(e.querySelector("[data-agent-flow-parameters]"),i.parameters,q()),o=F(e.querySelector("[data-agent-flow-bindings]"),i.slots,q());return{parameters:G(t.parameters,a,i.parameters),connectionBindings:G(t.connectionBindings,o,i.slots)}}catch(a){throw new v(a instanceof Error?a.message:s("agent.execution.fields.invalidValue",{name:""}))}}function G(n={},e,t){const i=Object.assign(Object.create(null),n);return t.forEach(a=>{delete i[a.name]}),Object.assign(i,e)}function Pe(n,e,t=[]){e=e.filter(c=>c.exposure===void 0||c.exposure==="global");const i=n.execution?.kind==="flow"?n.execution:void 0,a=!!n.composition,o=n.execution?.kind==="harness"?n.execution:void 0,r=i?.flowId??e[0]?.id??"",l=[...e];return r&&!l.some(c=>c.id===r)&&l.push({id:r,name:s("agent.execution.missingFlow",{id:r})}),`<section class="agent-section" data-agent-execution data-bound-execution="${g(JSON.stringify(n.execution??{kind:"agent"}))}">
        <button type="button" class="agent-section__header" aria-expanded="true"><span class="agent-section__icon">${R.run}</span><span class="agent-section__title">${s("agent.execution.title")}</span><span class="agent-section__toggle">${x.chevron}</span></button>
        <div class="agent-section__body">
            <label class="agent-form-field">${s("agent.execution.title")}<select class="agent-form-select" name="executionKind"><option value="agent">${s("agent.execution.agent")}</option><option value="composite" ${a?"selected":""}>${s("agent.composition.kind")}</option><option value="flow" ${i&&!a?"selected":""}>${s("agent.execution.flow")}</option><option value="harness" ${o?"selected":""}>${s("agent.execution.harness")}</option></select></label>
            <p class="agent-form-help" data-agent-binding-summary role="status"></p>
            ${Ie(n,t)}
            ${Le(o?.connectionId)}
            <fieldset class="agent-flow-fields__group" data-agent-flow-fields ${i&&!a?"":"hidden disabled"}>
                <div class="agent-form-grid">
                    <label class="agent-form-field">${s("agent.execution.definition")}<select class="agent-form-select" name="executionFlowId" required>${r?"":`<option value="">${s("agent.execution.required")}</option>`}${l.map(c=>`<option value="${g(c.id)}" ${r===c.id?"selected":""}>${g(c.name)}</option>`).join("")}</select></label>
                    <label class="agent-form-field">${s("agent.execution.revision")}<select class="agent-form-select" name="executionRevision">${ae([],i?.revision)}</select></label>
                </div>
                <p class="agent-form-help" data-agent-flow-status role="status"></p>
                <button type="button" class="agent-prompt-btn" data-open-bound-flow hidden>${s("agent.execution.openFlow")}</button>
                <button type="button" class="agent-prompt-btn" data-agent-flow-retry hidden>${s("flow.parameters.retry")}</button>
                <div data-agent-flow-editor></div>
                <p class="agent-form-help">${s("agent.execution.promptHint")}</p>
            </fieldset>
        </div></section>`}function Le(n){return`<fieldset class="agent-flow-fields__group" data-agent-harness-fields ${n?"":"hidden disabled"}>
                <label class="agent-form-field">${s("agent.execution.harnessConnection")}<select class="agent-form-select" name="executionHarnessConnection" required>
                    <option value="">${s("agent.execution.harnessRequired")}</option>${n?`<option selected value="${g(n)}">${g(n)}</option>`:""}
                </select></label><p class="agent-form-help" data-agent-harness-status role="status"></p>
                <button type="button" class="agent-prompt-btn" data-agent-harness-create>${s("agent.execution.harnessCreate")}</button>
                <button type="button" class="agent-prompt-btn" data-agent-harness-edit>${s("agent.execution.harnessEdit")}</button>
                <button type="button" class="agent-prompt-btn" data-agent-harness-retry>${s("flow.parameters.retry")}</button>
            </fieldset>`}function ae(n,e){const t=[...new Set(n.map(a=>a.revision))].sort((a,o)=>o-a),i=e!==void 0&&!t.includes(e)?`<option value="${e}" selected>${g(s("agent.execution.missingRevision",{revision:e}))}</option>`:"";return`<option value="" ${e===void 0?"selected":""}>${s("agent.execution.latest")}</option>${i}${t.map(a=>`<option value="${a}" ${a===e?"selected":""}>v${a}</option>`).join("")}`}function m(n,e){return n.querySelector(`[name="${e}"]`)}function qe(n){if(m(n,"executionKind").value==="harness"){const a=m(n,"executionHarnessConnection").value,o=n.querySelector("[data-agent-execution]");if(o.dataset.harnessState!=="ready")throw new Error(o.dataset.harnessError||s("agent.execution.loading"));if(!a||m(n,"executionHarnessConnection").selectedOptions[0]?.disabled)throw new Error(s("agent.execution.harnessRequired"));return{kind:"harness",connectionId:a}}if(m(n,"executionKind").value==="composite")return ie(n),JSON.parse(n.querySelector("[data-agent-execution]")?.dataset.boundExecution??'{"kind":"agent"}');if(m(n,"executionKind").value!=="flow")return{kind:"agent"};const e=m(n,"executionFlowId").value;if(!e)throw new Error(s("agent.execution.required"));const t=n.querySelector("[data-agent-execution]");if(t.dataset.state!=="ready")throw new Error(t.dataset.error||s("agent.execution.loading"));const i=m(n,"executionRevision").value;return{kind:"flow",flowId:e,revision:i?Number(i):void 0,...se(n)}}function Te(n,e,t,i={}){return new Oe(n,e,t,i)}class Oe{constructor(e,t,i,a){this.root=e,this.flows=i,this.options=a,this.agentId=t.id,this.section=e.querySelector("[data-agent-execution]"),this.fields=e.querySelector("[data-agent-flow-fields]"),this.status=e.querySelector("[data-agent-flow-status]"),t.execution?.kind==="flow"&&this.defaults.set(t.execution.flowId,t.execution);for(const r of["executionKind","executionFlowId","executionRevision","executionHarnessConnection"])m(e,r).addEventListener("change",()=>this.update(!0),{signal:this.lifetime.signal});e.querySelector("[data-agent-flow-retry]").addEventListener("click",()=>{this.catalog.delete(m(e,"executionFlowId").value),this.connections=void 0,this.update(!0)},{signal:this.lifetime.signal});const o=e.querySelector("[data-open-bound-flow]");o.hidden=!a.openFlow,o.addEventListener("click",()=>{this.openFlow(o)},{signal:this.lifetime.signal}),this.bindHarnessManagement(),ke(e),this.update(!1)}generation=0;agentId;disposed=!1;pending;interrupt;interrupted=new Promise(e=>{this.interrupt=e});lifetime=new AbortController;views=new Map;defaults=new Map;catalog=new Map;selections=new Map;activeFlow;connections;section;fields;status;async ready(){for(;this.pending;){const e=this.pending;if(await Promise.race([e,this.interrupted]),this.pending===e)return}}destroy(){this.disposed=!0,this.invalidate(),this.pending=void 0,this.lifetime.abort(),this.views.clear()}invalidate(){return this.interrupt?.(),this.interrupted=new Promise(e=>{this.interrupt=e}),++this.generation}update(e){const t=m(this.root,"executionKind").value==="flow",i=m(this.root,"executionKind").value==="composite",a=this.root.querySelector("[data-agent-composition]");a.hidden=!i,a.disabled=!i,this.summary(),this.fields.hidden=!t,this.fields.disabled=!t;const o=this.invalidate(),r=m(this.root,"executionKind").value==="harness",l=this.root.querySelector("[data-agent-harness-fields]");if(l.hidden=!r,l.disabled=!r,r&&!this.disposed){this.pending=this.loadHarness(o,e);return}if(!t||this.disposed){this.pending=void 0;return}this.capture(),this.pending=this.load(o,e)}bindHarnessManagement(){for(const e of["create","edit"]){const t=this.root.querySelector(`[data-agent-harness-${e}]`);t.hidden=!this.options.harnessConnections,t.addEventListener("click",()=>{this.editHarness(t,e==="edit")},{signal:this.lifetime.signal})}this.root.querySelector("[data-agent-harness-retry]").addEventListener("click",()=>this.update(!1),{signal:this.lifetime.signal})}async editHarness(e,t){const i=this.options.harnessConnections,a=t?m(this.root,"executionHarnessConnection").value:void 0;if(!i||t&&!a)return;const o=this.generation,r=performance.now(),l=$();e.disabled=!0;try{await we(i,a,c=>{if(!this.current(o))return;m(this.root,"executionHarnessConnection").add(new Option(c,c,!0,!0)),this.update(!0)},()=>this.current(o))}catch{this.current(o)&&(this.root.querySelector("[data-agent-harness-status]").textContent=s("agent.execution.harnessUnavailable")),console.error("agent.harness.connection.catalog.failed",{operation:"harness.connection.configure",operationId:l,stage:"targets",result:"failure",code:"HARNESS_TARGETS_UNAVAILABLE",durationMs:Math.round(performance.now()-r)})}finally{this.disposed||(e.disabled=!1)}}async loadHarness(e,t){const i=this.root.querySelector("[data-agent-harness-status]");this.section.dataset.harnessState="loading",i.textContent=s("agent.execution.loading");const a=performance.now(),o=$();try{const r=await this.options.listHarnessConnections?.()??[];if(!this.current(e))return;const l=m(this.root,"executionHarnessConnection"),c=l.value,d=r.map(u=>`<option value="${g(u.id)}" ${u.id===c?"selected":""} ${u.enabled===!1?"disabled":""}>${g(u.name)}</option>`);c&&!r.some(u=>u.id===c)&&d.unshift(`<option value="${g(c)}" selected disabled>${g(c)}</option>`),l.innerHTML=`<option value="">${s("agent.execution.harnessRequired")}</option>${d.join("")}`,this.section.dataset.harnessState="ready",this.section.dataset.harnessError="",i.textContent=s(r.length?"agent.execution.harnessHint":"agent.execution.harnessEmpty"),console.info("agent.harness.configuration.loaded",{operation:"agent.harness.configuration",operationId:o,stage:"catalog",result:"success",count:r.length,durationMs:Math.round(performance.now()-a)}),t&&E(this.root)}catch{if(!this.current(e))return;this.section.dataset.harnessState="error",this.section.dataset.harnessError=s("agent.execution.harnessUnavailable"),i.textContent=this.section.dataset.harnessError,console.error("agent.harness.configuration.failed",{operation:"agent.harness.configuration",operationId:o,stage:"catalog",result:"failure",code:"HARNESS_CATALOG_UNAVAILABLE",durationMs:Math.round(performance.now()-a)})}}capture(){if(!(!this.activeFlow||this.section.dataset.state!=="ready")){this.selections.set(this.activeFlow,m(this.root,"executionRevision").value);try{this.defaults.set(this.activeFlow,se(this.root))}catch{}}}async load(e,t){const i=m(this.root,"executionFlowId").value,a=$(),o=performance.now(),r=this.activeFlow&&this.activeFlow!==i?this.selections.get(i)??"":m(this.root,"executionRevision").value,l=$e(a,this.agentId,i,r,this.flows.length);S("agent.flow.configuration.started",l,o,{stage:"selection",result:"started",catalogCached:this.catalog.has(i),connectionsCached:!!this.connections}),this.setState("loading",s("agent.execution.loading"));try{if(!this.flows.some(d=>d.id===i))throw A(new Error(s(this.flows.length?"agent.execution.required":"agent.execution.noFlows")),"selection",i?"FLOW_NOT_IN_CATALOG":"FLOW_SELECTION_REQUIRED");const c=await this.loadCatalog(i,l);if(!this.current(e))return;this.apply(i,c),S("agent.flow.configuration.loaded",l,o,{stage:"render",result:"success",revisionCount:c.revisions.length,latestRevision:c.latest?.revision??null}),t&&E(this.root)}catch(c){if(!this.current(e))return;this.setState("error",c instanceof Error?c.message:s("agent.execution.unavailable")),S("agent.flow.configuration.failed",l,o,{result:"failure",...B(c)})}}async loadCatalog(e,t){let i=this.catalog.get(e);if(!i){const[a,o]=await Promise.all([this.stage("revisions",t,()=>this.options.listFlowRevisions?.(e)??Promise.resolve([])),this.stage("definition",t,()=>this.options.getFlowRevision?.(e)??Promise.resolve(void 0))]);i={revisions:a,latest:o},this.catalog.set(e,i)}return this.connections??=await this.stage("connections",t,()=>this.options.listConnections?.()??Promise.resolve([])),i}async stage(e,t,i){const a=performance.now();S("agent.flow.configuration.read.started",t,a,{stage:e,result:"started"});try{const o=await i();return S("agent.flow.configuration.read.completed",t,a,{stage:e,result:"success",...Array.isArray(o)?{count:o.length}:{found:o!=null}}),o}catch(o){const r=A(o,e,`FLOW_${e.toUpperCase()}_READ_FAILED`);throw S("agent.flow.configuration.read.failed",t,a,{result:"failure",...B(r)}),r}}apply(e,t){const i=m(this.root,"executionRevision"),a=this.activeFlow&&this.activeFlow!==e?this.selections.get(e)??"":i.value,o=a?Number(a):void 0;i.innerHTML=ae(t.revisions,o);const r=this.options.getFlowRevision?t.latest:[...t.revisions].sort((p,h)=>h.revision-p.revision)[0],l=o===void 0?r:t.revisions.find(p=>p.revision===o);if(o!==void 0&&!l)throw A(new Error(s("agent.execution.missingRevision",{revision:o})),"revision","FLOW_REVISION_UNAVAILABLE");const c=l??this.flows.find(p=>p.id===e);if(c&&c.exposure!==void 0&&c.exposure!=="global")throw A(new Error(s("callable.exposure.rootDenied")),"exposure","FLOW_EXPOSURE_DENIED");const d=JSON.stringify([e,o??"latest"]);let u=this.views.get(d);u||(u=document.createElement("div"),u.innerHTML=Ee(c,this.defaults.get(e)??{},this.connections??[]),this.views.set(d,u)),this.root.querySelector("[data-agent-flow-editor]").replaceChildren(u),this.activeFlow=e,this.setState("ready",l?s("agent.execution.inheritHint"):s("agent.execution.unpublished")),this.summary()}current(e){return!this.disposed&&this.generation===e}syncSaved(e){this.section.dataset.boundExecution=JSON.stringify(e.execution??{kind:"agent"}),this.summary()}async openFlow(e){e.disabled=!0;try{await this.options.openFlow?.(m(this.root,"executionFlowId").value)}catch(t){if(this.disposed)return;this.status.textContent=t instanceof Error?t.message:String(t),this.status.setAttribute("role","alert")}finally{this.disposed||(e.disabled=!1)}}summary(){const e=m(this.root,"executionKind").value,t=m(this.root,"executionRevision").value,i=m(this.root,"executionFlowId").selectedOptions[0]?.textContent??"";this.root.querySelector("[data-agent-binding-summary]").textContent=e==="flow"?s("agent.execution.boundSummary",{name:i,version:t?`v${t}`:"latest"}):s(e==="harness"?"agent.execution.harnessHint":e==="composite"?"agent.composition.hint":"agent.execution.directSummary");const a=this.root.querySelector("[data-agent-composition-status]");if(a&&e==="composite"){const o=JSON.parse(this.section.dataset.boundExecution??"{}");a.textContent=o?.kind==="flow"?s("agent.composition.bound",{version:o.revision??"latest"}):s("agent.composition.pending")}}setState(e,t){this.section.dataset.state=e,this.section.dataset.error=e==="error"?t:"",this.status.textContent=t,this.status.setAttribute("role",e==="error"?"alert":"status"),this.section.setAttribute("aria-busy",String(e==="loading")),this.root.querySelector("[data-agent-flow-retry]").hidden=e!=="error",this.root.querySelector("[data-agent-flow-editor]").hidden=e!=="ready"}}async function He(n,e){const t=performance.now(),i=$();try{const[a,o]=await Promise.all([e.getConnections?.()??[],e.getModelDefaults?.()??{}]),r={connections:a,defaults:o,providers:e.getProviders?.()??[]};return`<section class="agent-section" data-agent-model-defaults>
            <button type="button" class="agent-section__header" aria-expanded="true"><span class="agent-section__icon">${b.llm}</span>
                <span class="agent-section__title">${s("agent.models.title")}</span><span class="agent-section__toggle">${x.chevron}</span></button>
            <div class="agent-section__body"><p class="agent-form-help">${s("agent.models.hint")}</p>
                <div class="agent-form-grid">${ce.map(l=>Re(l,n.modelDefaults?.[l],r)).join("")}</div>
            </div></section>`}catch(a){return console.error("agent.models.read.failed",{operation:"agent.models.read",operationId:i,stage:"catalog",result:"failure",code:"AGENT_MODEL_CATALOG_READ_FAILED",durationMs:Math.round(performance.now()-t)}),`<section class="agent-section" data-agent-model-defaults><div class="agent-section__body"><p class="agent-form-help" role="alert">${g(s("agent.models.loadFailed",{reason:a instanceof Error?a.message:s("agent.execution.unavailable")}))}</p></div></section>`}}function Re(n,e,t){const i=t.connections.filter(l=>te(l,H(t,l),n)),a=t.connections.find(l=>l.id===t.defaults[n]),o=a?J(a,n,t):s("agent.models.systemUnset"),r=e&&!i.some(l=>l.id===e)?`<option value="${g(e)}" selected data-unavailable="true">${g(s("connection.unavailable",{id:e}))}</option>`:"";return`<label class="agent-form-field"><span class="agent-form-label">${s(`modelDefaults.purpose.${n}`)}</span>
        <select class="agent-form-select" name="agentModelDefault:${n}" data-agent-model-operation="${n}">
            <option value="">${g(s("agent.models.inherit",{name:o}))}</option>${r}
            ${i.map(l=>`<option value="${g(l.id)}" ${l.id===e?"selected":""}
                ${l.enabled===!1||H(t,l)?.enabled===!1?'disabled data-unavailable="true"':""}>${g(J(l,n,t))}</option>`).join("")}
        </select></label>`}function H(n,e){return n.providers.find(t=>t.id===e.providerId)}function J(n,e,t){const i=te(n,H(t,n),e);return[n.name,i?.name||i?.id].filter(Boolean).join(" · ")}function Ne(n,e){const t=[...n.querySelectorAll("[data-agent-model-operation]")];if(!t.length)return e;const i={};for(const a of t){const o=a.dataset.agentModelOperation,r=a.selectedOptions[0]?.dataset.unavailable==="true";if(a.setCustomValidity(r?s("agent.models.invalid",{name:s(`modelDefaults.purpose.${o}`)}):""),r)throw new v(a.validationMessage);a.value&&(i[o]=a.value)}return Object.keys(i).length?i:void 0}function Me(n){for(const e of n.querySelectorAll("[data-agent-model-operation]"))e.addEventListener("change",()=>{e.selectedOptions[0]?.dataset.unavailable!=="true"&&e.setCustomValidity("")})}const W=ne("agent-settings");function De(n,e,t){const i=n.querySelector("[data-agent-compact-navigation]"),a=e.mountCompactNavigation?.(i);a&&(n.dataset.editorMobileNavigation="embedded");const o=document.createElement("strong");o.className="agent-mobile-header__title",a||i.append(o);const r=()=>{o.textContent=n.querySelector('[name="name"]')?.value??""};n.addEventListener("input",r),r();const l=typeof matchMedia=="function"?matchMedia("(max-width: 768px)"):void 0,c=new Fe(n,e,t),d=()=>{const u=!!l?.matches,p=n.querySelector("[data-agent-identity]");n.querySelector(u?"[data-agent-identity-slot]":".agent-header").prepend(p),c.move(u)};return l?.addEventListener("change",d),d(),{cancelPendingAction:()=>c.cancel(),destroy(){c.destroy(),a?.(),n.removeEventListener("input",r),l?.removeEventListener("change",d),delete n.dataset.editorMobileNavigation}}}class Fe{constructor(e,t,i){this.root=e,this.options=t,this.flush=i,this.status=e.querySelector("[data-agent-chat-status]"),this.button.type="button",this.button.className="agent-chat-button",this.button.dataset.agentStartChat="",this.label.className="agent-chat-button__label";const a=document.createElement("span");a.className="agent-chat-button__icon",a.innerHTML=R.chat,a.setAttribute("aria-hidden","true"),this.button.append(a,this.label),this.button.onclick=()=>{this.open()},e.addEventListener("change",this.scopeChanged)}scopeChanged=()=>this.update();button=document.createElement("button");label=document.createElement("span");status;busy=!1;mobile=!1;disposed=!1;revision=0;move(e){this.mobile=e,this.options.onStartConversation&&(this.root.querySelector(e?"[data-agent-compact-actions]":"[data-agent-header-actions]").append(this.button),this.update())}update(){this.button.disabled=this.busy||!this.rootAllowed(),this.button.setAttribute("aria-busy",String(this.busy)),this.button.title=s(this.rootAllowed()?this.busy?"agent.layout.openingChat":"agent.layout.startChat":"callable.exposure.rootDenied"),this.button.setAttribute("aria-label",this.button.title),this.label.textContent=s(this.mobile?"agent.layout.chat":this.busy?"agent.layout.openingChat":"agent.layout.startChat")}async open(){if(this.busy||this.disposed||!this.rootAllowed()||this.options.signal?.aborted||!this.options.onStartConversation)return;this.busy=!0,this.status.hidden=!0,this.update();const e=this.revision,t=$(),i=performance.now();let a="save";this.log(t,a,"start",i);try{if(await this.flush(),this.disposed||e!==this.revision||this.options.signal?.aborted){this.log(t,a,"cancelled",i);return}if(!this.rootAllowed())throw a="exposure",Object.assign(new Error(s("callable.exposure.rootDenied")),{code:"CALLABLE_LOCAL_ONLY"});this.log(t,a,"success",i),a="open",await this.options.onStartConversation(),this.log(t,a,"success",i)}catch(o){this.failed(o,t,a,i)}finally{this.busy=!1,this.disposed||this.update()}}rootAllowed(){const e=this.root.querySelector('[name="exposure"]');return!e||e.value==="global"}failed(e,t,i,a){const o=this.root.querySelector('[data-autosave-status][data-state="failed"], [data-autosave-status][data-state="invalid"]'),r=i==="exposure"?"CALLABLE_LOCAL_ONLY":i==="open"?"AGENT_CHAT_OPEN_FAILED":o?.dataset.state==="invalid"?"AGENT_CHAT_VALIDATION_FAILED":"AGENT_CHAT_SAVE_FAILED";this.log(t,i,"failure",a,r),!this.disposed&&(this.status.textContent=(i==="save"?o?.textContent:void 0)||(e instanceof Error?e.message:String(e)),this.status.hidden=!1)}log(e,t,i,a,o){const r={operation:"agent.chat.open",operationId:e,stage:t,result:i,code:o,durationMs:Math.round(performance.now()-a)};i==="failure"?W.error("agent.chat.open",r):W.info("agent.chat.open",r)}cancel(){this.revision++}destroy(){this.disposed=!0,this.cancel(),this.root.removeEventListener("change",this.scopeChanged),this.button.onclick=null,this.button.remove()}}const K=ne("agent-publication");class je{constructor(e,t,i,a,o){this.root=e,this.service=t,this.agentId=i,this.flush=a,this.readOnly=o,e.hidden=!t.publishAgent||!t.getAgentPublicationStatus||!t.getAgentPublicationReceipt,!e.hidden&&(this.publish.type=this.inspect.type="button",this.publish.dataset.agentPublish="",this.inspect.dataset.agentPublicationInspect="",this.status.className="agent-publication__status",this.status.setAttribute("role","status"),this.status.setAttribute("aria-live","polite"),e.append(this.status,this.publish,this.inspect),this.publish.onclick=()=>{this.run()},this.inspect.onclick=()=>{this.refresh()},this.paint(),this.refresh())}publish=document.createElement("button");inspect=document.createElement("button");status=document.createElement("span");pending;active;busy=!1;disposed=!1;observation=0;sent;uncertain=!1;sourceRefreshRequired=!1;get hasPendingWrite(){return!!this.pending&&this.sent===this.pending.operationId}requireSourceReview(){this.sourceRefreshRequired=!0,this.paint()}assertCanClose(){if(this.hasPendingWrite)throw new Error(s("agent.publication.pendingLeave"))}destroy(){this.disposed=!0,this.active=void 0,this.root.replaceChildren()}paint(){this.publish.textContent=s(this.pending?"agent.publication.retry":"agent.publication.publish"),this.publish.disabled=this.disposed||this.readOnly||this.busy||this.sourceRefreshRequired&&!this.pending,this.inspect.textContent=s(this.pending?"agent.publication.reconcile":"agent.publication.refresh"),this.inspect.disabled=this.disposed}async refresh(){const e=this.pending?.operationId??$(),t=Date.now(),i=++this.observation;try{const a=this.pending;if(a)await this.inspectReceipt(a,i);else{const o=await this.service.getAgentPublicationStatus(this.agentId);this.canShowState(i)&&this.showState(o)}this.report(e,"inspect",t)}catch(a){this.currentObservation(i)&&this.failure(e,"inspect",t,a)}finally{this.paint()}}currentObservation(e){return!this.disposed&&e===this.observation}canShowState(e){return this.currentObservation(e)&&!this.pending&&!this.busy}async inspectReceipt(e,t){const i=await this.service.getAgentPublicationReceipt(structuredClone(e));this.disposed||t!==this.observation||this.pending?.operationId!==e.operationId||(i?this.accept(e,i):this.status.textContent=s("agent.publication.unknown"))}async run(){if(!this.available())return;const e=this.pending?.operationId??$(),t=Date.now(),i=this.uncertain;let a="save";this.active=e,this.busy=!0,this.observation++,this.paint();try{const o=await this.preparedRequest(e,c=>{a=c});if(!o)return;a="receipt";const r=await this.service.getAgentPublicationReceipt(o);if(!this.current(e))return;if(r){this.accept(o,r);return}a="publish",this.sent=e;const l=await this.service.publishAgent(o);this.current(e)&&this.accept(o,l),this.report(e,a,t)}catch(o){this.failedRun(e,i,a,t,o)}finally{this.active===e&&(this.busy=!1),this.paint()}}available(){return!this.disposed&&!this.readOnly&&!this.busy}async preparedRequest(e,t){return this.pending||await this.prepare(e,t),this.current(e)&&this.pending?structuredClone(this.pending):void 0}failedRun(e,t,i,a,o){this.current(e)&&(this.sent!==e||!t&&o?.outcome==="not-committed"?this.pending=void 0:this.uncertain=!0,this.failure(e,i,a,o))}async prepare(e,t){if(this.sourceRefreshRequired)throw Object.assign(new Error("Agent source must be reviewed again"),{code:"AGENT_PUBLICATION_EDITOR_STALE"});if(t("save"),await this.flush(),!this.current(e))return;t("prepare");const i=await this.service.getAgentPublicationStatus(this.agentId);this.current(e)&&(this.pending={agentId:this.agentId,operationId:e,expectedSourceDigest:i.sourceDigest,expectedRevisionDigest:i.draftDigest,expectedPublishedVersion:i.latest?.target.version??null})}current(e){return!this.disposed&&this.active===e}accept(e,t){this.pending?.operationId===e.operationId&&(ze(e,t),this.pending=void 0,this.active=void 0,this.sent=void 0,this.uncertain=!1,this.busy=!1,this.observation++,this.status.textContent=s("agent.publication.published",{version:t.target.version.slice(0,16)})+(this.sourceRefreshRequired?` · ${s("agent.publication.reviewRequired")}`:""),this.paint())}showState(e){this.status.textContent=this.sourceRefreshRequired?s("agent.publication.reviewRequired"):s(e.latest?e.hasDraftChanges?"agent.publication.changed":"agent.publication.current":"agent.publication.legacy")}failure(e,t,i,a){this.status.textContent=s("agent.publication.failed",{code:Y(a)}),this.report(e,t,i,a)}report(e,t,i,a){const o={operation:"agent.publish",operationId:e,stage:t,result:a?"failure":"success",code:a?Y(a):void 0,durationMs:Date.now()-i};a?K.warn("Agent publication",o):K.info("Agent publication",o)}}function ze(n,e){if(e?.schemaVersion!==1||e.target?.kind!=="agent"||e.target.id!==n.agentId||e.target.version!==`ap1_${n.expectedRevisionDigest}`||e.target.digest!==n.expectedRevisionDigest||e.sourceDigest!==n.expectedSourceDigest)throw Object.assign(new Error("Publication receipt differs from the frozen request"),{code:"AGENT_PUBLICATION_RECEIPT_INVALID"})}function Y(n){const e=n?.code;return typeof e=="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(e)?e:"AGENT_PUBLICATION_FAILED"}const Be=n=>[...new Set(n.split(/[\s,]+/).filter(Boolean))];function Ue(n,e,t=[]){const i=n.capabilityPolicy,a=new Set(i?.skillIds??[]),o=[...new Set([...t,...e.flatMap(d=>d.tools.map(u=>u.toolId))])],r=new Set(i?.toolIds??t),l=(i?.toolIds??[]).filter(d=>!o.includes(d)),c=new Map(e.map(d=>[d.id,d]));for(const d of a)c.has(d)||c.set(d,{id:d,name:d,tools:[]});return`<div class="agent-section" data-capability-editor>
        <button type="button" class="agent-section__header" aria-expanded="true">
            <span class="agent-section__icon" aria-hidden="true">${b.tool}</span>
            <span class="agent-section__title">${s("agent.capabilities.title")}</span>
            <span class="agent-section__toggle" aria-hidden="true">${x.chevron}</span>
        </button>
        <div class="agent-section__body">
            <label class="agent-default-tools"><input type="checkbox" name="defaultTools" ${i?.toolIds===void 0?"checked":""}> <span>${s("agent.capabilities.defaults")}</span></label>
            <p class="agent-form-help">${s("agent.capabilities.help")}</p>
            <div class="agent-capability-group">
                ${o.length?`<div class="agent-mcp-list">${o.map(d=>`<label class="agent-mcp-item"><input type="checkbox" name="toolGrant" value="${g(d)}" ${r.has(d)?"checked":""}><span class="agent-mcp-item__info agent-tool-id">${g(d)}</span></label>`).join("")}</div>`:""}
                <label class="agent-form-field"><span class="agent-form-label">${s("agent.capabilities.tools")}</span><textarea class="agent-form-input agent-form-code" name="toolIds" rows="3">${g(l.join(`
`))}</textarea></label>
            </div>
            <div class="agent-capability-group">
            <div class="agent-form-label">${s("agent.layout.skills")}</div>
            <p class="agent-form-help">${s("agent.capabilities.skillHelp")}</p>
            <div class="agent-mcp-list">${[...c.values()].map(d=>`<label class="agent-mcp-item">
                <input type="checkbox" name="skillIds" value="${g(d.id)}" ${a.has(d.id)?"checked":""}>
                <span class="agent-mcp-item__info"><span class="agent-mcp-item__name">${g(d.name)}</span><small class="agent-mcp-item__desc agent-tool-id">${g(d.tools.map(u=>u.toolId).join(", "))}</small></span>
            </label>`).join("")}</div>
            ${c.size?"":`<p class="agent-form-help">${s("agent.layout.skillsEmpty")}</p>`}
            </div>
        </div></div>`}function Ve(n,e){if(!n.querySelector("[data-capability-editor]"))return e;const t=n.querySelector('[name="defaultTools"]').checked,i=n.querySelector('[name="toolIds"]').value,a=o=>[...n.querySelectorAll(`[name="${o}"]:checked`)].map(r=>r.value);return{...e,toolIds:t?void 0:[...new Set([...a("toolGrant"),...Be(i)])],skillIds:a("skillIds"),mcpProfileIds:a("mcpServers")}}function Ge(n,e=[]){const t=a=>{const o=a.target,r=n.querySelector('[name="defaultTools"]');(o.name==="toolGrant"||o.name==="toolIds")&&(r.checked=!1),o.name==="defaultTools"&&r.checked&&(n.querySelectorAll('[name="toolGrant"]').forEach(l=>{l.checked=e.includes(l.value)}),n.querySelector('[name="toolIds"]').value="")},i=n.querySelector("[data-capability-editor]");i?.addEventListener("input",t),i?.addEventListener("change",t)}const _=["general","behavior","capabilities","advanced"];class Je{constructor(e,t,i,a={}){this.options=t,this.service=i,this.capabilities=a,this.defaultToolIds=[...new Set(a.defaultToolIds??[])]}defaultToolIds;autoSave;viewId=`agent-config-${$()}`;activePage="general";validationObserver;navigationEvents;executionForm;rendering;promptLibrary=[];container;content=null;_isDirty=!1;editorEvents=new de;originalContent="";currentTitle="";hostSettings;header;publication;async init(e,t){this.container=e,this.container.classList.add("agent-config-editor"),this.originalContent=t||"{}",this.currentTitle=this.options.title||"",this.setText(this.originalContent),await this.rendering,this.emit("ready",void 0)}getText(){return this.content?(this.syncModelFromUI(),JSON.stringify(this.content,null,2)):"{}"}setText(e){if(this.publication?.hasPendingWrite){this.publication.requireSourceReview();return}if(!this.autoSave?.protectsInput)try{const t=JSON.parse(e),i=t.id&&t.id.trim()!==""?t.id:ee(),a=this.normalizeAgentType(t.type);this.content={...t,id:i,name:t.name||"New Agent",type:a,description:t.description||"",icon:t.icon||"🤖",config:{...t.config,systemPrompt:t.config?.systemPrompt??"",mcpServers:t.config?.mcpServers||[],maxHistoryLength:t.config?.maxHistoryLength??-1,temperature:t.config?.temperature},interface:t.interface||{inputs:[],outputs:[]},defaultPrompts:this.normalizePrompts(t.defaultPrompts)},this.rendering=this.render()}catch(t){this.renderError(t.message),this.content=null}}normalizePrompts(e){return Array.isArray(e)?e.filter(t=>!!t&&typeof t=="object").map(t=>({name:typeof t.name=="string"?t.name:"",prompt:typeof t.prompt=="string"?t.prompt:""})):[]}normalizeAgentType(e){switch(e){case"agent":return"agent";case"composite":case"orchestrator":return"composite";case"tool":return"tool";case"workflow":return"workflow";default:return"agent"}}isDirty(){return(this.autoSave?.isDirty??this._isDirty)||!!this.hostSettings?.isDirty()}setDirty(e){this._isDirty=e}async render(){if(this.publication?.assertCanClose(),this.publication?.destroy(),this.publication=void 0,await this.hostSettings?.flush(),this.autoSave&&!await this.autoSave.dispose()||(this.executionForm?.destroy(),this.validationObserver?.disconnect(),this.navigationEvents?.abort(),await this.hostSettings?.destroy(),this.hostSettings=void 0,this.header?.destroy(),this.header=void 0,!this.content))return;const e=this.content,t={...e.config,systemPrompt:e.systemPrompt??e.config.systemPrompt},i=await this.service.listSystemPrompts();this.promptLibrary=i;const a=[...await this.service.getMCPServers()];for(const p of e.capabilityPolicy?.mcpProfileIds??t.mcpServers??[])a.some(h=>h.id===p)||a.push({id:p,name:p,transport:"http",status:"error"});const o=await this.service.getSkills();this.container.innerHTML=`
            <div class="agent-editor-container">
                <div class="agent-mobile-header">
                    <div class="agent-mobile-header__navigation" data-agent-compact-navigation></div>
                    <div class="agent-mobile-header__actions" data-agent-compact-actions></div>
                </div>
                <!-- Header with Icon & Name -->
                <div class="agent-header">
                    <div class="agent-header__identity" data-agent-identity>
                    <button type="button" class="agent-header__icon-picker" id="icon-picker" title="${s("agent.layout.changeIcon")}" aria-label="${s("agent.layout.changeIcon")}">
                        ${this.escapeHtml(e.icon||b.agent)}
                    </button>
                    <div class="agent-header__info">
                        <input type="text" 
                               class="agent-header__name-input" 
                               name="name" 
                               value="${this.escapeHtml(e.name)}" 
                               aria-label="${s("agent.layout.name")}"
                               placeholder="${s("agent.layout.name")}">
                        <textarea class="agent-header__desc-input" 
                                  name="description" 
                                  aria-label="${s("agent.layout.description")}"
                                  placeholder="${s("agent.layout.description")}"
                                  rows="2">${this.escapeHtml(e.description||"")}</textarea>
                    </div>
                    </div>
                    <div class="agent-header__actions" data-agent-header-actions></div>
                </div>
                <p class="agent-chat-status" data-agent-chat-status role="status" aria-live="polite" hidden></p>
                <div class="agent-publication" data-agent-publication></div>

                ${this.renderPageTabs()}
                <div class="agent-editor-panels">
                ${this.renderPageStart("general")}
                <div class="agent-editor-page">
                <div class="agent-basic-identity" data-agent-identity-slot></div>
                <div class="agent-form-row">
                    <label class="agent-form-label" for="agent-exposure">${s("callable.exposure.label")}</label>
                    <select class="agent-form-input" id="agent-exposure" name="exposure">
                        ${e.exposure!==void 0&&!["global","local"].includes(e.exposure)?`<option value="" selected>${s("callable.exposure.invalid")}</option>`:""}
                        <option value="global" ${e.exposure===void 0||e.exposure==="global"?"selected":""}>${s("callable.exposure.global")}</option>
                        <option value="local" ${e.exposure==="local"?"selected":""}>${s("callable.exposure.local")}</option>
                    </select>
                    <p class="agent-form-help">${s("callable.exposure.hint")}</p>
                </div>
                <div data-agent-execution-slot></div>
                <div class="agent-host-settings" data-agent-host-settings></div>

                </div></section>
                ${this.renderPageStart("behavior")}
                <div class="agent-editor-page">
                <div data-agent-model-defaults-slot></div>
                <!-- Agent behavior -->
                <div class="agent-section" id="llm-config-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${b.llm}</span>
                        <span class="agent-section__title">${s("agent.behavior.title")}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${x.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        ${be(i,t.systemPromptId)}
                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-system-prompt">${s("prompt.additional")}</label>
                            <textarea class="agent-form-textarea" 
                                      id="agent-system-prompt"
                                      name="systemPrompt" 
                                      placeholder="You are a helpful assistant...">${this.escapeHtml(t.systemPrompt||"")}</textarea>
                            <p class="agent-form-help">
                                ${s("prompt.additionalHint")}
                            </p>
                        </div>

                        <div class="agent-form-grid">
                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-history-length">${s("agent.layout.history")}</label>
                            <input type="number"
                                   id="agent-history-length"
                                   class="agent-form-input"
                                   name="maxHistoryLength"
                                   value="${t.maxHistoryLength??-1}"
                                   min="-1">
                            <p class="agent-form-help">${s("agent.layout.historyHint")}</p>
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-temperature">${s("agent.layout.temperature")}</label>
                            <input type="number"
                                   id="agent-temperature"
                                   class="agent-form-input"
                                   name="temperature"
                                   value="${t.temperature??""}"
                                   min="0" max="2" step="0.1"
                                   placeholder="${s("agent.layout.temperatureDefault")}">
                            <p class="agent-form-help">
                                ${s("agent.layout.temperatureHint")}
                            </p>
                        </div>
                        </div>
                        ${me(t.imageProcessing)}
                    </div>
                </div>

                <!-- Default Prompts -->
                <div class="agent-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${b.chat}</span>
                        <span class="agent-section__title">${s("agent.layout.presets")}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${x.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        <p class="agent-form-help" style="margin-bottom:12px;">
                            ${s("agent.layout.presetsHint")}
                        </p>
                        <div class="agent-prompt-list" id="prompt-list">
                            ${(e.defaultPrompts||[]).map((p,h)=>this.renderPromptRow(p,h)).join("")}
                        </div>
                    </div>
                </div>

                </div></section>
                ${this.renderPageStart("capabilities")}
                <div class="agent-editor-page agent-editor-page--tools">

                ${Ue(e,o,this.defaultToolIds)}

                <!-- MCP Tools -->
                <div class="agent-section" id="mcp-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${b.mcp}</span>
                        <span class="agent-section__title">${s("agent.layout.mcp")}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${x.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        ${a.length===0?`<div class="agent-empty-state">
                                    <div class="agent-empty-state__icon" aria-hidden="true">${b.mcp}</div>
                                    <p>${s("agent.layout.mcpEmpty")}</p>
                                    <p class="agent-form-help">${s("agent.layout.mcpEmptyHint")}</p>
                               </div>`:`<p class="agent-form-help" style="margin-bottom:12px;">
                                    ${s("agent.layout.mcpHint")}
                               </p>
                               <div class="agent-mcp-list">
                                    ${a.map(p=>`
                                        <label class="agent-mcp-item">
                                            <input type="checkbox" 
                                                   name="mcpServers" 
                                                   value="${this.escapeHtml(p.id)}"
                                                   ${(e.capabilityPolicy?.mcpProfileIds??t.mcpServers??[]).includes(p.id)?"checked":""}>
                                            <div class="agent-mcp-item__info">
                                                <div class="agent-mcp-item__name">
                                                    ${this.escapeHtml(p.icon||b.mcp)} ${this.escapeHtml(p.name)}
                                                </div>
                                                <div class="agent-mcp-item__desc">
                                                    ${this.escapeHtml(p.description||s("agent.layout.noDescription"))}
                                                </div>
                                            </div>
                                            <span class="agent-mcp-item__status ${p.status==="connected"?"connected":""}">
                                                ${s(p.status==="connected"?"agent.layout.connected":"agent.layout.disconnected")}
                                            </span>
                                        </label>
                                    `).join("")}
                               </div>`}
                    </div>
                </div>

                </div></section>
                ${this.renderPageStart("advanced")}
                <div class="agent-editor-page">
                ${this.renderAgentType(e.type)}
                <!-- Advanced Settings -->
                <div class="agent-section">
                    <button type="button" class="agent-section__header" aria-expanded="true">
                        <span class="agent-section__icon" aria-hidden="true">${R.settings}</span>
                        <span class="agent-section__title">${s("agent.layout.advanced")}</span>
                        <span class="agent-section__toggle" aria-hidden="true">${x.chevron}</span>
                    </button>
                    <div class="agent-section__body">
                        <div class="agent-form-row">
                            <label class="agent-form-label" for="agent-id">Agent ID</label>
                            <input type="text" 
                                   class="agent-form-input" 
                                   id="agent-id"
                                   name="id" 
                                   value="${this.escapeHtml(e.id)}" 
                                   readonly>
                            <p class="agent-form-help">${s("agent.layout.idHint")}</p>
                        </div>
                    </div>
                </div>

                </div></section>
                </div>
                <!-- Hidden field for icon -->
                <input type="hidden" name="icon" value="${this.escapeHtml(e.icon||b.agent)}">
            </div>
        `;const r=await this.capabilities.listFlows?.()??[],l=await this.service.getAgents?.()??[],c=document.createElement("div");if(c.innerHTML=Pe(e,r,l),this.container.querySelector("[data-agent-execution-slot]").replaceWith(c),this.container.querySelector("[data-agent-model-defaults-slot]").innerHTML=await He(e,this.service),Me(this.container),this.options.mountSettings){const p=this.container.querySelector("[data-agent-host-settings]");this.hostSettings=await this.options.mountSettings(p)}const d=this.service,u=d.getHarnessConnectionRecord&&d.getHarnessConnectionTargets&&d.saveHarnessConnection?{get:d.getHarnessConnectionRecord.bind(d),targets:d.getHarnessConnectionTargets.bind(d),save:d.saveHarnessConnection.bind(d)}:void 0;this.executionForm=Te(this.container,e,r,{...this.capabilities,harnessConnections:this.capabilities.harnessConnections??u,listHarnessConnections:this.capabilities.listHarnessConnections??(()=>this.service.getHarnessConnections?.()??Promise.resolve([]))}),await this.executionForm.ready(),this.bindEvents(),this.activatePage(this.activePage),this.header=De(this.container,this.options,()=>this.flushPendingSave()),this.publication=new je(this.container.querySelector("[data-agent-publication]"),this.service,e.id,()=>this.flushPendingSave(),!!this.options.readOnly)}renderPageTabs(){return`<nav class="agent-editor-tabs" role="tablist" aria-label="${s("agent.layout.pages")}">
            ${_.map(e=>`<button type="button" class="agent-editor-tab" role="tab"
                id="${this.viewId}-tab-${e}" aria-controls="${this.viewId}-panel-${e}"
                data-agent-page-link="${e}" aria-selected="${this.activePage===e}"
                tabindex="${this.activePage===e?0:-1}">${s(`agent.layout.page.${e}`)}</button>`).join("")}
        </nav>`}renderPageStart(e){return`<section class="agent-editor-panel" role="tabpanel" tabindex="0"
            id="${this.viewId}-panel-${e}" aria-labelledby="${this.viewId}-tab-${e}"
            data-agent-page="${e}" ${e===this.activePage?"":"hidden"}>`}activatePage(e,t=!1){this.activePage=e,this.container.querySelectorAll("[data-agent-page-link]").forEach(i=>{const a=i.dataset.agentPageLink===e;i.setAttribute("aria-selected",String(a)),i.tabIndex=a?0:-1,a&&t&&(i.focus(),i.scrollIntoView?.({block:"nearest",inline:"nearest"}))}),this.container.querySelectorAll("[data-agent-page]").forEach(i=>{i.hidden=i.dataset.agentPage!==e})}bindPageNavigation(){this.navigationEvents=new AbortController,this.container.addEventListener("focusout",t=>{const i=t.relatedTarget;i instanceof HTMLElement&&i.closest(".agent-editor-tabs")&&t.stopImmediatePropagation()},{capture:!0,signal:this.navigationEvents.signal});const e=this.container.querySelector("[role=tablist]");e.addEventListener("click",t=>{const i=t.target.closest("[data-agent-page-link]");i&&this.activatePage(i.dataset.agentPageLink)}),e.addEventListener("keydown",t=>{const i=t.target.closest("[data-agent-page-link]");if(!i||!["ArrowLeft","ArrowRight","Home","End"].includes(t.key))return;t.preventDefault();const a=_.indexOf(i.dataset.agentPageLink),o=t.key==="Home"?0:t.key==="End"?_.length-1:(a+(t.key==="ArrowRight"?1:-1)+_.length)%_.length;this.activatePage(_[o],!0)})}bindSectionNavigation(){this.container.querySelectorAll(".agent-section__header").forEach(e=>{e.addEventListener("click",()=>{const t=e.closest(".agent-section");t?.classList.toggle("collapsed"),e.setAttribute("aria-expanded",String(!t?.classList.contains("collapsed")))})})}observeValidation(){const e=this.container.querySelector("[data-autosave-status]");this.validationObserver=new MutationObserver(()=>{if(e.dataset.state!=="invalid")return;const t=this.container.querySelector("input:invalid, select:invalid, textarea:invalid");t&&this.revealField(t)}),this.validationObserver.observe(e,{attributes:!0,attributeFilter:["data-state"]})}revealField(e){const t=e.closest("[data-agent-page]");t&&this.activatePage(t.dataset.agentPage);const i=e.closest(".agent-section.collapsed");i?.classList.remove("collapsed"),i?.querySelector(".agent-section__header")?.setAttribute("aria-expanded","true"),document.activeElement!==e&&e.focus(),e.scrollIntoView?.({block:"nearest"})}readDraftField(e,t){try{return t()}catch(i){const a=this.container.querySelector(e);throw a&&this.revealField(a),i}}async flushHostSettings(){try{await this.hostSettings?.flush()}catch(e){const t=this.container.querySelector("[data-agent-host-settings] input:invalid, [data-agent-host-settings] select:invalid, [data-agent-host-settings] select");throw t&&this.revealField(t),e}}renderAgentType(e){return`<section class="agent-section">
            <button type="button" class="agent-section__header" aria-expanded="true">
                <span class="agent-section__icon" aria-hidden="true">${b.agent}</span>
                <span class="agent-section__title">${s("agent.layout.type")}</span>
                <span class="agent-section__toggle" aria-hidden="true">${x.chevron}</span>
            </button>
            <div class="agent-section__body">
                <p class="agent-form-help agent-type-help">${s("agent.layout.typeHint")}</p>
                <input class="agent-form-input" data-agent-type-metadata value="${this.escapeHtml(e)}" readonly>
            </div>
        </section>`}renderPromptRow(e,t){return`
            <div class="agent-prompt-item" data-index="${t}">
                <div class="agent-prompt-item__head">
                    <input type="text"
                           class="agent-form-input agent-prompt-name"
                           placeholder="名称（如：代码审查）"
                           value="${this.escapeHtml(e.name)}">
                    <div class="agent-prompt-actions">
                        <button type="button" class="agent-prompt-btn" data-action="up" title="上移">▲</button>
                        <button type="button" class="agent-prompt-btn" data-action="down" title="下移">▼</button>
                        <button type="button" class="agent-prompt-btn agent-prompt-btn--danger" data-action="remove" title="删除">✕</button>
                    </div>
                </div>
                <textarea class="agent-form-textarea agent-prompt-text"
                          rows="2"
                          placeholder="提示词内容...">${this.escapeHtml(e.prompt)}</textarea>
            </div>
        `}renderError(e){this.container.innerHTML=`
            <div class="agent-editor-container">
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">⚠️</div>
                    <h3 style="margin-bottom: 8px;">配置解析失败</h3>
                    <p style="color: #6b7280; font-size: 0.9rem;">${this.escapeHtml(e)}</p>
                    <pre style="margin-top: 16px; padding: 16px; background: #fef2f2; border-radius: 8px; text-align: left; overflow: auto; font-size: 0.8rem;">${this.escapeHtml(this.originalContent)}</pre>
                </div>
            </div>
        `}bindEvents(){if(this.bindPageNavigation(),this.bindSectionNavigation(),this.options.readOnly){z(this.container,this.promptLibrary,this.service,this.options.hostContext,()=>{}),this.container.querySelectorAll('input, select, textarea, button:not([role="tab"]):not(.agent-section__header)').forEach(r=>{r.disabled=!0});return}Ge(this.container,this.defaultToolIds),fe(this.container);const e=()=>{this._isDirty=!0,E(this.container)};this.autoSave=new pe(this.container,()=>this.saveDraft(),this.container.querySelector(".agent-header__info")??void 0),this.observeValidation(),z(this.container,this.promptLibrary,this.service,this.options.hostContext,e);const t=this.container.querySelector(".agent-header__name-input"),i=this.options.files?.fs,a=P(this.options);if(t&&i&&a){const r=this.options.language||"",l=async()=>{const c=t.value.trim();if(!c||c===this.currentTitle)return;const{filename:d}=ue(c,this.currentTitle+r);try{await i.driver.rename(a,d),this.currentTitle=c}catch{t.value=this.currentTitle}};t.addEventListener("blur",l),t.addEventListener("keydown",c=>{c.key==="Enter"&&(c.preventDefault(),t.blur()),c.key==="Escape"&&(t.value=this.currentTitle,t.blur())})}const o=this.container.querySelector("#icon-picker");o&&o.addEventListener("click",()=>this.showIconPicker()),this.bindPromptEvents(e)}bindPromptEvents(e){const t=this.container.querySelector("#prompt-list");this.container.querySelector("#prompt-add")?.addEventListener("click",()=>{this.collectPromptsToContent(),this.content?.defaultPrompts?.push({name:"",prompt:""}),this.content&&!this.content.defaultPrompts&&(this.content.defaultPrompts=[{name:"",prompt:""}]),this.rerenderPromptList(),e()}),t?.addEventListener("click",a=>{const o=a.target.closest(".agent-prompt-btn");if(!o)return;const r=o.closest(".agent-prompt-item"),l=parseInt(r?.dataset.index??"-1",10);if(l<0)return;this.collectPromptsToContent();const c=this.content?.defaultPrompts;if(!c)return;const d=o.dataset.action;if(d==="remove")c.splice(l,1);else if(d==="up"&&l>0)[c[l-1],c[l]]=[c[l],c[l-1]];else if(d==="down"&&l<c.length-1)[c[l+1],c[l]]=[c[l],c[l+1]];else return;this.rerenderPromptList(),e()}),t?.addEventListener("input",a=>{const o=a.target;(o.classList.contains("agent-prompt-name")||o.classList.contains("agent-prompt-text"))&&e()})}rerenderPromptList(){const e=this.container.querySelector("#prompt-list");if(!e)return;const t=this.content?.defaultPrompts??[];e.innerHTML=t.map((i,a)=>this.renderPromptRow(i,a)).join("")}collectPromptsToContent(){if(!this.content)return;const e=Array.from(this.container.querySelectorAll(".agent-prompt-item"));this.content.defaultPrompts=e.map(t=>({name:t.querySelector(".agent-prompt-name")?.value??"",prompt:t.querySelector(".agent-prompt-text")?.value??""}))}showIconPicker(){const e=["🤖",b.llm,"💡","🎯","🚀","⚡","🔥","✨","🎨","📝","📊","📈","🔍","🔧","⚙️","🛠️","💻","🖥️","📱","🌐","☁️","🔒","🔑","📡","🎭","🎪","🎬","🎮","🎲","🃏","🎵","🎸","📚","📖","✏️","🖊️","📌","📎","🗂️","📁","💬","💭","🗨️","👤","👥","🤝","👋","✋","🌟","⭐","🌙","☀️","🌈","🍀","🌸","🌺","🦾","🦿","🕸️","💎","🏆","🎖️","🥇"],t=document.createElement("div");t.className="icon-picker-overlay",t.innerHTML=`
            <div class="icon-picker-modal">
                <h3 style="margin: 0 0 16px 0; font-size: 1.1rem;">选择图标</h3>
                <div class="icon-picker-grid">
                    ${e.map(i=>`
                        <div class="icon-picker-item" data-icon="${i}">${i}</div>
                    `).join("")}
                </div>
                <div style="margin-top: 16px; text-align: right;">
                    <button class="icon-picker-cancel" style="padding: 8px 16px; border: none; background: #e5e7eb; border-radius: 6px; cursor: pointer;">取消</button>
                </div>
            </div>
        `,t.querySelectorAll(".icon-picker-item").forEach(i=>{i.addEventListener("click",()=>{const a=i.dataset.icon;if(a){const o=this.container.querySelector("#icon-picker");o&&(o.textContent=a);const r=this.container.querySelector('input[name="icon"]');r&&(r.value=a),this._isDirty=!0,E(this.container)}t.remove()})}),t.querySelector(".icon-picker-cancel")?.addEventListener("click",()=>t.remove()),t.addEventListener("click",i=>{i.target===t&&t.remove()}),document.body.appendChild(t)}syncModelFromUI(){if(!this.content||!this.container.querySelector('[name="name"]'))return;const e=a=>this.container.querySelector(`[name="${a}"]`)?.value||"";this.content.name=e("name"),this.content.icon=e("icon"),this.content.description=e("description");const t=e("exposure");if(t!=="global"&&t!=="local")throw new v(s("callable.exposure.invalid"));this.content.exposure=t,this.content.execution=this.readDraftField("[name=executionKind]",()=>qe(this.container)),this.content.composition=this.readDraftField("[name=compositionCoordinator]",()=>ie(this.container)),this.content.composition&&(this.content.type="composite"),this.content.modelDefaults=this.readDraftField("[data-agent-model-operation]",()=>Ne(this.container,this.content?.modelDefaults)),this.collectPromptsToContent(),this.content.defaultPrompts=(this.content.defaultPrompts??[]).filter(a=>a.name.trim()!==""||a.prompt.trim()!=="");const i=parseFloat(e("temperature"));this.content.config={...this.content.config,imageProcessing:this.readDraftField("[name=imageMaxEdge]",()=>ve(this.container)),systemPromptId:e("systemPromptId")||void 0,systemPrompt:e("systemPrompt"),maxHistoryLength:Number.isNaN(Number.parseInt(e("maxHistoryLength")))?-1:Number.parseInt(e("maxHistoryLength")),mcpServers:void 0,temperature:isNaN(i)?void 0:i},this.content.capabilityPolicy=Ve(this.container,this.content.capabilityPolicy),this.content.systemPrompt!==void 0&&(this.content.systemPrompt=this.content.config.systemPrompt)}async saveDraft(){if(await this.executionForm?.ready(),!this.container.querySelector('[name="name"]')?.value.trim())throw this.revealField(this.container.querySelector("[name=name]")),new v(s("settings.autosave.invalid"));this.syncModelFromUI();const t=structuredClone(this.content),i=this.options.hostContext?.saveContent,a=P(this.options),o=this.options.target?.kind!=="file"||!!this.service.getAgentResourceId?.(t.id);if(this.service.saveAgent&&o){await this.service.saveAgent(t);const r=await this.service.getAgentConfig?.(t.id);r&&this.content&&(this.content.execution=r.execution,this.executionForm?.syncSaved(r))}else i&&a?await i(a,JSON.stringify(t,null,2)):await this.service.saveAgent(t);this._isDirty=!1,this.emit("saved",void 0)}escapeHtml(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async flushPendingSave(){if(await this.flushHostSettings(),this.autoSave&&!await this.autoSave.flush())throw new Error(s("settings.autosave.leaveFailed"))}cancelPendingRender(){this.header?.cancelPendingAction()}async destroy(){if(this.publication?.assertCanClose(),this.publication?.destroy(),this.publication=void 0,this.header?.cancelPendingAction(),await this.flushHostSettings(),this.autoSave&&!await this.autoSave.dispose())throw new Error(s("settings.autosave.leaveFailed"));this.executionForm?.destroy(),this.validationObserver?.disconnect(),this.navigationEvents?.abort(),await this.hostSettings?.destroy(),this.hostSettings=void 0,this.header?.destroy(),this.header=void 0,delete this.container.dataset.editorMobileNavigation,this.container.innerHTML="",this.editorEvents.clear()}getMode(){return"edit"}async switchToMode(e){}setTitle(e){}setReadOnly(e){}focus(){this.container.querySelector(".agent-header__name-input")?.focus()}get commands(){return{}}async getHeadings(){return[]}async getSearchableText(){return JSON.stringify(this.content||{})}async getSummary(){return this.content?.description||null}async navigateTo(){}async search(){return[]}gotoMatch(){}clearSearch(){}async collapseBlocks(){return{affectedCount:0,allCollapsed:!0}}async expandBlocks(){return{affectedCount:0,allCollapsed:!1}}async toggleBlocks(){return this.collapseBlocks()}async pruneAssets(){return null}on(e,t){return this.editorEvents.on(e,i=>t(i))}emit(e,t){this.editorEvents.emit(e,t)}}function We(n,e){const t=n("correctionLog").trim();return{fsRoot:n("fsRoot").trim()||void 0,referencePaths:n("referencePaths").split(`
`).map(i=>i.trim()).filter(Boolean),templatePath:n("templatePath").trim()||void 0,correctionLog:t?{path:t,root:n("correctionRoot").trim()||void 0,enabled:e("correctionEnabled")}:void 0}}function Z(n,e){if(n.trim())try{const t=JSON.parse(n);if(!t||typeof t!="object"||Array.isArray(t))throw new Error(e);return t}catch{throw new v(e)}}function Ke(n,e){const t=n==="http",i=t?Z(e("headers"),s("skill.toast.invalidHeaders")):void 0;if(i&&Object.values(i).some(o=>typeof o!="string"))throw new v(s("skill.toast.invalidHeaders"));const a=e("auth-header").trim();return{instructions:n==="prompt"?e("instructions"):"",command:n==="shell"&&e("command")||void 0,mcpServerId:n==="mcp"&&e("mcpServerId")||void 0,mcpToolName:n==="mcp"&&e("mcpToolName")||void 0,endpoint:t&&e("endpoint")||void 0,method:t?e("method")||"POST":void 0,headers:t?{...i,...a?{Authorization:a}:{}}:void 0,parameters:["prompt","mcp"].includes(n)?void 0:Z(e("parameters"),s("skill.toast.invalidParams"))}}function Ye(n,e,t){const i=e("header-name").trim();if(!i)throw new v(s("settings.autosave.invalid"));const a=e("type"),o=e("globs").split(`
`).map(l=>l.trim()).filter(Boolean),r=Number(e("priority")||"50");if(!Number.isFinite(r))throw new v(s("settings.autosave.invalid"));return{...n,id:e("id").trim()||n.id,name:i,type:a,icon:e("header-icon")||void 0,description:e("description"),enabled:t("enabled"),...Ke(a,e),triggerStrategy:e("triggerStrategy")||"reference",autoLoad:t("autoLoad"),priority:r,globs:o.length?o:void 0,...We(e,t),disableModelInvocation:t("disableModelInvocation")||void 0,modifiedAt:Date.now()}}const k=n=>n.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");function Ze(n){const e=y[n]??y.custom,t=s(`skillType.${n}`);return`<span class="settings-badge" style="background:${e.color}15;color:${e.color};
                border:1px solid ${e.color}30;font-size:.75rem">
                ${e.icon} ${t}
            </span>`}function oe(n){return n?`<span class="settings-badge settings-badge--success">${s("status.enabled")}</span>`:`<span class="settings-badge" style="color:var(--st-text-tertiary)">${s("status.disabled")}</span>`}function Xe(){return`
        <div class="settings-empty settings-empty--mini">
            <div class="settings-empty__icon" style="font-size:2rem">${b.skill}</div>
            <p style="margin:.5rem 0">${s("skill.empty.text")}</p>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                <button class="settings-btn settings-btn--primary settings-btn--sm" data-action="add">
                    <i class="fas fa-plus"></i> ${s("skill.empty.action")}
                </button>
                <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="import">
                    <i class="fas fa-folder-open"></i> ${s("skill.import.fileLabel")}
                </button>
            </div>
        </div>`}function Qe(n,e,t){const i=n.id===e,a=t.has(n.id),o=y[n.type]??y.custom,r=s(`skillType.${n.type}`);return`
        <div class="settings-list-item ${i?"selected":""}" data-id="${n.id}" style="cursor:pointer">
            <input type="checkbox" class="settings-list-item__check" data-check-id="${n.id}"
                   ${a?"checked":""}
                   style="flex-shrink:0;margin:0;cursor:pointer;accent-color:var(--st-color-primary,#6366f1)"
                   title="Select for batch action"
                   onclick="event.stopPropagation()">
            <span class="settings-list-item__icon" style="font-size:1.25rem">${n.icon||o.icon}</span>
            <div class="settings-list-item__info" style="min-width:0">
                <div class="settings-list-item__title" data-name-for="${n.id}"
                     title="${s("tooltip.dblClickRename")}" style="cursor:text">${n.name}</div>
                <div class="settings-list-item__desc">${r}${n.endpoint?" · "+tt(n.endpoint):""}</div>
                <div style="font-family:monospace;font-size:.7rem;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.id}</div>
            </div>
            ${oe(n.enabled)}
        </div>`}function X(){return`
        <div class="settings-empty" style="height:100%;justify-content:center">
            <div class="settings-empty__icon">${b.skill}</div>
            <div class="settings-empty__title">${s("skill.select.title")}</div>
            <p style="color:var(--st-text-tertiary);font-size:.875rem;text-align:center;max-width:280px">
                ${s("skill.select.desc")}
            </p>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                <button class="settings-btn settings-btn--primary" data-action="add">
                    <i class="fas fa-plus"></i> ${s("skill.select.action")}
                </button>
                <button class="settings-btn settings-btn--secondary" data-action="import">
                    <i class="fas fa-folder-open"></i> ${s("skill.import.fileLabel")}
                </button>
            </div>
        </div>`}function re(n,e,t){if(!n)return"";const a=t.find(o=>o.id===n)?.tools??[];return a.length===0?`<option value="" disabled>${s("skill.hint.noMcpTools")}</option>`:a.map(o=>`<option value="${o.name}" ${e===o.name?"selected":""}>${o.name}${o.description?" — "+o.description:""}</option>`).join("")}function et(n){if(!n)return"";const{Authorization:e,...t}=n;return Object.keys(t).length?JSON.stringify(t,null,2):""}function tt(n){try{return new URL(n).hostname}catch{return n.slice(0,20)}}function Q(n,e,t){const i=y[n.type]??y.custom,a=n.type==="http",o=n.type==="shell",r=n.type==="prompt",l=n.type==="mcp",c=n.parameters?JSON.stringify(n.parameters,null,2):"";return`
        <!-- ── Header ── -->
        ${t({icon:n.icon||"",fallbackIcon:i.icon,editableIcon:!0,name:n.name,namePlaceholder:s("skill.placeholder.name"),badges:`${Ze(n.type)} ${oe(n.enabled)}`,subtitle:n.description||s("status.noDesc"),actions:`
                ${a?`
                <button class="settings-btn settings-btn--secondary" data-action="test" title="${s("tooltip.testConnection")}">
                    <i class="fas fa-vial"></i> ${s("action.test")}
                </button>`:""}

                <button class="settings-btn settings-btn--danger" data-action="delete" title="${s("action.delete")}">
                    <i class="fas fa-trash"></i>
                </button>`})}

        <!-- ── Scrollable body ── -->
        <div style="overflow-y:auto;padding:1.25rem 1.75rem 2rem">

            <!-- Basic Info -->
            <div class="settings-section">
                <h3 class="settings-section__title">${s("skill.section.basic")}</h3>
                <div class="settings-form-group">
                    <label>ID <span style="color:var(--st-text-tertiary);font-size:.8em">lowercase letters, numbers, hyphens</span></label>
                    <input class="settings-input" name="id" data-autosave-defer value="${n.id}"
                           placeholder="my-skill-id"
                           style="font-family:monospace;font-size:.875rem"
                           pattern="[a-z0-9][a-z0-9_-]*" title="Lowercase letters, numbers, hyphens">
                </div>
                <div class="settings-form-group">
                    <label>${s("form.description")}</label>
                    <textarea class="settings-textarea" name="description" rows="2"
                        placeholder="${s("skill.placeholder.desc")}">${n.description||""}</textarea>
                </div>
                <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:end">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${s("form.type")}</label>
                        <select class="settings-select" name="type">
                            <option value="prompt"  ${n.type==="prompt"?"selected":""}>${y.prompt.icon} Prompt — ${s("skillType.prompt.desc")}</option>
                            <option value="shell"   ${n.type==="shell"?"selected":""}>${y.shell.icon} Shell — ${s("skillType.shell.desc")}</option>
                            <option value="mcp"     ${n.type==="mcp"?"selected":""}>${y.mcp.icon} MCP — ${s("skillType.mcp.desc")}</option>
                            <option value="http"    ${n.type==="http"?"selected":""}>${y.http.icon} HTTP — ${s("skillType.http.desc")}</option>
                            <option value="builtin" ${n.type==="builtin"?"selected":""}>${y.builtin.icon} Builtin — ${s("skillType.builtin.desc")}</option>
                            <option value="custom"  ${n.type==="custom"?"selected":""}>${y.custom.icon} Custom — ${s("skillType.custom.desc")}</option>
                        </select>
                    </div>
                    <div class="settings-checkbox-row" style="padding-bottom:.5rem;white-space:nowrap">
                        <input type="checkbox" id="skill-enabled" name="enabled" ${n.enabled?"checked":""}>
                        <label for="skill-enabled">${s("skill.enabled.label")}</label>
                    </div>
                </div>
            </div>

            <!-- Trigger & Auto-load -->
            <div class="settings-section">
                <h3 class="settings-section__title">${s("skill.section.trigger")}</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${s("skill.trigger.strategyLabel")}</label>
                        <select class="settings-select" name="triggerStrategy" id="trigger-strategy-select">
                            <option value="reference" ${(n.triggerStrategy??"reference")==="reference"?"selected":""}>
                                📖 Reference — ${s("skill.trigger.reference.desc")}
                            </option>
                            <option value="action" ${n.triggerStrategy==="action"?"selected":""}>
                                ⚡ Action — ${s("skill.trigger.action.desc")}
                            </option>
                        </select>
                    </div>
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${s("skill.trigger.priorityLabel")}
                            <span style="color:var(--st-text-tertiary);font-size:.8em">${s("skill.trigger.priorityHint")}</span>
                        </label>
                        <input class="settings-input" type="number" name="priority"
                               value="${n.priority??50}" min="0" max="100" step="5"
                               style="font-variant-numeric:tabular-nums">
                    </div>
                </div>
                <div style="display:flex;gap:1.5rem;margin-top:.75rem;flex-wrap:wrap">
                    <div class="settings-checkbox-row">
                        <input type="checkbox" id="skill-autoload" name="autoLoad"
                               ${n.autoLoad?"checked":""}>
                        <label for="skill-autoload">${s("skill.trigger.autoLoadLabel")}</label>
                    </div>
                    <div class="settings-checkbox-row" id="disable-invocation-row"
                         style="${n.triggerStrategy==="action"?"":"display:none"}">
                        <input type="checkbox" id="skill-disable-model" name="disableModelInvocation"
                               ${n.disableModelInvocation?"checked":""}>
                        <label for="skill-disable-model">${s("skill.trigger.disableModelLabel")}</label>
                    </div>
                </div>
                <div class="settings-form-group" style="margin-top:.75rem">
                    <label>${s("skill.trigger.globsLabel")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${s("skill.trigger.globsHint")}</span>
                    </label>
                    <textarea class="settings-textarea" name="globs" rows="2"
                        style="font-family:monospace;font-size:.8125rem"
                        placeholder="src/controllers/*.ts&#10;src/**/*.handler.ts"
                        >${(n.globs??[]).join(`
`)}</textarea>
                </div>
                <div class="settings-form-group">
                    <label>${s("skill.trigger.correctionLogLabel")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${s("skill.trigger.correctionLogHint")}</span>
                    </label>
                    <input class="settings-input" name="correctionLog"
                           value="${k(n.correctionLog?.path??"")}"
                           placeholder="docs/agent-corrections.md"
                           style="font-family:monospace;font-size:.875rem">
                    <label><input type="checkbox" name="correctionEnabled" ${n.correctionLog?.enabled?"checked":""}> ${s("skill.support.correctionEnabled")}</label>
                    <label>${s("skill.support.correctionRoot")}</label>
                    <input class="settings-input" name="correctionRoot" value="${k(n.correctionLog?.root??"")}" placeholder="/workspace">
                </div>
                <div class="settings-form-group">
                    <label>${s("skill.support.root")}</label>
                    <input class="settings-input" name="fsRoot" value="${k(n.fsRoot??"")}" placeholder="/workspace/_agent/skills/review">
                    <p>${s("skill.support.hint")}</p>
                    <label>${s("skill.support.references")}</label>
                    <textarea class="settings-textarea" name="referencePaths" rows="3">${k((n.referencePaths??[]).join(`
`))}</textarea>
                    <label>${s("skill.support.template")}</label>
                    <input class="settings-input" name="templatePath" value="${k(n.templatePath??"")}" placeholder="template.md">
                </div>
            </div>

            <!-- Prompt Instructions (type=prompt) -->
            <div class="settings-section" id="prompt-section" style="${r?"":"display:none"}">
                <h3 class="settings-section__title">${s("skill.section.prompt")}</h3>
                <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                    ${s("skill.hint.prompt")}</p>
                <textarea class="settings-textarea" name="instructions" rows="14"
                    style="font-family:monospace;font-size:.8125rem;resize:vertical"
                    placeholder="${s("skill.placeholder.instructions").replace(/\\n/g,"&#10;")}"
                    >${n.instructions||""}</textarea>
            </div>

            <!-- MCP Config (type=mcp) -->
            <div class="settings-section" id="mcp-section" style="${l?"":"display:none"}">
                <h3 class="settings-section__title">${s("skill.section.mcp")}</h3>
                <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                    ${s("skill.hint.mcpDesc")}</p>
                <div class="settings-form-group">
                    <label>${s("skill.mcp.serverLabel")}</label>
                    <select class="settings-select" name="mcpServerId" id="mcp-server-select">
                        <option value="">${s("skill.mcp.serverEmpty")}</option>
                        ${e.map(d=>`
                            <option value="${d.id}" ${n.mcpServerId===d.id?"selected":""}>
                                ${d.icon||"🔌"} ${d.name}
                            </option>`).join("")}
                    </select>
                    ${e.length===0?`
                        <p style="font-size:.75rem;color:var(--st-color-warning,#f59e0b);margin:.375rem 0 0">
                            <i class="fas fa-exclamation-triangle"></i>
                            ${s("skill.hint.noMcpServer")}
                        </p>`:""}
                </div>
                <div class="settings-form-group" id="mcp-tool-group"
                     style="${n.mcpServerId?"":"display:none"}">
                    <label>${s("skill.mcp.toolLabel")}</label>
                    <select class="settings-select" name="mcpToolName" id="mcp-tool-select">
                        <option value="">${s("skill.mcp.toolEmpty")}</option>
                        ${re(n.mcpServerId,n.mcpToolName,e)}
                    </select>
                </div>
                ${n.mcpServerId&&n.mcpToolName?`
                    <div style="padding:.625rem .875rem;background:var(--st-surface-secondary,#f9fafb);
                                border-radius:6px;font-size:.8125rem;color:var(--st-text-secondary)">
                        <i class="fas fa-info-circle"></i>
                        ${s("skill.hint.mcpAutoParams")}
                    </div>`:""}
            </div>

            <!-- Shell Config (type=shell) -->
            <div class="settings-section" id="shell-section" style="${o?"":"display:none"}">
                <h3 class="settings-section__title">${s("skill.section.shell")}</h3>
                <div class="settings-form-group">
                    <label>
                        ${s("skill.shell.commandLabel")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${s("skill.shell.commandHint")}</span>
                    </label>
                    <input class="settings-input" name="command" style="font-family:monospace"
                        value="${n.command||""}"
                        placeholder="${s("skill.shell.placeholder")}">
                </div>
                <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.25rem 0 0">
                    ${s("skill.hint.shell")}</p>
            </div>

            <!-- HTTP Config (type=http) -->
            <div class="settings-section" id="http-section" style="${a?"":"display:none"}">
                <h3 class="settings-section__title">${s("skill.section.http")}</h3>
                <div class="settings-form-group">
                    <label>${s("form.endpoint")}</label>
                    <input class="settings-input" type="url" name="endpoint"
                        value="${n.endpoint||""}" placeholder="https://api.example.com/skill">
                </div>
                <div style="display:grid;grid-template-columns:120px 1fr;gap:.75rem">
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${s("form.method")}</label>
                        <select class="settings-select" name="method">
                            <option value="POST" ${(n.method??"POST")==="POST"?"selected":""}>POST</option>
                            <option value="GET"  ${n.method==="GET"?"selected":""}>GET</option>
                            <option value="PUT"  ${n.method==="PUT"?"selected":""}>PUT</option>
                        </select>
                    </div>
                    <div class="settings-form-group" style="margin-bottom:0">
                        <label>${s("form.auth")} <span style="color:var(--st-text-tertiary);font-size:.8em">可选</span></label>
                        <input class="settings-input" type="password" name="auth-header"
                            value="${n.headers?.Authorization||""}" placeholder="Bearer sk-...">
                    </div>
                </div>
                <div class="settings-form-group">
                    <label>
                        ${s("form.headers")}
                        <span style="color:var(--st-text-tertiary);font-size:.8em">${s("form.headersHint")}</span>
                    </label>
                    <textarea class="settings-textarea" name="headers" rows="3"
                        style="font-family:monospace;font-size:.8125rem"
                        placeholder='{"X-Custom-Header": "value"}'>${et(n.headers)}</textarea>
                </div>
            </div>

            <!-- Parameters Schema -->
            <div class="settings-section" id="params-section" style="${r||l?"display:none":""};margin-bottom:0">
                <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                    ${s("skill.section.params")}
                    <span style="font-size:.75rem;font-weight:400;color:var(--st-text-tertiary)">
                        JSON Schema
                    </span>
                </h3>
                <textarea class="settings-textarea" name="parameters" rows="10"
                    style="font-family:monospace;font-size:.8125rem;resize:vertical"
                    placeholder="${s("skill.param.placeholder")}">${c}</textarea>
                <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.375rem 0 0">
                    ${s("skill.hint.params")}</p>
            </div>
        </div>`}function nt(n){const e=document.createElement("input");e.type="file",e.accept=".json,.yaml,.yml,application/json",e.multiple=!0,e.style.display="none",document.body.appendChild(e),e.addEventListener("change",async()=>{const t=Array.from(e.files??[]);if(document.body.removeChild(e),t.length===0)return;const i=await Promise.allSettled(t.map(d=>d.text())),a=[],o=[];for(let d=0;d<i.length;d++){const u=i[d];if(u.status==="rejected"){o.push(s("skill.import.readError",{filename:t[d].name}));continue}try{const p=t[d].name,w=p.endsWith(".yaml")||p.endsWith(".yml")?C.load(u.value):JSON.parse(u.value),O=Array.isArray(w)?w:[w];a.push(...O)}catch{o.push(`${t[d].name}: ${s("skill.toast.invalidJson")}`)}}if(o.length>0&&f.error(o.join(`
`)),a.length===0)return;n.importing=!0;const r=new Set((await n.service.getSkills()).map(d=>d.id));let l="",c=0;for(const d of a){let u=d.id??`skill-${N()}`;if(r.has(u)){let p=2;for(;r.has(`${u}-${p}`);)p++;const h=`${u}-${p}`;o.push(`ID "${u}" already exists → renamed to "${h}"`),u=h}d.id=u,r.add(u),d.enabled=d.enabled??!1;try{await n.service.saveSkill(d),l=d.id,c++}catch(p){o.push(`${d.name||d.id}: ${p instanceof Error?p.message:String(p)}`)}}n.importing=!1,o.length>0&&f.error(o.join(`
`)),c>0&&f.success(s("skill.toast.imported",{count:c})),l&&(n.selectedId=l),await n.render()}),e.addEventListener("cancel",()=>{e.parentNode&&document.body.removeChild(e)}),e.click()}function it(n){const e=`
        <p style="font-size:.875rem;color:var(--st-text-secondary);margin:0 0 .75rem">
            ${s("dialog.import.hint")}</p>
        <textarea class="settings-textarea" id="import-json" rows="8"
            style="font-family:monospace;font-size:.8125rem"
            placeholder='[{"name":"My Skill","type":"prompt","instructions":"..."}]'></textarea>`;new T(s("skill.import.title"),e,{confirmText:s("dialog.import.action"),onConfirm:async()=>{const t=document.getElementById("import-json")?.value??"";let i;try{const l=t.trimStart().startsWith("---")||/^[a-zA-Z_][\w]*\s*:/m.test(t.trimStart().slice(0,120))?C.load(t):JSON.parse(t);i=Array.isArray(l)?l:[l]}catch{return f.error(s("skill.toast.invalidJson")),!1}n.importing=!0;const a=[];let o=0;for(const r of i){r.id=r.id??`skill-${N()}`,r.enabled=r.enabled??!1;try{await n.service.saveSkill(r),o++}catch(l){a.push(`${r.name||r.id}: ${l instanceof Error?l.message:String(l)}`)}}n.importing=!1,a.length>0&&f.error(a.join(`
`)),o>0&&(f.success(s("skill.toast.imported",{count:o})),n.selectedId=[...i].reverse().find(r=>r.id)?.id??n.selectedId),await n.render()}}).show()}async function st(n){const e=await n.service.getSkills();le(e,"skills.yaml")}async function at(n){const e=[...n.checkedIds];e.length!==0&&T.confirm(s("dialog.delete.title"),`Delete ${e.length} selected skill${e.length>1?"s":""}?`,async()=>{n.importing=!0;for(const t of e)await n.service.deleteSkill(t).catch(()=>{});n.importing=!1,n.checkedIds=new Set,e.includes(n.selectedId??"")&&(n.selectedId=null),await n.render()})}async function ot(n){const e=new Set(n.checkedIds);if(e.size===0)return;const i=(await n.service.getSkills()).filter(a=>e.has(a.id));le(i,i.length===1?`${i[0].id}.yaml`:"skills-export.yaml")}function le(n,e){const t=C.dump(n,{lineWidth:-1,noRefs:!0}),i=new Blob([t],{type:"text/yaml"}),a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(i),download:e});a.click(),URL.revokeObjectURL(a.href)}async function rt(n){const e={id:`skill-${N()}`,name:"New Skill",type:"prompt",enabled:!1,description:"",instructions:"",tools:[],triggerPatterns:[],autoLoad:!1,priority:50,createdAt:Date.now(),modifiedAt:Date.now()};await n.service.saveSkill(e),n.selectedId=e.id,await n.render()}function lt(n){n.selectedId&&T.confirm(s("dialog.delete.title"),s("skill.confirm.delete"),async()=>{await n.beforeDelete?.(),await n.service.deleteSkill(n.selectedId),n.selectedId=null,f.success(s("skill.toast.deleted")),await n.render()})}async function ct(n){const t=(await n.service.getSkills()).find(o=>o.id===n.selectedId);if(!t)return;if(t.type==="prompt"){f.info(s("skill.toast.testPrompt"));return}if(t.type==="mcp"){f.info(s("skill.toast.testMcp"));return}if(t.type!=="http"){f.error(s("skill.toast.testNotHttp"));return}if(!t.endpoint){f.error(s("skill.toast.testNoEndpoint"));return}const i=n.container.querySelector('[data-action="test"]');if(!i)return;const a=i.innerHTML;i.innerHTML=`<i class="fas fa-spinner fa-spin"></i> ${s("status.testing")}`,i.disabled=!0;try{const o=await fetch(t.endpoint,{method:t.method??"POST",headers:{"Content-Type":"application/json",...t.headers},body:JSON.stringify({})});o.ok?f.success(s("skill.toast.testSuccess",{status:o.status})):f.error(s("skill.toast.testFailed",{status:o.status}))}catch(o){f.error(s("skill.toast.testError",{message:o.message}))}finally{i.innerHTML=a,i.disabled=!1}}class M extends ge{selectedId=null;renderedSkill;_importing=!1;_checkedIds=new Set;_formOnly=!1;static createFormOnly(e,t,i){const a=new M(e,t,i??{});return a._formOnly=!0,i&&P(i)&&(a.selectedId=P(i)??null),a}async init(e,t){if(this._formOnly&&t?.trim())try{const i=C.load(t);i?.id&&(this.selectedId=i.id)}catch{}await super.init(e,t)}getText(){return!this._formOnly||!this.renderedSkill?"":C.dump(this.readDraft(),{lineWidth:-1,noRefs:!0})}readDraft(){if(!this.renderedSkill)throw new v(s("settings.autosave.invalid"));return Ye(this.renderedSkill,e=>this.val(e),e=>this.chk(e))}async saveDraft(){const e=this.renderedSkill,t=structuredClone(this.readDraft()),i=await this.service.getSkills();if(t.id!==e.id&&i.some(o=>o.id===t.id))throw new v(s("settings.autosave.invalid"));await this.service.saveSkill(t),t.id!==e.id&&await this.service.deleteSkill(e.id),this.renderedSkill=t,this.selectedId===e.id&&(this.selectedId=t.id);const a=[...this.container.querySelectorAll("[data-name-for]")].find(o=>o.dataset.nameFor===e.id);a&&!a.querySelector("input")&&(a.textContent=t.name)}buildImporterDeps(){const e=this;return{service:this.service,render:()=>this.render(),get selectedId(){return e.selectedId},set selectedId(t){e.selectedId=t},get importing(){return e._importing},set importing(t){e._importing=t},get checkedIds(){return e._checkedIds},set checkedIds(t){e._checkedIds=t}}}buildOpsDeps(){const e=this;return{service:this.service,beforeDelete:()=>this.discardAutoSave(),container:this.container,render:()=>this.render(),val:t=>this.val(t),chk:t=>this.chk(t),get selectedId(){return e.selectedId},set selectedId(t){e.selectedId=t}}}async render(){if(!await this.prepareRender()||this._importing)return;if(this._formOnly)return this._renderFormOnly();const[e,t]=await Promise.all([this.service.getSkills(),this.service.getMCPServers?.()??Promise.resolve([])]);this.selectedId&&!e.find(a=>a.id===this.selectedId)&&(this.selectedId=null),!this.selectedId&&e.length>0&&(this.selectedId=e[0].id);const i=e.find(a=>a.id===this.selectedId)??null;this.captureRenderedSkill(i),this.container.innerHTML=`
            <div class="settings-split${this.selectedId?" has-detail":""}">
                <div class="settings-split__sidebar">
                    <div class="settings-split__header">
                        <h3 style="margin:0;font-size:.9375rem;font-weight:600">
                            <i class="fas fa-bolt" style="margin-right:.5rem;opacity:.7"></i>Skills
                        </h3>
                        <div class="settings-page__actions">
                            <button class="settings-btn-round" data-action="add"          title="${s("skill.addNew")}"><i class="fas fa-plus"></i></button>
                            <button class="settings-btn-round" data-action="import"       title="${s("skill.import.fileTooltip")}"><i class="fas fa-folder-open"></i></button>
                            <button class="settings-btn-round" data-action="import-paste" title="${s("skill.import.pasteTooltip")}"><i class="fas fa-clipboard"></i></button>
                            <button class="settings-btn-round" data-action="export"       title="${s("skill.exportAll")}"><i class="fas fa-file-export"></i></button>
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
                        ${e.length===0?Xe():e.map(a=>Qe(a,this.selectedId,this._checkedIds)).join("")}
                    </div>
                </div>

                <div class="settings-split__content">
                    <button class="settings-mobile-back" data-action="mobile-back">&#8592; Skills</button>
                    ${i?Q(i,t,a=>this.renderEntityHeader(a)):X()}
                </div>
            </div>`,this.bindEvents(t)}bindEvents(e){this.clearListeners();const t=this.buildOpsDeps(),i=this.buildImporterDeps(),a=this.container.querySelector(".settings-split__list");a&&(this.addEventListener(a,"change",p=>{const h=p.target.closest("[data-check-id]");if(!h)return;const w=h.dataset.checkId;h.checked?this._checkedIds.add(w):this._checkedIds.delete(w),this.render()}),this.addEventListener(a,"click",p=>{if(p.target.closest(".settings-inline-rename")||p.target.closest("[data-check-id]"))return;const h=p.target.closest("[data-id]");h&&(this.selectedId=h.dataset.id,this.render())}),this.addEventListener(a,"dblclick",p=>{const h=p.target.closest("[data-name-for]");h&&this._startSkillInlineRename(h,h.dataset.nameFor)})),this.bindAction("mobile-back",()=>{this.selectedId=null,this.render()}),this.bindAction("batch-clear",()=>{this._checkedIds.clear(),this.render()}),this.bindAction("batch-delete",()=>at(i)),this.bindAction("batch-export",()=>ot(i)),this.bindEntityHeaderEvents({onIconSave:async()=>{const p=this.container.querySelector(".settings-split__content")??this.container;E(p)}});const o=this.container.querySelector("#trigger-strategy-select"),r=this.container.querySelector("#disable-invocation-row");o&&r&&this.addEventListener(o,"change",()=>{r.style.display=o.value==="action"?"":"none"}),this.bindAction("add",()=>rt(t)),this.bindAction("import",()=>nt(i)),this.bindAction("import-paste",()=>it(i)),this.bindAction("export",()=>st(i)),this.bindAction("delete",()=>lt(t)),this.bindAction("test",()=>ct(t)),this.renderedSkill&&this.bindAutoSave(this.container.querySelector(".settings-split__content")??this.container,()=>this.saveDraft());const l=this.container.querySelector('[name="type"]');l&&this.addEventListener(l,"change",()=>{const p=l.value,h=(w,O)=>{const D=this.container.querySelector(w);D&&(D.style.display=O?"":"none")};h("#prompt-section",p==="prompt"),h("#shell-section",p==="shell"),h("#mcp-section",p==="mcp"),h("#http-section",p==="http"),h("#params-section",p!=="prompt"&&p!=="mcp")});const c=this.container.querySelector("#mcp-server-select"),d=this.container.querySelector("#mcp-tool-group"),u=this.container.querySelector("#mcp-tool-select");c&&d&&u&&this.addEventListener(c,"change",()=>{const p=c.value;d.style.display=p?"":"none",u.innerHTML=`<option value="">${s("skill.mcp.toolEmpty")}</option>`+re(p,void 0,e)})}_startSkillInlineRename(e,t){this.startInlineRename(e,async i=>{const o=(await this.service.getSkills()).find(r=>r.id===t);o&&await this.service.saveSkill({...o,name:i,modifiedAt:Date.now()})},i=>{if(t!==this.selectedId)return;const a=this.container.querySelector('[name="header-name"]'),o=this.container.querySelector('[name="name"]');a&&(a.value=i,this.resizeHeaderInput(a)),o&&(o.value=i)})}bindAction(e,t){this.container.querySelectorAll(`[data-action="${e}"]`).forEach(i=>this.addEventListener(i,"click",t))}val(e){return this.container.querySelector(`[name="${e}"]`)?.value??""}chk(e){return this.container.querySelector(`[name="${e}"]`)?.checked??!1}captureRenderedSkill(e){this.renderedSkill=e?structuredClone(e):void 0}async _renderFormOnly(){const[e,t]=await Promise.all([this.service.getSkills(),this.service.getMCPServers?.()??Promise.resolve([])]),i=this.selectedId?e.find(a=>a.id===this.selectedId):null;if(this.captureRenderedSkill(i),!i){this.container.innerHTML=X(),this.bindEvents(t);return}this.container.innerHTML=Q(i,t,a=>this.renderEntityHeader(a)),this.bindEvents(t)}}function ut(n){return async(e,t)=>{const i=M.createFormOnly(e,n,t);return await i.init(e,t.initialContent??""),i}}function gt(n,e={}){const t={...e,defaultToolIds:[...e.defaultToolIds??[]]};return async(i,a)=>{const o=new Je(i,a,n,t);return await o.init(i,a.initialContent),o}}export{ft as ConnectionSettingsEditor,vt as CostEditor,bt as MCPSettingsEditor,yt as ProviderSettingsEditor,M as SkillSettingsEditor,$t as SystemPromptSettingsEditor,gt as createAgentEditorFactory,ut as createSkillsEditorFactory};
