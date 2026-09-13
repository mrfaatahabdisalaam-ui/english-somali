const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const OpenAI = require('openai');
const { v2: cloudinary } = require('cloudinary');
const { execFile } = require('child_process');
const util = require('util');
const { db, userFromRow } = require('./db-models');

const execFileAsync = util.promisify(execFile);

async function uploadVideoToCloudinary(filePath) {
  return await cloudinary.uploader.upload(filePath, {
    resource_type: 'video',
    folder: 'english-somali/videos'
  });
}


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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

const ADMIN_PHONE = '';


const ADMIN_ID = 'ADMIN-001';

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
  return false;
}

async function getUserById(id) {
  if (!id) return null;

  const result = await db.query(
    `SELECT * FROM users WHERE id = $1`,
    [id]
  );

  return userFromRow(result.rows[0]);
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

async function auth(req, res, next) {
  try {
    const user = await getUserById(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: 'Login required' });
    }

    req.currentUser = user;
    next();
  } catch (error) {
    console.error('AUTH DB ERROR:', error);
    res.status(500).json({ error: 'Database error' });
  }
}

async function admin(req, res, next) {
  try {
    const user = await getUserById(req.session.userId);

    if (!req.session.admin && !(user && user.role === 'admin')) {
      return res.status(403).json({ error: 'Admin only' });
    }

    req.currentUser = user;
    next();
  } catch (error) {
    console.error('ADMIN DB ERROR:', error);
    res.status(500).json({ error: 'Database error' });
  }
}

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

app.post('/api/login', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!/^61[0-9]{7}$/.test(phone)) {
      return res.status(400).json({
        error: 'Number-ka waa inuu noqdaa 61xxxxxxx oo 9 digit ah'
      });
    }

    const result = await db.query(
      `SELECT * FROM users`
    );

    let row = result.rows.find(
      (u) => normalizePhone(u.phone) === phone
    );

    if (!row) {
      const id = Date.now().toString();

      const inserted = await db.query(
        `INSERT INTO users
          (id, phone, role, free_access, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          id,
          phone,
          isAdminPhone(phone) ? 'admin' : 'user',
          false,
          null
        ]
      );

      row = inserted.rows[0];
    } else if (isAdminPhone(phone) && row.role !== 'admin') {
      const updated = await db.query(
        `UPDATE users
         SET role = 'admin'
         WHERE id = $1
         RETURNING *`,
        [row.id]
      );

      row = updated.rows[0];
    }

    const user = userFromRow(row);

    req.session.userId = user.id;

    res.json({
      phone: user.phone,
      role: user.role,
      isAdmin: user.role === 'admin',
      paid: paid(user),
      expiresAt: user.expiresAt
    });
  } catch (error) {
    console.error('LOGIN DB ERROR:', error);

    res.status(500).json({
      error: 'Login database error'
    });
  }
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

app.get('/api/me', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT EXISTS(
         SELECT 1
         FROM payments
         WHERE user_id = $1
           AND status = 'pending'
       ) AS pending`,
      [req.currentUser.id]
    );

    const pending = result.rows[0].pending;

    res.json({
      phone: req.currentUser.phone,
      role: req.currentUser.role || 'user',
      isAdmin: req.currentUser.role === 'admin',
      paid: paid(req.currentUser),
      expiresAt: req.currentUser.expiresAt,
      pending
    });
  } catch (error) {
    console.error('ME DB ERROR:', error);
    res.status(500).json({ error: 'Database error' });
  }
});


/* =========================
   PAYMENT REQUEST
========================= */

app.post('/api/payment-request', auth, async (req, res) => {
  try {
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

    const pendingResult = await db.query(
      `SELECT EXISTS(
         SELECT 1
         FROM payments
         WHERE user_id = $1
           AND status = 'pending'
       ) AS pending`,
      [req.currentUser.id]
    );

    if (pendingResult.rows[0].pending) {
      return res.status(400).json({
        error: 'Codsi payment hore ayaa sugaya xaqiijin.'
      });
    }

    const id = Date.now().toString();

    await db.query(
      `INSERT INTO payments
       (
         id,
         user_id,
         phone,
         amount,
         currency,
         payment_method,
         payment_number,
         payment_name,
         sender_phone,
         reference,
         status
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        req.currentUser.id,
        req.currentUser.phone,
        PRICE,
        'USD',
        PAYMENT_METHOD,
        PAYMENT_NUMBER,
        PAYMENT_NAME,
        senderPhone,
        senderPhone,
        'pending'
      ]
    );

    res.json({
      ok: true,
      message:
        'Payment-kaaga waa la helay. Admin ayaa hubinaya.'
    });
  } catch (error) {
    console.error('PAYMENT REQUEST DB ERROR:', error);

    res.status(500).json({
      error: 'Payment database error'
    });
  }
});

/* =========================
   LESSONS
========================= */

app.get('/api/lessons', auth, async (req, res) => {
  try {
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

    const result = await db.query(
      `SELECT *
       FROM lessons
       ORDER BY created_at DESC`
    );

    res.json(
      result.rows.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description || '',
        video: lesson.video_url || (
          lesson.video
            ? '/uploads/' + lesson.video
            : ''
        ),
        videoUrl: lesson.video_url || '',
        videoPublicId: lesson.video_public_id || '',
        lines: Array.isArray(lesson.lines)
          ? lesson.lines
          : [],
        createdAt: lesson.created_at
          ? new Date(lesson.created_at).toISOString()
          : null
      }))
    );
  } catch (error) {
    console.error('LESSONS DB ERROR:', error);

    res.status(500).json({
      error: 'Lessons database error'
    });
  }
});

/* =========================
   ADMIN LOGIN
========================= */

app.post('/api/admin/login', async (req, res) => {
  try {
    const adminId = String(req.body.adminId || '').trim();

    if (adminId !== ADMIN_ID) {
      return res.status(401).json({
        error: 'Admin ID khalad ah'
      });
    }

    const existing = await db.query(
      `SELECT *
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [ADMIN_ID]
    );

    let row;

    if (existing.rows.length === 0) {
      const inserted = await db.query(
        `INSERT INTO users
         (id, phone, role, free_access, expires_at)
         VALUES ($1, $2, 'admin', true, NULL)
         RETURNING *`,
        [ADMIN_ID, 'ADMIN-001']
      );

      row = inserted.rows[0];
    } else {
      const updated = await db.query(
        `UPDATE users
         SET role = 'admin',
             free_access = true
         WHERE id = $1
         RETURNING *`,
        [ADMIN_ID]
      );

      row = updated.rows[0];
    }

    const adminUser = userFromRow(row);

    req.session.admin = true;
    req.session.userId = adminUser.id;

    res.json({
      ok: true,
      role: 'admin',
      isAdmin: true,
      paid: true,
      expiresAt: null
    });
  } catch (error) {
    console.error('ADMIN LOGIN DB ERROR:', error);

    res.status(500).json({
      error: 'Admin login database error'
    });
  }
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

app.get('/api/admin/stats', admin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM lessons) AS lessons,
        (SELECT COUNT(*) FROM payments WHERE status = 'pending') AS pending,
        (SELECT COUNT(*) FROM payments WHERE status = 'approved') AS approved,
        (SELECT COUNT(*) FROM payments WHERE status = 'rejected') AS rejected,
        (
          SELECT COUNT(*)
          FROM users
          WHERE role = 'admin'
             OR free_access = true
             OR (expires_at IS NOT NULL AND expires_at > NOW())
        ) AS active
    `);

    const row = result.rows[0];

    res.json({
      users: Number(row.users),
      lessons: Number(row.lessons),
      pending: Number(row.pending),
      approved: Number(row.approved),
      rejected: Number(row.rejected),
      active: Number(row.active)
    });
  } catch (error) {
    console.error('ADMIN STATS DB ERROR:', error);

    res.status(500).json({
      error: 'Stats database error'
    });
  }
});

/* =========================
   ADMIN PAYMENTS
========================= */

app.get('/api/admin/payments', admin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM payments
       ORDER BY created_at DESC`
    );

    res.json(result.rows.map((p) => ({
      id: p.id,
      userId: p.user_id,
      phone: p.phone,
      amount: Number(p.amount),
      currency: p.currency,
      paymentMethod: p.payment_method,
      paymentNumber: p.payment_number,
      paymentName: p.payment_name,
      senderPhone: p.sender_phone,
      reference: p.reference,
      status: p.status,
      createdAt: p.created_at
        ? new Date(p.created_at).toISOString()
        : null,
      approvedAt: p.approved_at
        ? new Date(p.approved_at).toISOString()
        : null,
      rejectedAt: p.rejected_at
        ? new Date(p.rejected_at).toISOString()
        : null
    })));
  } catch (error) {
    console.error('ADMIN PAYMENTS DB ERROR:', error);
    res.status(500).json({
      error: 'Payments database error'
    });
  }
});


/* =========================
   APPROVE PAYMENT
========================= */

app.post(
  '/api/admin/payment/:id/approve',
  admin,
  async (req, res) => {
    try {
      const paymentResult = await db.query(
        `SELECT *
         FROM payments
         WHERE id = $1`,
        [req.params.id]
      );

      const payment = paymentResult.rows[0];

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

      const userResult = await db.query(
        `SELECT *
         FROM users
         WHERE id = $1`,
        [payment.user_id]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      let base = new Date();

      if (
        user.expires_at &&
        new Date(user.expires_at).getTime() > Date.now()
      ) {
        base = new Date(user.expires_at);
      }

      base.setDate(base.getDate() + MEMBERSHIP_DAYS);

      const expiresAt = base.toISOString();

      await db.query(
        `UPDATE payments
         SET status = 'approved',
             approved_at = NOW()
         WHERE id = $1`,
        [payment.id]
      );

      await db.query(
        `UPDATE users
         SET expires_at = $1
         WHERE id = $2`,
        [expiresAt, user.id]
      );

      res.json({
        ok: true,
        message: 'Payment approved. 30 maalmood ayaa lagu daray.',
        expiresAt
      });
    } catch (error) {
      console.error('APPROVE PAYMENT DB ERROR:', error);

      res.status(500).json({
        error: 'Payment approval database error'
      });
    }
  }
);


/* =========================
   REJECT PAYMENT
========================= */

app.post(
  '/api/admin/payment/:id/reject',
  admin,
  async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE payments
         SET status = 'rejected',
             rejected_at = NOW()
         WHERE id = $1
           AND status = 'pending'
         RETURNING *`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        const check = await db.query(
          `SELECT id FROM payments WHERE id = $1`,
          [req.params.id]
        );

        if (check.rows.length === 0) {
          return res.status(404).json({
            error: 'Payment not found'
          });
        }

        return res.json({
          ok: true,
          message: 'Payment hore ayaa loo processing gareeyay.'
        });
      }

      res.json({
        ok: true,
        message: 'Payment rejected.'
      });
    } catch (error) {
      console.error('REJECT PAYMENT DB ERROR:', error);

      res.status(500).json({
        error: 'Payment rejection database error'
      });
    }
  }
);

/* =========================
   ADMIN FREE ACCESS
========================= */

app.post('/api/admin/user/:id/free', admin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users
       SET free_access = true
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const user = userFromRow(result.rows[0]);

    res.json({
      ok: true,
      message: 'Free access waa la siiyay user-ka.',
      user
    });
  } catch (error) {
    console.error('FREE ACCESS DB ERROR:', error);

    res.status(500).json({
      error: 'Free access database error'
    });
  }
});


app.post('/api/admin/user/:id/free/remove', admin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users
       SET free_access = false
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const user = userFromRow(result.rows[0]);

    res.json({
      ok: true,
      message: 'Free access waa laga qaaday user-ka.',
      user
    });
  } catch (error) {
    console.error('REMOVE FREE ACCESS DB ERROR:', error);

    res.status(500).json({
      error: 'Remove free access database error'
    });
  }
});

/* =========================
   REVOKE PAID ACCESS
========================= */

app.post('/api/admin/user/:id/revoke-paid', admin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users
       SET expires_at = NULL
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const user = userFromRow(result.rows[0]);

    if (user.role === 'admin') {
      return res.status(400).json({
        error: 'Admin access lama laga qaadi karo'
      });
    }

    res.json({
      ok: true,
      message: 'Paid access waa laga qaaday user-ka.',
      user
    });
  } catch (error) {
    console.error('REVOKE PAID DB ERROR:', error);

    res.status(500).json({
      error: 'Revoke paid database error'
    });
  }
});


app.get('/api/admin/users', admin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM users
       ORDER BY created_at DESC`
    );

    res.json(
      result.rows.map((row) => {
        const user = userFromRow(row);

        return {
          id: user.id,
          phone: user.phone,
          role: user.role || 'user',
          freeAccess: user.freeAccess === true,
          expiresAt: user.expiresAt || null,
          createdAt: user.createdAt || null,
          paid: paid(user)
        };
      })
    );
  } catch (error) {
    console.error('ADMIN USERS DB ERROR:', error);

    res.status(500).json({
      error: 'Users database error'
    });
  }
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

app.get('/api/admin/lessons', admin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT *
      FROM lessons
      ORDER BY created_at DESC
    `);

    res.json(
      result.rows.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description || '',
        video: lesson.video_url || lesson.video || '',
        videoUrl: lesson.video_url || '',
        videoPublicId: lesson.video_public_id || '',
        lines: Array.isArray(lesson.lines) ? lesson.lines : [],
        createdAt: lesson.created_at
          ? new Date(lesson.created_at).toISOString()
          : null
      }))
    );
  } catch (error) {
    console.error('ADMIN LESSONS DB ERROR:', error);

    res.status(500).json({
      error: 'Lessons database error'
    });
  }
});


/* =========================
   ADD LESSON
========================= */

app.post(
  '/api/admin/lesson',
  admin,
  async (req, res) => {
    try {
      const {
        title,
        description,
        videoUrl,
        videoPublicId,
        lines
      } = req.body;

      if (!videoUrl || !videoPublicId) {
        return res.status(400).json({
          error: 'Video-ga Cloudinary lama helin'
        });
      }

      if (!title || !String(title).trim()) {
        return res.status(400).json({
          error: 'Magaca casharka geli'
        });
      }

      if (!Array.isArray(lines) || !lines.length) {
        return res.status(400).json({
          error: 'Ku dar ugu yaraan hal subtitle'
        });
      }

      const id = Date.now().toString();
      const cleanTitle = String(title).trim();
      const cleanDescription = String(description || '').trim();

      const cleanLines = lines.map((x) => ({
        start: Number(x.start),
        end: Number(x.end),
        en: String(x.en || ''),
        so: String(x.so || '')
      }));

      const result = await db.query(
        `INSERT INTO lessons
         (
           id,
           title,
           description,
           video,
           video_url,
           video_public_id,
           lines
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *`,
        [
          id,
          cleanTitle,
          cleanDescription,
          String(videoPublicId),
          String(videoUrl),
          String(videoPublicId),
          JSON.stringify(cleanLines)
        ]
      );

      const row = result.rows[0];

      const item = {
        id: row.id,
        title: row.title,
        description: row.description || '',
        video: row.video_url || row.video || '',
        videoUrl: row.video_url || '',
        videoPublicId: row.video_public_id || '',
        lines: Array.isArray(row.lines) ? row.lines : [],
        createdAt: row.created_at
          ? new Date(row.created_at).toISOString()
          : null
      };

      res.json({
        ok: true,
        item,
        message: '✅ Casharka waa la geliyey.'
      });
    } catch (error) {
      console.error('ADD LESSON DB ERROR:', error);

      res.status(500).json({
        error: 'Lesson database error'
      });
    }
  }
);


/* =========================
   DELETE LESSON
========================= */

app.delete(
  '/api/admin/lesson/:id',
  admin,
  async (req, res) => {
    try {
      const result = await db.query(
        `SELECT *
         FROM lessons
         WHERE id = $1
         LIMIT 1`,
        [req.params.id]
      );

      const lesson = result.rows[0];

      if (!lesson) {
        return res.status(404).json({
          error: 'Lesson not found'
        });
      }

      // Delete video from Cloudinary
      if (lesson.video_public_id) {
        try {
          await cloudinary.uploader.destroy(
            lesson.video_public_id,
            { resource_type: 'video' }
          );
        } catch (e) {
          console.error('CLOUDINARY DELETE ERROR:', e);
        }
      }

      // Delete old local video if it exists
      const file = path.join(UP, lesson.video || '');

      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }

      await db.query(
        `DELETE FROM lessons
         WHERE id = $1`,
        [req.params.id]
      );

      res.json({
        ok: true,
        message: 'Casharka waa la tirtiray.'
      });
    } catch (error) {
      console.error('DELETE LESSON DB ERROR:', error);

      res.status(500).json({
        error: 'Lesson delete database error'
      });
    }
  }
);


/* =========================
   EDIT LESSON
========================= */

app.put(
  '/api/admin/lesson/:id',
  admin,
  async (req, res) => {
    try {
      const existing = await db.query(
        `SELECT *
         FROM lessons
         WHERE id = $1
         LIMIT 1`,
        [req.params.id]
      );

      const lesson = existing.rows[0];

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

      if (!Array.isArray(lines) || !lines.length) {
        return res.status(400).json({
          error: 'Ku dar ugu yaraan hal subtitle'
        });
      }

      const title = String(
        req.body.title || lesson.title
      ).trim();

      const description = String(
        req.body.description || ''
      ).trim();

      const cleanLines = lines.map((x) => ({
        start: Number(x.start),
        end: Number(x.end),
        en: String(x.en || ''),
        so: String(x.so || '')
      }));

      const result = await db.query(
        `UPDATE lessons
         SET title = $1,
             description = $2,
             lines = $3::jsonb
         WHERE id = $4
         RETURNING *`,
        [
          title,
          description,
          JSON.stringify(cleanLines),
          req.params.id
        ]
      );

      const row = result.rows[0];

      const item = {
        id: row.id,
        title: row.title,
        description: row.description || '',
        video: row.video_url || row.video || '',
        videoUrl: row.video_url || '',
        videoPublicId: row.video_public_id || '',
        lines: Array.isArray(row.lines) ? row.lines : [],
        createdAt: row.created_at
          ? new Date(row.created_at).toISOString()
          : null
      };

      res.json({
        ok: true,
        item
      });
    } catch (error) {
      console.error('EDIT LESSON DB ERROR:', error);

      res.status(500).json({
        error: 'Lesson update database error'
      });
    }
  }
);

app.get('/api/cloudinary-config', admin, (req, res) => {
  res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    uploadPreset: 'english_somali_videos'
  });
});


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



// Google Search Console sitemap
app.get('/sitemap.xml', (req, res) => {
  const baseUrl = 'https://englishsomali.abasthan.app';

  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
  </url>
</urlset>`);
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
    `Admin ID: ${ADMIN_ID}`
  );
});

