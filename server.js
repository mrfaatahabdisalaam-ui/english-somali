const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const OpenAI = require('openai');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const PORT = process.env.PORT || 3000;

/*
  ADMIN SETTINGS
  ----------------
  Admin password-ka waxaa fiican inaad environment variable ka dhigto.
  Haddii aadan dejin, password-ka ku meelgaarka ah waa:
  ChangeThisAdminPassword

  ADMIN_PHONE waa number-ka admin-ka.
*/
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'ceadce18c5d8b4295898c8db3fe87decaaa0ccf967dd3df798134099b0c571ae';

const ADMIN_PHONE =
  process.env.ADMIN_PHONE || '616785024';

const SESSION_SECRET =
  process.env.SESSION_SECRET || 'change-this-secret-in-production';

const PAYMENT_NUMBER = '616785024';
const PAYMENT_NAME = 'Abdifitaah Abdisalaam Xuseyn';
const PAYMENT_METHOD = 'Hormuud';
const PRICE = 3;
const MEMBERSHIP_DAYS = 30;

const DATA = path.join(__dirname, 'data');
const UP = path.join(__dirname, 'public', 'uploads');

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UP, { recursive: true });

for (const f of ['users.json', 'lessons.json', 'payments.json']) {
  const p = path.join(DATA, f);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '[]');
  }
}

const read = (f) =>
  JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const write = (f, d) =>
  fs.writeFileSync(
    path.join(DATA, f),
    JSON.stringify(d, null, 2)
  );

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 31
    }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UP,
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      );

      cb(null, Date.now() + '-' + safeName);
    }
  }),

  limits: {
    fileSize: 700 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    cb(null, /^video\//.test(file.mimetype));
  }
});


/* =========================
   HELPERS
========================= */

function normalizePhone(phone) {
  return String(phone || '')
    .trim()
    .replace(/\s+/g, '');
}

function isAdminPhone(phone) {
  return normalizePhone(phone) === normalizePhone(ADMIN_PHONE);
}

function userFrom(req) {
  if (!req.session.userId) return null;

  return read('users.json').find(
    (u) => u.id === req.session.userId
  );
}

function paid(user) {
  if (!user) return false;

  /*
    ADMIN = FREE
    Server-side check.
  */
  if (user.role === 'admin') {
    return true;
  }

  if (user.freeAccess === true) {
    return true;
  }

  if (
    user.expiresAt &&
    new Date(user.expiresAt).getTime() > Date.now()
  ) {
    return true;
  }

  return false;
}

function auth(req, res, next) {
  const user = userFrom(req);

  if (!user) {
    return res.status(401).json({
      error: 'Login required'
    });
  }

  req.currentUser = user;
  next();
}

function admin(req, res, next) {
  const user = userFrom(req);

  if (!req.session.admin && !(user && user.role === 'admin')) {
    return res.status(403).json({
      error: 'Admin only'
    });
  }

  req.currentUser = user;
  next();
}


/* =========================
   CONFIG
========================= */

app.get('/api/config', (req, res) => {
  res.json({
    price: PRICE,
    days: MEMBERSHIP_DAYS,

    paymentMethod: PAYMENT_METHOD,
    paymentNumber: PAYMENT_NUMBER,
    paymentName: PAYMENT_NAME,

    currency: 'USD'
  });
});


/* =========================
   USER LOGIN
========================= */

app.post('/api/login', (req, res) => {
  const phone = normalizePhone(req.body.phone);

  if (!/^61[0-9]{7}$/.test(phone)) {
    return res.status(400).json({
      error: 'Number-ka waa inuu noqdaa 61xxxxxxx oo 9 digit ah'
    });
  }

  let users = read('users.json');

  let user = users.find(
    (x) => normalizePhone(x.phone) === phone
  );

  if (!user) {
    user = {
      id: Date.now().toString(),
      phone,
      role: isAdminPhone(phone) ? 'admin' : 'user',
      expiresAt: null,
      createdAt: new Date().toISOString()
    };

    users.push(user);
    write('users.json', users);
  } else {

    /*
      Haddii number-ku yahay ADMIN_PHONE,
      role admin ayaa lagu xaqiijinayaa server-ka.
    */
    if (isAdminPhone(phone)) {
      user.role = 'admin';
      write('users.json', users);
    }
  }

  req.session.userId = user.id;

  res.json({
    phone: user.phone,
    role: user.role || 'user',
    isAdmin: user.role === 'admin',
    paid: paid(user),
    expiresAt: user.expiresAt
  });
});


/* =========================
   LOGOUT
========================= */

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});


/* =========================
   CURRENT USER
========================= */

app.get('/api/me', auth, (req, res) => {
  const pending = read('payments.json').some(
    (p) =>
      p.userId === req.currentUser.id &&
      p.status === 'pending'
  );

  res.json({
    phone: req.currentUser.phone,
    role: req.currentUser.role || 'user',
    isAdmin: req.currentUser.role === 'admin',
    paid: paid(req.currentUser),
    expiresAt: req.currentUser.expiresAt,
    pending
  });
});


/* =========================
   PAYMENT REQUEST
========================= */

app.post('/api/payment-request', auth, (req, res) => {

  /*
    ADMIN lacag looma baahan.
  */
  if (req.currentUser.role === 'admin') {
    return res.status(400).json({
      error: 'Admin-ku payment uma baahna. Admin access waa FREE.'
    });
  }

  const senderPhone = String(
    req.body.senderPhone || req.body.reference || ''
  ).trim().replace(/\s+/g, '');

  if (!/^61[0-9]{7}$/.test(senderPhone)) {
    return res.status(400).json({
      error: 'Geli lambarka Hormuudka aad lacagta kasoo dirtay (61xxxxxxx).'
    });
  }

  let payments = read('payments.json');

  const pending = payments.some(
    (p) =>
      p.userId === req.currentUser.id &&
      p.status === 'pending'
  );

  if (pending) {
    return res.status(400).json({
      error: 'Codsi payment hore ayaa sugaya xaqiijin.'
    });
  }

  payments.push({
    id: Date.now().toString(),

    userId: req.currentUser.id,
    phone: req.currentUser.phone,

    amount: PRICE,
    currency: 'USD',

    paymentMethod: PAYMENT_METHOD,
    paymentNumber: PAYMENT_NUMBER,
    paymentName: PAYMENT_NAME,

    senderPhone,
    reference: senderPhone,

    status: 'pending',

    createdAt: new Date().toISOString()
  });

  write('payments.json', payments);

  res.json({
    ok: true,
    message:
      'Payment-kaaga waa la helay. Admin ayaa hubinaya.'
  });
});


/* =========================
   LESSONS
========================= */

app.get('/api/lessons', auth, (req, res) => {

  /*
    ADMIN = FREE
    User = membership active required.
  */
  if (!paid(req.currentUser)) {
    return res.status(402).json({
      error: 'Subscription expired',
      expiresAt: req.currentUser.expiresAt
    });
  }

  res.json(
    read('lessons.json').map((lesson) => ({
      ...lesson,
      video: '/uploads/' + lesson.video
    }))
  );
});


/* =========================
   ADMIN LOGIN
========================= */

app.post('/api/admin/login', (req, res) => {
  const password = String(
    req.body.password || ''
  );

  const passwordHash = crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');

  if (passwordHash !== ADMIN_PASSWORD) {
    return res.status(401).json({
      error: 'Password khalad ah'
    });
  }

  req.session.admin = true;

  /*
    Hubi/abuuri admin user.
    Tani waxay admin-ka siinaysaa FREE access
    marka /api/lessons la isticmaalayo.
  */
  let users = read('users.json');

  let adminUser = users.find(
    (u) =>
      normalizePhone(u.phone) ===
      normalizePhone(ADMIN_PHONE)
  );

  if (!adminUser) {
    adminUser = {
      id: 'admin-' + Date.now(),
      phone: ADMIN_PHONE,
      role: 'admin',
      expiresAt: null,
      createdAt: new Date().toISOString()
    };

    users.push(adminUser);
  } else {
    adminUser.role = 'admin';
  }

  write('users.json', users);

  req.session.userId = adminUser.id;

  res.json({
    ok: true,
    role: 'admin',
    isAdmin: true,
    paid: true,
    message: 'Admin login successful. FREE access.'
  });
});


/* =========================
   ADMIN LOGOUT
========================= */

app.post('/api/admin/logout', admin, (req, res) => {
  req.session.admin = false;

  res.json({
    ok: true
  });
});


/* =========================
   ADMIN STATS
========================= */

app.get('/api/admin/stats', admin, (req, res) => {
  const users = read('users.json');
  const payments = read('payments.json');
  const lessons = read('lessons.json');

  res.json({
    users: users.length,
    lessons: lessons.length,

    pending: payments.filter(
      (p) => p.status === 'pending'
    ).length,

    approved: payments.filter(
      (p) => p.status === 'approved'
    ).length,

    rejected: payments.filter(
      (p) => p.status === 'rejected'
    ).length,

    active: users.filter(paid).length,

    paymentMethod: PAYMENT_METHOD,
    paymentNumber: PAYMENT_NUMBER,
    paymentName: PAYMENT_NAME,
    price: PRICE,
    days: MEMBERSHIP_DAYS
  });
});


/* =========================
   ADMIN PAYMENTS
========================= */

app.get('/api/admin/payments', admin, (req, res) => {
  const payments = read('payments.json');

  payments.sort((a, b) =>
    String(b.createdAt).localeCompare(
      String(a.createdAt)
    )
  );

  res.json(payments);
});


/* =========================
   APPROVE PAYMENT
========================= */

app.post(
  '/api/admin/payment/:id/approve',
  admin,
  (req, res) => {

    let payments = read('payments.json');

    const payment = payments.find(
      (p) => p.id === req.params.id
    );

    if (!payment) {
      return res.status(404).json({
        error: 'Payment not found'
      });
    }

    if (payment.status !== 'pending') {
      return res.json({
        ok: true,
        message: 'Payment hore ayaa loo processing gareeyay.'
      });
    }

    payment.status = 'approved';
    payment.approvedAt =
      new Date().toISOString();

    let users = read('users.json');

    const user = users.find(
      (u) => u.id === payment.userId
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    /*
      Haddii membership hore wali shaqaynayo,
      30 maalmood ayaa lagu daraa expiry-ga hore.
      Haddii uu dhacay, maanta ayaa laga bilaabayaa.
    */
    let base;

    if (
      user.expiresAt &&
      new Date(user.expiresAt).getTime() > Date.now()
    ) {
      base = new Date(user.expiresAt);
    } else {
      base = new Date();
    }

    base.setDate(
      base.getDate() + MEMBERSHIP_DAYS
    );

    user.expiresAt = base.toISOString();

    write('users.json', users);
    write('payments.json', payments);

    res.json({
      ok: true,
      message: 'Payment approved. 30 maalmood ayaa lagu daray.',
      expiresAt: user.expiresAt
    });
  }
);


/* =========================
   REJECT PAYMENT
========================= */

app.post(
  '/api/admin/payment/:id/reject',
  admin,
  (req, res) => {

    let payments = read('payments.json');

    const payment = payments.find(
      (p) => p.id === req.params.id
    );

    if (!payment) {
      return res.status(404).json({
        error: 'Payment not found'
      });
    }

    payment.status = 'rejected';
    payment.rejectedAt =
      new Date().toISOString();

    write('payments.json', payments);

    res.json({
      ok: true,
      message: 'Payment rejected.'
    });
  }
);



/* =========================
   ADMIN FREE ACCESS
========================= */

app.post('/api/admin/user/:id/free', admin, (req, res) => {
  const users = read('users.json');

  const user = users.find(
    (u) => u.id === req.params.id
  );

  if (!user) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  user.freeAccess = true;

  write('users.json', users);

  res.json({
    ok: true,
    message: 'Free access waa la siiyay user-ka.',
    user
  });
});


app.post('/api/admin/user/:id/free/remove', admin, (req, res) => {
  const users = read('users.json');

  const user = users.find(
    (u) => u.id === req.params.id
  );

  if (!user) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  user.freeAccess = false;

  write('users.json', users);

  res.json({
    ok: true,
    message: 'Free access waa laga qaaday user-ka.',
    user
  });
});



/* =========================
   REVOKE PAID ACCESS
========================= */

app.post('/api/admin/user/:id/revoke-paid', admin, (req, res) => {
  const users = read('users.json');

  const user = users.find(
    (u) => u.id === req.params.id
  );

  if (!user) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  if (user.role === 'admin') {
    return res.status(400).json({
      error: 'Admin access lama laga qaadi karo'
    });
  }

  user.expiresAt = null;

  write('users.json', users);

  res.json({
    ok: true,
    message: 'Paid access waa laga qaaday user-ka.',
    user
  });
});

app.get('/api/admin/users', admin, (req, res) => {
  const users = read('users.json');

  res.json(
    users.map((u) => ({
      id: u.id,
      phone: u.phone,
      role: u.role || 'user',
      freeAccess: u.freeAccess === true,
      expiresAt: u.expiresAt || null,
      createdAt: u.createdAt || null,
      paid: paid(u)
    }))
  );
});


/* =========================
   AI AUTO SUBTITLES
========================= */

app.post(
  '/api/admin/auto-subtitles',
  admin,
  upload.single('video'),
  async (req, res) => {
    let audioFile = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Video geli'
        });
      }

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          error: 'OPENAI_API_KEY lama helin'
        });
      }

      const videoFile = req.file.path;
      audioFile = videoFile + '.mp3';

      /* Video -> MP3 audio */
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', videoFile,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-b:a', '64k',
        audioFile
      ]);

      /* AI English transcription + timestamps */
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFile),
        model: 'gpt-4o-transcribe',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      });

      const segments = Array.isArray(transcription.segments)
        ? transcription.segments
        : [];

      if (!segments.length) {
        throw new Error('AI transcript segments lama helin.');
      }

      /* English -> Somali */
      const input = segments.map((x, i) => ({
        n: i + 1,
        start: Number(x.start) || 0,
        end: Number(x.end) || 0,
        en: String(x.text || '').trim()
      }));

      const translation = await openai.responses.create({
        model: 'gpt-5-mini',
        input: [
          {
            role: 'system',
            content:
              'You translate English subtitles into natural, clear Somali. ' +
              'Return ONLY valid JSON. Keep every subtitle number and timing exactly. ' +
              'Do not merge or delete subtitles.'
          },
          {
            role: 'user',
            content:
              JSON.stringify(input) +
              '\n\nReturn JSON array with objects containing: n, start, end, en, so.'
          }
        ]
      });

      let translatedText = translation.output_text || '';
      translatedText = translatedText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let translated;

      try {
        translated = JSON.parse(translatedText);
      } catch {
        throw new Error('AI Somali translation JSON sax ma aha.');
      }

      if (!Array.isArray(translated)) {
        throw new Error('AI translation format sax ma aha.');
      }

      const lines = translated
        .map((x, i) => ({
          start: Number(x.start),
          end: Number(x.end),
          en: String(x.en || input[i]?.en || '').trim(),
          so: String(x.so || '').trim()
        }))
        .filter(x =>
          Number.isFinite(x.start) &&
          Number.isFinite(x.end) &&
          x.end > x.start &&
          x.en &&
          x.so
        );

      if (!lines.length) {
        throw new Error('AI subtitles lama sameyn karin.');
      }

      /* Delete temporary MP3; keep uploaded video */
      if (fs.existsSync(audioFile)) {
        fs.unlinkSync(audioFile);
      }

      res.json({
        ok: true,
        message: '🤖 AI subtitles waa la sameeyay.',
        video: req.file.filename,
        lines
      });

    } catch (error) {
      if (audioFile && fs.existsSync(audioFile)) {
        try {
          fs.unlinkSync(audioFile);
        } catch {}
      }

      console.error('AI AUTO SUBTITLE ERROR:', error);

      res.status(500).json({
        error:
          error?.message ||
          'AI subtitles lama sameyn karin.'
      });
    }
  }
);


/* =========================
   ADMIN LESSONS
========================= */

app.get('/api/admin/lessons', admin, (req, res) => {
  res.json(read('lessons.json'));
});


/* =========================
   ADD LESSON
========================= */

app.post(
  '/api/admin/lesson',
  admin,
  upload.single('video'),
  (req, res) => {

    if (!req.file) {
      return res.status(400).json({
        error: 'Video geli'
      });
    }

    let lines;

    try {
      lines = JSON.parse(
        req.body.lines || '[]'
      );
    } catch (e) {
      return res.status(400).json({
        error: 'Subtitles JSON sax ma aha'
      });
    }

    if (
      !Array.isArray(lines) ||
      !lines.length
    ) {
      return res.status(400).json({
        error: 'Ku dar ugu yaraan hal subtitle'
      });
    }

    const lessons = read('lessons.json');

    const item = {
      id: Date.now().toString(),

      title:
        String(
          req.body.title ||
          'English Listening Lesson'
        ).trim(),

      description:
        String(
          req.body.description || ''
        ).trim(),

      video: req.file.filename,

      lines: lines.map((x) => ({
        start: Number(x.start),
        end: Number(x.end),
        en: String(x.en || ''),
        so: String(x.so || '')
      })),

      createdAt:
        new Date().toISOString()
    };

    lessons.unshift(item);

    write('lessons.json', lessons);

    res.json({
      ok: true,
      item
    });
  }
);


/* =========================
   DELETE LESSON
========================= */

app.delete(
  '/api/admin/lesson/:id',
  admin,
  (req, res) => {

    let lessons = read('lessons.json');

    const index = lessons.findIndex(
      (x) => x.id === req.params.id
    );

    if (index < 0) {
      return res.status(404).json({
        error: 'Lesson not found'
      });
    }

    const file = path.join(
      UP,
      lessons[index].video
    );

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }

    lessons.splice(index, 1);

    write('lessons.json', lessons);

    res.json({
      ok: true
    });
  }
);



/* =========================
   EDIT LESSON
========================= */

app.put(
  '/api/admin/lesson/:id',
  admin,
  (req, res) => {

    const lessons = read('lessons.json');

    const lesson = lessons.find(
      (x) => x.id === req.params.id
    );

    if (!lesson) {
      return res.status(404).json({
        error: 'Lesson not found'
      });
    }

    let lines;

    try {
      lines = JSON.parse(
        req.body.lines || '[]'
      );
    } catch (e) {
      return res.status(400).json({
        error: 'Subtitles JSON sax ma aha'
      });
    }

    if (
      !Array.isArray(lines) ||
      !lines.length
    ) {
      return res.status(400).json({
        error: 'Ku dar ugu yaraan hal subtitle'
      });
    }

    lesson.title = String(
      req.body.title || lesson.title
    ).trim();

    lesson.description = String(
      req.body.description || ''
    ).trim();

    lesson.lines = lines.map((x) => ({
      start: Number(x.start),
      end: Number(x.end),
      en: String(x.en || ''),
      so: String(x.so || '')
    }));

    lesson.updatedAt = new Date().toISOString();

    write('lessons.json', lessons);

    res.json({
      ok: true,
      item: lesson
    });
  }
);

/* =========================
   FRONTEND FALLBACK
========================= */

app.get('*', (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );
});


/* =========================
   START SERVER
========================= */

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `English Somali Membership: http://localhost:${PORT}`
  );

  console.log(
    `Payment: ${PRICE}$ / ${MEMBERSHIP_DAYS} days`
  );

  console.log(
    `Payment method: ${PAYMENT_METHOD}`
  );

  console.log(
    `Payment number: ${PAYMENT_NUMBER}`
  );

  console.log(
    `Admin phone: ${ADMIN_PHONE}`
  );
});

