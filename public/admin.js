const $ = id => document.getElementById(id);

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));

async function req(url, opt = {}) {
  const r = await fetch(url, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(opt.headers || {})
    }
  });

  const d = await r.json().catch(() => ({}));

  if (!r.ok) throw d;

  return d;
}

async function login() {
  try {
    await req('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        adminId: $('adminId').value,
        password: $('adminPassword').value
      })
    });

    $('login').classList.add('hidden');
    $('dash').classList.remove('hidden');
    $('out').classList.remove('hidden');

    await load();

  } catch (e) {
    alert(e.error || 'Khalad');
  }
}

$('loginBtn')?.addEventListener('click', login);

$('out')?.addEventListener('click', async () => {
  await req('/api/admin/logout', { method: 'POST' });
  location.reload();
});

async function load() {
  await loadStats();
  await loadPayments();
  await loadLessons();
}

async function loadStats() {
  const s = await req('/api/admin/stats');

  $('stats').innerHTML = [
    ['👥 Users', s.users],
    ['🟢 Active', s.active],
    ['💳 Pending', s.pending],
    ['🎬 Lessons', s.lessons]
  ].map(x =>
    `<div class="stat">
      <span>${x[0]}</span>
      <b>${x[1]}</b>
    </div>`
  ).join('');
}

async function loadPayments() {
  const ps = await req('/api/admin/payments');

  $('payments').innerHTML = ps.length
    ? ps.map(p => `
      <div class="pay">
        <b>📱 ${esc(p.phone)}</b><br>
        <span>$${p.amount} • Ref: <b>${esc(p.reference)}</b></span><br>
        <small>${new Date(p.createdAt).toLocaleString()}</small><br>

        ${
          p.status === 'pending'
          ? `
            <button class="success"
              onclick="approve('${p.id}')">
              ✅ Approve +30 maalmood
            </button>

            <button class="danger"
              onclick="rejectP('${p.id}')">
              Reject
            </button>
          `
          : `<span class="hint">Status: ${p.status}</span>`
        }
      </div>
    `).join('')
    : '<span class="hint">Payment requests ma jiraan.</span>';
}

async function approve(id) {
  if (!confirm('Ma hubtaa inaad APPROVE gareyneyso payment-kan?')) return;

  try {
    const d = await req(
      '/api/admin/payment/' + encodeURIComponent(id) + '/approve',
      { method: 'POST' }
    );

    alert(d.message || 'Payment approved');

    await load();

  } catch (e) {
    alert(
      'Approve failed: ' +
      (e.error || e.message || 'Khalad aan la aqoon')
    );
  }
}

async function rejectP(id) {
  if (!confirm('Ma hubtaa inaad REJECT gareyneyso payment-kan?')) return;

  try {
    const d = await req(
      '/api/admin/payment/' + encodeURIComponent(id) + '/reject',
      { method: 'POST' }
    );

    alert(d.message || 'Payment rejected');

    await load();

  } catch (e) {
    alert(
      'Reject failed: ' +
      (e.error || e.message || 'Khalad aan la aqoon')
    );
  }
}


/* =========================
   AI SUBTITLE → LINES
========================= */

function collectSubtitleLines() {

  const rows = [
    ...document.querySelectorAll(
      '#subtitleRows .subtitle-row'
    )
  ];

  return rows
    .map(row => ({
      start: Number(
        row.querySelector('.sub-start')?.value
      ),

      end: Number(
        row.querySelector('.sub-end')?.value
      ),

      en:
        row.querySelector('.sub-en')?.value.trim() || '',

      so:
        row.querySelector('.sub-so')?.value.trim() || ''
    }))
    .filter(x =>
      Number.isFinite(x.start) &&
      Number.isFinite(x.end) &&
      x.end > x.start &&
      x.en
    );
}


/* =========================
   PUBLISH LESSON
========================= */

async function publishLesson(event) {

  event.preventDefault();

  const video = $('video')?.files?.[0];

  if (!video) {
    $('msg').textContent = '❌ Video geli.';
    return;
  }

  const title = $('title')?.value.trim();

  if (!title) {
    $('msg').textContent =
      '❌ Magaca casharka geli.';
    return;
  }

  const lines = collectSubtitleLines();

  if (!lines.length) {
    $('msg').textContent =
      '❌ Marka hore samee English subtitles.';
    return;
  }

  const fd = new FormData();

  fd.append('title', title);

  fd.append(
    'description',
    $('desc')?.value.trim() || ''
  );

  fd.append('video', video);

  fd.append(
    'lines',
    JSON.stringify(lines)
  );

  $('msg').textContent =
    '⏳ Video + subtitles ayaa la upload-gareynayaa...';

  try {

    const r = await fetch(
      '/api/admin/lesson',
      {
        method: 'POST',
        body: fd
      }
    );

    const d =
      await r.json().catch(() => ({}));

    if (!r.ok) throw d;

    $('msg').textContent =
      '✅ Casharka waa la publish gareeyay.';

    $('title').value = '';
    $('desc').value = '';
    $('video').value = '';

    $('subtitleRows').innerHTML = '';

    await load();

  } catch (e) {

    $('msg').textContent =
      '❌ ' +
      (
        e.error ||
        e.message ||
        'Khalad'
      );
  }
}


/* =========================
   LESSON LIST
========================= */

async function loadLessons() {

  const ls =
    await req('/api/admin/lessons');

  $('lessonList').innerHTML =
    ls.length

    ? ls.map(x => `
      <div class="lesson-admin">

        <span>
          🎬 <b>${esc(x.title)}</b><br>

          <small class="hint">
            ${x.lines?.length || 0}
            subtitles
          </small>
        </span>

        <button
          class="danger"
          onclick="delLesson('${x.id}')">
          🗑️ Delete
        </button>

      </div>
    `).join('')

    : '<span class="hint">Wali wax cashar ah lama publish-gareyn.</span>';
}

async function delLesson(id) {

  if (!confirm(
    'Casharkan ma tirtiraysaa?'
  )) return;

  await req(
    '/api/admin/lesson/' + id,
    { method: 'DELETE' }
  );

  await load();
}


/* =========================
   EVENTS
========================= */

$('lessonForm')?.addEventListener(
  'submit',
  publishLesson
);


// ===============================
// YouTube Video Loader
// ===============================

(() => {
  const urlInput = document.getElementById("youtubeUrl");
  const loadBtn = document.getElementById("loadYoutubeBtn");
  const status = document.getElementById("youtubeStatus");
  const preview = document.getElementById("youtubePreview");
  const player = document.getElementById("youtubePlayer");
  const title = document.getElementById("youtubeTitle");

  if (!urlInput || !loadBtn) return;

  function getYoutubeId(url) {
    try {
      const u = new URL(url);

      if (u.hostname.includes("youtu.be")) {
        return u.pathname.slice(1).split("/")[0];
      }

      if (u.hostname.includes("youtube.com")) {
        if (u.pathname === "/watch") {
          return u.searchParams.get("v");
        }

        if (u.pathname.startsWith("/shorts/")) {
          return u.pathname.split("/")[2];
        }

        if (u.pathname.startsWith("/embed/")) {
          return u.pathname.split("/")[2];
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  loadBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    const videoId = getYoutubeId(url);

    if (!videoId) {
      status.textContent = "❌ YouTube URL sax ah geli.";
      preview.style.display = "none";
      return;
    }

    status.textContent = "⏳ Video-ga waa la soo bandhigayaa...";

    player.innerHTML = `
      <iframe
        width="100%"
        height="100%"
        src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}"
        title="YouTube video"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen>
      </iframe>
    `;

    title.value = title.value || "YouTube Video";
    preview.style.display = "block";
    status.textContent = "✅ Video-ga waa diyaar.";
  });
})();


// ===============================
// YouTube Subtitle Editor
// ===============================

const youtubeRows = document.getElementById("youtubeSubtitleRows");
const addYoutubeSubtitleBtn = document.getElementById("addYoutubeSubtitle");
const saveYoutubeSubtitlesBtn = document.getElementById("saveYoutubeSubtitles");
const publishYoutubeLessonBtn = document.getElementById("publishYoutubeLesson");
const youtubeSubtitleStatus = document.getElementById("youtubeSubtitleStatus");

function addYoutubeSubtitleRow(data = {}) {
  if (!youtubeRows) return;

  const row = document.createElement("div");
  row.className = "youtube-subtitle-row";

  row.innerHTML = `
    <input class="subtitle-start" type="number" step="0.1"
      placeholder="Start (sec)" value="${data.start ?? ""}">
    <input class="subtitle-end" type="number" step="0.1"
      placeholder="End (sec)" value="${data.end ?? ""}">
    <input class="subtitle-english" type="text"
      placeholder="English subtitle" value="${escapeHtml(data.english ?? data.en ?? "")}">
    <input class="subtitle-somali" type="text"
      placeholder="Somali translation" value="${escapeHtml(data.somali ?? data.so ?? "")}">
    <button type="button" class="remove-subtitle">✕</button>
  `;

  youtubeRows.appendChild(row);

  row.querySelector(".remove-subtitle")?.addEventListener("click", () => {
    row.remove();
  });
}

function parseSubtitleTime(value) {
  const text = String(value ?? "").trim();

  if (!text) return 0;

  // 00:03.0
  if (text.includes(":")) {
    const parts = text.split(":");

    if (parts.length === 2) {
      const minutes = Number(parts[0]) || 0;
      const seconds = Number(parts[1]) || 0;

      return minutes * 60 + seconds;
    }

    if (parts.length === 3) {
      const hours = Number(parts[0]) || 0;
      const minutes = Number(parts[1]) || 0;
      const seconds = Number(parts[2]) || 0;

      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  return Number(text) || 0;
}

function collectSubtitles() {
  if (!youtubeRows) return [];

  return [...youtubeRows.querySelectorAll(".youtube-subtitle-row")]
    .map(row => ({
      start: parseSubtitleTime(
        row.querySelector(".subtitle-start")?.value
      ),

      end: parseSubtitleTime(
        row.querySelector(".subtitle-end")?.value
      ),

      en: row.querySelector(".subtitle-english")?.value.trim() || "",

      so: row.querySelector(".subtitle-somali")?.value.trim() || ""
    }))
    .filter(x => x.en && x.end > x.start);
}

addYoutubeSubtitleBtn?.addEventListener("click", () => {
  addYoutubeSubtitleRow();
});

saveYoutubeSubtitlesBtn?.addEventListener("click", () => {
  const subtitles = collectSubtitles();

  localStorage.setItem(
    "youtubeSubtitlesDraft",
    JSON.stringify(subtitles)
  );

  if (youtubeSubtitleStatus) {
    youtubeSubtitleStatus.textContent =
      `💾 ${subtitles.length} subtitle(s) waa la keydiyay.`;
  }
});

publishYoutubeLessonBtn?.addEventListener("click", async () => {
  const urlInput = document.getElementById("youtubeUrl");
  const titleEl = document.getElementById("youtubeTitle");

  const youtubeUrl = urlInput?.value.trim() || "";
  const subtitles = collectSubtitles();

  const title =
    titleEl?.value?.trim?.() ||
    "YouTube Lesson";

  if (!youtubeUrl) {
    if (youtubeSubtitleStatus) {
      youtubeSubtitleStatus.textContent =
        "❌ Marka hore geli YouTube URL.";
    }
    return;
  }

  if (!subtitles.length) {
    if (youtubeSubtitleStatus) {
      youtubeSubtitleStatus.textContent =
        "❌ Ku dar ugu yaraan hal English subtitle.";
    }
    return;
  }

  if (youtubeSubtitleStatus) {
    youtubeSubtitleStatus.textContent =
      "⏳ Casharka YouTube ayaa la publish-gareynayaa...";
  }

  try {
    const response = await fetch("/api/admin/youtube-lesson", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        description: "",
        youtubeUrl,
        lines: subtitles
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        `HTTP ${response.status}`
      );
    }

    if (youtubeSubtitleStatus) {
      youtubeSubtitleStatus.textContent =
        "✅ YouTube casharka waa la publish gareeyay oo DB-ga ayaa lagu kaydiyay.";
    }

    localStorage.removeItem("youtubeSubtitlesDraft");

  } catch (error) {
    console.error("YouTube publish error:", error);

    if (youtubeSubtitleStatus) {
      youtubeSubtitleStatus.textContent =
        `❌ Publish failed: ${error.message}`;
    }
  }
});

// Load saved local draft
try {
  const saved = JSON.parse(
    localStorage.getItem("youtubeSubtitlesDraft") || "[]"
  );

  if (Array.isArray(saved) && saved.length) {
    saved.forEach(addYoutubeSubtitleRow);
  }
} catch (e) {
  console.warn("YouTube subtitle draft lama akhrin:", e);
}
