(function(){"use strict";function i(n){return`canoe-chat:${n}`}function a(n){try{const e=localStorage.getItem(i(n));if(!e)return null;const t=JSON.parse(e);return t.expiresAt<Date.now()?(localStorage.removeItem(i(n)),null):t}catch{return null}}function c(n,e){localStorage.setItem(i(n),JSON.stringify(e))}function d(){const n=document.currentScript,e=n==null?void 0:n.getAttribute("data-bridge-url");return e?e.replace(/^http/,"ws")+"/chat":"ws://localhost:3001/chat"}function l(){const n=document.currentScript,e=n==null?void 0:n.getAttribute("data-widget-key");if(!e)throw new Error("data-widget-key is required");return e}class r{constructor(){this.ws=null,this.reconnectAttempt=0,this.reconnectTimer=null,this.panelOpen=!1,this.widgetKey=l(),this.container=this.buildUi(),document.body.appendChild(this.container),this.messagesEl=this.container.querySelector(".canoe-messages"),this.inputEl=this.container.querySelector(".canoe-input"),this.connect()}buildUi(){const e=document.createElement("div");e.className="canoe-chat-root",e.innerHTML=`
      <button type="button" class="canoe-toggle" aria-label="Open chat">Chat</button>
      <div class="canoe-panel" hidden>
        <div class="canoe-header">Chat with us</div>
        <div class="canoe-intro">
          <input class="canoe-name" placeholder="Name (optional)" />
          <input class="canoe-email" type="email" placeholder="Email (optional)" />
          <button type="button" class="canoe-start">Start chat</button>
          <button type="button" class="canoe-skip">Skip — chat anonymously</button>
        </div>
        <div class="canoe-messages"></div>
        <form class="canoe-compose" hidden>
          <input class="canoe-input" placeholder="Type a message…" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </div>
    `;const t=document.createElement("style");return t.textContent=`
      .canoe-chat-root { position: fixed; bottom: 16px; right: 16px; z-index: 99999; font-family: system-ui, sans-serif; }
      .canoe-toggle { background: #18181b; color: #fff; border: none; border-radius: 999px; padding: 12px 18px; cursor: pointer; }
      .canoe-panel { position: absolute; bottom: 48px; right: 0; width: 320px; height: 420px; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,.12); }
      .canoe-header { padding: 12px; font-weight: 600; border-bottom: 1px solid #e4e4e7; }
      .canoe-intro { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .canoe-intro input { padding: 8px; border: 1px solid #d4d4d8; border-radius: 6px; }
      .canoe-intro button { padding: 8px; border-radius: 6px; cursor: pointer; }
      .canoe-skip { background: transparent; border: none; color: #71717a; text-decoration: underline; }
      .canoe-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .canoe-msg { max-width: 85%; padding: 8px 10px; border-radius: 10px; font-size: 14px; line-height: 1.4; }
      .canoe-msg.inbound { align-self: flex-start; background: #f4f4f5; }
      .canoe-msg.outbound { align-self: flex-end; background: #18181b; color: #fff; }
      .canoe-compose { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e4e4e7; }
      .canoe-input { flex: 1; padding: 8px; border: 1px solid #d4d4d8; border-radius: 6px; }
    `,document.head.appendChild(t),e.querySelector(".canoe-toggle").addEventListener("click",()=>{this.panelOpen=!this.panelOpen;const o=e.querySelector(".canoe-panel");o.hidden=!this.panelOpen}),e.querySelector(".canoe-start").addEventListener("click",()=>{const o=e.querySelector(".canoe-name").value.trim(),s=e.querySelector(".canoe-email").value.trim();this.initSession({name:o||void 0,email:s||void 0})}),e.querySelector(".canoe-skip").addEventListener("click",()=>{this.initSession({skipAnonymous:!0})}),e.querySelector(".canoe-compose").addEventListener("submit",o=>{o.preventDefault();const s=this.inputEl.value.trim();!s||!this.ws||this.ws.readyState!==WebSocket.OPEN||(this.appendMessage(s,"outbound"),this.ws.send(JSON.stringify({type:"message",text:s})),this.inputEl.value="")}),e}initSession(e){const t=this.container.querySelector(".canoe-intro"),o=this.container.querySelector(".canoe-compose");t.hidden=!0,o.hidden=!1;const s=a(this.widgetKey);this.connect({...e,sessionToken:s==null?void 0:s.sessionToken})}connect(e){this.ws&&(this.ws.onclose=null,this.ws.close()),this.ws=new WebSocket(d()),this.ws.onopen=()=>{var t;this.reconnectAttempt=0,this.ws.send(JSON.stringify({type:"init",widgetKey:this.widgetKey,sessionToken:(e==null?void 0:e.sessionToken)??((t=a(this.widgetKey))==null?void 0:t.sessionToken),name:e==null?void 0:e.name,email:e==null?void 0:e.email,skipAnonymous:e==null?void 0:e.skipAnonymous}))},this.ws.onmessage=t=>{const o=JSON.parse(t.data);this.handleServerMessage(o)},this.ws.onclose=()=>{this.scheduleReconnect()}}scheduleReconnect(){if(this.reconnectTimer)return;const e=Math.min(3e4,1e3*2**this.reconnectAttempt);this.reconnectAttempt+=1,this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;const t=a(this.widgetKey);t&&this.connect({sessionToken:t.sessionToken})},e)}handleServerMessage(e){if(e.type==="session"){c(this.widgetKey,{sessionToken:e.sessionToken,conversationId:e.conversationId,expiresAt:Date.now()+10080*60*1e3});return}if(e.type==="history"){this.messagesEl.innerHTML="";for(const t of e.messages){const o=t.direction==="inbound"?"inbound":"outbound";this.appendMessage(t.body,o==="inbound"?"inbound":"outbound")}return}if(e.type==="message"){const t=e.senderType==="external"?"outbound":"inbound";this.appendMessage(e.text,t);return}if(e.type==="handoff"&&e.message){this.appendMessage(e.message,"inbound");return}e.type==="error"&&(e.code==="invalid_session"&&localStorage.removeItem(i(this.widgetKey)),this.appendMessage(e.message??e.code,"inbound"))}appendMessage(e,t){const o=document.createElement("div");o.className=`canoe-msg ${t}`,o.textContent=e,this.messagesEl.appendChild(o),this.messagesEl.scrollTop=this.messagesEl.scrollHeight}}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>new r):new r})();
