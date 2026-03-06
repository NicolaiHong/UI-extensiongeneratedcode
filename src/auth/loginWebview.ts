import * as vscode from "vscode";
import { AuthManager } from "./authManager";
import { getServerUrl } from "../api/client";

export function showLoginWebview(
  extensionUri: vscode.Uri,
  auth: AuthManager,
): void {
  const panel = vscode.window.createWebviewPanel(
    "uigenai-login",
    "UI Gen AI — Login",
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === "oauth") {
        const serverUrl = getServerUrl();
        vscode.env.openExternal(
          vscode.Uri.parse(`${serverUrl}/auth/${msg.provider}`),
        );
        panel.webview.postMessage({
          type: "oauthStarted",
          provider: msg.provider,
        });
        return;
      }
      panel.webview.postMessage({ type: "loading", value: true });
      if (msg.type === "login") {
        const u = await auth.login(msg.email, msg.password);
        vscode.window.showInformationMessage(
          `Welcome back, ${u.displayName || u.email}! 🎉`,
        );
        panel.dispose();
      } else if (msg.type === "register") {
        const u = await auth.register(msg.email, msg.password, msg.displayName);
        vscode.window.showInformationMessage(
          `Account created! Welcome, ${u.displayName || u.email}! 🎉`,
        );
        panel.dispose();
      }
    } catch (err: any) {
      const m = err.response?.data?.error?.message || err.message || "Failed";
      panel.webview.postMessage({ type: "error", message: m });
    } finally {
      try {
        panel.webview.postMessage({ type: "loading", value: false });
      } catch {}
    }
  });

  // Close login panel when auth state changes (e.g. OAuth callback received)
  const disposable = auth.onDidChange((user) => {
    if (user) {
      try {
        panel.dispose();
      } catch {}
    }
  });
  panel.onDidDispose(() => disposable.dispose());

  panel.webview.html = getLoginHtml();
}

function getLoginHtml(): string {
  return /*html*/ `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#121416,#1c1f21);color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.c{width:100%;max-width:400px}
.logo{text-align:center;margin-bottom:28px}
.logo h1{font-size:24px;font-weight:800}
.logo p{color:#00a2ad;font-size:13px;margin-top:4px}
.card{background:#1c1f21;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:28px;box-shadow:0 0 15px rgba(0,162,173,.1)}
.tabs{display:flex;gap:0;margin-bottom:20px;background:rgba(255,255,255,.05);border-radius:8px;padding:3px}
.tab{flex:1;padding:9px;text-align:center;cursor:pointer;border-radius:6px;font-weight:600;font-size:13px;color:rgba(255,255,255,.5);border:none;background:transparent;transition:.2s}
.tab.active{background:#00a2ad;color:#fff;box-shadow:0 0 12px rgba(0,162,173,.3)}
.fg{margin-bottom:14px}
.fg label{display:block;font-size:12px;font-weight:500;color:rgba(255,255,255,.7);margin-bottom:5px}
.fg input{width:100%;height:42px;padding:0 12px;background:#173436;border:1px solid #2e676b;border-radius:8px;color:#fff;font-size:13px;outline:none;transition:.2s}
.fg input:focus{border-color:#00a2ad;box-shadow:0 0 0 3px rgba(0,162,173,.15)}
.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:9px 12px;color:#f87171;font-size:12px;margin-bottom:14px;display:none}
.err.show{display:block}
.btn{width:100%;height:44px;background:#00a2ad;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 0 15px rgba(0,162,173,.2);transition:.2s;margin-top:6px}
.btn:hover{box-shadow:0 0 25px rgba(0,162,173,.4)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.hidden{display:none!important}
.divider{display:flex;align-items:center;margin:18px 0 14px;gap:10px}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}
.divider span{font-size:11px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:1px}
.btn-oauth{width:100%;height:42px;border:1px solid rgba(255,255,255,.12);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:.2s;margin-bottom:8px}
.btn-google{background:#1c1f21;color:#fff}.btn-google:hover{background:#2a2d30;border-color:rgba(255,255,255,.2)}
.btn-github{background:#1c1f21;color:#fff}.btn-github:hover{background:#2a2d30;border-color:rgba(255,255,255,.2)}
.btn-oauth:disabled{opacity:.5;cursor:not-allowed}
.oauth-msg{text-align:center;font-size:11px;color:#00a2ad;margin-top:6px;display:none}
.oauth-msg.show{display:block}
</style></head><body>
<div class="c">
<div class="logo"><h1>⚡ UI Gen AI</h1><p>Your vision, translated to code.</p></div>
<div class="card">
<div class="tabs">
<button class="tab active" onclick="sw('login')" id="t-l">Sign In</button>
<button class="tab" onclick="sw('register')" id="t-r">Register</button>
</div>
<div id="err" class="err"></div>
<form id="f-login" onsubmit="doLogin(event)">
<div class="fg"><label>Email</label><input type="email" id="l-e" placeholder="name@company.com" required></div>
<div class="fg"><label>Password</label><input type="password" id="l-p" placeholder="••••••••" required></div>
<button type="submit" class="btn" id="l-btn">Sign In</button>
</form>
<div class="divider"><span>or continue with</span></div>
<button class="btn-oauth btn-google" onclick="doOAuth('google')" id="g-btn">🔵 Sign in with Google</button>
<button class="btn-oauth btn-github" onclick="doOAuth('github')" id="gh-btn">⚫ Sign in with GitHub</button>
<div class="oauth-msg" id="oauth-msg">✓ Browser opened — complete sign-in there</div>
<form id="f-reg" class="hidden" onsubmit="doReg(event)">
<div class="fg"><label>Display Name</label><input type="text" id="r-n" placeholder="John Doe"></div>
<div class="fg"><label>Email</label><input type="email" id="r-e" placeholder="name@company.com" required></div>
<div class="fg"><label>Password</label><input type="password" id="r-p" placeholder="Min 8 characters" required minlength="8"></div>
<button type="submit" class="btn" id="r-btn">Create Account</button>
</form>
</div>
</div>
<script>
const vscode=acquireVsCodeApi();
function sw(t){document.getElementById('f-login').classList.toggle('hidden',t!=='login');document.getElementById('f-reg').classList.toggle('hidden',t!=='register');document.getElementById('t-l').classList.toggle('active',t==='login');document.getElementById('t-r').classList.toggle('active',t==='register');document.getElementById('err').classList.remove('show')}
function doLogin(e){e.preventDefault();document.getElementById('err').classList.remove('show');vscode.postMessage({type:'login',email:document.getElementById('l-e').value,password:document.getElementById('l-p').value})}
function doReg(e){e.preventDefault();document.getElementById('err').classList.remove('show');vscode.postMessage({type:'register',email:document.getElementById('r-e').value,password:document.getElementById('r-p').value,displayName:document.getElementById('r-n').value||undefined})}
function doOAuth(provider){document.getElementById('err').classList.remove('show');vscode.postMessage({type:'oauth',provider:provider})}
window.addEventListener('message',e=>{const d=e.data;if(d.type==='error'){const el=document.getElementById('err');el.textContent=d.message;el.classList.add('show')}if(d.type==='loading'){document.querySelectorAll('.btn').forEach(b=>{b.disabled=d.value;b.textContent=d.value?'Please wait...':'Sign In'})}
if(d.type==='oauthStarted'){document.getElementById('oauth-msg').classList.add('show');document.getElementById('g-btn').disabled=true;document.getElementById('gh-btn').disabled=true}})
</script></body></html>`;
}
