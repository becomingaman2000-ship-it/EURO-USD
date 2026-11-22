import { marketHealth } from './safety.js';
/* Email alerts when a setup is fit to enter.
   Uses FormSubmit (no API key). First mail asks Gmail to confirm the inbox. */

export const ALERT_EMAIL = "becomingaman2000@gmail.com";
const KEY_ON = "ipda-mail-on";
const KEY_LAST = "ipda-mail-last";
const KEY_ARMED = "ipda-mail-armed";
const COOLDOWN_MS = 40 * 60 * 1000;
let sendingEntry=false;
let sendingTest=false;

export function mailEnabled() {
  return localStorage.getItem(KEY_ON) !== "0";
}

export function setMailEnabled(on) {
  localStorage.setItem(KEY_ON, on ? "1" : "0");
}

export function lastMail() {
  try {
    return JSON.parse(localStorage.getItem(KEY_LAST) || "null");
  } catch {
    return null;
  }
}

function actionOf(side) {
  if (side === "LONG" || side === "BUY" || side === "BULLISH") return "BUY";
  if (side === "SHORT" || side === "SELL" || side === "BEARISH") return "SELL";
  return "FLAT";
}

function fmt(n) {
  return Number.isFinite(+n) ? Number(n).toFixed(5) : "—";
}

export function buildAlert(ex, market) {
  const act = actionOf(ex.side);
  const instrument=market?.meta?.proxy?"EUR/USDT PROXY (not broker EUR/USD)":"EUR/USD";
  const spot = fmt(market?.meta?.spot ?? ex.entry);
  const when = new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Johannesburg",
    hour12: false,
  });
  return {
    subject: `IPDA Desk: ${ex.status === "ENTER" ? "ENTER" : ex.status} ${act} ${instrument} @ ${fmt(ex.entry)}`,
    action: act,
    status: ex.status,
    label: (ex.label || "").replace("LONG", "BUY").replace("SHORT", "SELL"),
    pair: instrument,
    spot,
    entry: fmt(ex.entry),
    stop: fmt(ex.sl),
    tp1: fmt(ex.t1),
    tp2: fmt(ex.t2),
    rr: ex.rr != null ? String(ex.rr) : "—",
    model: ex.model || "—",
    window: ex.window || ex.when || "—",
    pipsToEntry: ex.pipsToEntry != null ? `${ex.pipsToEntry}` : "—",
    pipsToTp: ex.pipsToTp != null ? `${ex.pipsToTp}` : "—",
    note: (ex.note || "").replace(/\bLONG\b/g, "BUY").replace(/\bSHORT\b/g, "SELL"),
    source: market?.meta?.source || "IPDA Desk",
    time: when,
    desk: "https://becomingaman2000-ship-it.github.io/EURO-USD/",
  };
}

async function postFormSubmit(payload) {
  const body = {
    _subject: payload.subject,
    _template: "table",
    _captcha: "false",
    _honey: "",
    name: "IPDA Desk",
    email: "ipda-desk@noreply.local",
    Action: payload.action,
    Status: payload.label,
    Pair: payload.pair,
    Spot: payload.spot,
    "Enter at": payload.entry,
    "Stop loss": payload.stop,
    "Take profit 1": payload.tp1,
    "Take profit 2": payload.tp2,
    "R:R": payload.rr,
    Model: payload.model,
    Window: payload.window,
    "Pips to entry": payload.pipsToEntry,
    "Pips to TP1": payload.pipsToTp,
    Note: payload.note,
    Source: payload.source,
    Time: payload.time,
    Desk: payload.desk,
    message:
      `${payload.label}\n` +
      `ACTION: ${payload.action}\n` +
      `${payload.pair} spot ${payload.spot}\n` +
      `Enter ${payload.entry}  |  Stop ${payload.stop}\n` +
      `TP1 ${payload.tp1}  |  TP2 ${payload.tp2}\n` +
      `R:R ${payload.rr}  |  ${payload.model}\n` +
      `${payload.window}\n` +
      `${payload.note}\n` +
      payload.desk,
  };

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try {
  const res = await fetch(`https://formsubmit.co/ajax/${ALERT_EMAIL}`, {
    signal:controller.signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !(json.success===true || json.success==="true")) throw new Error(json?.message || `Email service did not confirm acceptance (HTTP ${res.status})`);
  return json;
  } finally {clearTimeout(timer);}
}

export async function sendTestAlert() {
  if(sendingTest)return {skipped:true};
  sendingTest=true;
  try {
    const result=await postFormSubmit({subject:'IPDA Desk — email delivery TEST (not a trade)',action:'TEST ONLY',label:'Email connection test — NOT a trading signal',pair:'No trade',spot:'—',entry:'—',stop:'—',tp1:'—',tp2:'—',rr:'—',model:'Delivery test only',window:'Not applicable',pipsToEntry:'—',pipsToTp:'—',note:'You requested this test from the dashboard. No valid live signal is implied. Check for a FormSubmit activation email and confirm it if requested.',source:'User-requested email test',time:new Date().toISOString(),desk:'https://becomingaman2000-ship-it.github.io/EURO-USD/'});
    return {ok:true,result};
  } finally {sendingTest=false;}
}

export async function sendAlert(ex, market, { force = false } = {}) {
  if(ex?.status!=='ENTER')throw new Error('Entry alerts require an observed ENTER signal');
  const health=marketHealth(market);
  if(!health.ok)throw new Error(`Alert blocked: ${health.reasons.join(" · ")}`);
  const payload = buildAlert(ex, market);
  const rec = {
    key: `${payload.action}-${payload.entry}-${payload.tp1}`,
    at: Date.now(),
    action: payload.action,
    entry: payload.entry,
    subject: payload.subject,
  };
  if (!force) {
    const prev = lastMail();
    if (prev && prev.key === rec.key && Date.now() - prev.at < COOLDOWN_MS) {
      return { skipped: true, reason: "cooldown", last: prev };
    }
  }
  const result = await postFormSubmit(payload);
  localStorage.setItem(KEY_LAST, JSON.stringify(rec));
  return { ok: true, result, last: rec };
}

export async function maybeNotify(ex, market, onStatus) {
  if (!mailEnabled()) {onStatus?.("off","Email alerts are OFF on this device");return;}
  if(sendingEntry)return;
  if (!ex) return;
  if (ex.status !== "ENTER") {
    sessionStorage.setItem(KEY_ARMED, "0");
    return;
  }
  if (sessionStorage.getItem(KEY_ARMED) === "1") {
    const prev = lastMail();
    const key = `${actionOf(ex.side)}-${fmt(ex.entry)}-${fmt(ex.t1)}`;
    if (prev && prev.key === key) return;
  }
  try {
    sendingEntry=true;
    onStatus?.("sending", "Submitting entry alert…");
    const out = await sendAlert(ex, market);
    if (out.skipped) {
      onStatus?.("idle", `Last alert ${new Date(out.last.at).toLocaleTimeString()} (cooldown)`);
      return;
    }
    sessionStorage.setItem(KEY_ARMED, "1");
    onStatus?.("sent", `Email service accepted the alert for ${ALERT_EMAIL}; inbox delivery not verified`);
  } catch (err) {
    onStatus?.("error", err.message || "Mail failed");
  } finally {sendingEntry=false;}
}
