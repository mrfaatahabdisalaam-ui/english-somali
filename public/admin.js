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

    title.textContent = "YouTube Video";
    preview.style.display = "block";
    status.textContent = "✅ Video-ga waa diyaar.";
  });
})();


// ===============================
// YouTube Subtitle Editor
// ===============================

(() => {
  const rows = document.getElementById("youtubeSubtitleRows");
  const addBtn = document.getElementById("addYoutubeSubtitle");
  const saveBtn = document.getElementById("saveYoutubeSubtitles");
  const publishBtn = document.getElementById("publishYoutubeLesson");
  const status = document.getElementById("youtubeSubtitleStatus");

  if (!rows || !addBtn) return;

  function createSubtitleRow() {
    const row = document.createElement("div");

    row.className = "youtube-subtitle-row";

    row.style.cssText =
      "padding:14px;margin:12px 0;border:1px solid rgba(255,255,255,.12);border-radius:12px;";

    row.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <input
          class="subtitle-start"
          type="text"
          value="00:00.0"
          placeholder="00:00.0"
          style="width:90px;"
        >

        <input
          class="subtitle-end"
          type="text"
          value="00:03.0"
          placeholder="00:03.0"
          style="width:90px;"
        >
      </div>

      <input
        class="subtitle-english"
        type="text"
        placeholder="English subtitle..."
        style="width:100%;margin-top:10px;"
      >

      <input
        class="subtitle-somali"
        type="text"
        placeholder="Somali translation..."
        style="width:100%;margin-top:10px;"
      >

      <button
        type="button"
        class="remove-subtitle"
        style="margin-top:10px;"
      >
        🗑 Remove
      </button>
    `;

    return row;
  }

  addBtn.addEventListener("click", () => {
    rows.appendChild(createSubtitleRow());
  });

  rows.addEventListener("click", (event) => {
    if (!event.target.classList.contains("remove-subtitle")) return;

    const row = event.target.closest(".youtube-subtitle-row");

    if (row) row.remove();
  });

  function collectSubtitles() {
    return [...rows.querySelectorAll(".youtube-subtitle-row")]
      .map(row => ({
        start: row.querySelector(".subtitle-start")?.value.trim() || "",
        end: row.querySelector(".subtitle-end")?.value.trim() || "",
        english: row.querySelector(".subtitle-english")?.value.trim() || "",
        somali: row.querySelector(".subtitle-somali")?.value.trim() || ""
      }))
      .filter(item => item.english || item.somali);
  }

  saveBtn?.addEventListener("click", () => {
    const subtitles = collectSubtitles();

    localStorage.setItem(
      "youtubeLessonSubtitles",
      JSON.stringify(subtitles)
    );

    status.textContent =
      `✅ ${subtitles.length} subtitle line(s) saved locally.`;
  });

  publishBtn?.addEventListener("click", () => {
    const subtitles = collectSubtitles();

    if (!subtitles.length) {
      status.textContent =
        "❌ Marka hore geli ugu yaraan hal subtitle.";
      return;
    }

    localStorage.setItem(
      "youtubeLessonSubtitles",
      JSON.stringify(subtitles)
    );

    status.textContent =
      `🚀 ${subtitles.length} subtitle line(s) diyaar ayay u yihiin publish.`;
  });
})();

