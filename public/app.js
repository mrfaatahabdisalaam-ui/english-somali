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
  }, 4000);
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
  const pin = $('pin')?.value.trim();

  if (phone !== 'ADMIN-001' && !/^61[0-9]{7}$/.test(phone)) {
    toast('❌ Geli lambar sax ah ama ADMIN-001.');
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
      body: JSON.stringify({ phone, pin })
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

function getYoutubeId(url) {
  if (!url) return '';

  const value = String(url).trim();

  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }

  if (/^[A-Za-z0-9_-]{11}$/.test(value)) {
    return value;
  }

  return '';
}

function renderLesson(lesson) {
  const lines = Array.isArray(lesson.lines) ? lesson.lines : [];

  const youtubeId =
    lesson.youtubeId ||
    (
      String(lesson.videoPublicId || '').startsWith('youtube:')
        ? String(lesson.videoPublicId).replace('youtube:', '')
        : ''
    ) ||
    getYoutubeId(lesson.video || lesson.videoUrl || '');

  const isYoutube = Boolean(youtubeId);

  return `
    <article
      class="lesson"
      data-lesson-id="${esc(lesson.id)}"
      data-youtube-id="${esc(youtubeId)}">

      <div class="lesson-header">
        <h2>${esc(lesson.title)}</h2>

        ${
          lesson.description
            ? `<div class="desc">${esc(lesson.description)}</div>`
            : ''
        }
      </div>

      <div class="player-wrap">

        ${
          isYoutube
            ? `
              <div class="youtube-player-container">
                <div
                  class="youtube-player"
                  id="youtube-player-${esc(lesson.id)}"
                  data-youtube-id="${esc(youtubeId)}">
                </div>
              </div>
            `
            : `
              <video
                class="lesson-video"
                controls
                preload="metadata"
                playsinline
                src="${esc(lesson.video || lesson.videoUrl || '')}">
              </video>
            `
        }

        <div class="controls">
          <button type="button" class="restart-btn">
            ↩️ Bilow
          </button>

          <button type="button" class="speed-btn">
            1×
          </button>
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
                          `<span
                            class="word"
                            data-word="${wordIndex}">
                            ${esc(word)}
                          </span>`
                        ).join(' ')
                      }
                    </div>

                    <div class="so">
                      ${esc(line.so || '')}
                    </div>

                  </div>
                `;
              }).join('')
            : `
              <div class="notice">
                Subtitles ma jiraan.
              </div>
            `
        }
      </div>

    </article>
  `;
}

function loadYoutubeAPI() {
  return new Promise(resolve => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }

    const previousCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === 'function') {
        try {
          previousCallback();
        } catch {}
      }

      resolve();
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
}

async function wireYoutubeLessons() {
  const youtubeLessons =
    [...document.querySelectorAll('.lesson[data-youtube-id]')]
      .filter(lesson => lesson.dataset.youtubeId);

  if (!youtubeLessons.length) return;

  try {
    await loadYoutubeAPI();
  } catch {
    return;
  }

  if (!window.YT || !window.YT.Player) return;

  youtubeLessons.forEach(lesson => {
    const lessonId = lesson.dataset.lessonId;
    const youtubeId = lesson.dataset.youtubeId;
    const playerElement = document.getElementById(
      `youtube-player-${lessonId}`
    );

    if (!playerElement || playerElement.dataset.ready === '1') {
      return;
    }

    playerElement.dataset.ready = '1';

    const rows = [...lesson.querySelectorAll('.line')];
    const restart = lesson.querySelector('.restart-btn');
    const speed = lesson.querySelector('.speed-btn');

    let player;

    const updateSubtitles = () => {
      if (!player || typeof player.getCurrentTime !== 'function') return;

      const time = Number(player.getCurrentTime()) || 0;

      let activeIndex = -1;

      rows.forEach((row, index) => {
        const start = Number(row.dataset.start) || 0;
        const end = Number(row.dataset.end) || 0;

        const active = time >= start && time < end;

        row.classList.toggle('active', active);
        row.classList.toggle('is-hidden', !active);

        if (active) {
          activeIndex = index;
        }

        row.querySelectorAll('.word').forEach(word => {
          word.classList.remove('current');
        });
      });

      if (activeIndex >= 0) {
        const row = rows[activeIndex];

        const start = Number(row.dataset.start) || 0;
        const end =
          Number(row.dataset.end) || start + 1;

        const duration = Math.max(end - start, 0.1);

        const progress = Math.min(
          Math.max((time - start) / duration, 0),
          0.999
        );

        const words = [
          ...row.querySelectorAll('.word')
        ];

        if (words.length) {
          const wordIndex = Math.min(
            Math.floor(progress * words.length),
            words.length - 1
          );

          words[wordIndex]?.classList.add('current');
        }
      }
    };

    player = new YT.Player(playerElement, {
      videoId: youtubeId,

      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1
      },

      events: {
        onReady: () => {
          playerElement.dataset.playerReady = '1';

          if (!playerElement._subtitleTimer) {
            playerElement._subtitleTimer =
              setInterval(updateSubtitles, 100);
          }
        },

        onStateChange: event => {
          if (event.data === YT.PlayerState.PLAYING) {
            youtubeLessons.forEach(otherLesson => {
              if (otherLesson === lesson) return;

              const otherElement =
                otherLesson.querySelector('.youtube-player');

              const otherPlayer =
                otherElement?._ytPlayer;

              if (
                otherPlayer &&
                typeof otherPlayer.pauseVideo === 'function'
              ) {
                try {
                  otherPlayer.pauseVideo();
                } catch {}
              }
            });

            document
              .querySelectorAll('.lesson-video')
              .forEach(video => {
                try {
                  video.pause();
                } catch {}
              });
          }

          updateSubtitles();
        }
      }
    });

    playerElement._ytPlayer = player;

    rows.forEach(row => {
      row.addEventListener('click', () => {
        const start =
          Number(row.dataset.start) || 0;

        if (
          player &&
          typeof player.seekTo === 'function'
        ) {
          player.seekTo(start, true);
          player.playVideo();
        }
      });
    });

    restart?.addEventListener('click', () => {
      if (
        player &&
        typeof player.seekTo === 'function'
      ) {
        player.seekTo(0, true);
        player.playVideo();
      }
    });

    speed?.addEventListener('click', () => {
      const speeds = [1, 1.25, 1.5, 0.75];

      let current = 1;

      try {
        current =
          player.getPlaybackRate() || 1;
      } catch {}

      const index = speeds.indexOf(current);

      const next =
        speeds[(index + 1) % speeds.length];

      try {
        player.setPlaybackRate(next);
      } catch {}

      speed.textContent = next + '×';
    });
  });
}

function wireLessons() {
  const videos = [
    ...document.querySelectorAll('.lesson-video')
  ];

  document.querySelectorAll('.lesson').forEach(lesson => {
    const video =
      lesson.querySelector('.lesson-video');

    const linesBox =
      lesson.querySelector('.lines');

    const rows = [
      ...lesson.querySelectorAll('.line')
    ];

    const restart =
      lesson.querySelector('.restart-btn');

    const speed =
      lesson.querySelector('.speed-btn');

    // YouTube lesson-kan waxaa maamula wireYoutubeLessons()
    if (lesson.dataset.youtubeId) {
      return;
    }

    if (!video) return;

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
        const start =
          Number(row.dataset.start) || 0;

        const end =
          Number(row.dataset.end) || 0;

        const active =
          time >= start && time < end;

        row.classList.toggle('active', active);
      row.classList.toggle('is-hidden', !active);

        if (active) {
          activeIndex = index;
        }
      });

      rows.forEach(row => {
        row.querySelectorAll('.word').forEach(word => {
          word.classList.remove('current');
        });
      });

      if (activeIndex >= 0) {
        const row = rows[activeIndex];

        const start =
          Number(row.dataset.start) || 0;

        const end =
          Number(row.dataset.end) ||
          start + 1;

        const duration =
          Math.max(end - start, 0.1);

        const progress =
          Math.min(
            Math.max(
              (time - start) / duration,
              0
            ),
            0.999
          );

        const words =
          [...row.querySelectorAll('.word')];

        if (words.length) {
          const wordIndex =
            Math.min(
              Math.floor(
                progress * words.length
              ),
              words.length - 1
            );

          words[wordIndex]?.classList.add('current');
        }
      }
    });

    rows.forEach(row => {
      row.addEventListener('click', () => {
        video.currentTime =
          Number(row.dataset.start) || 0;

        videos.forEach(other => {
          if (other !== video) {
            other.pause();
          }
        });

        video.play().catch(() => {});
      });
    });

    restart?.addEventListener('click', () => {
      videos.forEach(other => {
        if (other !== video) {
          other.pause();
        }
      });

      video.currentTime = 0;
      video.play().catch(() => {});
    });

    speed?.addEventListener('click', () => {
      const speeds =
        [1, 1.25, 1.5, 0.75];

      const current =
        video.playbackRate || 1;

      const index =
        speeds.indexOf(current);

      const next =
        speeds[(index + 1) % speeds.length];

      video.playbackRate = next;
      speed.textContent =
        next + '×';
    });
  });

  wireYoutubeLessons();
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
      const locked = user.locked === true;

      let status = '🔴 Expired';
      let daysRemaining = 0;

      if (admin) {
        status = '👑 ADMIN • FREE';
      } else if (free) {
        status = '🆓 FREE ACCESS';
      } else if (
        user.expiresAt &&
        new Date(user.expiresAt).getTime() > Date.now()
      ) {
        const diff =
          new Date(user.expiresAt).getTime() - Date.now();

        daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));

        status = '🟢 Active';
      }

      const expiry = user.expiresAt
        ? new Date(user.expiresAt).toLocaleDateString('so-SO')
        : '—';

      return `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <strong>📱 ${esc(user.phone)}</strong>

            <span>${status}</span>

            <small>📅 Membership: ${expiry}</small>

            ${
              admin || free
                ? ''
                : `<small>⏳ Maalmaha haray: ${daysRemaining}</small>`
            }

            ${
              locked
                ? '<small>🔒 Account-ku waa xiran yahay</small>'
                : ''
            }

            <small>ID: ${esc(user.id)}</small>
          </div>

          ${
            admin
              ? '<div class="admin-badge">👑 ADMIN</div>'
              : `
                <div class="admin-user-actions">

                  <button
                    type="button"
                    class="add-30-days"
                    data-user-id="${esc(user.id)}">
                    ➕ +30 maalmood
                  </button>

                  <button
                    type="button"
                    class="undo-30-days"
                    data-user-id="${esc(user.id)}">
                    ↩️ Ka laabo 30 maalmood
                  </button>

                  <button
                    type="button"
                    class="delete-user"
                    data-user-id="${esc(user.id)}">
                    🗑️ Delete User
                  </button>

                  <button
                    type="button"
                    class="activate-user"
                    data-user-id="${esc(user.id)}">
                    🟢 Active ka dhig
                  </button>

                  <button
                    type="button"
                    class="expire-user"
                    data-user-id="${esc(user.id)}">
                    🔴 Expired ka dhig
                  </button>

                  ${
                    locked
                      ? `<button
                          type="button"
                          class="unlock-user"
                          data-user-id="${esc(user.id)}">
                          🔓 Fur account
                        </button>`
                      : `<button
                          type="button"
                          class="lock-user"
                          data-user-id="${esc(user.id)}">
                          🔒 Xir account
                        </button>`
                  }

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

                  <button
                    type="button"
                    class="revoke-paid"
                    data-user-id="${esc(user.id)}">
                    🚫 Ka qaad Paid
                  </button>

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

    container.querySelectorAll('.add-30-days').forEach(button => {
      button.onclick = () =>
        add30Days(button.dataset.userId);
    });

    container.querySelectorAll('.undo-30-days').forEach(button => {
      button.onclick = () =>
        undo30Days(button.dataset.userId);
    });

    container.querySelectorAll('.delete-user').forEach(button => {
      button.onclick = () =>
        deleteUser(button.dataset.userId);
    });

    container.querySelectorAll('.activate-user').forEach(button => {
      button.onclick = () =>
        activateUser(button.dataset.userId);
    });

    container.querySelectorAll('.expire-user').forEach(button => {
      button.onclick = () =>
        expireUser(button.dataset.userId);
    });

    container.querySelectorAll('.lock-user').forEach(button => {
      button.onclick = () =>
        lockUser(button.dataset.userId);
    });

    container.querySelectorAll('.unlock-user').forEach(button => {
      button.onclick = () =>
        unlockUser(button.dataset.userId);
    });

  } catch (error) {
    container.innerHTML =
      '<div class="notice">❌ ' +
      esc(error.error || 'Users lama soo gelin.') +
      '</div>';
  }
}

async function activateUser(userId) {
  if (!confirm('User-kan Active ma ka dhigaysaa?')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}/activate`,
      { method: 'POST' }
    );

    toast(result.message || '🟢 User-ka waa Active.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Active lagama dhigi karin.');
  }
}

async function expireUser(userId) {
  if (!confirm('User-kan Expired ma ka dhigaysaa?')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}/expire`,
      { method: 'POST' }
    );

    toast(result.message || '🔴 User-ka waa Expired.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Expired lagama dhigi karin.');
  }
}

async function add30Days(userId) {
  if (!confirm('Qofkan 30 maalmood ma ugu dari kartaa?')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}/add-30-days`,
      { method: 'POST' }
    );

    toast(result.message || '➕ 30 maalmood ayaa lagu daray.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || '30 maalmood laguma darin.');
  }
}

async function undo30Days(userId) {
  if (!confirm('30 maalmoodkii ugu dambeeyay ma ka laabaysaa user-kan?')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}/undo-30-days`,
      { method: 'POST' }
    );

    toast(result.message || '↩️ 30 maalmood waa laga laabay.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || '30 maalmood lagama laabi karin.');
  }
}

async function deleteUser(userId) {
  if (!confirm('⚠️ User-kan ma tirtiraysaa? Tirtiridda user-ka lama soo celin karo.')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );

    toast(result.message || '🗑️ User-ka waa la tirtiray.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'User-ka lama tirtiri karin.');
  }
}

async function lockUser(userId) {
  if (!confirm('Account-kan ma xiraysaa?')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}/lock`,
      { method: 'POST' }
    );

    toast(result.message || '🔒 Account-ka waa la xiray.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Account-ka lama xiri karin.');
  }
}

async function unlockUser(userId) {
  if (!confirm('Account-kan ma furaysaa?')) return;

  try {
    const result = await api(
      `/api/admin/user/${encodeURIComponent(userId)}/unlock`,
      { method: 'POST' }
    );

    toast(result.message || '🔓 Account-ka waa la furay.');

    await loadAdminUsers();
    await loadAdminStats();
  } catch (error) {
    toast(error.error || 'Account-ka lama furi karin.');
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

let browserWhisper = null;
let browserWhisperLoading = false;

async function generateAISubtitles() {
  const input = $('video');
  const status = $('uploadStatus');
  const rows = $('subtitleRows');
  const video = input?.files?.[0];

  if (!video) {
    toast('🎬 Marka hore video dooro.');
    return;
  }

  if (!rows) {
    toast('❌ Subtitle rows lama helin.');
    return;
  }

  try {
    rows.innerHTML = '';

    if (status) {
      status.textContent =
        '⏳ AI English transcription ayaa bilaabanaya...';
      show('uploadStatus');
    }

    if (!browserWhisper) {
      if (browserWhisperLoading) {
        toast('⏳ AI model-ka wali wuu soo degayaa...');
        return;
      }

      browserWhisperLoading = true;

      if (status) {
        status.textContent =
          '⬇️ AI model-ka English ayaa browser-ka soo degsanaya... markii ugu horreysa way qaadan kartaa.';
      }

      const { pipeline, env } = await import(
        'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0'
      );

      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;

      browserWhisper = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny.en',
        {
          dtype: 'q4'
        }
      );

      browserWhisperLoading = false;
    }

    if (status) {
      status.textContent =
        '🔊 Video-ga ayaa la dhageysanayaa... English + timestamps ayaa la sameynayaa.';
    }

    const arrayBuffer = await video.arrayBuffer();

    const AudioCtx =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioCtx) {
      throw new Error('Browser-kan AudioContext ma taageerayo.');
    }

    const audioContext = new AudioCtx();

    const decoded =
      await audioContext.decodeAudioData(arrayBuffer);

    const targetRate = 16000;
    const duration = decoded.duration;

    const offline = new OfflineAudioContext(
      1,
      Math.ceil(duration * targetRate),
      targetRate
    );

    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);

    const rendered = await offline.startRendering();
    const audioData = rendered.getChannelData(0);

    if (status) {
      status.textContent =
        '🤖 English-ka ayaa hadda la aqrinayaa...';
    }

    const result = await browserWhisper(audioData, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5
    });

    await audioContext.close();

    const chunks = Array.isArray(result?.chunks)
      ? result.chunks
      : [];

    if (!chunks.length) {
      throw new Error('English subtitles lama helin.');
    }

    let count = 0;

    for (const chunk of chunks) {
      const timestamp = chunk.timestamp;

      if (!Array.isArray(timestamp)) continue;

      const startTime = Number(timestamp[0]);
      const endTime = Number(timestamp[1]);
      const en = String(chunk.text || '').trim();

      if (
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime) ||
        endTime <= startTime ||
        !en
      ) {
        continue;
      }

      addSubtitleRow({
        start: startTime.toFixed(1),
        end: endTime.toFixed(1),
        en,
        so: ''
      });

      count++;
    }

    if (!count) {
      throw new Error('English subtitles sax ah lama helin.');
    }

    if (status) {
      status.textContent =
        `✅ ${count} English subtitles ayaa otomaatig loo sameeyay. Hadda Somali-ga ku qor.`;
      show('uploadStatus');
    }

    toast(`✅ ${count} English subtitles waa diyaar.`);

  } catch (error) {
    console.error('BROWSER WHISPER ERROR:', error);

    browserWhisperLoading = false;

    if (status) {
      status.textContent =
        '❌ ' +
        (error?.message ||
          'English transcription ayaa fashilmay.');
      show('uploadStatus');
    }

    toast(
      error?.message ||
      'English transcription ayaa fashilmay.'
    );
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

  // 🎬 VIDEO LA DOORTO → AI SUBTITLES SI TOOS AH U BILAAB
  $('video')?.addEventListener('change', async () => {
    const video = $('video')?.files?.[0];

    if (!video) return;

    // Nadiifi subtitles-kii hore
    const rows = $('subtitleRows');
    if (rows) rows.innerHTML = '';

    // AI si otomaatig ah u bilow
    await generateAISubtitles();
  });

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


// =====================================================
// YouTube Admin Dashboard
// =====================================================

(() => {
  const urlInput = document.getElementById("youtubeUrl");
  const loadBtn = document.getElementById("loadYoutubeBtn");
  const status = document.getElementById("youtubeStatus");
  const preview = document.getElementById("youtubePreview");
  const player = document.getElementById("youtubePlayer");
  const title = document.getElementById("youtubeTitle");
  const rows = document.getElementById("youtubeSubtitleRows");
  const addBtn = document.getElementById("addYoutubeSubtitle");
  const saveBtn = document.getElementById("saveYoutubeSubtitles");
  const publishBtn = document.getElementById("publishYoutubeLesson");
  const subtitleStatus = document.getElementById("youtubeSubtitleStatus");

  if (!urlInput || !loadBtn) return;

  function youtubeId(value) {
    try {
      const u = new URL(String(value).trim());

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

  function addRow(data = {}) {
    if (!rows) return;

    const row = document.createElement("div");
    row.className = "subtitle-row youtube-subtitle-row";

    row.innerHTML = `
      <input
        class="subtitle-start"
        type="number"
        step="0.1"
        min="0"
        placeholder="Start (sec)"
        value="${Number.isFinite(Number(data.start)) ? data.start : ""}"
      >

      <input
        class="subtitle-end"
        type="number"
        step="0.1"
        min="0"
        placeholder="End (sec)"
        value="${Number.isFinite(Number(data.end)) ? data.end : ""}"
      >

      <input
        class="subtitle-english"
        type="text"
        placeholder="English"
        value="${escapeHtml(data.en || "")}"
      >

      <input
        class="subtitle-somali"
        type="text"
        placeholder="Somali"
        value="${escapeHtml(data.so || "")}"
      >

      <button
        type="button"
        class="btn btn-secondary remove-subtitle">
        ✕
      </button>
    `;

    rows.appendChild(row);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function collectRows() {
    if (!rows) return [];

    return [...rows.querySelectorAll(".youtube-subtitle-row")]
      .map((row, index) => {
        const start = Number(
          row.querySelector(".subtitle-start")?.value
        );

        const end = Number(
          row.querySelector(".subtitle-end")?.value
        );

        const en =
          row.querySelector(".subtitle-english")?.value.trim() || "";

        const so =
          row.querySelector(".subtitle-somali")?.value.trim() || "";

        return {
          index,
          start,
          end,
          en,
          so
        };
      })
      .filter(line =>
        Number.isFinite(line.start) &&
        Number.isFinite(line.end) &&
        line.start >= 0 &&
        line.end > line.start &&
        line.en
      )
      .map(({ start, end, en, so }) => ({
        start,
        end,
        en,
        so
      }));
  }

  loadBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    const id = youtubeId(url);

    if (!id) {
      status.textContent = "❌ YouTube URL sax ah geli.";
      status.classList.remove("hidden");
      if (preview) preview.style.display = "none";
      return;
    }

    player.innerHTML = `
      <iframe
        width="100%"
        height="100%"
        src="https://www.youtube.com/embed/${encodeURIComponent(id)}"
        title="YouTube video"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen>
      </iframe>
    `;

    if (preview) preview.style.display = "block";

    status.textContent = "✅ Video-ga waa diyaar.";
    status.classList.remove("hidden");
  });

  addBtn?.addEventListener("click", () => {
    addRow();
  });

  rows?.addEventListener("click", event => {
    const remove = event.target.closest(".remove-subtitle");

    if (!remove) return;

    const all = rows.querySelectorAll(".youtube-subtitle-row");

    if (all.length > 1) {
      remove.closest(".youtube-subtitle-row")?.remove();
    } else {
      const row = remove.closest(".youtube-subtitle-row");
      row?.querySelector(".subtitle-start") && (
        row.querySelector(".subtitle-start").value = ""
      );
      row?.querySelector(".subtitle-end") && (
        row.querySelector(".subtitle-end").value = ""
      );
      row?.querySelector(".subtitle-english") && (
        row.querySelector(".subtitle-english").value = ""
      );
      row?.querySelector(".subtitle-somali") && (
        row.querySelector(".subtitle-somali").value = ""
      );
    }
  });

  saveBtn?.addEventListener("click", () => {
    const subtitles = collectRows();

    localStorage.setItem(
      "youtubeSubtitlesDraft",
      JSON.stringify(subtitles)
    );

    if (subtitleStatus) {
      subtitleStatus.textContent =
        `💾 ${subtitles.length} subtitle(s) waa la keydiyay.`;
      subtitleStatus.classList.remove("hidden");
    }
  });

  publishBtn?.addEventListener("click", async () => {
    const youtubeUrl = urlInput.value.trim();
    const lessonTitle = title?.value.trim() || "";
    const subtitles = collectRows();

    if (!youtubeId(youtubeUrl)) {
      if (subtitleStatus) {
        subtitleStatus.textContent =
          "❌ Marka hore geli YouTube URL sax ah.";
        subtitleStatus.classList.remove("hidden");
      }
      return;
    }

    if (!lessonTitle) {
      if (subtitleStatus) {
        subtitleStatus.textContent =
          "❌ Magaca casharka geli.";
        subtitleStatus.classList.remove("hidden");
      }
      return;
    }

    if (!subtitles.length) {
      if (subtitleStatus) {
        subtitleStatus.textContent =
          "❌ Ugu yaraan hal English subtitle geli.";
        subtitleStatus.classList.remove("hidden");
      }
      return;
    }

    publishBtn.disabled = true;
    publishBtn.textContent = "⏳ Publishing...";

    try {
      const result = await api("/api/admin/youtube-lesson", {
        method: "POST",
        body: JSON.stringify({
          title: lessonTitle,
          description: "",
          youtubeUrl,
          lines: subtitles
        })
      });

      if (subtitleStatus) {
        subtitleStatus.textContent =
          result.message || "✅ YouTube lesson waa la publish gareeyay.";
        subtitleStatus.classList.remove("hidden");
      }

      localStorage.removeItem("youtubeSubtitlesDraft");

      await loadAdminLessons();
      await loadAdminStats();

    } catch (error) {
      if (subtitleStatus) {
        subtitleStatus.textContent =
          "❌ " + (error.error || error.message || "Publish ayaa fashilmay.");
        subtitleStatus.classList.remove("hidden");
      }
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = "🚀 PUBLISH";
    }
  });

  // Soo celi draft-kii hore
  try {
    const draft = JSON.parse(
      localStorage.getItem("youtubeSubtitlesDraft") || "[]"
    );

    if (Array.isArray(draft) && draft.length && rows) {
      rows.innerHTML = "";
      draft.forEach(addRow);
    }
  } catch {}

})();


/* =====================================================
   YOUTUBE AUTO SUBTITLE DASHBOARD
   ===================================================== */

(() => {
  const autoBtn = document.getElementById("autoYoutubeSubtitles");
  const urlInput = document.getElementById("youtubeUrl");
  const rows = document.getElementById("youtubeSubtitleRows");
  const status = document.getElementById("youtubeSubtitleStatus");

  if (!autoBtn || !urlInput || !rows) return;

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function addAutoRow(data) {
    const row = document.createElement("div");
    row.className = "subtitle-row youtube-subtitle-row";

    row.innerHTML = `
      <input
        class="subtitle-start"
        type="number"
        step="0.1"
        min="0"
        value="${esc(data.start)}"
        placeholder="Start (sec)"
      >

      <input
        class="subtitle-end"
        type="number"
        step="0.1"
        min="0"
        value="${esc(data.end)}"
        placeholder="End (sec)"
      >

      <input
        class="subtitle-english"
        type="text"
        value="${esc(data.en)}"
        placeholder="English"
      >

      <input
        class="subtitle-somali"
        type="text"
        value=""
        placeholder="Somali"
      >

      <button
        type="button"
        class="btn btn-secondary remove-subtitle">
        ✕
      </button>
    `;

    rows.appendChild(row);
  }

  autoBtn.addEventListener("click", async () => {
    const youtubeUrl = String(urlInput.value || "").trim();

    if (!youtubeUrl) {
      alert("Marka hore geli YouTube URL.");
      return;
    }

    autoBtn.disabled = true;
    autoBtn.textContent = "⏳ SOO SAARAYA...";

    if (status) {
      status.classList.remove("hidden");
      status.textContent =
        "🤖 YouTube English subtitles ayaa la soo saaraya...";
    }

    try {
      const response = await fetch(
        "/api/admin/youtube-transcript",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ youtubeUrl })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
          "English subtitles lama heli karin."
        );
      }

      rows.innerHTML = "";

      for (const line of data.lines) {
        addAutoRow(line);
      }

      if (status) {
        status.textContent =
          `✅ ${data.count} English subtitle rows ayaa la helay. Hadda waad sixi kartaa English-ka oo Somali-ga geli kartaa.`;
      }

    } catch (err) {
      console.error(err);

      if (status) {
        status.textContent =
          "❌ " +
          (err.message ||
            "Automatic subtitles lama heli karin.");
      }

      alert(
        err.message ||
        "Automatic subtitles lama heli karin."
      );

    } finally {
      autoBtn.disabled = false;
      autoBtn.textContent = "🤖 AUTO SUBTITLES";
    }
  });
})();

/* =====================================================
   VIDEO FILE PICKER + WHISPER GENERATOR
   ===================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("youtubeWhisperFile");
  const chooseBtn = document.getElementById("chooseYoutubeWhisperFile");
  const generateBtn = document.getElementById("generateYoutubeWhisper");
  const fileName = document.getElementById("youtubeWhisperFileName");
  const status = document.getElementById("youtubeWhisperStatus");
  const rows = document.getElementById("youtubeSubtitleRows");

  if (!fileInput || !chooseBtn || !generateBtn) {
    console.log("Whisper video controls lama helin.");
    return;
  }

  /* CHOOSE VIDEO */
  chooseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    fileInput.value = "";
    fileInput.click();
  });

  /* VIDEO SELECTED */
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
      fileName.textContent = "Video lama dooran.";
      chooseBtn.textContent = "📁 CHOOSE VIDEO";
      return;
    }

    fileName.textContent =
      "✅ " + file.name + " (" +
      (file.size / 1024 / 1024).toFixed(1) +
      " MB)";

    chooseBtn.textContent = "📁 CHANGE VIDEO";

    status.textContent =
      "✅ Video waa la doortay. Hadda riix GENERATE FROM VIDEO.";
  });

  /* GENERATE ENGLISH SUBTITLES */
  generateBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const file = fileInput.files && fileInput.files[0];

    if (!file) {
      alert("❌ Marka hore riix CHOOSE VIDEO oo dooro video.");
      return;
    }

    generateBtn.disabled = true;
    chooseBtn.disabled = true;
    generateBtn.textContent = "⏳ WHISPER WAA SHAQAYNAYAA...";

    status.textContent =
      "🎙️ Video-ga ayaa la dirayaa. Fadlan sug...";

    try {
      const formData = new FormData();
      formData.append("video", file);

      const response = await fetch(
        "/api/admin/whisper-subtitles",
        {
          method: "POST",
          body: formData
        }
      );

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error(
          "Server-ku jawaab sax ah ma soo celin."
        );
      }

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
          "Whisper subtitles lama samayn karin."
        );
      }

      if (!Array.isArray(data.lines) || !data.lines.length) {
        throw new Error(
          "Whisper wax English subtitles ah kama helin video-ga."
        );
      }

      /* Clear old rows */
      rows.innerHTML = "";

      /* Escape HTML */
      const esc = (value) =>
        String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      /* Add Whisper rows */
      for (const line of data.lines) {
        const row = document.createElement("div");

        row.className =
          "subtitle-row youtube-subtitle-row";

        row.innerHTML = `
          <input
            class="subtitle-start"
            type="number"
            step="0.1"
            min="0"
            value="${esc(line.start)}"
            placeholder="Start (sec)"
          >

          <input
            class="subtitle-end"
            type="number"
            step="0.1"
            min="0"
            value="${esc(line.end)}"
            placeholder="End (sec)"
          >

          <input
            class="subtitle-english"
            type="text"
            value="${esc(line.en)}"
            placeholder="English"
          >

          <input
            class="subtitle-somali"
            type="text"
            value=""
            placeholder="Somali"
          >

          <button
            type="button"
            class="btn btn-secondary remove-subtitle">
            ✕
          </button>
        `;

        rows.appendChild(row);
      }

      status.textContent =
        `✅ ${data.count || data.lines.length} English subtitle rows ayaa la sameeyay. Hadda English-ka sax oo Somali geli.`;

    } catch (error) {
      console.error("WHISPER FRONTEND ERROR:", error);

      status.textContent =
        "❌ " +
        (error.message ||
          "Whisper subtitles lama samayn karin.");

      alert(
        error.message ||
        "Whisper subtitles lama samayn karin."
      );

    } finally {
      generateBtn.disabled = false;
      chooseBtn.disabled = false;
      generateBtn.textContent =
        "🎙️ GENERATE FROM VIDEO";
    }
  });
});
