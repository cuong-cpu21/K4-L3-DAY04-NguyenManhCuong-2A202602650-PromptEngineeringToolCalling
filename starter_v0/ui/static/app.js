/* Northstar Helpdesk UI — chat with tool trace, data dashboard, trace & tool log */
(() => {
  "use strict";

  // ------------------------------------------------------------------ utils
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function el(tag, attrs = {}, html) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "class") node.className = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    if (html != null) node.innerHTML = html;
    return node;
  }
  const fmtMs = (ms) => (ms == null || Number.isNaN(ms) ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
  const fmtTime = (iso) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d) ? iso : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit" }); };
  const argsText = (args) => Object.entries(args || {}).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");

  function jsonHtml(value) {
    const text = esc(JSON.stringify(value, null, 2) ?? "null");
    return text.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, (m, str, colon, bool) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (bool) return `<span class="b">${m}</span>`;
      if (m === "null") return `<span class="z">${m}</span>`;
      return `<span class="n">${m}</span>`;
    });
  }

  function md(text) {
    const blocks = [];
    let src = esc(text || "").replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(code); return `\u0000${blocks.length - 1}\u0000`; });
    src = src.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    const out = [];
    let list = null;
    for (const line of src.split(/\n/)) {
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/) || line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet) { if (!list) { list = []; } list.push(`<li>${bullet[1]}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
      const h = line.match(/^#{1,3}\s+(.*)$/);
      if (h) out.push(`<h3>${h[1]}</h3>`);
      else if (line.trim()) out.push(`<p>${line}</p>`);
    }
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre class="json">${blocks[Number(i)]}</pre>`);
  }

  function toast(html, kind = "") {
    const node = el("div", { class: `toast ${kind}` }, html);
    $("#toasts").append(node);
    setTimeout(() => node.remove(), 3600);
  }

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  };
  const api = {
    async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); },
    async post(url, body) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return r.json(); },
  };

  // ------------------------------------------------------------------ state
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(16).slice(2)}`);
  const state = {
    sessionId: store.get("northstar.session") || newId(),
    info: null,
    data: null,
    tab: "desk",
    dash: "services",
    devType: "all",
    devSearch: "",
    turns: [],
    uiCalls: [],
    live: null,
    busy: false,
    traceMode: "turns",
    selected: null,            // {kind: "turn"|"ui", id}
    logFilter: { tool: "all", source: "all", errorsOnly: false },
    touchedAssets: new Set(),
    touchedServices: new Set(),
  };
  store.set("northstar.session", state.sessionId);

  // ------------------------------------------------------------------ domain helpers
  const SERVICE_ICON = { vpn: "🔐", email: "✉️", sso: "🪪", wifi: "📶", printing: "🖨️" };
  const SERVICE_LABEL = { vpn: "VPN", email: "Email", sso: "SSO", wifi: "Wi-Fi", printing: "Printing" };
  const STATUS_LABEL = { operational: "Hoạt động bình thường", degraded: "Suy giảm", partial_outage: "Gián đoạn một phần", maintenance: "Bảo trì" };
  const TYPE_LABEL = { all: "Tất cả", laptop: "Laptop", desktop: "Desktop", mobile: "Điện thoại", printer: "Máy in", meeting_room: "Phòng họp" };
  const CHECKS = ["network", "vpn", "security", "hardware", "software"];
  const PRIORITIES = ["low", "medium", "high", "critical"];

  function severity(text) {
    const t = String(text || "").toLowerCase();
    if (!t || /not applicable|not installed on fixed|not_available/.test(t)) return "na";
    if (/fail|offline|error|link down|disconnected|packet loss|stopped/.test(t)) return "bad";
    if (/warning|pending|behind|stale|expires|delayed|paused|update available|fallback|no recent/.test(t)) return "warn";
    return "ok";
  }
  function worst(levels) { return levels.includes("bad") ? "bad" : levels.includes("warn") ? "warn" : "ok"; }
  const deviceHealth = (asset) => worst(CHECKS.map((c) => severity(asset.diagnostics?.[c])));
  const findAsset = (id) => state.data?.assets.assets.find((a) => a.asset_id === String(id || "").toUpperCase());
  const findUser = (id) => state.data?.users.users.find((u) => u.employee_id === String(id || "").toUpperCase());

  function deviceSVG(type, sev = "ok") {
    const c = { ok: "#14b8a6", warn: "#f59e0b", bad: "#ef4444", na: "#94a3b8" }[sev] || "#14b8a6";
    const screen = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${c}" opacity=".9"/><path d="M${x + 4} ${y + h - 6} l${w * 0.25} -${h * 0.35} l${w * 0.18} ${h * 0.2} l${w * 0.3} -${h * 0.4}" stroke="#fff" stroke-width="1.6" fill="none" opacity=".85"/>`;
    const svg = {
      laptop: `<rect x="14" y="7" width="52" height="36" rx="3" fill="#1e293b"/>${screen(18, 11, 44, 28)}<path d="M5 45h70l-4 7H9z" fill="#94a3b8"/><rect x="33" y="45" width="14" height="2" rx="1" fill="#64748b"/>`,
      desktop: `<rect x="12" y="5" width="56" height="37" rx="3" fill="#1e293b"/>${screen(16, 9, 48, 29)}<rect x="36" y="42" width="8" height="8" fill="#64748b"/><rect x="25" y="50" width="30" height="4" rx="2" fill="#94a3b8"/>`,
      mobile: `<rect x="27" y="3" width="26" height="54" rx="6" fill="#1e293b"/>${screen(30, 9, 20, 40)}<circle cx="40" cy="53" r="1.8" fill="#64748b"/>`,
      printer: `<rect x="22" y="5" width="36" height="18" fill="#f8fafc" stroke="#cbd5e1"/><rect x="9" y="20" width="62" height="25" rx="5" fill="#475569"/><rect x="18" y="42" width="44" height="12" rx="1" fill="#e2e8f0" stroke="#cbd5e1"/><circle cx="62" cy="28" r="3.2" fill="${c}"/><rect x="16" y="26" width="22" height="3" rx="1.5" fill="#94a3b8"/>`,
      meeting_room: `<rect x="6" y="18" width="68" height="18" rx="9" fill="#1e293b"/><circle cx="40" cy="27" r="6" fill="#0f172a" stroke="${c}" stroke-width="2.5"/><circle cx="40" cy="27" r="2" fill="${c}"/>${[14, 20, 26, 54, 60, 66].map((x) => `<circle cx="${x}" cy="27" r="1.4" fill="#475569"/>`).join("")}<ellipse cx="22" cy="50" rx="8" ry="3.5" fill="#334155"/><ellipse cx="58" cy="50" rx="8" ry="3.5" fill="${sev === "bad" ? "#ef4444" : "#334155"}"/>`,
    }[type] || `<rect x="16" y="10" width="48" height="40" rx="6" fill="#1e293b"/>${screen(20, 14, 40, 32)}`;
    return `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${svg}</svg>`;
  }

  function initials(name) { return String(name || "?").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase(); }
  function avatarColor(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 55% 45%)`; }

  function statusOf(result) {
    if (!result || typeof result !== "object") return "ok";
    if (result.error) return "error";
    if (result.awaiting_user) return "awaiting_user";
    return ["created", "needs_confirmation"].includes(result.status) ? result.status : "ok";
  }
  const modelName = (d) => (String(d.model || "").toLowerCase().startsWith(String(d.manufacturer || "").toLowerCase()) ? d.model : `${d.manufacturer} ${d.model}`);

  /** The system prompt asks for JSON {intent, action, reply, evidence_ids}; show reply, keep fields as tags. */
  function parseReply(text) {
    const raw = String(text || "").trim();
    const body = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    if (body.startsWith("{")) {
      try {
        const obj = JSON.parse(body);
        if (obj && typeof obj === "object" && "reply" in obj) return { reply: String(obj.reply ?? ""), intent: obj.intent, action: obj.action, evidence: obj.evidence_ids, structured: true };
      } catch { /* not JSON, show as text */ }
    }
    return { reply: raw, structured: false };
  }

  // ------------------------------------------------------------------ tool result cards
  function renderResult(tool, args, result, opts = {}) {
    const status = statusOf(result);
    const card = el("div", { class: `rcard${status === "error" ? " error" : ""}` });
    const head = el("header", {}, `<span class="tname">${esc(tool)}</span><span class="badge ${esc(status)}">${esc(status)}</span>
      ${opts.ms != null ? `<span class="badge">${fmtMs(opts.ms)}</span>` : ""}
      ${opts.source ? `<span class="badge src-${esc(opts.source)} src">${opts.source === "ui" ? "gọi từ UI" : "agent gọi"}</span>` : ""}`);
    const body = el("div", { class: "rbody" });
    card.append(head, body);
    try {
      body.innerHTML = cardBody(tool, args || {}, result || {});
    } catch (err) {
      body.innerHTML = `<pre class="json">${jsonHtml(result)}</pre>`;
    }
    body.append(el("details", {}, `<summary class="hint" style="cursor:pointer">Input &amp; kết quả JSON</summary>
      <div class="call-grid" style="margin-top:8px"><div><div class="sub">input</div><pre class="json">${jsonHtml(args || {})}</pre></div>
      <div><div class="sub">result</div><pre class="json">${jsonHtml(result)}</pre></div></div>`));
    body.querySelectorAll("[data-open-asset]").forEach((b) => b.addEventListener("click", () => openDeviceDrawer(b.dataset.openAsset)));
    body.querySelectorAll("[data-open-user]").forEach((b) => b.addEventListener("click", () => openUserDrawer(b.dataset.openUser)));
    return card;
  }

  function errorBody(result) {
    const extra = result.available_services ? `<div class="hint">Dịch vụ hợp lệ: ${result.available_services.map((s) => `<code>${esc(s)}</code>`).join(" ")}</div>` : "";
    return `<div class="incident-banner bad"><div>⛔</div><div><div class="t mono">${esc(result.error)}</div><div class="d">${esc(result.message || "Tool trả về lỗi. Agent không được coi hành động là thành công.")}</div>${extra}</div></div>`;
  }

  function diagRows(diagnostics, { asset, buttons = false } = {}) {
    return `<div class="diag">${Object.entries(diagnostics || {}).map(([cat, text]) => {
      const sev = severity(text);
      return `<div class="diag-row ${sev}"><div class="cat"><i class="dot ${sev === "na" ? "" : sev}"></i>${esc(cat)}</div><div>${esc(text)}</div>
        ${buttons ? `<button class="btn ghost small check-btn" data-check="${esc(cat)}" data-asset="${esc(asset)}">⚡ inspect_device(${esc(cat)})</button>` : ""}</div>`;
    }).join("")}</div>`;
  }

  function cardBody(tool, args, r) {
    if (r.error) return errorBody(r);
    switch (tool) {
      case "check_service_status": {
        return `<div class="svc-env" style="cursor:default"><span class="svc-icon">${SERVICE_ICON[r.service] || "🛰️"}</span>
            <div style="flex:1"><div class="svc-name">${esc(SERVICE_LABEL[r.service] || r.service)} <span class="muted" style="text-transform:none;font-weight:500">· ${esc(r.environment)}</span></div>
            <div class="st"><i class="dot ${esc(r.status)}"></i> ${esc(STATUS_LABEL[r.status] || r.status)}</div></div>
            ${r.incident_id ? `<span class="badge ${esc(r.status)}">${esc(r.incident_id)}</span>` : ""}</div>
          ${r.incident ? `<dl class="kv"><dt>Sự cố</dt><dd>${esc(r.incident)}</dd><dt>Khu vực</dt><dd>${esc((r.affected_locations || []).join(", ") || "—")}</dd>
            <dt>Workaround</dt><dd>${esc(r.workaround || "—")}</dd><dt>Cập nhật</dt><dd>${esc(fmtTime(r.last_updated))}</dd></dl>` : `<div class="hint">Không có sự cố · snapshot ${esc(fmtTime(r.checked_at))}</div>`}`;
      }
      case "inspect_device": {
        const d = r.device || {};
        const sev = worst(Object.values(r.diagnostics || {}).map(severity));
        return `<div class="dev-top"><div class="dev-illu">${deviceSVG(d.type, sev)}</div><div style="flex:1;min-width:0">
            <div class="dev-id">${esc(r.asset_id)} <span class="badge">${esc(TYPE_LABEL[d.type] || d.type || "")}</span></div>
            <div class="dev-model">${esc(modelName(d))} · ${esc(d.os)}</div>
            <div class="dev-meta"><span>📍 ${esc(d.location)}</span>${d.assigned_to ? `<span>👤 ${esc(d.assigned_to)}</span>` : ""}<span>check: <b>${esc(r.check)}</b></span></div></div>
            <button class="btn ghost small" data-open-asset="${esc(r.asset_id)}">Mở thiết bị</button></div>${diagRows(r.diagnostics)}`;
      }
      case "lookup_user": {
        const u = r.employee || {};
        return `<div class="person"><span class="avatar-sm" style="background:${avatarColor(u.employee_id)}">${esc(initials(u.display_name))}</span>
            <div style="flex:1"><div style="font-weight:700">${esc(u.display_name)} <span class="mono muted" style="font-size:12px">${esc(u.employee_id)}</span></div>
            <div class="hint">${esc(u.department)} · ${esc(u.office)}</div></div>
            <span class="badge ${esc(u.account_status)}">${esc(u.account_status)}</span></div>
          <dl class="kv"><dt>MFA</dt><dd><span class="badge ${esc(u.mfa_status)}">${esc(u.mfa_status)}</span></dd>
            <dt>Thiết bị</dt><dd>${(u.assigned_assets || []).map((a) => `<button class="chip" data-open-asset="${esc(a)}">${esc(a)}</button>`).join(" ") || "—"}</dd></dl>`;
      }
      case "search_kb":
      case "policy": {
        const items = r.results || [];
        if (!items.length) return `<div class="hint">Không tìm thấy kết quả phù hợp cho “${esc(r.query)}”.</div>`;
        return items.map((it) => `<div class="article"><div class="ttl">${esc(it.title)}${it.section ? ` · ${esc(it.section)}` : ""}</div>
            <div class="sub">${esc(it.article_id || it.doc_id)} · ${esc(it.category || it.policy_area)} · score ${esc(it.score)}</div>
            <div class="body">${esc(it.content || it.facts || "")}</div>
            ${(it.untrusted_text || []).length ? `<div class="untrusted">⚠️ Đã tách ${it.untrusted_text.length} dòng giống chỉ dẫn (không thực thi): ${esc(it.untrusted_text.join(" | ").slice(0, 160))}</div>` : ""}</div>`).join("");
      }
      case "create_ticket": {
        if (r.status === "created") {
          return `<div class="ticket-visual"><div class="big">🎫</div><div><div class="tid">${esc(r.ticket_id)}</div>
            <div class="hint">Ticket đã tạo (mock cục bộ) · ${esc(args.priority || "medium")}${args.asset_id ? ` · ${esc(args.asset_id)}` : ""}</div>
            <div style="font-size:12.5px;margin-top:2px">${esc(args.summary || "")}</div></div></div>`;
        }
        return `<div class="incident-banner"><div>✋</div><div><div class="t">Chưa tạo ticket: cần xác nhận</div><div class="d">${esc(r.message || "")}</div></div></div>`;
      }
      case "format_incident_report":
        return `<div class="hint">Template <b>${esc(r.template)}</b> · ${esc(r.finding_count)} finding</div><div class="report-md bubble">${md(r.markdown)}</div>`;
      case "clarify":
        return `<div class="incident-banner" style="background:#f0fdfa;border-color:#99f6e4"><div>❓</div><div><div class="t">${esc(r.question || args.question)}</div>
          <div class="d">Kiểu trả lời: <b>${esc(r.response_type)}</b>${(r.options || []).length ? ` · lựa chọn: ${r.options.map((o) => `<code>${esc(o)}</code>`).join(" ")}` : ""}</div></div></div>`;
      case "search_device_info":
        return `${(r.items || []).map((it) => `<div class="article"><div class="ttl"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></div><div class="sub">${esc(it.source)}</div><div class="body">${esc(it.summary)}</div></div>`).join("") || `<div class="hint">Không có kết quả.</div>`}
          ${r.external_data_notice ? `<div class="hint">🌐 ${esc(r.external_data_notice)}</div>` : ""}`;
      default:
        return `<pre class="json">${jsonHtml(r)}</pre>`;
    }
  }

  // ------------------------------------------------------------------ manual tool calls (second path)
  async function callTool(tool, args) {
    const record = await api.post("/api/tool", { session_id: state.sessionId, tool, args });
    if (record.error && !record.tool) { toast(`Không gọi được ${esc(tool)}: ${esc(record.error)}`, "error"); return null; }
    state.uiCalls.push(record);
    updateTraceCount();
    if (state.tab === "trace") renderTrace();
    return record;
  }

  async function runToolInto(slot, tool, args) {
    slot.innerHTML = `<div class="hint"><span class="typing"><i></i><i></i><i></i></span> Đang gọi <code>${esc(tool)}</code>…</div>`;
    const record = await callTool(tool, args);
    slot.replaceChildren();
    if (record) slot.append(renderResult(record.tool, record.args, record.result, { source: "ui", ms: record.duration_ms }));
    return record;
  }

  function askAgent(text) {
    closeDrawer();
    setTab("desk");
    sendMessage(text);
  }

  // ------------------------------------------------------------------ tabs
  function setTab(tab) {
    state.tab = tab === "trace" ? "trace" : "desk";
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === state.tab));
    $("#view-desk").hidden = state.tab !== "desk";
    $("#view-trace").hidden = state.tab !== "trace";
    if (location.hash.slice(1) !== state.tab) history.replaceState(null, "", `#${state.tab}`);
    if (state.tab === "trace") renderTrace();
  }

  // ------------------------------------------------------------------ dashboard
  async function loadData() {
    state.data = await api.get("/api/data");
    renderKpis();
    renderDash();
  }

  function renderKpis() {
    const d = state.data;
    const services = d.services.services;
    const issues = services.filter((s) => s.status !== "operational");
    const prodIssues = issues.filter((s) => s.environment === "production").length;
    const assets = d.assets.assets;
    const faulty = assets.filter((a) => deviceHealth(a) === "bad").length;
    const users = d.users.users;
    const blocked = users.filter((u) => u.account_status !== "active").length;
    const toolCalls = state.turns.reduce((n, t) => n + (t.tool_events || []).length, 0) + state.uiCalls.length;
    const kpi = (ic, bg, k, v) => `<div class="kpi"><div class="ic" style="background:${bg}">${ic}</div><div><div class="k">${k}</div><div class="v">${v}</div></div></div>`;
    $("#kpis").innerHTML = [
      kpi("🛰️", "#dbeafe", `Dịch vụ có sự cố · ${prodIssues} prod`, `${issues.length}<small> / ${services.length}</small>`),
      kpi("💻", "#fee2e2", "Thiết bị đang lỗi", `${faulty}<small> / ${assets.length}</small>`),
      kpi("👥", "#fef3c7", "Tài khoản bất thường", `${blocked}<small> / ${users.length}</small>`),
      kpi("🎫", "#ccfbf1", "Ticket đã tạo", `${d.tickets.length}`),
      kpi("🛠", "#ede9fe", "Tool call phiên này", `${toolCalls}`),
    ].join("");
  }

  function renderDash() {
    $$("#dash-tabs button").forEach((b) => b.classList.toggle("is-active", b.dataset.dash === state.dash));
    const body = $("#dash-body");
    body.replaceChildren(({ services: dashServices, devices: dashDevices, users: dashUsers, tickets: dashTickets, knowledge: dashKnowledge }[state.dash] || dashServices)());
  }

  const twoPaths = (text) => `<div class="two-paths">🔀 <span>${text}</span></div>`;

  function dashServices() {
    const panel = el("div", { class: "panel section" });
    const services = state.data.services.services;
    const byName = {};
    for (const s of services) (byName[s.service] ||= {})[s.environment] = s;
    const banners = services.filter((s) => s.status !== "operational").map((s) => `
      <div class="incident-banner ${s.status === "partial_outage" ? "bad" : ""}"><div><i class="dot ${esc(s.status)}"></i></div>
        <div style="flex:1"><div class="t">${esc(SERVICE_LABEL[s.service])} ${esc(s.environment)} · ${esc(STATUS_LABEL[s.status] || s.status)} <span class="mono muted" style="font-size:11px">${esc(s.incident_id)}</span></div>
        <div class="d">${esc(s.incident)}${s.workaround ? ` — <b>Workaround:</b> ${esc(s.workaround)}` : ""}</div></div></div>`).join("");
    panel.innerHTML = `<div class="section-head"><h2>Trạng thái dịch vụ dùng chung</h2><span class="spacer"></span><span class="hint">snapshot ${esc(fmtTime(state.data.services.snapshot_at))}</span></div>
      ${twoPaths("Hai đường trả lời: bấm một môi trường để xem chi tiết và gọi <code>check_service_status</code> trực tiếp, hoặc hỏi trợ lý trong khung chat.")}
      ${banners}
      <div class="svc-grid">${Object.entries(byName).map(([name, envs]) => `
        <div class="svc-card"><header><div class="svc-icon">${SERVICE_ICON[name] || "🛰️"}</div><div class="svc-name">${esc(SERVICE_LABEL[name] || name)}</div></header>
          ${["production", "staging"].filter((e) => envs[e]).map((e) => {
            const s = envs[e];
            const touched = state.touchedServices.has(`${name}:${e}`);
            return `<div class="svc-env" data-svc="${esc(name)}" data-env="${esc(e)}" style="${touched ? "border-color:var(--teal-2);background:#f0fdfa" : ""}">
              <i class="dot ${esc(s.status)}"></i><span class="env">${esc(e)}</span><span class="st">${esc(STATUS_LABEL[s.status] || s.status)}</span>${s.incident_id ? `<span class="inc">${esc(s.incident_id)}</span>` : ""}</div>`;
          }).join("")}
        </div>`).join("")}</div>`;
    panel.querySelectorAll("[data-svc]").forEach((n) => n.addEventListener("click", () => openServiceDrawer(n.dataset.svc, n.dataset.env)));
    return panel;
  }

  function dashDevices() {
    const panel = el("div", { class: "panel section" });
    const assets = state.data.assets.assets;
    const types = ["all", ...new Set(assets.map((a) => a.type))];
    const q = state.devSearch.trim().toLowerCase();
    const shown = assets.filter((a) => (state.devType === "all" || a.type === state.devType)
      && (!q || [a.asset_id, a.model, a.manufacturer, a.location, a.assigned_to].join(" ").toLowerCase().includes(q)));
    panel.innerHTML = `<div class="section-head"><h2>Thiết bị</h2><span class="spacer"></span>
        <input class="search" id="dev-search" placeholder="Tìm mã máy, model, vị trí…" value="${esc(state.devSearch)}" /></div>
      ${twoPaths("Bấm thiết bị để xem sức khỏe và chạy <code>inspect_device</code> theo từng nhóm, hoặc nhờ trợ lý kiểm tra.")}
      <div class="filters" style="margin-bottom:12px">${types.map((t) => `<button class="chip${state.devType === t ? " is-active" : ""}" data-type="${esc(t)}">${esc(TYPE_LABEL[t] || t)} <span class="muted">${t === "all" ? assets.length : assets.filter((a) => a.type === t).length}</span></button>`).join("")}</div>
      <div class="dev-grid">${shown.map((a) => {
        const sev = deviceHealth(a);
        return `<div class="dev-card${state.touchedAssets.has(a.asset_id) ? " touched" : ""}" data-asset="${esc(a.asset_id)}">
          <div class="dev-top"><div class="dev-illu">${deviceSVG(a.type, sev)}</div><div style="min-width:0;flex:1">
            <div class="dev-id">${esc(a.asset_id)} <i class="dot ${sev}" style="margin-left:4px"></i></div>
            <div class="dev-model">${esc(modelName(a))}</div></div></div>
          <div class="dev-meta"><span>📍 ${esc(a.location)}</span><span>💿 ${esc(a.os)}</span>${a.assigned_to ? `<span>👤 ${esc(a.assigned_to)}</span>` : ""}</div>
          <div><div class="health">${CHECKS.map((c) => `<span class="${severity(a.diagnostics[c])}" title="${esc(c)}: ${esc(a.diagnostics[c])}"></span>`).join("")}</div>
          <div class="health-legend">${CHECKS.map((c) => `<span>${c.slice(0, 4)}</span>`).join("")}</div></div>
        </div>`;
      }).join("") || `<div class="empty">Không có thiết bị phù hợp.</div>`}</div>`;
    panel.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { state.devType = b.dataset.type; renderDash(); }));
    panel.querySelectorAll("[data-asset]").forEach((c) => c.addEventListener("click", () => openDeviceDrawer(c.dataset.asset)));
    const search = $("#dev-search", panel);
    search.addEventListener("input", () => {
      state.devSearch = search.value;
      const pos = search.selectionStart;
      renderDash();
      const again = $("#dev-search");
      again.focus();
      again.setSelectionRange(pos, pos);
    });
    return panel;
  }

  function dashUsers() {
    const panel = el("div", { class: "panel section" });
    const users = state.data.users.users;
    panel.innerHTML = `<div class="section-head"><h2>Nhân viên</h2><span class="spacer"></span><span class="hint">${users.length} tài khoản giả lập</span></div>
      ${twoPaths("Bấm một dòng để gọi <code>lookup_user</code> trực tiếp hoặc hỏi trợ lý.")}
      <div class="table-wrap"><table class="data"><thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Văn phòng</th><th>Tài khoản</th><th>MFA</th><th>Thiết bị</th></tr></thead>
      <tbody>${users.map((u) => `<tr class="clickable" data-user="${esc(u.employee_id)}">
        <td><div class="person"><span class="avatar-sm" style="background:${avatarColor(u.employee_id)}">${esc(initials(u.display_name))}</span><div><div style="font-weight:600">${esc(u.display_name)}</div><div class="mono muted" style="font-size:11px">${esc(u.employee_id)}</div></div></div></td>
        <td>${esc(u.department)}</td><td>${esc(u.office)}</td>
        <td><span class="badge ${esc(u.account_status)}">${esc(u.account_status)}</span></td>
        <td><span class="badge ${esc(u.mfa_status)}">${esc(u.mfa_status)}</span></td>
        <td>${u.assigned_assets.map((a) => `<button class="chip" data-open-asset="${esc(a)}">${esc(a)}</button>`).join(" ") || `<span class="muted">—</span>`}</td></tr>`).join("")}</tbody></table></div>`;
    panel.querySelectorAll("[data-user]").forEach((r) => r.addEventListener("click", () => openUserDrawer(r.dataset.user)));
    panel.querySelectorAll("[data-open-asset]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); openDeviceDrawer(b.dataset.openAsset); }));
    return panel;
  }

  function dashTickets(prefill = {}) {
    const wrap = el("div", { class: "ticket-layout" });
    const assets = state.data.assets.assets;
    const form = el("div", { class: "panel section" });
    form.innerHTML = `<div class="section-head"><h2>Tạo ticket thủ công</h2></div>
      ${twoPaths("UI hỏi xác nhận payload rồi mới gọi <code>create_ticket</code>(confirmed=true); trong chat, agent phải tự hỏi xác nhận.")}
      <form class="form" id="ticket-form">
        <label class="field">Tóm tắt sự cố<textarea name="summary" required maxlength="1000" placeholder="VD: VPN báo AUTH_TIMEOUT khi kết nối từ nhà">${esc(prefill.summary || "")}</textarea></label>
        <div class="field">Mức ưu tiên<div class="prio-row">${PRIORITIES.map((p) => `<label><input type="radio" name="priority" value="${p}" ${p === (prefill.priority || "medium") ? "checked" : ""}/><span>${p}</span></label>`).join("")}</div></div>
        <label class="field">Thiết bị liên quan<select name="asset_id"><option value="">— Không gắn thiết bị —</option>
          ${assets.map((a) => `<option value="${esc(a.asset_id)}" ${a.asset_id === prefill.asset_id ? "selected" : ""}>${esc(a.asset_id)} · ${esc(a.model)}</option>`).join("")}</select></label>
        <button class="btn primary" type="submit">Xem lại &amp; tạo ticket</button>
        <p class="hint" style="margin:0">Không ghi mật khẩu, token, mã MFA vào ticket — tool sẽ từ chối (<code>restricted_sensitive_data</code>).</p>
      </form><div class="result-slot" id="ticket-result" style="margin-top:12px"></div>`;
    const list = el("div", { class: "panel section" });
    const tickets = state.data.tickets;
    list.innerHTML = `<div class="section-head"><h2>Ticket đã tạo</h2><span class="spacer"></span><span class="hint">thư mục <code>tickets/</code> (mock, không commit)</span></div>
      <div class="ticket-list">${tickets.map((t, i) => `<div class="ticket-item${i === 0 && state.flashTicket === t.ticket_id ? " new" : ""}">
          <span class="tid">🎫 ${esc(t.ticket_id)}</span><span>${t.asset_id ? `<button class="chip" data-open-asset="${esc(t.asset_id)}">${esc(t.asset_id)}</button>` : ""}</span>
          <span class="badge ${esc(t.priority)}">${esc(t.priority)}</span>
          <div class="sum">${esc(t.summary)}</div><div class="when">${esc(fmtTime(t.created_at))}</div></div>`).join("") || `<div class="empty">Chưa có ticket. Tạo bằng form bên cạnh hoặc nhờ trợ lý (sẽ được hỏi xác nhận).</div>`}</div>`;
    list.querySelectorAll("[data-open-asset]").forEach((b) => b.addEventListener("click", () => openDeviceDrawer(b.dataset.openAsset)));
    $("#ticket-form", form).addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const args = { summary: String(fd.get("summary") || "").trim(), priority: fd.get("priority"), asset_id: fd.get("asset_id") || "", confirmed: true };
      if (!args.summary) return;
      const dialog = $("#ticket-dialog");
      $("#ticket-payload").innerHTML = jsonHtml(args);
      dialog.returnValue = "";
      dialog.showModal();
      dialog.addEventListener("close", async function onClose() {
        dialog.removeEventListener("close", onClose);
        if (dialog.returnValue !== "confirm") return;
        const record = await runToolInto($("#ticket-result"), "create_ticket", args);
        if (record?.result?.status === "created") {
          toast(`🎫 Đã tạo ${esc(record.result.ticket_id)}`, "ok");
          state.flashTicket = record.result.ticket_id;
          ev.target.reset();
          await refreshTickets(false);
          const slot = $("#ticket-result");
          const keep = slot ? [...slot.childNodes] : [];
          renderDash();
          $("#ticket-result")?.append(...keep);
        }
      });
    });
    wrap.append(form, list);
    return wrap;
  }

  function dashKnowledge() {
    const wrap = el("div", { class: "kb-layout" });
    const kb = el("div", { class: "panel section" });
    const cats = ["all", ...new Set(state.data.kb.map((k) => k.category))];
    kb.innerHTML = `<div class="section-head"><h2>Knowledge base</h2></div>
      <form class="search-row" id="kb-form"><input class="search" name="q" placeholder="VD: vpn auth timeout windows" required />
        <select name="category">${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
        <button class="btn soft small" type="submit">⚡ search_kb</button></form>
      <div class="result-slot" id="kb-result" style="margin-bottom:10px"></div>
      <div class="kb-list">${state.data.kb.map((k) => `<div class="kb-item" data-title="${esc(k.title)}" data-cat="${esc(k.category)}"><span class="badge">${esc(k.category)}</span><span class="ttl">${esc(k.title)}</span><span class="id">${esc(k.article_id)}</span></div>`).join("")}</div>`;
    const pol = el("div", { class: "panel section" });
    const areas = ["all", ...state.data.policies.map((p) => p.policy_area)];
    pol.innerHTML = `<div class="section-head"><h2>Chính sách IT</h2></div>
      <form class="search-row" id="policy-form"><input class="search" name="q" placeholder="VD: ticket cần xác nhận không" required />
        <select name="area">${areas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}</select>
        <button class="btn soft small" type="submit">⚡ policy</button></form>
      <div class="result-slot" id="policy-result" style="margin-bottom:10px"></div>
      <div class="kb-list">${state.data.policies.map((p) => `<div class="kb-item" data-area="${esc(p.policy_area)}" data-ptitle="${esc(p.title)}"><span class="badge info">${esc(p.policy_area)}</span><span class="ttl">${esc(p.title)}</span></div>`).join("")}</div>`;
    $("#kb-form", kb).addEventListener("submit", (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); runToolInto($("#kb-result"), "search_kb", { query: fd.get("q"), category: fd.get("category"), top_k: 3 }); });
    $("#policy-form", pol).addEventListener("submit", (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); runToolInto($("#policy-result"), "policy", { query: fd.get("q"), policy_area: fd.get("area"), top_k: 3 }); });
    kb.querySelectorAll("[data-title]").forEach((n) => n.addEventListener("click", () => runToolInto($("#kb-result"), "search_kb", { query: n.dataset.title, category: n.dataset.cat, top_k: 1 })));
    pol.querySelectorAll("[data-area]").forEach((n) => n.addEventListener("click", () => runToolInto($("#policy-result"), "policy", { query: n.dataset.ptitle, policy_area: n.dataset.area, top_k: 2 })));
    wrap.append(kb, pol);
    return wrap;
  }

  async function refreshTickets(render = true) {
    try {
      const data = await api.get("/api/data");
      state.data.tickets = data.tickets;
      renderKpis();
      if (render && state.dash === "tickets") renderDash();
    } catch { /* keep current view */ }
  }

  // ------------------------------------------------------------------ drawers
  function openDrawer(html, bind) {
    $("#drawer-body").innerHTML = html;
    $("#drawer").hidden = false;
    $("#drawer-backdrop").hidden = false;
    bind?.($("#drawer-body"));
  }
  function closeDrawer() { $("#drawer").hidden = true; $("#drawer-backdrop").hidden = true; }

  function openServiceDrawer(service, env) {
    const s = state.data.services.services.find((x) => x.service === service && x.environment === env);
    if (!s) return;
    openDrawer(`<div class="hero"><div class="svc-icon" style="width:64px;height:64px;font-size:32px;border-radius:18px;background:#fff">${SERVICE_ICON[service] || "🛰️"}</div>
        <div><h2>${esc(SERVICE_LABEL[service] || service)} · ${esc(env)}</h2><span class="badge ${esc(s.status)}"><i class="dot ${esc(s.status)}"></i>${esc(STATUS_LABEL[s.status] || s.status)}</span></div></div>
      <div class="block"><h3>Chi tiết</h3><dl class="kv">
        <dt>Sự cố</dt><dd>${esc(s.incident || "Không có")}</dd><dt>Mã</dt><dd class="mono">${esc(s.incident_id || "—")}</dd>
        <dt>Khu vực</dt><dd>${esc((s.affected_locations || []).join(", ") || "—")}</dd><dt>Bắt đầu</dt><dd>${esc(fmtTime(s.started_at) || "—")}</dd>
        <dt>Cập nhật</dt><dd>${esc(fmtTime(s.last_updated))}</dd><dt>Workaround</dt><dd>${esc(s.workaround || "—")}</dd></dl></div>
      <div class="block"><h3>Hai đường trả lời</h3><div class="card-actions">
        <button class="btn soft" id="d-run">⚡ Gọi check_service_status</button>
        <button class="btn ghost" id="d-ask">💬 Hỏi trợ lý</button></div>
        <div class="result-slot" id="d-slot" style="margin-top:10px"></div></div>`, (root) => {
      $("#d-run", root).addEventListener("click", () => runToolInto($("#d-slot", root), "check_service_status", { service, environment: env }));
      $("#d-ask", root).addEventListener("click", () => askAgent(`Dịch vụ ${SERVICE_LABEL[service] || service} ${env} hiện có đang gặp sự cố không?`));
    });
  }

  function openDeviceDrawer(assetId) {
    const a = findAsset(assetId);
    if (!a) { toast(`Không có thiết bị ${esc(assetId)} trong dữ liệu`, "error"); return; }
    const sev = deviceHealth(a);
    const owner = a.assigned_to ? findUser(a.assigned_to) : null;
    openDrawer(`<div class="hero">${deviceSVG(a.type, sev)}<div><h2 class="mono">${esc(a.asset_id)}</h2>
        <div class="dev-model">${esc(modelName(a))}</div><div style="margin-top:6px"><span class="badge">${esc(TYPE_LABEL[a.type] || a.type)}</span> <span class="badge ${sev}">${sev === "ok" ? "khỏe" : sev === "warn" ? "cần chú ý" : "có lỗi"}</span></div></div></div>
      <div class="block"><h3>Thông tin</h3><dl class="kv"><dt>Hệ điều hành</dt><dd>${esc(a.os)}</dd><dt>Vị trí</dt><dd>${esc(a.location)}</dd>
        <dt>Người dùng</dt><dd>${owner ? `<button class="chip" id="d-owner">${esc(owner.display_name)} · ${esc(owner.employee_id)}</button>` : "—"}</dd>
        <dt>Mua ngày</dt><dd>${esc(a.purchase_date)}</dd><dt>Bảo hành đến</dt><dd>${esc(a.warranty_until)}</dd></dl></div>
      <div class="block"><h3>Chẩn đoán (snapshot)</h3>${diagRows(a.diagnostics, { asset: a.asset_id, buttons: true })}</div>
      <div class="block"><h3>Hai đường trả lời</h3><div class="card-actions">
        <button class="btn soft" id="d-run">⚡ inspect_device(all)</button>
        <button class="btn ghost" id="d-ask">💬 Nhờ trợ lý kiểm tra</button>
        <button class="btn ghost" id="d-ticket">🎫 Tạo ticket cho máy này</button></div>
        <div class="result-slot" id="d-slot" style="margin-top:10px"></div></div>`, (root) => {
      const slot = $("#d-slot", root);
      $("#d-run", root).addEventListener("click", () => runToolInto(slot, "inspect_device", { asset_id: a.asset_id, check: "all" }));
      root.querySelectorAll(".check-btn").forEach((b) => b.addEventListener("click", () => { runToolInto(slot, "inspect_device", { asset_id: a.asset_id, check: b.dataset.check }); slot.scrollIntoView({ behavior: "smooth", block: "nearest" }); }));
      $("#d-ask", root).addEventListener("click", () => askAgent(`Kiểm tra tổng thể thiết bị ${a.asset_id} giúp mình.`));
      $("#d-ticket", root).addEventListener("click", () => {
        closeDrawer();
        state.dash = "tickets";
        $$("#dash-tabs button").forEach((b) => b.classList.toggle("is-active", b.dataset.dash === "tickets"));
        const bad = CHECKS.filter((c) => severity(a.diagnostics[c]) !== "ok" && severity(a.diagnostics[c]) !== "na").map((c) => `${c}: ${a.diagnostics[c]}`);
        $("#dash-body").replaceChildren(dashTickets({ asset_id: a.asset_id, summary: bad[0] ? `${a.asset_id} ${bad[0]}` : "", priority: sev === "bad" ? "high" : "medium" }));
      });
      $("#d-owner", root)?.addEventListener("click", () => openUserDrawer(owner.employee_id));
    });
  }

  function openUserDrawer(employeeId) {
    const u = findUser(employeeId);
    if (!u) return;
    openDrawer(`<div class="hero"><span class="avatar-sm" style="width:64px;height:64px;font-size:22px;background:${avatarColor(u.employee_id)}">${esc(initials(u.display_name))}</span>
        <div><h2>${esc(u.display_name)}</h2><div class="mono muted">${esc(u.employee_id)}</div></div></div>
      <div class="block"><h3>Thông tin</h3><dl class="kv"><dt>Phòng ban</dt><dd>${esc(u.department)}</dd><dt>Văn phòng</dt><dd>${esc(u.office)}</dd>
        <dt>Tài khoản</dt><dd><span class="badge ${esc(u.account_status)}">${esc(u.account_status)}</span></dd><dt>MFA</dt><dd><span class="badge ${esc(u.mfa_status)}">${esc(u.mfa_status)}</span></dd>
        <dt>Thiết bị</dt><dd>${u.assigned_assets.map((a) => `<button class="chip" data-open-asset="${esc(a)}">${esc(a)}</button>`).join(" ") || "—"}</dd></dl></div>
      <div class="block"><h3>Hai đường trả lời</h3><div class="card-actions">
        <button class="btn soft" id="d-run">⚡ Gọi lookup_user</button><button class="btn ghost" id="d-ask">💬 Hỏi trợ lý</button></div>
        <div class="result-slot" id="d-slot" style="margin-top:10px"></div></div>`, (root) => {
      $("#d-run", root).addEventListener("click", () => runToolInto($("#d-slot", root), "lookup_user", { employee_id: u.employee_id }));
      $("#d-ask", root).addEventListener("click", () => askAgent(`Tra cứu tài khoản nhân viên ${u.employee_id} và thiết bị được cấp.`));
      root.querySelectorAll("[data-open-asset]").forEach((b) => b.addEventListener("click", () => openDeviceDrawer(b.dataset.openAsset)));
    });
  }

  // ------------------------------------------------------------------ chat
  const SUGGESTIONS = [
    ["🔐 VPN production", "VPN production hiện có đang gặp sự cố không?"],
    ["💻 Kiểm tra LT-240", "Kiểm tra tổng thể laptop LT-240 giúp mình."],
    ["❓ Thiếu mã máy", "Kiểm tra Wi-Fi trên laptop của mình giúp nhé."],
    ["👤 EMP-1003", "Tra cứu tài khoản nhân viên EMP-1003 và thiết bị được cấp."],
    ["📚 Hướng dẫn VPN", "Tìm hướng dẫn khắc phục VPN trên Windows 11."],
    ["🎫 Tạo ticket", "Tạo ticket mức high cho lỗi VPN trên LT-204 giúp mình."],
    ["🔀 VPN LT-204 + status", "VPN trên LT-204 lỗi; kiểm tra cả trạng thái VPN production và máy đó."],
    ["✉️ Email prod vs staging", "So sánh trạng thái email production và staging."],
    ["🖨️ PR-404", "Máy in PR-404 đang gặp vấn đề gì?"],
  ];

  function renderSuggestions() {
    $("#suggestions").replaceChildren(...SUGGESTIONS.map(([label, text]) => el("button", { type: "button", title: text, onclick: () => sendMessage(text) }, esc(label))));
  }

  const scrollChat = () => { const log = $("#chat-log"); log.scrollTop = log.scrollHeight; };

  function addUserMessage(text) {
    $("#chat-log").append(el("div", { class: "msg user" }, `<div class="bubble">${esc(text)}</div>`));
    scrollChat();
  }

  function addBotShell() {
    const wrap = el("div", { class: "msg bot" });
    const steps = el("div", { class: "steps" });
    const cards = el("div", { class: "cards" });
    const bubble = el("div", { class: "bubble" }, `<span class="typing"><i></i><i></i><i></i></span>`);
    const meta = el("div", { class: "meta" });
    wrap.append(steps, cards, bubble, meta);
    $("#chat-log").append(wrap);
    scrollChat();
    return { wrap, steps, cards, bubble, meta, chips: new Map() };
  }

  function chip(ui, key, cls, ico, html, detail) {
    let node = ui.chips.get(key);
    if (!node) {
      node = el("div", { class: `step-chip ${cls}` });
      node.addEventListener("click", () => {
        const next = node.nextElementSibling;
        if (next?.classList.contains("chip-detail")) { next.remove(); node.classList.remove("open"); return; }
        if (!node._detail) return;
        node.classList.add("open");
        node.after(el("div", { class: "chip-detail" }, node._detail()));
      });
      ui.steps.append(node);
      ui.chips.set(key, node);
    }
    node.innerHTML = `<span class="ico">${ico}</span>${html}`;
    node._detail = detail;
    scrollChat();
    return node;
  }

  function llmChip(ui, round, info) {
    const html = info.done
      ? `<b>LLM · vòng ${round}</b><span class="args">${info.calls ? `chọn ${info.calls} tool` : "trả lời trực tiếp"}</span><span class="ms">${fmtMs(info.ms)}</span>`
      : `<b>LLM · vòng ${round}</b><span class="args">đang suy luận…</span><span class="typing"><i></i><i></i><i></i></span>`;
    chip(ui, `llm-${round}`, "llm", "🧠", html, info.done ? () => `<div class="cd-row"><div class="k">assistant text</div>${info.text ? esc(info.text) : '<span class="muted">(trống)</span>'}</div>
      <div class="cd-row"><div class="k">tool_calls yêu cầu</div><pre class="json">${jsonHtml(info.toolCalls || [])}</pre></div>` : null);
  }

  function toolChip(ui, round, index, ev, done) {
    const status = done ? ev.status : "running";
    const html = `<b>${esc(ev.tool)}</b><span class="args" title="${esc(argsText(ev.args))}">${esc(argsText(ev.args))}</span>
      ${done ? `<span class="badge ${esc(status)}">${esc(status)}</span><span class="ms">${fmtMs(ev.duration_ms)}</span>` : `<span class="typing"><i></i><i></i><i></i></span>`}`;
    chip(ui, `tool-${round}-${index}`, "tool", "🛠", html, done ? () => `<div class="cd-row"><div class="k">input</div><pre class="json">${jsonHtml(ev.args)}</pre></div>
      <div class="cd-row"><div class="k">result</div><pre class="json">${jsonHtml(ev.result)}</pre></div>` : null);
  }

  function noteTouched(ev) {
    const r = ev.result || {};
    if (ev.tool === "inspect_device" && r.asset_id && !r.error) state.touchedAssets.add(r.asset_id);
    if (ev.tool === "check_service_status" && r.service && !r.error) state.touchedServices.add(`${r.service}:${r.environment}`);
  }

  function finishBot(ui, turn) {
    ui.bubble.classList.remove("error");
    if (turn.status === "provider_error") {
      ui.bubble.classList.add("error");
      ui.bubble.innerHTML = `<b>Lỗi provider</b><br><span class="mono" style="font-size:12px">${esc(turn.error)}</span>`;
    } else {
      const parsed = parseReply(turn.assistant_text);
      ui.bubble.innerHTML = md(parsed.reply || "(agent không trả lời bằng văn bản)");
      if (parsed.structured) {
        const tags = el("div", { class: "reply-tags" }, `${parsed.intent ? `<span class="badge info">intent: ${esc(parsed.intent)}</span>` : ""}${parsed.action ? `<span class="badge">action: ${esc(parsed.action)}</span>` : ""}
          ${(parsed.evidence || []).length ? `<span class="badge">evidence: ${esc([].concat(parsed.evidence).join(", "))}</span>` : ""}`);
        ui.bubble.append(tags);
      }
      if (turn.status === "waiting_for_user") {
        const clar = turn.clarify || {};
        const options = clar.response_type === "yes_no" ? ["Có, tôi xác nhận", "Không, hủy yêu cầu"] : clar.options || [];
        if (options.length) {
          const quick = el("div", { class: "quick-replies" });
          options.forEach((o) => quick.append(el("button", { class: "btn soft small", type: "button", onclick: () => sendMessage(o) }, esc(o))));
          ui.bubble.append(quick);
        }
      }
    }
    const tools = (turn.tool_events || []).length;
    const errors = (turn.tool_events || []).filter((e) => e.status === "error").length;
    ui.meta.innerHTML = `<span class="badge ${esc(turn.status)}">${esc(turn.status)}</span><span>${(turn.rounds || []).length} vòng LLM · ${tools} tool${errors ? ` · <b style="color:var(--bad)">${errors} lỗi</b>` : ""}</span>
      <span>${fmtMs(turn.total_ms)}</span><span class="mono" title="artifact_version">${esc(turn.artifact_version || "")}</span>`;
    ui.meta.append(el("a", { onclick: () => { state.selected = { kind: "turn", id: turn.turn_id }; state.traceMode = "turns"; setTab("trace"); } }, "Xem trace →"));
    scrollChat();
  }

  function renderFinishedTurn(turn) {
    addUserMessage(turn.user);
    const ui = addBotShell();
    for (const round of turn.rounds || []) {
      const timing = (turn.timing || []).find((t) => t.kind === "llm" && t.round === round.round);
      llmChip(ui, round.round, { done: true, calls: round.tool_calls.length, ms: timing ? timing.end_ms - timing.start_ms : null, text: round.assistant_text, toolCalls: round.tool_calls });
      round.tool_results.forEach((ev, i) => {
        toolChip(ui, round.round, i, ev, true);
        if (ev.tool !== "clarify") ui.cards.append(renderResult(ev.tool, ev.args, ev.result, { ms: ev.duration_ms }));
      });
    }
    finishBot(ui, turn);
  }

  async function sendMessage(text) {
    text = String(text || "").trim();
    if (!text || state.busy) { if (state.busy) toast("Trợ lý đang xử lý lượt trước…"); return; }
    state.busy = true;
    $("#chat-send").disabled = true;
    $("#chat-input").value = "";
    autosize();
    addUserMessage(text);
    const ui = addBotShell();
    state.touchedAssets.clear();
    state.touchedServices.clear();
    const live = { turn_id: `live-${Date.now()}`, user: text, running: true, t0: performance.now(), rounds: [], tool_events: [], timing: [], status: "running", artifact_version: state.info?.artifact_version };
    state.live = live;
    state.selected = { kind: "turn", id: live.turn_id };
    updateTraceCount();

    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: state.sessionId, message: text }) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handleEvent(JSON.parse(line), ui, live);
        }
      }
    } catch (err) {
      live.running = false;
      state.live = null;
      ui.bubble.classList.add("error");
      ui.bubble.textContent = `Mất kết nối tới server: ${err.message}`;
    } finally {
      state.busy = false;
      $("#chat-send").disabled = false;
      $("#chat-input").focus();
    }
  }

  function handleEvent(ev, ui, live) {
    switch (ev.event) {
      case "turn_start":
        live.turn_id = ev.turn_id;
        live.artifact_version = ev.artifact_version;
        state.selected = { kind: "turn", id: ev.turn_id };
        if (state.info && ev.artifact_version !== state.info.artifact_version) { state.info.artifact_version = ev.artifact_version; renderInfo(); toast("Artifact đã đổi — lượt này dùng phiên bản mới"); }
        break;
      case "llm_start":
        live.rounds.push({ round: ev.round, assistant_text: null, tool_calls: [], tool_results: [], running: true });
        live.timing.push({ kind: "llm", round: ev.round, start_ms: ev.t_ms, end_ms: null });
        llmChip(ui, ev.round, { done: false });
        break;
      case "llm_end": {
        const round = live.rounds.find((r) => r.round === ev.round);
        Object.assign(round, { assistant_text: ev.assistant_text, tool_calls: ev.tool_calls, running: false });
        live.timing.find((t) => t.kind === "llm" && t.round === ev.round).end_ms = ev.t_ms;
        llmChip(ui, ev.round, { done: true, calls: ev.tool_calls.length, ms: ev.t_ms - ev.start_ms, text: ev.assistant_text, toolCalls: ev.tool_calls });
        break;
      }
      case "tool_start":
        live.timing.push({ kind: "tool", round: ev.round, index: ev.index, tool: ev.tool, start_ms: ev.t_ms, end_ms: null });
        toolChip(ui, ev.round, ev.index, ev, false);
        break;
      case "tool_end": {
        const record = { tool: ev.tool, args: ev.args, result: ev.result, status: ev.status, round: ev.round, duration_ms: ev.duration_ms };
        live.rounds.find((r) => r.round === ev.round)?.tool_results.push(record);
        live.tool_events.push(record);
        const timing = live.timing.find((t) => t.kind === "tool" && t.round === ev.round && t.index === ev.index);
        if (timing) timing.end_ms = ev.t_ms;
        toolChip(ui, ev.round, ev.index, record, true);
        noteTouched(record);
        if (ev.tool !== "clarify") ui.cards.append(renderResult(ev.tool, ev.args, ev.result, { ms: ev.duration_ms, source: "agent" }));
        if (ev.tool === "create_ticket" && ev.result?.status === "created") { state.flashTicket = ev.result.ticket_id; toast(`🎫 Agent đã tạo ${esc(ev.result.ticket_id)}`, "ok"); refreshTickets(); }
        scrollChat();
        break;
      }
      case "turn_end":
        state.turns.push(ev.turn);
        state.live = null;
        state.transcriptPath = ev.transcript_path;
        finishBot(ui, ev.turn);
        updateTraceCount();
        renderKpis();
        if (state.dash === "devices" || state.dash === "services") renderDash();
        break;
      default:
        break;
    }
    if (state.tab === "trace") scheduleTrace();
  }

  function autosize() {
    const ta = $("#chat-input");
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }

  // ------------------------------------------------------------------ trace
  let traceRaf = 0;
  function scheduleTrace() { if (!traceRaf) traceRaf = requestAnimationFrame(() => { traceRaf = 0; renderTrace(); }); }
  setInterval(() => { if (state.live && state.tab === "trace" && state.traceMode === "turns") renderTrace(); }, 300);

  const allTurns = () => (state.live ? [...state.turns, state.live] : state.turns);
  function updateTraceCount() { $("#trace-count").textContent = allTurns().length + state.uiCalls.length; }

  function allToolCalls() {
    const rows = [];
    state.turns.forEach((t) => (t.tool_events || []).forEach((e, i) => rows.push({ ...e, source: "agent", turn_id: t.turn_id, turn_index: t.turn_index, created_at: t.started_at, key: `${t.turn_id}-${i}` })));
    state.uiCalls.forEach((c) => rows.push({ ...c, key: c.call_id }));
    return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  function renderTrace() {
    $$("#trace-mode button").forEach((b) => b.classList.toggle("is-active", b.dataset.mode === state.traceMode));
    if (state.traceMode === "log") { renderLogSide(); renderLog(); return; }
    renderTurnList();
    const main = $("#trace-main");
    const sel = state.selected;
    if (sel?.kind === "ui") {
      const call = state.uiCalls.find((c) => c.call_id === sel.id);
      if (call) { main.replaceChildren(uiCallDetail(call)); return; }
    }
    const turn = allTurns().find((t) => t.turn_id === sel?.id);
    if (!turn) {
      main.innerHTML = `<div class="panel trace-empty"><div class="big">🧭</div><h2>Trace hội thoại</h2>
        <p class="muted">Mỗi tin nhắn tạo một trace: LLM chọn tool → tool chạy với input cụ thể → kết quả hoặc lỗi → LLM tổng hợp câu trả lời, kèm độ trễ từng bước và <code>artifact_version</code>. Tool gọi trực tiếp từ bảng điều khiển cũng được ghi lại.</p></div>`;
      return;
    }
    const openRaw = main.querySelector("details.raw")?.open;
    const openRoundsScroll = window.scrollY;
    main.replaceChildren(...turnDetail(turn));
    if (openRaw) main.querySelector("details.raw").open = true;
    if (turn.running) window.scrollTo(0, openRoundsScroll);
  }

  function renderTurnList() {
    const list = $("#turn-list");
    const items = [
      ...allTurns().map((t) => ({ kind: "turn", id: t.turn_id, at: t.started_at || new Date().toISOString(), t })),
      ...state.uiCalls.map((c) => ({ kind: "ui", id: c.call_id, at: c.created_at, c })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!items.length) { list.innerHTML = `<li class="list-empty">Chưa có hoạt động. Chat với trợ lý hoặc bấm các nút ⚡ gọi tool trên bảng điều khiển.</li>`; return; }
    if (!state.selected || !items.some((i) => i.kind === state.selected.kind && i.id === state.selected.id)) state.selected = { kind: items[0].kind, id: items[0].id };
    list.replaceChildren(...items.map((item) => {
      const active = item.kind === state.selected.kind && item.id === state.selected.id;
      let inner;
      if (item.kind === "turn") {
        const t = item.t;
        const errors = (t.tool_events || []).filter((e) => e.status === "error").length;
        inner = `<div class="q">${esc(t.user)}</div><div class="m"><span class="badge src-agent">agent</span>
          ${t.running ? `<span class="badge run">● đang chạy</span>` : `<span class="badge ${esc(t.status)}">${esc(t.status)}</span><span>${fmtMs(t.total_ms)}</span>`}
          <span>${(t.tool_events || []).length} tool</span>${errors ? `<span class="badge error">${errors} lỗi</span>` : ""}</div>`;
      } else {
        const c = item.c;
        inner = `<div class="q mono" style="font-size:12px">${esc(c.tool)}(${esc(argsText(c.args))})</div><div class="m"><span class="badge src-ui">UI</span><span class="badge ${esc(c.status)}">${esc(c.status)}</span><span>${fmtMs(c.duration_ms)}</span><span>${esc(fmtTime(c.created_at))}</span></div>`;
      }
      return el("li", { class: `turn-item${active ? " is-active" : ""}`, onclick: () => { state.selected = { kind: item.kind, id: item.id }; renderTrace(); } }, inner);
    }));
  }

  function uiCallDetail(call) {
    const box = el("div", { class: "trace-main" });
    const summary = el("div", { class: "panel trace-summary" }, `<div class="q" style="font-family:var(--mono);font-size:15px">${esc(call.tool)}(${esc(argsText(call.args))})</div>
      <div class="trace-actions"><span class="badge src-ui">Gọi trực tiếp từ UI</span><span class="badge ${esc(call.status)}">${esc(call.status)}</span><span class="badge">${fmtMs(call.duration_ms)}</span><span class="badge">${esc(fmtTime(call.created_at))}</span></div>
      <p class="muted" style="margin:0">Đường thứ hai: bảng điều khiển gọi thẳng tool cục bộ, không qua LLM. Kết quả giống hệt khi agent gọi cùng input.</p>`);
    const card = el("div", { class: "panel section" });
    card.append(renderResult(call.tool, call.args, call.result, { source: "ui", ms: call.duration_ms }));
    box.append(summary, card);
    return box;
  }

  function turnDetail(turn) {
    const now = turn.running ? performance.now() - turn.t0 : turn.total_ms;
    const timing = turn.timing || [];
    const llmMs = timing.filter((t) => t.kind === "llm").reduce((n, t) => n + ((t.end_ms ?? now) - t.start_ms), 0);
    const toolMs = timing.filter((t) => t.kind === "tool").reduce((n, t) => n + ((t.end_ms ?? now) - t.start_ms), 0);
    const events = turn.tool_events || [];
    const errors = events.filter((e) => e.status === "error").length;

    const summary = el("div", { class: "panel trace-summary" });
    const parsed = turn.running ? null : parseReply(turn.assistant_text);
    summary.innerHTML = `<div class="q">${esc(turn.user)}</div>
      <div class="stats">
        <div class="stat"><div class="k">Tổng thời gian</div><div class="v">${fmtMs(now)}</div></div>
        <div class="stat"><div class="k">Vòng LLM</div><div class="v">${(turn.rounds || []).length}<small> / ${state.info?.max_tool_rounds ?? 4}</small></div></div>
        <div class="stat"><div class="k">Tool call</div><div class="v">${events.length}</div></div>
        <div class="stat"><div class="k">Tool lỗi</div><div class="v" style="color:${errors ? "var(--bad)" : "inherit"}">${errors}</div></div>
        <div class="stat"><div class="k">Thời gian LLM</div><div class="v">${fmtMs(llmMs)}</div></div>
        <div class="stat"><div class="k">Thời gian tool</div><div class="v">${fmtMs(toolMs)}</div></div>
      </div>
      <div class="trace-actions">
        ${turn.running ? `<span class="badge run">● Đang chạy</span>` : `<span class="badge ${esc(turn.status)}">${esc(turn.status)}</span>`}
        <span class="badge">${esc(state.info?.provider || "")} · ${esc(state.info?.model || "")}</span>
        <span class="badge mono" title="artifact_version">${esc(turn.artifact_version || "")}</span>
        <span style="flex:1"></span>
        <button class="btn ghost small" id="copy-turn" ${turn.running ? "disabled" : ""}>Copy JSON lượt này</button>
        <a class="btn ghost small" href="/api/transcript?session_id=${encodeURIComponent(state.sessionId)}" download>⬇ Transcript phiên</a>
      </div>
      ${turn.running ? "" : turn.status === "provider_error" ? `<div class="incident-banner bad"><div>⛔</div><div><div class="t">Provider error</div><div class="d mono">${esc(turn.error)}</div></div></div>`
        : `<div class="answer-box"><div class="panel-title" style="margin-bottom:4px">Câu trả lời ${turn.status === "waiting_for_user" ? "(đang chờ người dùng)" : ""}</div>${md(parsed.reply)}</div>`}`;
    summary.querySelector("#copy-turn")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(turn, null, 2)); toast("📋 Đã copy JSON lượt này"); } catch { toast("Trình duyệt chặn clipboard", "error"); }
    });

    // flow
    const nodes = [`<div class="flow-node user"><div class="k">User</div><div class="v">${esc(turn.user)}</div></div>`];
    for (const round of turn.rounds || []) {
      nodes.push(`<div class="flow-node llm"><div class="k">LLM · vòng ${round.round}</div><div class="v">${round.running ? "đang suy luận…" : round.tool_calls.length ? `chọn ${round.tool_calls.length} tool` : "trả lời"}</div></div>`);
      for (const ev of round.tool_results) nodes.push(`<div class="flow-node tool ${ev.status === "error" ? "error" : ""}"><div class="k">${esc(ev.status)}</div><div class="v">${esc(ev.tool)}</div></div>`);
    }
    if (!turn.running) {
      const cls = turn.status === "answered" ? "final" : turn.status === "waiting_for_user" ? "wait" : "tool error";
      const label = { answered: "Trả lời", waiting_for_user: "Hỏi lại user", provider_error: "Provider error", max_tool_rounds: "Dừng: max rounds" }[turn.status] || turn.status;
      nodes.push(`<div class="flow-node ${cls}"><div class="k">${esc(label)}</div><div class="v">${esc(parseReply(turn.assistant_text || turn.error).reply.slice(0, 60))}</div></div>`);
    }
    const flow = el("div", { class: "panel flow" }, `<div class="panel-title" style="margin-bottom:10px">Luồng tool calling</div><div class="flow-row">${nodes.join('<div class="flow-arrow">→</div>')}</div>`);

    // waterfall
    const span = Math.max(now || 0, 1);
    const pct = (ms) => `${Math.max(0, Math.min(100, (ms / span) * 100))}%`;
    const toolStatus = (t) => events.find((e) => e.round === t.round && e.tool === t.tool)?.status;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${fmtMs(span * f)}</span>`).join("");
    const wf = el("div", { class: "panel waterfall" }, `<div class="panel-title" style="margin-bottom:10px">Waterfall độ trễ</div>
      <div class="wf-grid"><div></div><div class="wf-axis">${ticks}</div><div></div>
      ${timing.map((t) => {
        const end = t.end_ms ?? now;
        const err = t.kind === "tool" && toolStatus(t) === "error";
        return `<div class="wf-label"><span class="kind ${t.kind}">${t.kind === "llm" ? "LLM" : "TOOL"}</span><span class="name">V${t.round} · ${esc(t.kind === "llm" ? "provider.complete" : t.tool)}</span></div>
          <div class="wf-track"><div class="wf-bar ${t.kind}${err ? " error" : ""}${t.end_ms == null && turn.running ? " running" : ""}" style="left:${pct(t.start_ms)};width:${pct(end - t.start_ms)}"></div></div>
          <div class="wf-ms">${fmtMs(end - t.start_ms)}</div>`;
      }).join("") || `<div></div><div class="hint">Chưa có bước nào.</div><div></div>`}</div>`);

    // rounds
    const rounds = (turn.rounds || []).map((round) => {
      const t = timing.find((x) => x.kind === "llm" && x.round === round.round);
      const card = el("article", { class: "panel round-card" });
      card.innerHTML = `<header><span class="round-no">${round.round}</span><span class="title">Vòng ${round.round}: ${round.running ? "LLM đang suy luận" : round.tool_calls.length ? `LLM gọi ${round.tool_calls.map((c) => `<code>${esc(c.name)}</code>`).join(", ")}` : "LLM trả lời, không gọi tool"}</span>
        <span class="lat">LLM ${t ? fmtMs((t.end_ms ?? now) - t.start_ms) : "…"}</span></header>`;
      const body = el("div", { class: "round-body" });
      body.append(el("div", { class: "blk llm" }, `<div class="k">🧠 Output của LLM</div>
        ${round.running ? `<span class="typing"><i></i><i></i><i></i></span>` : `${round.assistant_text ? `<pre class="json" style="background:#fffbeb;color:var(--ink)">${esc(round.assistant_text)}</pre>` : `<div class="hint">Không có text (chỉ tool_calls).</div>`}
          ${round.tool_calls.length ? `<div class="sub hint" style="margin:8px 0 4px">tool_calls yêu cầu</div><pre class="json">${jsonHtml(round.tool_calls)}</pre>` : ""}`}`));
      round.tool_results.forEach((ev, i) => {
        const blk = el("div", { class: "blk call" }, `<div class="k">🛠 Tool call ${i + 1}: <code>${esc(ev.tool)}</code><span class="badge ${esc(ev.status)}">${esc(ev.status)}</span><span class="badge">${fmtMs(ev.duration_ms)}</span></div>`);
        blk.append(renderResult(ev.tool, ev.args, ev.result, { ms: ev.duration_ms }));
        body.append(blk);
      });
      card.append(body);
      return card;
    });

    const raw = el("details", { class: "panel raw" }, `<summary>Raw JSON lượt này (định dạng transcript)</summary><pre class="json" style="margin-top:10px;max-height:520px">${jsonHtml(turn.running ? { ...turn, t0: undefined } : turn)}</pre>`);
    return [summary, flow, wf, ...rounds, raw];
  }

  function renderLogSide() {
    const rows = allToolCalls();
    const counts = {};
    rows.forEach((r) => { (counts[r.tool] ||= { n: 0, err: 0 }).n += 1; if (r.status === "error") counts[r.tool].err += 1; });
    const max = Math.max(1, ...Object.values(counts).map((c) => c.n));
    const list = $("#turn-list");
    const tools = (state.info?.tools || []).map((t) => t.name);
    list.innerHTML = `<li class="list-empty" style="padding:4px 6px">Số lần gọi theo tool (bấm để lọc)</li>` + tools.map((name) => {
      const c = counts[name] || { n: 0, err: 0 };
      return `<li class="turn-item${state.logFilter.tool === name ? " is-active" : ""}" data-tool="${esc(name)}"><div class="q mono" style="font-size:12px">${esc(name)}</div>
        <div class="m"><span>${c.n} lần</span>${c.err ? `<span class="badge error">${c.err} lỗi</span>` : ""}</div>
        <div class="tool-stat" style="border:0;padding:4px 0 0"><div class="bar"><i style="width:${(c.n / max) * 100}%"></i></div></div></li>`;
    }).join("");
    list.querySelectorAll("[data-tool]").forEach((n) => n.addEventListener("click", () => { state.logFilter.tool = state.logFilter.tool === n.dataset.tool ? "all" : n.dataset.tool; renderTrace(); }));
  }

  function renderLog() {
    const f = state.logFilter;
    const all = allToolCalls();
    const rows = all.filter((r) => (f.tool === "all" || r.tool === f.tool) && (f.source === "all" || r.source === f.source) && (!f.errorsOnly || r.status === "error"));
    const panel = el("div", { class: "panel log-panel" });
    const tools = ["all", ...new Set([...(state.info?.tools || []).map((t) => t.name), ...all.map((r) => r.tool)])];
    panel.innerHTML = `<div class="section-head"><h2>Lịch sử tool call</h2><span class="spacer"></span><span class="hint">${rows.length} / ${all.length} lượt gọi</span></div>
      <div class="log-filters">
        <select id="lf-tool">${tools.map((t) => `<option value="${esc(t)}" ${f.tool === t ? "selected" : ""}>${t === "all" ? "Mọi tool" : esc(t)}</option>`).join("")}</select>
        <select id="lf-source"><option value="all">Mọi nguồn</option><option value="agent" ${f.source === "agent" ? "selected" : ""}>Agent</option><option value="ui" ${f.source === "ui" ? "selected" : ""}>UI</option></select>
        <label><input type="checkbox" id="lf-err" ${f.errorsOnly ? "checked" : ""}/> Chỉ lỗi</label>
        <span style="flex:1"></span><a class="btn ghost small" href="/api/transcript?session_id=${encodeURIComponent(state.sessionId)}" download>⬇ Transcript phiên</a>
      </div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Thời điểm</th><th>Nguồn</th><th>Tool</th><th>Input</th><th>Trạng thái</th><th>Thời gian</th></tr></thead><tbody id="log-body"></tbody></table></div>
      ${rows.length ? "" : `<div class="empty" style="margin-top:12px">Chưa có tool call phù hợp bộ lọc.</div>`}`;
    const tbody = $("#log-body", panel);
    rows.slice().reverse().forEach((r) => {
      const tr = el("tr", { class: "clickable" }, `<td style="white-space:nowrap">${esc(fmtTime(r.created_at))}${r.turn_index ? `<div class="hint">lượt #${r.turn_index} · vòng ${r.round}</div>` : ""}</td>
        <td><span class="badge src-${esc(r.source)}">${r.source === "ui" ? "UI" : "agent"}</span></td><td class="mono" style="font-size:12px;font-weight:600">${esc(r.tool)}</td>
        <td class="args-cell" title="${esc(argsText(r.args))}">${esc(argsText(r.args))}</td><td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td><td class="mono" style="font-size:12px">${fmtMs(r.duration_ms)}</td>`);
      tr.addEventListener("click", () => {
        const next = tr.nextElementSibling;
        if (next?.classList.contains("detail-row")) { next.remove(); tr.classList.remove("expanded"); return; }
        tr.classList.add("expanded");
        const td = el("td", { colspan: "6" });
        td.append(renderResult(r.tool, r.args, r.result, { source: r.source, ms: r.duration_ms }));
        if (r.turn_id) {
          const open = el("div", { style: "margin-top:8px" });
          open.append(el("a", { class: "btn ghost small", onclick: () => { state.traceMode = "turns"; state.selected = { kind: "turn", id: r.turn_id }; renderTrace(); } }, "Mở trace lượt hội thoại →"));
          td.append(open);
        }
        const detail = el("tr", { class: "detail-row" });
        detail.append(td);
        tr.after(detail);
      });
      tbody.append(tr);
    });
    $("#lf-tool", panel).addEventListener("change", (e) => { f.tool = e.target.value; renderTrace(); });
    $("#lf-source", panel).addEventListener("change", (e) => { f.source = e.target.value; renderTrace(); });
    $("#lf-err", panel).addEventListener("change", (e) => { f.errorsOnly = e.target.checked; renderTrace(); });
    $("#trace-main").replaceChildren(panel);
  }

  // ------------------------------------------------------------------ boot
  function renderInfo() {
    $("#pill-model").textContent = `${state.info.provider} · ${state.info.model}`;
    $("#pill-version").textContent = state.info.artifact_version;
    const select = $("#version-select");
    select.replaceChildren(...(state.info.versions || []).map((v) => el("option", { value: v.id }, esc(v.label))));
    select.value = state.info.version_id;
  }

  function startNewSession() {
    state.sessionId = newId();
    store.set("northstar.session", state.sessionId);
    Object.assign(state, { turns: [], uiCalls: [], live: null, selected: null });
    state.touchedAssets.clear();
    state.touchedServices.clear();
    resetChatLog();
    updateTraceCount();
    renderKpis();
    renderDash();
    if (state.tab === "trace") renderTrace();
  }

  async function switchVersion(select) {
    const target = select.value;
    const label = select.selectedOptions[0]?.textContent || target;
    const hasActivity = state.turns.length || state.uiCalls.length;
    if (state.busy) { toast("Đợi lượt hiện tại chạy xong rồi đổi phiên bản"); select.value = state.info.version_id; return; }
    if (hasActivity && !confirm(`Chuyển sang ${label}? Phiên chat mới sẽ được mở, hội thoại hiện tại vẫn nằm trong transcript cũ.`)) {
      select.value = state.info.version_id;
      return;
    }
    select.disabled = true;
    try {
      const info = await api.post("/api/version", { version_id: target });
      if (info.error) throw new Error(info.error);
      state.info = info;
      renderInfo();
      startNewSession();
      toast(`Đang dùng ${esc(label)}`, "ok");
    } catch (err) {
      select.value = state.info.version_id;
      toast(`Không đổi được phiên bản: ${esc(err.message)}`, "error");
    } finally {
      select.disabled = false;
    }
  }

  function resetChatLog() {
    const intro = $("#chat-log .intro");
    $("#chat-log").replaceChildren(intro);
  }

  async function boot() {
    $$(".tab").forEach((t) => t.addEventListener("click", (ev) => { ev.preventDefault(); setTab(t.dataset.tab); }));
    $$("#dash-tabs button").forEach((b) => b.addEventListener("click", () => { state.dash = b.dataset.dash; renderDash(); }));
    $$("#trace-mode button").forEach((b) => b.addEventListener("click", () => { state.traceMode = b.dataset.mode; renderTrace(); }));
    $("#drawer-close").addEventListener("click", closeDrawer);
    $("#drawer-backdrop").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeDrawer(); });
    $("#composer").addEventListener("submit", (ev) => { ev.preventDefault(); sendMessage($("#chat-input").value); });
    $("#chat-input").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); sendMessage($("#chat-input").value); } });
    $("#chat-input").addEventListener("input", autosize);
    $("#btn-transcript").addEventListener("click", () => { if (!state.turns.length && !state.uiCalls.length) { toast("Phiên chưa có hoạt động để lưu"); return; } location.href = `/api/transcript?session_id=${encodeURIComponent(state.sessionId)}`; });
    $("#btn-new-session").addEventListener("click", () => {
      if (state.busy) return;
      if ((state.turns.length || state.uiCalls.length) && !confirm("Bắt đầu phiên mới? Hội thoại hiện tại vẫn được lưu trong transcript cũ.")) return;
      startNewSession();
      toast("Đã mở phiên mới", "ok");
    });
    $("#version-select").addEventListener("change", (ev) => switchVersion(ev.target));
    window.addEventListener("hashchange", () => setTab(location.hash.slice(1)));

    renderSuggestions();
    try {
      [state.info] = await Promise.all([api.get("/api/info"), loadData()]);
      renderInfo();
      const saved = await api.get(`/api/session?session_id=${encodeURIComponent(state.sessionId)}`);
      state.turns = saved.turns || [];
      state.uiCalls = saved.ui_calls || [];
      state.turns.forEach(renderFinishedTurn);
      updateTraceCount();
      renderKpis();
    } catch (err) {
      toast(`Không tải được dữ liệu: ${esc(err.message)}`, "error");
    }
    setTab(location.hash.slice(1) || "desk");
  }

  boot();
})();
