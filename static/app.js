/* ═══════════════════════════════════════════════════════════════════════════
   Body Freedom Lead Gen — app.js
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Password gate ─────────────────────────────────────────────────────────────

(function() {
  const PASS = "BKTestLab";
  const gate = document.getElementById("password-gate");
  const input = document.getElementById("password-input");
  const btn = document.getElementById("password-submit");
  const err = document.getElementById("password-error");

  if (sessionStorage.getItem("ml_auth") === "1") {
    gate.classList.add("hidden");
    return;
  }

  document.getElementById("app").style.display = "none";

  function attempt() {
    if (input.value === PASS) {
      sessionStorage.setItem("ml_auth", "1");
      gate.classList.add("hidden");
      document.getElementById("app").style.display = "";
    } else {
      err.textContent = "Incorrect access code.";
      input.value = "";
      input.focus();
    }
  }

  btn.addEventListener("click", attempt);
  input.addEventListener("keydown", e => { if (e.key === "Enter") attempt(); });
  input.focus();
})();

// ── Utilities ────────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function fmt(n) {
  if (n == null) return "—";
  n = Number(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${r.status} ${txt}`);
  }
  return r.json();
}

function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function scoreBadge(score) {
  if (!score) return `<span class="badge badge-1">?</span>`;
  return `<span class="badge badge-${score}">${score}</span>`;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

const tabs = {};
$$("[data-tab]", $("#nav")).forEach(btn => {
  tabs[btn.dataset.tab] = btn;
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  $$("[data-tab]", $("#nav")).forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "queue") loadQueue();
  if (name === "scrape") loadScrapeTab();
  if (name === "score") loadScoreTab();
  if (name === "leads") loadLeads();
  if (name === "insights") loadInsightsTab();
  if (name === "strategy") renderStrategy();
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 1 — DISCOVER
// ══════════════════════════════════════════════════════════════════════════════

let activeOrbitId = null;
let orbitPollTimer = null;
let orbitSortCol = "view_count";
let orbitSortDir = "desc";
let orbitCurrentPosts = [];

// Load past jobs on page load
loadPastJobs();

async function loadPastJobs() {
  try {
    const data = await api("GET", "/api/orbit-jobs");
    renderPastJobs(data.jobs || []);
  } catch (e) {
    console.warn("Failed to load past jobs:", e);
  }
}

function renderPastJobs(jobs) {
  const container = $("#past-jobs-container");
  if (!jobs.length) {
    container.innerHTML = `<div class="empty">No past searches yet.</div>`;
    return;
  }
  container.innerHTML = jobs.map(j => `
    <div class="orbit-job-row" data-orbit-id="${esc(j.orbit_id)}">
      <div class="job-card ${activeOrbitId === j.orbit_id ? 'active-job' : ''}">
        <span class="status-dot ${j.status === 'completed' ? 'dot-done' : j.status === 'running' ? 'dot-running' : 'dot-error'}"></span>
        <div class="job-card-meta">
          <div class="job-card-name">${esc(j.name || j.orbit_id)}</div>
          <div class="job-card-id">${esc(j.orbit_id)}</div>
        </div>
        <small style="color:var(--text-muted)">${esc(j.status)}</small>
      </div>
    </div>
  `).join("");

  $$(".orbit-job-row").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.orbitId;
      selectOrbitJob(id);
    });
  });
}

async function selectOrbitJob(orbitId) {
  activeOrbitId = orbitId;
  clearInterval(orbitPollTimer);
  showActiveJob(orbitId, "loading", null);
  await pollOrbit(orbitId);
}

$("#discover-form").addEventListener("submit", async e => {
  e.preventDefault();
  const raw = $("#kw-input").value.trim();
  if (!raw) return;
  const keywords = raw.split(",").map(s => s.trim()).filter(Boolean);
  const time_period = $("#period-select").value;
  const name = keywords.slice(0, 3).join(", ");

  const btn = $("#orbit-btn");
  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    const data = await api("POST", "/api/virlo/orbit", { keywords, name, time_period });

    if (data.duplicate) {
      const ok = confirm(
        `You already ran this search ("${data.existing_name}", status: ${data.existing_status}).\n\nRun again and spend Virlo credits?`
      );
      if (!ok) {
        btn.disabled = false;
        btn.textContent = "Search";
        return;
      }
      const forced = await api("POST", "/api/virlo/orbit", { keywords, name, time_period, force: true });
      activeOrbitId = forced.orbit_id;
      showActiveJob(forced.orbit_id, "running", null);
      startOrbitPolling(forced.orbit_id);
      await loadPastJobs();
      return;
    }

    activeOrbitId = data.orbit_id;
    showActiveJob(data.orbit_id, "running", null);
    startOrbitPolling(data.orbit_id);
    await loadPastJobs();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Search";
  }
});

function showActiveJob(orbitId, status, posts) {
  const area = $("#active-job-area");
  const isRunning = status === "running" || status === "loading";
  area.innerHTML = `
    <div class="job-card" style="margin-bottom:12px">
      ${isRunning ? `<span class="spinner"></span>` : `<span class="status-dot ${status === 'completed' ? 'dot-done' : 'dot-error'}"></span>`}
      <div class="job-card-meta">
        <div class="job-card-name">Active search</div>
        <div class="job-card-id">${esc(orbitId)}</div>
      </div>
      <small style="color:var(--text-muted)">${esc(status)}</small>
    </div>
  `;
  if (posts) renderOrbitResults(posts);
}

function startOrbitPolling(orbitId) {
  clearInterval(orbitPollTimer);
  orbitPollTimer = setInterval(() => pollOrbit(orbitId), 15000);
}

async function pollOrbit(orbitId) {
  try {
    const data = await api("GET", `/api/virlo/orbit/${orbitId}`);
    showActiveJob(orbitId, data.status, data.status === "completed" ? data.posts : null);
    if (data.status === "completed" || data.status === "failed") {
      clearInterval(orbitPollTimer);
      await loadPastJobs();
    }
  } catch (err) {
    console.error("Orbit poll error:", err);
  }
}

function renderOrbitResults(posts) {
  orbitCurrentPosts = posts || [];
  const area = $("#orbit-results-area");
  if (!orbitCurrentPosts.length) {
    area.innerHTML = `<div class="empty">No posts found.</div>`;
    return;
  }
  const sorted = sortPosts(orbitCurrentPosts, orbitSortCol, orbitSortDir);
  area.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;color:var(--text-muted)">${orbitCurrentPosts.length} posts found</span>
    </div>
    <div class="table-wrap">
      <table id="posts-table">
        <thead>
          <tr>
            <th class="sortable" data-col="creator_handle">Handle</th>
            <th class="sortable num" data-col="view_count">Views</th>
            <th class="sortable num" data-col="like_count">Likes</th>
            <th class="sortable num" data-col="comment_count">Comments</th>
            <th>URL</th>
            <th>Queue</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(p => postRow(p)).join("")}
        </tbody>
      </table>
    </div>
  `;
  applySortIndicators(orbitSortCol, orbitSortDir);

  $$("th.sortable", area).forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (orbitSortCol === col) orbitSortDir = orbitSortDir === "desc" ? "asc" : "desc";
      else { orbitSortCol = col; orbitSortDir = "desc"; }
      renderOrbitResults(orbitCurrentPosts);
    });
  });

  $$(".queue-toggle", area).forEach(btn => {
    btn.addEventListener("click", () => toggleQueue(btn));
  });
}

function postRow(p) {
  const inQueue = p.in_queue === 1;
  return `
    <tr>
      <td class="handle">@${esc(p.creator_handle || "—")}</td>
      <td class="num">${fmt(p.view_count)}</td>
      <td class="num">${fmt(p.like_count)}</td>
      <td class="num">${fmt(p.comment_count)}</td>
      <td class="url"><a href="${esc(p.post_url)}" target="_blank">${esc(p.post_url)}</a></td>
      <td>
        <button class="btn btn-sm queue-toggle ${inQueue ? 'btn-ghost' : ''}"
          data-post-id="${p.id}" data-in-queue="${inQueue ? '1' : '0'}">
          ${inQueue ? "Remove" : "+ Queue"}
        </button>
      </td>
    </tr>
  `;
}

function sortPosts(posts, col, dir) {
  return [...posts].sort((a, b) => {
    const va = a[col] ?? 0;
    const vb = b[col] ?? 0;
    if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === "asc" ? va - vb : vb - va;
  });
}

function applySortIndicators(col, dir) {
  $$("th.sortable").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.col === col) th.classList.add(`sort-${dir}`);
  });
}

async function toggleQueue(btn) {
  const postId = btn.dataset.postId;
  const inQueue = btn.dataset.inQueue === "1";
  btn.disabled = true;
  try {
    if (inQueue) {
      await api("DELETE", `/api/posts/${postId}/queue`);
    } else {
      await api("POST", `/api/posts/${postId}/queue`);
    }
    // flip in local data
    const post = orbitCurrentPosts.find(p => String(p.id) === String(postId));
    if (post) post.in_queue = inQueue ? 0 : 1;
    renderOrbitResults(orbitCurrentPosts);
    toast(inQueue ? "Removed from queue" : "Added to queue");
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
  }
}

// ── Satellite ─────────────────────────────────────────────────────────────────

$("#satellite-form").addEventListener("submit", async e => {
  e.preventDefault();
  let handle = $("#sat-handle").value.trim().replace(/^@/, "");
  if (!handle) return;
  const area = $("#satellite-results");
  area.innerHTML = `<div><span class="spinner"></span> Looking up @${esc(handle)}…</div>`;
  try {
    const data = await api("POST", "/api/virlo/satellite", { handle });
    renderSatelliteResult(data, handle, area);
  } catch (err) {
    area.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
  }
});

function renderSatelliteResult(data, handle, area) {
  const videos = data.videos || data.top_videos || [];
  const jobId = data.job_id || data.jobId;

  if (jobId && (!data.status || data.status !== "completed")) {
    area.innerHTML = `<div class="job-card"><span class="spinner"></span> Job queued: <span class="mono">${esc(jobId)}</span></div>`;
    const pollSat = async () => {
      try {
        const r = await api("GET", `/api/virlo/satellite/${jobId}`);
        if (r.status === "completed" || r.videos) {
          clearInterval(satTimer);
          renderSatelliteResult(r, handle, area);
        }
      } catch (_) {}
    };
    const satTimer = setInterval(pollSat, 5000);
    return;
  }

  if (!videos.length) {
    area.innerHTML = `<div class="empty">No videos found for @${esc(handle)}.</div>`;
    return;
  }

  area.innerHTML = `
    <div style="margin-bottom:8px;font-weight:500">@${esc(handle)} — ${videos.length} videos</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th class="num">Views</th>
            <th class="num">Likes</th>
            <th class="num">Comments</th>
            <th>Queue</th>
          </tr>
        </thead>
        <tbody>
          ${videos.map(v => {
            const url = v.post_url || v.url || v.postUrl || "";
            return `<tr>
              <td class="url"><a href="${esc(url)}" target="_blank">${esc(url)}</a></td>
              <td class="num">${fmt(v.view_count || v.views || v.viewCount)}</td>
              <td class="num">${fmt(v.like_count || v.likes || v.likeCount)}</td>
              <td class="num">${fmt(v.comment_count || v.comments || v.commentCount)}</td>
              <td><small style="color:var(--text-muted)">Add via Discover tab</small></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2 — QUEUE
// ══════════════════════════════════════════════════════════════════════════════

async function loadQueue() {
  const container = $("#queue-container");
  container.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    const data = await api("GET", "/api/queue");
    renderQueue(data.posts || []);
  } catch (err) {
    container.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
  }
}

function renderQueue(posts) {
  const container = $("#queue-container");
  if (!posts.length) {
    container.innerHTML = `<div class="empty">Queue is empty. Add posts from the Discover tab.</div>`;
    return;
  }
  container.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">${posts.length} post${posts.length !== 1 ? "s" : ""} queued</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Handle</th>
            <th class="num">Views</th>
            <th class="num">Comments</th>
            <th>URL</th>
            <th>Status</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          ${posts.map(p => `
            <tr>
              <td class="handle">@${esc(p.creator_handle || "—")}</td>
              <td class="num">${fmt(p.view_count)}</td>
              <td class="num">${fmt(p.comment_count)}</td>
              <td class="url"><a href="${esc(p.post_url)}" target="_blank">${esc(p.post_url)}</a></td>
              <td><span class="status-dot dot-${scrapeStatusDot(p.scrape_status)}"></span>${esc(p.scrape_status)}</td>
              <td>
                <button class="btn btn-sm btn-ghost remove-btn" data-post-id="${p.id}">Remove</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px">
      <button class="btn" id="queue-to-scrape-btn">Go to Scrape →</button>
    </div>
  `;

  $$(".remove-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api("DELETE", `/api/posts/${btn.dataset.postId}/queue`);
        toast("Removed from queue");
        loadQueue();
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
      }
    });
  });

  $("#queue-to-scrape-btn").addEventListener("click", () => switchTab("scrape"));
}

function scrapeStatusDot(s) {
  return s === "done" ? "done" : s === "scraping" ? "running" : s === "error" ? "error" : "pending";
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 3 — SCRAPE
// ══════════════════════════════════════════════════════════════════════════════

let scrapePollTimer = null;

async function loadScrapeTab() {
  const queueData = await api("GET", "/api/queue").catch(() => ({ posts: [] }));
  const queued = queueData.posts || [];
  $("#scrape-queue-count").textContent = queued.length;

  const scrapeBtn = $("#scrape-run-btn");
  scrapeBtn.disabled = queued.length === 0;

  await refreshScrapeStatus();
}

$("#scrape-run-btn").addEventListener("click", async () => {
  const btn = $("#scrape-run-btn");
  btn.disabled = true;
  btn.textContent = "Starting…";
  const include_replies = $("#include-replies-toggle").checked;
  try {
    await api("POST", "/api/scrape/run", { include_replies });
    toast("Scrape started" + (include_replies ? " (with reply threads)" : ""));
    startScrapePolling();
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
    btn.textContent = "Run Scrape →";
  }
});

function startScrapePolling() {
  clearInterval(scrapePollTimer);
  scrapePollTimer = setInterval(refreshScrapeStatus, 10000);
  refreshScrapeStatus();
}

async function refreshScrapeStatus() {
  try {
    const data = await api("GET", "/api/scrape/status");
    renderScrapeStatus(data);
    if (!data.running) clearInterval(scrapePollTimer);
  } catch (_) {}
}

function renderScrapeStatus(data) {
  const wrap = $("#scrape-progress-wrap");
  const label = $("#scrape-progress-label");
  const apifyStatus = $("#scrape-apify-status");
  const postList = $("#scrape-post-list");
  const btn = $("#scrape-run-btn");

  if (data.running || data.status !== "idle") {
    wrap.style.display = "block";
    label.innerHTML = data.running
      ? `<span class="spinner"></span> Scraping comments…`
      : data.error
        ? `<span style="color:var(--error)">Error: ${esc(data.error)}</span>`
        : `Done — ${data.status}`;
    apifyStatus.textContent = data.status || "";
    if (data.running) {
      $("#scrape-progress-bar").style.width = "60%";
    } else if (data.status === "SUCCEEDED") {
      $("#scrape-progress-bar").style.width = "100%";
      btn.disabled = false;
      btn.textContent = "Run Scrape →";
    } else {
      btn.disabled = false;
      btn.textContent = "Run Scrape →";
    }
  } else {
    wrap.style.display = "none";
  }

  if (data.post_statuses && Object.keys(data.post_statuses).length) {
    postList.innerHTML = `
      <div style="margin-top:16px">
        <div class="section-title" style="font-size:13px;color:var(--text-muted)">Post Status</div>
        ${Object.entries(data.post_statuses).map(([url, st]) => `
          <div class="card" style="display:flex;align-items:center;gap:10px;margin-top:8px">
            <span class="status-dot dot-${scrapeStatusDot(st)}"></span>
            <a href="${esc(url)}" target="_blank" style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(url)}</a>
            <span style="font-size:12px;color:var(--text-muted)">${esc(st)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 4 — SCORE
// ══════════════════════════════════════════════════════════════════════════════

let scorePollTimer = null;

async function loadScoreTab() {
  const data = await api("GET", "/api/score/status").catch(() => ({ running: false, processed: 0, total: 0 }));
  renderScoreStatus(data);
  // load unscored count
  const leads = await api("GET", "/api/leads").catch(() => ({ leads: [] }));
  const unscored = (leads.leads || []).filter(l => l.score == null).length;
  $("#unscored-count").textContent = unscored;
  if (data.running) startScorePolling();
}

$("#score-run-btn").addEventListener("click", async () => {
  const btn = $("#score-run-btn");
  btn.disabled = true;
  try {
    await api("POST", "/api/score/run");
    toast("Scoring started");
    startScorePolling();
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
  }
});

function startScorePolling() {
  clearInterval(scorePollTimer);
  scorePollTimer = setInterval(refreshScoreStatus, 3000);
}

async function refreshScoreStatus() {
  try {
    const data = await api("GET", "/api/score/status");
    renderScoreStatus(data);
    if (!data.running) {
      clearInterval(scorePollTimer);
      $("#score-run-btn").disabled = false;
      // reload unscored count
      const leads = await api("GET", "/api/leads").catch(() => ({ leads: [] }));
      const unscored = (leads.leads || []).filter(l => l.score == null).length;
      $("#unscored-count").textContent = unscored;
      await loadScoredPreview();
    }
  } catch (_) {}
}

function renderScoreStatus(data) {
  const area = $("#score-progress-area");
  if (data.running) {
    area.style.display = "block";
    const pct = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
    $("#score-progress-bar").style.width = pct + "%";
    $("#score-progress-text").textContent = `${data.processed} / ${data.total}`;
  } else {
    if (data.error) {
      area.style.display = "block";
      area.innerHTML = `<div class="error-msg">Error: ${esc(data.error)}</div>`;
    } else {
      area.style.display = "none";
    }
  }
}

async function loadScoredPreview() {
  try {
    const data = await api("GET", "/api/leads?score=3");
    const leads = (data.leads || []).slice(0, 5);
    const area = $("#scored-preview");
    if (!leads.length) { area.innerHTML = ""; return; }
    area.innerHTML = `
      <div class="section-title" style="font-size:13px;margin-top:20px;color:var(--text-muted)">
        Recent Hot Leads (Score 3)
      </div>
      ${leads.map(l => miniLeadCard(l)).join("")}
    `;
  } catch (_) {}
}

function miniLeadCard(l) {
  return `
    <div class="card" style="margin-top:8px">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
        ${scoreBadge(l.score)}
        <strong>@${esc(l.commenter_username)}</strong>
        <span style="color:var(--text-muted);font-size:12px;margin-left:auto">${esc(l.source_post_url || "")}</span>
      </div>
      <div class="lead-comment">${esc(l.comment_text)}</div>
      ${l.score_reasoning ? `<div class="lead-reasoning">${esc(l.score_reasoning)}</div>` : ""}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 5 — LEADS
// ══════════════════════════════════════════════════════════════════════════════

async function loadLeads() {
  const score = $("#filter-score").value;
  const status = $("#filter-status").value;
  const source_post_url = $("#filter-post").value.trim();
  const lead_type = $("#filter-lead-type").value;

  const params = new URLSearchParams();
  if (score) params.set("score", score);
  if (status) params.set("status", status);
  if (source_post_url) params.set("source_post_url", source_post_url);
  if (lead_type) params.set("lead_type", lead_type);

  const container = $("#leads-container");
  container.innerHTML = `<div class="empty"><span class="spinner"></span> Loading…</div>`;
  try {
    const data = await api("GET", `/api/leads?${params}`);
    const leads = data.leads || [];
    $("#leads-count").textContent = `${leads.length} lead${leads.length !== 1 ? "s" : ""}`;
    renderLeads(leads);
  } catch (err) {
    container.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
  }
}

$("#leads-apply-btn").addEventListener("click", loadLeads);
["filter-score", "filter-status", "filter-lead-type"].forEach(id => {
  $(`#${id}`).addEventListener("change", loadLeads);
});

function renderLeads(leads) {
  const container = $("#leads-container");
  if (!leads.length) {
    container.innerHTML = `<div class="empty">No leads found.</div>`;
    return;
  }
  container.innerHTML = leads.map(l => leadCard(l)).join("");

  // Collapse toggle
  $$(".lead-header").forEach(header => {
    header.addEventListener("click", () => {
      header.closest(".lead-card").classList.toggle("collapsed");
    });
  });

  // DM draft autosave
  $$(".dm-textarea").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const leadId = ta.dataset.leadId;
      try {
        await api("PATCH", `/api/leads/${leadId}`, { dm_draft: ta.value });
      } catch (err) {
        toast("Save failed: " + err.message, "error");
      }
    });
  });

  // Status select
  $$(".status-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      const leadId = sel.dataset.leadId;
      try {
        await api("PATCH", `/api/leads/${leadId}`, { status: sel.value });
        toast("Status updated");
      } catch (err) {
        toast(err.message, "error");
        loadLeads();
      }
    });
  });

  // Instagram DM button
  $$(".ig-dm-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const username = btn.dataset.username;
      navigator.clipboard.writeText("@" + username).catch(() => {});
      window.open("https://www.instagram.com/direct/new/", "_blank");
      toast(`@${username} copied — opening IG DMs`);
    });
  });

  // ManyChat button
  $$(".manychat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      window.open("https://manychat.com", "_blank");
    });
  });

  // Hide (collapse) button
  $$(".hide-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".lead-card").classList.add("collapsed");
    });
  });
}

function leadCard(l) {
  const scoreClass = l.score ? `score-${l.score}` : "";
  const statusOpts = ["new", "contacted", "responded", "not_relevant"];
  const keywordBadge = l.lead_type === "keyword_responder"
    ? `<span class="badge badge-keyword">keyword</span>` : "";
  const opBadge = l.creator_replied
    ? `<span class="badge badge-op">OP replied</span>` : "";
  return `
    <div class="lead-card ${scoreClass}" data-lead-id="${l.id}">
      <div class="lead-header">
        ${scoreBadge(l.score)}
        ${keywordBadge}${opBadge}
        <span class="lead-username">@${esc(l.commenter_username)}</span>
        ${l.source_post_url ? `<span class="lead-source">from <a href="${esc(l.source_post_url)}" target="_blank" onclick="event.stopPropagation()">${esc(shortUrl(l.source_post_url))}</a></span>` : ""}
        <span class="lead-collapse-icon">▾</span>
      </div>
      <div class="lead-body">
        <blockquote class="lead-comment">${esc(l.comment_text)}</blockquote>
        ${l.score_reasoning ? `<div class="lead-reasoning">${esc(l.score_reasoning)}</div>` : ""}
        ${l.dm_draft !== null && l.score !== 1 ? `
          <div class="lead-dm-label">DM Draft</div>
          <div class="lead-dm-draft">
            <textarea class="dm-textarea" data-lead-id="${l.id}" rows="3">${esc(l.dm_draft || "")}</textarea>
          </div>
        ` : ""}
        <div class="lead-actions">
          <select class="status-select" data-lead-id="${l.id}">
            ${statusOpts.map(s => `<option value="${s}" ${l.status === s ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}
          </select>
          <button class="btn btn-sm ig-dm-btn" data-username="${esc(l.commenter_username)}">Open IG DM</button>
          <button class="btn btn-sm btn-ghost manychat-btn">ManyChat</button>
          <button class="btn btn-sm btn-ghost hide-btn">Hide</button>
          ${l.profile_url ? `<a href="${esc(l.profile_url)}" target="_blank" class="btn btn-sm btn-ghost">Profile ↗</a>` : ""}
        </div>
      </div>
    </div>
  `;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    return parts[parts.length - 1] || u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}

// Load initial data
loadPastJobs();

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 6 — INSIGHTS
// ══════════════════════════════════════════════════════════════════════════════

let insightsPollTimer = null;

async function loadInsightsTab() {
  // Populate scope dropdown with orbit jobs
  try {
    const jobsData = await api("GET", "/api/orbit-jobs");
    const scopeSel = $("#insights-scope");
    const jobs = (jobsData.jobs || []).filter(j => j.status === "completed");
    // Clear all but the first "All leads" option
    while (scopeSel.options.length > 1) scopeSel.remove(1);
    jobs.forEach(j => {
      const opt = document.createElement("option");
      opt.value = j.orbit_id;
      opt.textContent = j.name || j.orbit_id;
      scopeSel.appendChild(opt);
    });
  } catch (_) {}

  // Load history
  await loadInsightsHistory();

  // Check if running
  try {
    const status = await api("GET", "/api/analyze/status");
    if (status.running) startInsightsPolling();
    if (status.latest_id) await loadAndRenderAnalysis(status.latest_id);
  } catch (_) {}
}

async function loadInsightsHistory() {
  try {
    const data = await api("GET", "/api/analyze-history");
    const analyses = data.analyses || [];
    const container = $("#insights-history");
    if (!analyses.length) { container.innerHTML = ""; return; }
    container.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Past analyses — click to reload</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        ${analyses.map(a => `
          <button class="btn btn-sm btn-ghost history-analysis-btn" data-id="${a.id}">
            ${esc(a.scope_label)} · ${a.comment_count} comments · ${esc(a.created_at.slice(0,10))}
          </button>
        `).join("")}
      </div>
    `;
    $$(".history-analysis-btn").forEach(btn => {
      btn.addEventListener("click", () => loadAndRenderAnalysis(Number(btn.dataset.id)));
    });
  } catch (_) {}
}

$("#insights-run-btn").addEventListener("click", async () => {
  const btn = $("#insights-run-btn");
  const scope = $("#insights-scope").value;
  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    await api("POST", "/api/analyze/run", { scope });
    toast("Analysis started");
    startInsightsPolling();
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
    btn.textContent = "Run Analysis →";
  }
});

function startInsightsPolling() {
  $("#insights-progress-wrap").style.display = "block";
  clearInterval(insightsPollTimer);
  insightsPollTimer = setInterval(async () => {
    try {
      const status = await api("GET", "/api/analyze/status");
      if (!status.running) {
        clearInterval(insightsPollTimer);
        $("#insights-progress-wrap").style.display = "none";
        $("#insights-run-btn").disabled = false;
        $("#insights-run-btn").textContent = "Run Analysis →";
        if (status.error) {
          toast("Analysis error: " + status.error, "error");
        } else if (status.latest_id) {
          await loadAndRenderAnalysis(status.latest_id);
          await loadInsightsHistory();
        }
      }
    } catch (_) {}
  }, 3000);
}

async function loadAndRenderAnalysis(id) {
  try {
    const data = await api("GET", `/api/analyze/${id}`);
    if (data.analysis) renderAnalysis(data.analysis);
  } catch (err) {
    toast("Failed to load analysis: " + err.message, "error");
  }
}

function renderAnalysis(a) {
  const r = a.result;
  const container = $("#insights-results");
  container.innerHTML = `
    <div class="insights-meta">
      Analyzed <strong>${a.comment_count}</strong> comments · scope: <strong>${esc(a.scope_label)}</strong> · ${esc((a.created_at || "").slice(0,16).replace("T"," "))}
    </div>

    ${insightSection("Who They Are", `<p class="audience-profile">${esc(r.audience_profile || "")}</p>`)}

    ${insightSection("Pain Points", (r.pain_points || []).map(p => `
      <div class="pain-card">
        <div class="pain-card-header">
          <span class="pain-label">${esc(p.label)}</span>
          <span class="badge intensity-${p.intensity || 'medium'}">${esc(p.intensity || "")}</span>
          ${p.body_area ? `<span class="badge badge-area">${esc(p.body_area.replace("_"," "))}</span>` : ""}
        </div>
        ${(p.quotes || []).map(q => `<blockquote class="pain-quote">"${esc(q)}"</blockquote>`).join("")}
      </div>
    `).join(""))}

    ${insightSection("Their Language", `
      <div class="pill-cloud">
        ${(r.their_language || []).map(phrase => `
          <span class="pill" title="Click to copy" onclick="copyPill(this)">${esc(phrase)}</span>
        `).join("")}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Click any phrase to copy it</div>
    `)}

    ${insightSection("What They've Tried (That Didn't Work)", `
      <div class="tried-grid">
        ${(r.tried_and_failed || []).map(t => `
          <div class="tried-item">
            <div class="tried-solution">${esc(t.solution)}</div>
            <div class="tried-why">${esc(t.why_it_failed)}</div>
          </div>
        `).join("")}
      </div>
    `)}

    ${insightSection("Questions They Ask", `
      <ul class="questions-list">
        ${(r.questions_they_ask || []).map(q => `<li>"${esc(q)}"</li>`).join("")}
      </ul>
    `)}

    ${insightSection("Emotional Signals", `
      <div class="pill-cloud">
        ${(r.emotional_signals || []).map(s => `<span class="pill pill-emotion">${esc(s)}</span>`).join("")}
      </div>
    `)}

    <div class="insights-divider"><span>Content Strategy</span></div>

    ${insightSection("Content Hooks", (r.content_hooks || []).map(h => `
      <div class="hook-card">
        <div class="hook-line">${esc(h.hook)}</div>
        <div class="hook-meta">
          <span class="badge badge-angle">${esc(h.angle || "")}</span>
          <span class="hook-why">${esc(h.why_it_works || "")}</span>
        </div>
        <button class="copy-btn" onclick="copyText(${JSON.stringify(h.hook)}, this)">Copy</button>
      </div>
    `).join(""))}

    ${insightSection("Content Pillars", `
      <div class="pillars-grid">
        ${(r.content_pillars || []).map(p => `
          <div class="pillar-card">
            <div class="pillar-name">${esc(p.name)}</div>
            <div class="pillar-rationale">${esc(p.rationale || "")}</div>
            <div class="pillar-meta">
              ${(p.content_types || []).map(t => `<span class="badge badge-format">${esc(t)}</span>`).join("")}
              ${p.post_frequency ? `<span style="font-size:11px;color:var(--text-muted)">${esc(p.post_frequency)}</span>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `)}

    ${insightSection("Video Concepts", (r.video_concepts || []).map(v => `
      <div class="concept-card">
        <div class="concept-header">
          <span class="concept-format badge badge-format">${esc(v.format || "")}</span>
          <strong class="concept-title">${esc(v.title)}</strong>
        </div>
        <div class="concept-hook">"${esc(v.hook_line)}"</div>
        ${v.visual_open ? `<div class="concept-visual">📹 ${esc(v.visual_open)}</div>` : ""}
        <div class="concept-arc">
          <div class="arc-step"><span class="arc-label">Problem</span>${esc(v.problem || "")}</div>
          <div class="arc-step"><span class="arc-label">Solution</span>${esc(v.solution || "")}</div>
          <div class="arc-step"><span class="arc-label">Payoff</span>${esc(v.payoff || "")}</div>
        </div>
        ${v.cta ? `<div class="concept-cta"><strong>CTA:</strong> ${esc(v.cta)}</div>` : ""}
        ${v.caption_hook ? `<div class="concept-caption"><strong>Caption hook:</strong> "${esc(v.caption_hook)}"</div>` : ""}
        ${v.hashtag_angle ? `<div class="concept-hashtags"><strong>Hashtags:</strong> ${esc(v.hashtag_angle)}</div>` : ""}
        <button class="copy-btn" onclick="copyConceptBrief(this)" data-concept='${JSON.stringify(v).replace(/'/g,"&#39;")}'>Copy full brief</button>
      </div>
    `).join(""))}
  `;
}

function insightSection(title, content) {
  return `
    <div class="insight-section">
      <div class="insight-section-title">${title}</div>
      <div class="insight-section-body">${content}</div>
    </div>
  `;
}

function copyPill(el) {
  navigator.clipboard.writeText(el.textContent).then(() => {
    el.classList.add("copied");
    setTimeout(() => el.classList.remove("copied"), 1200);
  });
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

function copyConceptBrief(btn) {
  const v = JSON.parse(btn.dataset.concept);
  const text = [
    `TITLE: ${v.title}`,
    `FORMAT: ${v.format}`,
    ``,
    `HOOK (first 3 seconds): "${v.hook_line}"`,
    v.visual_open ? `VISUAL OPEN: ${v.visual_open}` : "",
    ``,
    `PROBLEM: ${v.problem}`,
    `SOLUTION: ${v.solution}`,
    `PAYOFF: ${v.payoff}`,
    ``,
    v.cta ? `CTA: ${v.cta}` : "",
    v.caption_hook ? `CAPTION HOOK: "${v.caption_hook}"` : "",
    v.hashtag_angle ? `HASHTAGS: ${v.hashtag_angle}` : "",
  ].filter(Boolean).join("\n");
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// STRATEGY TAB
// ══════════════════════════════════════════════════════════════════════════════

const PILLAR_ICONS = {
  disconnected: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#2e2e2e" stroke-width="1"/>
    <!-- Chain link left -->
    <rect x="14" y="33" width="18" height="14" rx="7" fill="none" stroke="#3dde84" stroke-width="2.2"/>
    <line x1="22" y1="33" x2="22" y2="47" stroke="#3dde84" stroke-width="2.2"/>
    <!-- Gap / lightning bolt -->
    <polyline points="34,36 37,40 34,44" fill="none" stroke="#3dde84" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="46,36 43,40 46,44" fill="none" stroke="#3dde84" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Chain link right -->
    <rect x="48" y="33" width="18" height="14" rx="7" fill="none" stroke="#3dde84" stroke-width="2.2"/>
    <line x1="57" y1="33" x2="57" y2="47" stroke="#3dde84" stroke-width="2.2"/>
    <!-- Crack lines -->
    <line x1="38" y1="38" x2="42" y2="42" stroke="#3dde84" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
  </svg>`,

  steps: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#2e2e2e" stroke-width="1"/>
    <!-- Ascending steps -->
    <polyline points="16,56 16,46 28,46 28,36 40,36 40,26 62,26" fill="none" stroke="#3dde84" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Arrow up -->
    <polyline points="54,18 62,26 54,34" fill="none" stroke="#3dde84" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Step fills (subtle) -->
    <rect x="16" y="46" width="12" height="10" fill="#3dde84" opacity="0.07"/>
    <rect x="28" y="36" width="12" height="20" fill="#3dde84" opacity="0.07"/>
    <rect x="40" y="26" width="22" height="30" fill="#3dde84" opacity="0.07"/>
  </svg>`,

  desk: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#2e2e2e" stroke-width="1"/>
    <!-- Monitor screen -->
    <rect x="18" y="22" width="44" height="30" rx="3" fill="none" stroke="#3dde84" stroke-width="2.2"/>
    <!-- Screen X -->
    <line x1="26" y1="30" x2="54" y2="44" stroke="#3dde84" stroke-width="1.5" opacity="0.4"/>
    <line x1="54" y1="30" x2="26" y2="44" stroke="#3dde84" stroke-width="1.5" opacity="0.4"/>
    <!-- Stand -->
    <line x1="40" y1="52" x2="40" y2="60" stroke="#3dde84" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="30" y1="60" x2="50" y2="60" stroke="#3dde84" stroke-width="2.2" stroke-linecap="round"/>
    <!-- Person slumped (simplified) -->
    <circle cx="40" cy="32" r="3.5" fill="none" stroke="#3dde84" stroke-width="1.8"/>
    <path d="M40 35.5 Q37 42 34 44" fill="none" stroke="#3dde84" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
  </svg>`,

  feltSense: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#2e2e2e" stroke-width="1"/>
    <!-- Head silhouette -->
    <circle cx="40" cy="28" r="12" fill="none" stroke="#3dde84" stroke-width="2"/>
    <!-- Neck -->
    <line x1="36" y1="39" x2="36" y2="44" stroke="#3dde84" stroke-width="2"/>
    <line x1="44" y1="39" x2="44" y2="44" stroke="#3dde84" stroke-width="2"/>
    <!-- Shoulders -->
    <path d="M28,44 Q40,50 52,44" fill="none" stroke="#3dde84" stroke-width="2" stroke-linecap="round"/>
    <!-- Pulse wave emanating -->
    <path d="M14,60 L22,60 L26,52 L30,68 L34,56 L38,60 L66,60" fill="none" stroke="#3dde84" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  longevity: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#2e2e2e" stroke-width="1"/>
    <!-- Infinity symbol -->
    <path d="M22,40 C22,32 28,28 34,28 C40,28 40,40 40,40 C40,40 40,52 46,52 C52,52 58,48 58,40 C58,32 52,28 46,28 C40,28 40,40 40,40 C40,40 40,52 34,52 C28,52 22,48 22,40 Z" fill="none" stroke="#3dde84" stroke-width="2.5"/>
    <!-- Running figure on the path -->
    <circle cx="53" cy="32" r="2.5" fill="#3dde84"/>
    <line x1="53" y1="34" x2="53" y2="40" stroke="#3dde84" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="53" y1="37" x2="49" y2="40" stroke="#3dde84" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="53" y1="37" x2="57" y2="40" stroke="#3dde84" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="50" y1="40" x2="48" y2="44" stroke="#3dde84" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="56" y1="40" x2="58" y2="44" stroke="#3dde84" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  journey: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="#1a1a1a" stroke="#2e2e2e" stroke-width="1"/>
    <!-- Ascending spiral path -->
    <path d="M40,65 C28,65 18,58 18,50 C18,42 28,37 40,37 C52,37 60,32 60,26 C60,20 52,15 40,15" fill="none" stroke="#3dde84" stroke-width="2.2" stroke-linecap="round"/>
    <!-- Dots on the path (milestones) -->
    <circle cx="40" cy="65" r="3" fill="#3dde84"/>
    <circle cx="22" cy="52" r="2.5" fill="#3dde84" opacity="0.6"/>
    <circle cx="58" cy="30" r="2.5" fill="#3dde84" opacity="0.6"/>
    <!-- Arrowhead at top -->
    <polyline points="34,18 40,12 46,18" fill="none" stroke="#3dde84" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
};

const STRATEGY_DATA = {
  quotes: [
    "My hips are just crazy, I've tried everything, so tired of tight hips.",
    "Been working in an office for 15 years and I would scream if I straightened my legs.",
    "My whole life changed."
  ],
  profile: `These are people in their 30s–50s — desk workers, former athletes, runners, and aging active adults — who feel trapped in bodies that no longer move the way they used to. They're not broken. They're <strong>disconnected</strong>. They've accumulated stiffness, limitation, and quiet shame from years of being given the wrong frame: that pain is the problem, stretching is the solution, and deterioration is inevitable with age.<br><br>They don't want to become yoga masters. They want to move through their day without wincing. They want to feel like themselves again — capable, free, and alive in their body.`,
  enemy: {
    not: "Tight muscles, bad genetics, aging, or lack of flexibility.",
    yes: "Disconnection — the break between mind and body created by years of sedentary work, symptom-chasing, and being told to stretch the place that hurts instead of training the system that's protecting them.",
    validation: "Every 'tried and failed' solution in the comment data — stretching, yoga, foam rolling, PT, gym training — failed for the same reason. They all treated the symptom, not the disconnection. The audience has said, unprompted, \"the area of pain isn't actually the root cause.\" They're ready for this frame."
  },
  pillars: [
    {
      key: "disconnected",
      name: "You're Not Broken, You're Disconnected",
      cadence: "2× per week — highest trust-builder",
      stars: 5,
      phrases: ["the area of pain isn't actually the root cause", "tried everything", "so tired of tight hips", "mind-body connection", "activating the right muscles", "embarrassing and frustrating"],
      directions: [
        "Root cause explainer — \"Your hips aren't tight because you don't stretch enough. They're tight because your body is protecting you.\"",
        "Symptom inversion carousel — \"The thing that hurts is never the problem.\" 3 common pain sites → actual upstream cause.",
        "The \"tried everything\" video — Name every failed solution and explain why each fails without addressing disconnection. High save potential."
      ]
    },
    {
      key: "steps",
      name: "Start Here — Mobility for Real Beginners",
      cadence: "2× per week — fastest audience growth",
      stars: 5,
      phrases: ["can't even get into a squat", "I can't get into that position", "is there a beginner version?", "tight quads", "if you can't get into a deep squat"],
      directions: [
        "Zero to squat series — 3-step progressive entry (heel elevation → hip circles → door-frame hold). POV floor angle.",
        "\"If you can't do X, do this\" format — genuine beginner entry for any advanced movement, no condescension.",
        "Modification library carousel — \"5 movements, 3 levels each.\" Saves extremely well."
      ]
    },
    {
      key: "desk",
      name: "Desk Job Damage & Reversal",
      cadence: "1–2× per week — strongest identity hook",
      stars: 4,
      phrases: ["working in an office for 15 years", "desk job", "sitting all day", "posture", "especially as we age", "longevity"],
      directions: [
        "\"What 15 years at a desk actually did to your body\" — Carousel with body diagram. 5 physical changes + 30-second corrective for each.",
        "The desk worker's morning routine — 10-minute real-time follow-along, filmed in bedroom or kitchen. Designed to save as an alarm.",
        "Micro-mobility at your desk — \"You don't need a gym. You need 2 minutes and a chair.\""
      ]
    },
    {
      key: "feltSense",
      name: "The Felt Sense",
      cadence: "1× per week — deep loyalty builder",
      stars: 3,
      phrases: ["mind-body connection", "feels so good and essential", "my whole life changed", "natural lubrication", "activating the right muscles"],
      directions: [
        "One movement, felt from the inside — Demo while narrating what you feel in your body, not what muscles are working.",
        "\"Before and after awareness\" demo — Same movement done mechanically vs. with felt sense. The difference is visible.",
        "Q&A: \"What does it feel like when your hips actually open?\" — Validates that they can't quite feel this yet."
      ]
    },
    {
      key: "longevity",
      name: "Longevity — Moving Well for Decades",
      cadence: "1× per week — aspirational anchor",
      stars: 4,
      phrases: ["the older I get", "especially as we age", "longevity", "range of motion", "feels so good and essential", "SO important at my age"],
      directions: [
        "\"Moving well at 40, 50, 60\" — Reel montage of real people at various ages. Voice-over: \"This isn't special. This is trainable.\"",
        "The longevity stack — \"3 movements worth doing every day for the rest of your life.\" Simple, memorable, high save.",
        "Progress story — Creator sharing their own rebuilding arc. Journals, setbacks, gains."
      ]
    },
    {
      key: "journey",
      name: "The Rebuilding Journey",
      cadence: "1× per week or less — trust engine",
      stars: 0,
      phrases: [],
      directions: [
        "Origin story — What was your body like before? What broke the pattern? Specific and physical, not abstract.",
        "\"The thing I got wrong for years\" — Vulnerability content that validates the audience's own failures.",
        "What I do every day — Current practice, honestly. Not aspirational. What you actually do when tired or busy."
      ]
    }
  ],
  hooks: {
    "Reframe — Highest Pattern Interrupt": [
      "Your hips aren't tight because you don't stretch enough.",
      "The reason your lower back hurts after running has nothing to do with your lower back.",
      "You don't need more flexibility. You need this.",
      "The area that hurts is never the actual problem."
    ],
    "Identity — Immediate Recognition": [
      "I've tried everything and my hips are still tight — sound familiar?",
      "I can't even get into a squat — I heard you. Here's where to start.",
      "15 years behind a desk. Here's what it actually did to your body.",
      "If your joints pop every time you move, watch this."
    ],
    "Aspiration — Challenge the Resignation": [
      "What if feeling stiff and achy in your 40s isn't inevitable?",
      "The older I get, the more I realize: stiffness was never inevitable. We just weren't taught the right things.",
      "Since I started doing this every morning, my whole body changed. 10 minutes. That's it."
    ],
    "Fear — Use Sparingly, Pair with Relief": [
      "Your desk job isn't just draining your energy. It's physically reshaping your body — here's exactly how.",
      "Your joints are constantly popping. Here's the truth about what that actually means."
    ]
  },
  positioning: {
    for: "Desk workers, former athletes, and aging active adults in their 30s–50s who feel trapped in bodies that don't move the way they used to.",
    offer: "A systematic approach to reconnecting mind and body through mobility training that starts where you actually are — not where you're supposed to be.",
    unlike: "Physio content (clinical, injury-focused), yoga content (too advanced), or gym content (mechanical, no body awareness) — we treat the root cause: the disconnection between how you think about your body and how it actually moves.",
    promise: "Freedom — not as a destination but as a felt, daily experience of moving well in the body you have right now."
  },
  always: [
    "Name the root cause, not just the symptom",
    "Use their exact words back to them",
    "Show modifications and progressions — assume nothing about baseline range",
    "Speak to the identity (who they are), not just the pain (what hurts)",
    "Be in the process with them — rebuilding, not arrived",
    "Give them something they can feel immediately"
  ],
  never: [
    "Show off range of motion without immediately making it accessible",
    "Use language that implies they should already be able to do this",
    "Treat pain as the problem without addressing the upstream cause",
    "Overpromise timelines (\"30 days to perfect hips\")",
    "Demonstrate only — always explain the why",
    "Forget that shame lives in this audience; actively disarm it"
  ],
  gaps: [
    { gap: "Beginner / modification content", evidence: "Constant \"is there a scaled version?\" comments", priority: "High" },
    { gap: "Desk job as root cause frame", evidence: "\"Office for 15 years\" comments everywhere", priority: "High" },
    { gap: "Running + hip/back connection", evidence: "Multiple \"lower back after a run\" comments", priority: "High" },
    { gap: "Squat progression from zero", evidence: "Direct explicit ask across multiple competitors", priority: "High" },
    { gap: "Joint popping education", evidence: "Multiple anxious \"constantly popping\" comments", priority: "Medium" },
    { gap: "Hip replacements / serious injury", evidence: "Surprising volume of replacement/surgery comments", priority: "Medium" },
    { gap: "Hormonal changes + mobility (women 40+)", evidence: "\"Especially as we age and those darn hormones\"", priority: "Medium" },
    { gap: "Is this for men?", evidence: "Comments asking this on competitor posts", priority: "Low" }
  ]
};

let strategyRendered = false;

function renderStrategy() {
  if (strategyRendered) return;
  strategyRendered = true;

  const d = STRATEGY_DATA;
  const c = $("#strategy-container");

  const stars = (n) => n === 0
    ? `<span style="color:var(--text-muted);font-size:12px">Relationship-building (no data signal)</span>`
    : "★".repeat(n) + "☆".repeat(5 - n);

  const priorityBadge = (p) => {
    const cls = p === "High" ? "priority-high" : p === "Medium" ? "priority-medium" : "priority-low";
    return `<span class="${cls}">${p}</span>`;
  };

  c.innerHTML = `
    <!-- ── Hero ── -->
    <div class="strategy-hero">
      <div class="strategy-hero-title">In Their Own Words — Audience Identity</div>
      <div class="strategy-quotes">
        ${d.quotes.map(q => `
          <div class="strategy-quote">
            <blockquote>"${esc(q)}"</blockquote>
          </div>`).join("")}
      </div>
      <div class="strategy-profile">${d.profile}</div>
    </div>

    <!-- ── The Enemy ── -->
    <div class="strategy-enemy">
      <div class="strategy-enemy-label">The Real Enemy</div>
      <div class="strategy-enemy-yes">The disconnection between mind and body.</div>
      <div class="strategy-enemy-body">
        <strong style="color:var(--text-muted)">Not:</strong> ${esc(d.enemy.not)}<br><br>
        <strong style="color:var(--text)">Yes:</strong> ${esc(d.enemy.yes)}<br><br>
        <em style="color:var(--text-muted)">${esc(d.enemy.validation)}</em>
      </div>
    </div>

    <!-- ── Content Pillars ── -->
    <div class="strategy-section-header">Content Pillars</div>
    <div class="pillars-strategy-grid">
      ${d.pillars.map(p => `
        <div class="strategy-pillar-card">
          <div class="pillar-icon-wrap">${PILLAR_ICONS[p.key]}</div>
          <div>
            <div class="pillar-card-name">${esc(p.name)}</div>
            <div class="pillar-cadence">${esc(p.cadence)}</div>
          </div>
          <div class="pillar-stars">${stars(p.stars)}</div>
          ${p.phrases.length ? `
            <div class="pillar-phrases">
              ${p.phrases.map(ph => `<span class="pillar-phrase">"${esc(ph)}"</span>`).join("")}
            </div>` : ""}
          <ul class="pillar-directions">
            ${p.directions.map(dir => `<li>${esc(dir)}</li>`).join("")}
          </ul>
        </div>`).join("")}
    </div>

    <!-- ── Hook Bank ── -->
    <div class="strategy-section-header">Hook Bank</div>
    <div class="hooks-grid">
      ${Object.entries(d.hooks).map(([label, hooks]) => `
        <div class="hook-category-card">
          <div class="hook-category-label">${esc(label)}</div>
          <div class="hook-pills">
            ${hooks.map(h => `
              <div class="hook-pill" onclick="copyHookPill(this)" title="Click to copy">${esc(h)}</div>
            `).join("")}
          </div>
        </div>`).join("")}
    </div>

    <!-- ── Positioning ── -->
    <div class="strategy-section-header">Positioning Statement</div>
    <div class="positioning-card">
      <div class="positioning-row">
        <span class="positioning-label">For</span>
        <span>${esc(d.positioning.for)}</span>
      </div>
      <div class="positioning-row">
        <span class="positioning-label">We offer</span>
        <span>${esc(d.positioning.offer)}</span>
      </div>
      <div class="positioning-row">
        <span class="positioning-label">Unlike</span>
        <span>${esc(d.positioning.unlike)}</span>
      </div>
      <div class="positioning-row">
        <span class="positioning-label">Promise</span>
        <span class="positioning-promise">${esc(d.positioning.promise)}</span>
      </div>
    </div>

    <!-- ── Messaging Rules ── -->
    <div class="strategy-section-header">Messaging Rules</div>
    <div class="rules-grid">
      <div class="rules-card always">
        <div class="rules-card-label">Always</div>
        <ul class="rules-list">
          ${d.always.map(r => `<li>${esc(r)}</li>`).join("")}
        </ul>
      </div>
      <div class="rules-card never">
        <div class="rules-card-label">Never</div>
        <ul class="rules-list">
          ${d.never.map(r => `<li>${esc(r)}</li>`).join("")}
        </ul>
      </div>
    </div>

    <!-- ── Gap Analysis ── -->
    <div class="strategy-section-header">Audience Gaps — Validated by Data</div>
    <div class="gap-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Gap</th>
            <th>Evidence from Comments</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          ${d.gaps.map(g => `
            <tr>
              <td style="font-weight:600">${esc(g.gap)}</td>
              <td style="color:var(--text-muted);font-style:italic">${esc(g.evidence)}</td>
              <td>${priorityBadge(g.priority)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <div style="text-align:center;color:var(--text-muted);font-size:12px;padding-bottom:32px">
      Strategy synthesized from <strong style="color:var(--text)">67 scored competitor leads</strong> · Last updated 2026-03-18
    </div>
  `;
}

function copyHookPill(el) {
  navigator.clipboard.writeText(el.textContent.trim()).then(() => {
    el.classList.add("copied");
    const orig = el.textContent;
    el.textContent = "Copied!";
    setTimeout(() => { el.textContent = orig; el.classList.remove("copied"); }, 1500);
  });
}
