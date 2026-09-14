const $ = id => document.getElementById(id);

let me = null;
let editingLessonId = null;

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));

async function api(url, options = {}) {
  const config = { ...options, headers: { ...(options.headers || {}) } };

  if (config.body && !(config.body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, config);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw data || { error: `HTTP ${response.status}` };
  }

  return data;
}

function toast(message) {
  const el = $('toast');
  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}

function show(id) {
  $(id)?.classList.remove('hidden');
}

function hide(id) {
  $(id)?.classList.add('hidden');
}

function isAdmin() {
  return !!(me && (me.isAdmin === true || me.role === 'admin'));
}

function isPaid() {
  return !!(me && me.paid);
}

async function boot() {
  try {
    me = await api('/api/me');
    render();
  } catch {
    hide('logoutBtn');
    show('login');
  }
}

function render() {
  hide('login');

  if (!me) {
    show('login');
    return;
  }

  show('logoutBtn');

  if (isAdmin()) {
    hide('pay');
    show('content');
    show('adminPanel');

    if ($('account')) {
      $('account').textContent = '👑 ADMIN • 📱 ' + me.phone;
    }

    if ($('expiry')) {
      $('expiry').textContent = '🆓 FREE ACCESS';
    }

    loadLessons();
    loadAdminStats();
    loadAdminUsers();
    loadAdminPayments();
    loadAdminLessons();
    setupAdminEvents();
    return;
  }

  hide('adminPanel');

  if (!isPaid()) {
    hide('content');
    show('pay');

    if (me.pending) {
      show('pending');
    } else {
      hide('pending');
    }

    loadPaymentConfig();
    return;
  }

  hide('pay');
  show('content');

  if ($('account')) {
    $('account').textContent = '📱 ' + me.phone;
  }

  if ($('expiry')) {
    $('expiry').textContent = me.expiresAt
      ? '⏳ ' + new Date(me.expiresAt).toLocaleDateString('so-SO')
      : '🆓 FREE ACCESS';
  }

  loadLessons();
}

async function login() {
  const phone = $('phone')?.value.trim();

  if (phone.startsWith('ADMIN-001') && phone !== 'ADMIN-001') {
    toast('❌ Admin ID-ga waa khalad. Geli ADMIN-001 oo keliya.');
    return;
  }

  if (phone !== 'ADMIN-001' && !/^61[0-9]{7}$/.test(phone)) {
    toast('❌ Lambarka waa inuu ahaadaa 9 lambar oo ka bilaabanaya 61. Tusaale: 612942662');
    return;
  }

  try {
    const button = $('loginBtn');
    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Gelaya...';
    }

    me = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });

    render();
    toast(isAdmin() ? '👑 Admin login successful.' : '✅ Waad gashay.');
  } catch (error) {
    toast(error.error || 'Login ayaa fashilmay.');
  } finally {
    const button = $('loginBtn');
    if (button) {
      button.disabled = false;
      button.textContent = 'Geli';
    }
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {}

  me = null;
  location.reload();
}

async function loadPaymentConfig() {
  try {
    const config = await api('/api/config');

    const price = document.querySelector('.price');
    if (price) {
      price.innerHTML =
        '$' + esc(config.price) +
        ' <span>/ ' + esc(config.membershipDays) +
        ' maalmood</span>';
    }

    const paybox = document.querySelector('.paybox');
    if (paybox) {
      paybox.innerHTML =
        '<b>' + esc(config.paymentNumber) + '</b>' +
        '<span>' + esc(config.paymentName) + '</span>' +
        '<span>' + esc(config.paymentMethod) + '</span>';
    }
  } catch {}
}

async function sendPayment() {
  const ref = $('ref')?.value.trim();

  if (!ref) {
    toast('📱 Geli lambarka Hormuudka aad lacagta kasoo dirtay.');
    return;
  }

  try {
    const button = $('payBtn');

    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Diraya...';
    }

    const result = await api('/api/payment-request', {
      method: 'POST',
      body: JSON.stringify({ reference: ref, senderPhone: ref })
    });

    toast(result.message || '✅ Payment request waa la diray.');
    $('ref').value = '';
    show('pending');

    me = await api('/api/me');
  } catch (error) {
    toast(error.error || 'Payment request ayaa fashilmay.');
  } finally {
    const button = $('payBtn');

    if (button) {
      button.disabled = false;
      button.textContent = '✅ Waxaan bixiyay $3';
    }
  }
}

async function loadLessons() {
  const container = $('lessons');
  if (!container) return;

  container.innerHTML = '<div class="notice">⏳ Casharrada waa la soo gelinayaa...</div>';

  try {
    const lessons = await api('/api/lessons');

    if (!lessons.length) {
      container.innerHTML =
        '<div class="notice">📚 Weli casharro lama gelin.</div>';
      return;
    }

    container.innerHTML = lessons.map(renderLesson).join('');
    wireLessons();
  } catch (error) {
    container.innerHTML =
      '<div class="notice">❌ ' +
      esc(error.error || 'Casharrada lama soo gelin.') +
      '</div>';
  }
}

function renderLesson(lesson) {
  const lines = Array.isArray(lesson.lines) ? lesson.lines : [];

  return `
    <article class="lesson" data-lesson-id="${esc(lesson.id)}">
      <h2>${esc(lesson.title)}</h2>

      ${
        lesson.description
          ? `<div class="desc">${esc(lesson.description)}</div>`
          : ''
      }

      <div class="player-wrap">
        <video
          class="lesson-video"
          controls
          preload="metadata"
          playsinline
          src="${esc(lesson.video)}">
        </video>

        <div class="controls">
          <button type="button" class="restart-btn">↩️ Bilow</button>
          <button type="button" class="speed-btn">1×</button>
        </div>
      </div>

      <div class="lines">
        ${
          lines.length
            ? lines.map((line, index) => {
                const words = String(line.en || '')
                  .split(/\s+/)
                  .filter(Boolean);

                return `
                  <div
                    class="line"
                    data-start="${Number(line.start) || 0}"
                    data-end="${Number(line.end) || 0}"
                    data-num="${index + 1}">

                    <div class="en">
                      ${
                        words.map((word, wordIndex) =>
                          `<span class="word" data-word="${wordIndex}">
                            ${esc(word)}
                          </span>`
                        ).join(' ')
                      }
                    </div>

                    <div class="so">${esc(line.so)}</div>
                  </div>
                `;
              }).join('')
            : '<div class="notice">Subtitles ma jiraan.</div>'
        }
      </div>
    </article>
  `;
}

function wireLessons() {
  const videos = [...document.querySelectorAll('.lesson-video')];

  document.querySelectorAll('.lesson').forEach(lesson => {
    const video = lesson.querySelector('.lesson-video');
    const linesBox = lesson.querySelector('.lines');
    const rows = [...lesson.querySelectorAll('.line')];
    const restart = lesson.querySelector('.restart-btn');
    const speed = lesson.querySelector('.speed-btn');

    if (!video) return;

    // Video-kan markuu bilaabmo, videos kale wada jooji
    video.addEventListener('play', () => {
      videos.forEach(other => {
        if (other !== video) {
          other.pause();
        }
      });
    });

    video.addEventListener('timeupdate', () => {
      const time = video.currentTime;

      let activeIndex = -1;

      rows.forEach((row, index) => {
        const start = Number(row.dataset.start) || 0;
        const end = Number(row.dataset.end) || 0;

        const active = time >= start && time < end;

        row.classList.toggle('active', active);
        row.style.display = active ? 'block' : 'none';

        if (active) {
          activeIndex = index;
        }
      });

      // Erayada subtitle-ka hadda socda
      rows.forEach(row => {
        row.querySelectorAll('.word').forEach(word => {
          word.classList.remove('current');
        });
      });

      if (activeIndex >= 0) {
        const row = rows[activeIndex];
        const start = Number(row.dataset.start) || 0;
        const end = Number(row.dataset.end) || start + 1;

        const duration = Math.max(end - start, 0.1);
        const progress = Math.min(
          Math.max((time - start) / duration, 0),
          0.999
        );

        const words = [...row.querySelectorAll('.word')];

        if (words.length) {
          const wordIndex = Math.min(
            Math.floor(progress * words.length),
            words.length - 1
          );

          words[wordIndex]?.classList.add('current');
        }

      }
    });

    // Subtitle kasta waa la gujin karaa
    rows.forEach(row => {
      row.addEventListener('click', () => {
        video.currentTime = Number(row.dataset.start) || 0;

        videos.forEach(other => {
          if (other !== video) other.pause();
        });

        video.play().catch(() => {});
      });
    });

    restart?.addEventListener('click', () => {
      videos.forEach(other => {
        if (other !== video) other.pause();
      });

      video.currentTime = 0;
      video.play().catch(() => {});
    });

    speed?.addEventListener('click', () => {
      const speeds = [1, 1.25, 1.5, 0.75];
      const current = video.playbackRate || 1;
      const index = speeds.indexOf(current);
      const next = speeds[(index + 1) % speeds.length];

      video.playbackRate = next;
      speed.textContent = next + '×';
    });
  });
}

async function loadAdminStats() {
  if (!isAdmin()) return;

  try {
    const stats = await api('/api/admin/stats');

    if ($('statUsers')) $('statUsers').textContent = stats.users ?? 0;
    if ($('statLessons')) $('statLessons').textContent = stats.lessons ?? 0;
    if ($('statPending')) $('statPending').textContent = stats.pending ?? 0;
    if ($('statApproved')) $('statApproved').textContent = stats.approved ?? 0;
    if ($('statRejected')) $('statRejected').textContent = stats.rejected ?? 0;
    if ($('statActive')) $('statActive').textContent = stats.active ?? 0;
  } catch {}
}

async function loadAdminUsers() {
  if (!isAdmin()) return;

  const container = $('adminUsers');
  if (!container) return;

  container.innerHTML =
    '<div class="notice">⏳ Users-ka waa la soo gelinayaa...</div>';

  try {
    const users = await api('/api/admin/users');

    if (!users.length) {
      container.innerHTML =
        '<div class="notice">👥 Users ma jiraan.</div>';
      return;
    }

    container.innerHTML = users.map(user => {
      const admin = user.role === 'admin';
      const free = user.freeAccess === true;

      let status = '🔴 No access';

      if (admin) {
        status = '👑 ADMIN • FREE';
      } else if (free) {
        status = '🆓 FREE ACCESS';
      } else if (
        user.expiresAt &&
        new Date(user.expiresAt).getTime() > Date.now()
      ) {
        status =
          '🟢 Paid ilaa ' +
          new Date(user.expiresAt).toLocaleDateString('so-SO');
      }

      return `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <strong>📱 ${esc(user.phone)}</strong>
            <span>${status}</span>
            <small>ID: ${esc(user.id)}</small>
          </div>

          ${
            admin
              ? '<div class="admin-badge">👑 ADMIN</div>'
              : `
                <div class="admin-user-actions">
                  ${
                    free
                      ? `<button
                          type="button"
                          class="remove-free"
                          data-user-id="${esc(user.id)}">
                          🔒 Ka qaad FREE
                        </button>`
                      : `<button
                          type="button"
                          class="give-free"
                          data-user-id="${esc(user.id)}">
                          🆓 FREE ugu fur
                        </button>`
                  }

                  ${
                    user.expiresAt
                      ? `<button
                          type="button"
                          class="revoke-paid"
                          data-user-id="${esc(user.id)}">
                          🚫 Revoke Paid
                        </button>`
                      : ''
                  }
                </div>
              `
          }
        </div>
      `;
    }).join('');

    container.querySelectorAll('.give-free').forEach(button => {
      button.onclick = () =>
        changeFreeAccess(button.dataset.userId, true);
    });

    container.querySelectorAll('.remove-free').forEach(button => {
      button.onclick = () =>
        changeFreeAccess(button.dataset.userId, false);
    });

    container.querySelectorAll('.revoke-paid').forEach(button => {
      button.onclick = () =>
        revokePaid(button.dataset.userId);
    });

  } catch (error) {
    container.innerHTML =
      '<div class="notice">❌ ' +
      esc(error.error || 'Users lama soo gelin.') +
      '</div>';
  }
}

async function changeFreeAccess(userId, enabled) {
  const question = enabled
    ? 'Qofkan course-ka oo dhan FREE ma ugu furaysaa?'
    : 'FREE access qofkan ma ka qaadaysaa?';

  if (!confirm(question)) return;

  try {
    const url = enabled
      ? `/api/admin/user/${encodeURIComponent(userId)}/free`
      : `/api/admin/user/${encodeURIComponent(userId)}/free/remove`;

    const result = await api(url, { method: 'POST' });

    toast(result.message || (enabled
      ? '🆓 FREE access waa la furay.'
      : '🔒 FREE access waa laga qaaday.'));

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Isbeddelka lama sameyn.');
  }
}

async function revokePaid(userId) {
  if (!confirm('Paid access qofkan ma ka joojinaysaa?')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}/revoke-paid`,
      { method: 'POST' }
    );

    toast(result.message || '🚫 Paid access waa laga joojiyey.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Revoke failed.');
  }
}

async function loadAdminPayments() {
  if (!isAdmin()) return;

  const container = $('adminPayments');
  if (!container) return;

  container.innerHTML =
    '<div class="notice">⏳ Payments-ka waa la soo gelinayaa...</div>';

  try {
    const payments = await api('/api/admin/payments');

    if (!payments.length) {
      container.innerHTML =
        '<div class="notice">💳 Payment requests ma jiraan.</div>';
      return;
    }

    container.innerHTML = payments.map(payment => {
      const status = String(payment.status || '').toLowerCase();

      let badge = '🟡 PENDING';

      if (status === 'approved') badge = '🟢 APPROVED';
      if (status === 'rejected') badge = '🔴 REJECTED';

      return `
        <div class="admin-payment-card">
          <strong>📱 ${esc(payment.phone || payment.userPhone || '')}</strong>

          <span>💵 $${esc(payment.amount ?? 3)}</span>
          <span>🏦 ${esc(payment.method || 'Hormuud')}</span>
          <span>📱 Sender: ${esc(payment.senderPhone || payment.reference || "")}</span>
          <span>${badge}</span>

          ${
            status === 'pending'
              ? `
                <button
                  type="button"
                  class="approve-payment"
                  data-payment-id="${esc(payment.id)}">
                  ✅ Approve
                </button>

                <button
                  type="button"
                  class="reject-payment"
                  data-payment-id="${esc(payment.id)}">
                  ❌ Reject
                </button>
              `
              : ''
          }

          <small class="payment-date">
            ${payment.createdAt
              ? esc(new Date(payment.createdAt).toLocaleString('so-SO'))
              : ''}
          </small>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.approve-payment').forEach(button => {
      button.onclick = () =>
        processPayment(button.dataset.paymentId, 'approve');
    });

    container.querySelectorAll('.reject-payment').forEach(button => {
      button.onclick = () =>
        processPayment(button.dataset.paymentId, 'reject');
    });

  } catch (error) {
    container.innerHTML =
      '<div class="notice">❌ ' +
      esc(error.error || 'Payments lama soo gelin.') +
      '</div>';
  }
}

async function processPayment(paymentId, action) {
  const question =
    action === 'approve'
      ? 'Payment-kan ma xaqiijisay? User-ka waxaa loo furayaa 30 maalmood.'
      : 'Payment-kan ma Reject-gareynaysaa?';

  if (!confirm(question)) return;

  try {
    const url =
      action === 'approve'
        ? `/api/admin/payment/${encodeURIComponent(paymentId)}/approve`
        : `/api/admin/payment/${encodeURIComponent(paymentId)}/reject`;

    const result = await api(url, { method: 'POST' });

    toast(result.message ||
      (action === 'approve'
        ? '🟢 Payment waa la approve gareeyey.'
        : '🔴 Payment waa la reject gareeyey.'));

    await loadAdminPayments();
    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Payment lama processing-gareyn.');
  }
}

async function loadAdminLessons() {
  if (!isAdmin()) return;

  const container = $('adminLessons');
  if (!container) return;

  container.innerHTML =
    '<div class="notice">⏳ Lessons-ka waa la soo gelinayaa...</div>';

  try {
    const lessons = await api('/api/admin/lessons');

    if (!lessons.length) {
      container.innerHTML =
        '<div class="notice">📚 Lessons ma jiraan.</div>';
      return;
    }

    container.innerHTML = lessons.map(lesson => `
      <div class="admin-lesson-card">
        <div>
          <strong>📚 ${esc(lesson.title)}</strong>

          ${
            lesson.description
              ? `<p>${esc(lesson.description)}</p>`
              : ''
          }

          <small>
            ${Array.isArray(lesson.lines) ? lesson.lines.length : 0}
            subtitle lines
          </small>
        </div>

        <div class="admin-lesson-actions">
          <button
            type="button"
            class="edit-lesson"
            data-lesson-id="${esc(lesson.id)}">
            ✏️ Edit
          </button>

          <button
            type="button"
            class="delete-lesson"
            data-lesson-id="${esc(lesson.id)}">
            🗑️ Delete
          </button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.edit-lesson').forEach(button => {
      button.onclick = async () => {
        const lesson = lessons.find(
          item => String(item.id) === String(button.dataset.lessonId)
        );

        if (lesson) openLessonEditor(lesson);
      };
    });

    container.querySelectorAll('.delete-lesson').forEach(button => {
      button.onclick = () =>
        deleteLesson(button.dataset.lessonId);
    });

  } catch (error) {
    container.innerHTML =
      '<div class="notice">❌ ' +
      esc(error.error || 'Lessons lama soo gelin.') +
      '</div>';
  }
}

async function deleteLesson(id) {
  if (!confirm(
    'Casharkan iyo video-giisa ma tirtiraysaa?\n\nTallaabadan lama celin karo.'
  )) return;

  try {
    const result = await api(
      `/api/admin/lesson/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );

    toast(result.message || '🗑️ Lesson waa la tirtiray.');

    await loadAdminLessons();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Lesson lama tirtirin.');
  }
}

function openLessonEditor(lesson) {
  editingLessonId = lesson.id;

  if ($('editLessonTitle')) {
    $('editLessonTitle').value = lesson.title || '';
  }

  if ($('editLessonDescription')) {
    $('editLessonDescription').value = lesson.description || '';
  }

  const rows = $('editSubtitleRows');

  if (rows) {
    rows.innerHTML = '';

    const lines = Array.isArray(lesson.lines)
      ? lesson.lines
      : [];

    if (lines.length) {
      lines.forEach(line => addEditSubtitleRow(line));
    } else {
      addEditSubtitleRow();
    }
  }

  show('lessonEditorOverlay');
  document.body.style.overflow = 'hidden';
}

function closeLessonEditor() {
  editingLessonId = null;
  hide('lessonEditorOverlay');
  document.body.style.overflow = '';
}

function addEditSubtitleRow(line = {}) {
  const container = $('editSubtitleRows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'editor-row';

  row.innerHTML = `
    <input
      class="edit-start"
      type="number"
      step="0.1"
      min="0"
      placeholder="Start"
      value="${esc(line.start ?? '')}">

    <input
      class="edit-end"
      type="number"
      step="0.1"
      min="0"
      placeholder="End"
      value="${esc(line.end ?? '')}">

    <input
      class="edit-en"
      type="text"
      placeholder="English"
      value="${esc(line.en ?? '')}">

    <input
      class="edit-so"
      type="text"
      placeholder="Somali"
      value="${esc(line.so ?? '')}">

    <div class="subtitle-row-actions">
      <button type="button" class="sub-copy-en" title="Copy English">📋 EN</button>
      <button type="button" class="sub-copy-so" title="Copy Somali">📋 SO</button>
      <button type="button" class="edit-remove" title="Ka saar">🗑️</button>
    </div>
  `;

  row.addEventListener('click', (event) => {
    if (event.target.closest('button') ||
        event.target.matches('input, textarea')) return;

    const start = Number(row.querySelector('.sub-start')?.value);

    if (Number.isFinite(start) && $('timestampVideo')) {
      $('timestampVideo').currentTime = start;
    }
  });

  row.querySelector('.sub-copy-en').onclick = async () => {
    const text = row.querySelector('.sub-en')?.value || '';
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      toast('📋 English waa la copy-gareeyey.');
    } catch {
      toast('Copy-ga lama samayn.');
    }
  };

  row.querySelector('.sub-copy-so').onclick = async () => {
    const text = row.querySelector('.sub-so')?.value || '';
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      toast('📋 Somali waa la copy-gareeyey.');
    } catch {
      toast('Copy-ga lama samayn.');
    }
  };

  row.querySelector('.edit-remove').onclick = () => {
    row.remove();
  };

  container.appendChild(row);
}

async function saveLessonEdit() {
  if (!editingLessonId) return;

  const title = $('editLessonTitle')?.value.trim();
  const description = $('editLessonDescription')?.value.trim() || '';

  if (!title) {
    toast('Magaca casharka geli.');
    return;
  }

  const rows = [...document.querySelectorAll('#editSubtitleRows .editor-row')];

  const lines = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const start = Number(row.querySelector('.edit-start')?.value);
    const end = Number(row.querySelector('.edit-end')?.value);
    const en = row.querySelector('.edit-en')?.value.trim() || '';
    const so = row.querySelector('.edit-so')?.value.trim() || '';

    if (!Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start) {
      toast(`Subtitle #${i + 1}: waqtiga sax.`);
      return;
    }

    if (!en || !so) {
      toast(`Subtitle #${i + 1}: English iyo Somali waa loo baahan yahay.`);
      return;
    }

    lines.push({ start, end, en, so });
  }

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].start < lines[i - 1].start) {
      toast('Subtitles-ka waa inay waqtiga u kala horreeyaan.');
      return;
    }
  }

  try {
    const button = $('editSave');

    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Saving...';
    }

    const result = await api(
      `/api/admin/lesson/${encodeURIComponent(editingLessonId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          title,
          description,
          lines
        })
      }
    );

    toast(result.message || '✅ Lesson waa la cusbooneysiiyey.');

    closeLessonEditor();
    await loadAdminLessons();
    await loadLessons();
  } catch (error) {
    toast(error.error || 'Lesson lama save-gareyn.');
  } finally {
    const button = $('editSave');

    if (button) {
      button.disabled = false;
      button.textContent = '💾 Save Changes';
    }
  }
}

async function generateAISubtitles() {
  const input = $('video');
  const button = $('aiSubtitleBtn');
  const status = $('uploadStatus');

  const video = input?.files?.[0];

  if (!video) {
    toast('🎬 Marka hore video dooro.');
    return;
  }

  try {
    if (button) {
      button.disabled = true;
      button.textContent = '🤖 AI wuu dhageysanayaa...';
    }

    if (status) {
      status.textContent =
        '🤖 AI ayaa video-ga dhageysanaya, timestamps iyo Somali translation sameynaya...';
      show('uploadStatus');
    }

    const form = new FormData();
    form.append('video', video);

    const result = await api('/api/admin/auto-subtitles', {
      method: 'POST',
      body: form
    });

    const rows = $('subtitleRows');

    if (!rows) {
      throw new Error('Subtitle rows lama helin.');
    }

    rows.innerHTML = '';

    for (const line of (result.lines || [])) {
      addSubtitleRow(line);
    }

    if (status) {
      status.textContent =
        `✅ AI wuxuu sameeyay ${(result.lines || []).length} subtitles. Dib u eeg kadib Upload Lesson dheh.`;
    }

    toast('✅ AI subtitles waa diyaar.');

  } catch (error) {
    console.error(error);

    if (status) {
      status.textContent =
        '❌ ' + (error.error || error.message || 'AI subtitles waa fashilmay.');
      show('uploadStatus');
    }

    toast(error.error || error.message || 'AI subtitles waa fashilmay.');

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '🤖 AI Subtitle Samee';
    }
  }
}


async function uploadLesson(event) {
  event.preventDefault();

  if (!isAdmin()) {
    toast('Admin only.');
    return;
  }

  const video = $('video')?.files?.[0];
  const title = $('title')?.value.trim();
  const description = $('description')?.value.trim() || '';

  if (!video) {
    toast('Video dooro.');
    return;
  }

  if (!title) {
    toast('Magaca casharka geli.');
    return;
  }

  const rows = [...document.querySelectorAll('#subtitleRows .subtitle-row')];
  const lines = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const start = Number(row.querySelector('.sub-start')?.value);
    const end = Number(row.querySelector('.sub-end')?.value);
    const en = row.querySelector('.sub-en')?.value.trim() || '';
    const so = row.querySelector('.sub-so')?.value.trim() || '';

    if (!Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start) {
      toast(`Subtitle #${i + 1}: waqtiga sax.`);
      return;
    }

    if (!en || !so) {
      toast(`Subtitle #${i + 1}: English iyo Somali geli.`);
      return;
    }

    lines.push({ start, end, en, so });
  }

  if (!lines.length) {
    toast('Ugu yaraan hal subtitle geli.');
    return;
  }

  const status = $('uploadStatus');
  const button = document.querySelector('#lessonForm button[type="submit"]');

  try {
    if (status) {
      status.textContent = '⏳ Cloudinary ayaa video-ga qaadanaya...';
      show('uploadStatus');
    }

    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Uploading...';
    }

    const config = await api('/api/cloudinary-config');

    const cloudinaryForm = new FormData();
    cloudinaryForm.append('file', video);
    cloudinaryForm.append('upload_preset', config.uploadPreset);

    const cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/video/upload`,
      {
        method: 'POST',
        body: cloudinaryForm
      }
    );

    const cloudinaryData =
      await cloudinaryResponse.json().catch(() => ({}));

    if (!cloudinaryResponse.ok) {
      throw new Error(
        cloudinaryData.error?.message ||
        `Cloudinary upload failed: HTTP ${cloudinaryResponse.status}`
      );
    }

    const result = await api('/api/admin/lesson', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        videoUrl: cloudinaryData.secure_url,
        videoPublicId: cloudinaryData.public_id,
        lines
      })
    });

    if (status) {
      status.textContent =
        result.message || '✅ Casharka waa la geliyey.';
    }

    toast('✅ Lesson cusub waa la geliyey.');

    $('lessonForm').reset();
    $('subtitleRows').innerHTML = '';

    addSubtitleRow();

    await loadAdminLessons();
    await loadAdminStats();

  } catch (error) {
    if (status) {
      status.textContent =
        '❌ ' + (error.error || error.message || 'Upload ayaa fashilmay.');
    }

    toast(
      error.error ||
      error.message ||
      'Upload ayaa fashilmay.'
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '⬆️ Soo geli casharka';
    }
  }
}

function addSubtitleRow(line = {}) {
  const container = $('subtitleRows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'subtitle-row editor-row';

  row.innerHTML = `
    <input
      class="sub-start"
      type="number"
      min="0"
      step="0.1"
      placeholder="Start"
      value="${esc(line.start ?? '')}">

    <input
      class="sub-end"
      type="number"
      min="0"
      step="0.1"
      placeholder="End"
      value="${esc(line.end ?? '')}">

    <input
      class="sub-en"
      type="text"
      placeholder="English"
      value="${esc(line.en ?? '')}">

    <input
      class="sub-so"
      type="text"
      placeholder="Somali"
      value="${esc(line.so ?? '')}">

    <button
      type="button"
      class="edit-remove"
      title="Ka saar">
      🗑️
    </button>
  `;

  row.querySelector('.edit-remove').onclick = () => {
    row.remove();
  };

  container.appendChild(row);
}


function setupTimestampEditor() {
  const input = $('video');
  const editor = $('timestampEditor');
  const video = $('timestampVideo');
  const current = $('timestampCurrent');
  const duration = $('timestampDuration');
  const startBtn = $('setStart');
  const endBtn = $('setEnd');

  if (!input || !editor || !video) return;

  /* Live subtitle preview for Admin */
  let preview = $('timestampSubtitlePreview');

  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'timestampSubtitlePreview';
    preview.className = 'timestamp-subtitle-preview';
    preview.innerHTML = `
      <div class="preview-en">Video-ga bilow si subtitle-ku u muuqdo...</div>
      <div class="preview-so"></div>
    `;

    const timeBox = editor.querySelector('.timestamp-time');
    if (timeBox) {
      timeBox.insertAdjacentElement('afterend', preview);
    } else {
      editor.appendChild(preview);
    }
  }

  const formatTime = (seconds) => {
    seconds = Number(seconds) || 0;
    const m = Math.floor(seconds / 60);
    const sec = seconds - m * 60;
    return String(m).padStart(2, '0') + ':' + sec.toFixed(1).padStart(4, '0');
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];

    if (!file) {
      editor.classList.add('hidden');
      video.removeAttribute('src');
      video.load();
      return;
    }

    video.src = URL.createObjectURL(file);
    editor.classList.remove('hidden');
    video.load();
  });

  video.addEventListener('loadedmetadata', () => {
    duration.textContent = formatTime(video.duration);
    current.textContent = formatTime(video.currentTime);
  });

  video.addEventListener('timeupdate', () => {
    current.textContent = formatTime(video.currentTime);

    const rows = [...document.querySelectorAll('#subtitleRows .subtitle-row')];
    const time = video.currentTime;

    rows.forEach(row => row.classList.remove('timestamp-active'));

    const activeRow = rows.find(row => {
      const start = Number(row.querySelector('.sub-start')?.value);
      const end = Number(row.querySelector('.sub-end')?.value);
      return Number.isFinite(start) &&
             Number.isFinite(end) &&
             time >= start &&
             time < end;
    });

    if (activeRow) {
      activeRow.classList.add('timestamp-active');

      const en = activeRow.querySelector('.sub-en')?.value || '';
      const so = activeRow.querySelector('.sub-so')?.value || '';

      const previewEn = preview.querySelector('.preview-en');
      const previewSo = preview.querySelector('.preview-so');

      if (previewEn) previewEn.textContent = en;
      if (previewSo) previewSo.textContent = so;
    } else {
      const previewEn = preview.querySelector('.preview-en');
      const previewSo = preview.querySelector('.preview-so');

      if (previewEn) previewEn.textContent = 'Subtitle-kan waqtigan ma jiro';
      if (previewSo) previewSo.textContent = '';
    }
  });

  startBtn?.addEventListener('click', () => {
    const rows = [...document.querySelectorAll('#subtitleRows .subtitle-row')];
    const row = rows[rows.length - 1];

    if (!row) {
      addSubtitleRow();
      return;
    }

    const input = row.querySelector('.sub-start');

    if (input) {
      input.value = video.currentTime.toFixed(1);
      input.focus();
    }
  });

  endBtn?.addEventListener('click', () => {
    const rows = [...document.querySelectorAll('#subtitleRows .subtitle-row')];
    const row = rows[rows.length - 1];

    if (!row) return;

    const input = row.querySelector('.sub-end');

    if (input) {
      input.value = video.currentTime.toFixed(1);
      input.focus();
    }
  });
}

function setupAdminEvents() {
  if (!isAdmin() || window.adminEventsReady) return;

  window.adminEventsReady = true;

  $('lessonForm')?.addEventListener('submit', uploadLesson);

  $('addSubtitle')?.addEventListener('click', () => {
    addSubtitleRow();
  });

  $('aiSubtitleBtn')?.addEventListener('click', generateAISubtitles);

  setupTimestampEditor();

  $('refreshUsers')?.addEventListener('click', async () => {
    await loadAdminUsers();
    await loadAdminStats();
  });

  $('refreshPayments')?.addEventListener('click', async () => {
    await loadAdminPayments();
    await loadAdminStats();
  });

  $('editAddSubtitle')?.addEventListener('click', () => {
    addEditSubtitleRow();
  });

  $('editCancel')?.addEventListener('click', closeLessonEditor);

  $('editSave')?.addEventListener('click', saveLessonEdit);

  $('lessonEditorOverlay')?.addEventListener('click', event => {
    if (event.target === $('lessonEditorOverlay')) {
      closeLessonEditor();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' &&
        $('lessonEditorOverlay')?.classList.contains('show')) {
      closeLessonEditor();
    }
  });
}

$('loginBtn')?.addEventListener('click', login);

$('phone')?.addEventListener('keydown', event => {
  if (event.key === 'Enter') login();
});

$('payBtn')?.addEventListener('click', sendPayment);

$('logoutBtn')?.addEventListener('click', logout);

boot();
