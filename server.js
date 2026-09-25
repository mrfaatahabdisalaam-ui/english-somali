const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { v2: cloudinary } = require('cloudinary');
const { execFile } = require('child_process');
const util = require('util');
const { db, userFromRow } = require('./db-models');

const execFileAsync = util.promisify(execFile);

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Isku-dayo badan. Fadlan sug 15 daqiiqo.'
  }
});


/* =========================
   PIN SECURITY
========================= */

function hashPin(pin) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');

    crypto.scrypt(pin, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);

      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPin(pin, storedHash) {
  return new Promise((resolve, reject) => {
    if (!storedHash || !storedHash.includes(':')) {
      return resolve(false);
    }

    const [salt, keyHex] = storedHash.split(':');

    crypto.scrypt(pin, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);

      const storedKey = Buffer.from(keyHex, 'hex');

      if (storedKey.length !== derivedKey.length) {
        return resolve(false);
      }

      resolve(crypto.timingSafeEqual(storedKey, derivedKey));
    });
  });
}

function validPin(pin) {
  return /^[0-9]{4,6}$/.test(String(pin || ''));
}

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
  process.env.ADMIN_PASSWORD;

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
    const loginValue = String(req.body.phone || '').trim();

    // USER LOGIN - phone + PIN
    const pin = String(req.body.pin || '').trim();

    // ADMIN LOGIN THROUGH THE SAME LOGIN PAGE
    if (loginValue === ADMIN_ID) {
      if (!ADMIN_PASSWORD || pin !== ADMIN_PASSWORD) {
        return res.status(401).json({
          error: '❌ Admin PIN-ka waa khalad.'
        });
      }

      req.session.userId = ADMIN_ID;

      return res.json({
        phone: ADMIN_ID,
        role: 'admin',
        isAdmin: true,
        paid: true,
        expiresAt: null
      });
    }

    if (!/^61[0-9]{7}$/.test(loginValue)) {
      return res.status(400).json({
        error: '❌ Lambarka waa inuu ahaadaa 9 lambar oo ka bilaabanaya 61. Tusaale: 612942662'
      });
    }

    const phone = normalizePhone(loginValue);

    if (pin && !validPin(pin)) {
      return res.status(400).json({
        error: '❌ PIN-ku waa inuu ahaadaa 4 ilaa 6 lambar.'
      });
    }

    const result = await db.query(
      `SELECT *
       FROM users
       WHERE phone = $1
         AND id <> $2
       LIMIT 1`,
      [phone, ADMIN_ID]
    );

    let row = result.rows[0];

    // Account cusub
    if (!row) {
      if (!pin) {
        return res.status(400).json({
          error: '🔐 Account cusub ayaad tahay. Samee PIN 4 ilaa 6 lambar ah.'
        });
      }

      const id = Date.now().toString();
      const pinHash = await hashPin(pin);

      const inserted = await db.query(
        `INSERT INTO users
          (id, phone, role, free_access, expires_at, pin_hash)
         VALUES ($1, $2, 'user', false, null, $3)
         RETURNING *`,
        [id, phone, pinHash]
      );

      row = inserted.rows[0];
    } else {
      // Account hore oo aan weli PIN lahayn
      if (!row.pin_hash) {
        if (!pin) {
          return res.status(400).json({
            error: '🔐 Account-kan PIN ma laha. Geli PIN cusub oo 4 ilaa 6 lambar ah.'
          });
        }

        const pinHash = await hashPin(pin);

        const updated = await db.query(
          `UPDATE users
           SET pin_hash = $1
           WHERE id = $2
           RETURNING *`,
          [pinHash, row.id]
        );

        row = updated.rows[0];
      } else {
        // Account hore oo PIN leh
        if (!pin) {
          return res.status(401).json({
            error: '🔐 Geli PIN-kaaga si aad u gasho account-ka.'
          });
        }

        const correctPin = await verifyPin(pin, row.pin_hash);

        if (!correctPin) {
          return res.status(401).json({
            error: '❌ PIN-ka waa khalad.'
          });
        }
      }
    }

    const user = userFromRow(row);

    // ACCOUNT LOCK CHECK
    if (user.locked === true) {
      return res.status(403).json({
        error: '🔒 Account-kan waa xiran yahay. Fadlan la xiriir Admin-ka.'
      });
    }

    req.session.userId = user.id;

    return res.json({
      phone: user.phone,
      role: 'user',
      isAdmin: false,
      paid: paid(user),
      expiresAt: user.expiresAt
    });

  } catch (error) {
    console.error('LOGIN DB ERROR:', error);

    return res.status(500).json({
      error: '❌ Login-ka ayaa cilad galay. Fadlan mar kale isku day.'
    });
  }
});

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

app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  try {
    const adminId = String(req.body.adminId || '').trim();
    const adminPassword = String(req.body.password || '');

    if (adminId !== ADMIN_ID) {
      return res.status(401).json({
        error: 'Admin ID khalad ah'
      });
    }

    if (!ADMIN_PASSWORD || adminPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({
        error: 'Admin password khalad ah'
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
  req.session.destroy(() => {
    res.json({
      ok: true
    });
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
   ADD 30 DAYS
========================= */

app.post('/api/admin/user/:id/add-30-days', admin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM users
       WHERE id = $1 AND role <> 'admin'`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found ama Admin looma dari karo'
      });
    }

    const user = result.rows[0];

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
      `UPDATE users
       SET expires_at = $1
       WHERE id = $2`,
      [expiresAt, user.id]
    );

    res.json({
      ok: true,
      message: '➕ 30 maalmood ayaa lagu daray.',
      expiresAt
    });
  } catch (error) {
    console.error('ADD 30 DAYS DB ERROR:', error);

    res.status(500).json({
      error: 'Add 30 days database error'
    });
  }
});

/* =========================
   UNDO 30 DAYS
========================= */

app.post('/api/admin/user/:id/undo-30-days', admin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM users
       WHERE id = $1 AND role <> 'admin'`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found ama Admin lama beddeli karo'
      });
    }

    const user = result.rows[0];

    if (!user.expires_at) {
      return res.status(400).json({
        error: 'User-kan ma laha membership expiry oo 30 maalmood laga laabto.'
      });
    }

    const expiresAt = new Date(user.expires_at);
    expiresAt.setDate(expiresAt.getDate() - MEMBERSHIP_DAYS);

    await db.query(
      `UPDATE users
       SET expires_at = $1
       WHERE id = $2 AND role <> 'admin'`,
      [expiresAt.toISOString(), user.id]
    );

    res.json({
      ok: true,
      message: '↩️ 30 maalmood waa laga laabay.',
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('UNDO 30 DAYS DB ERROR:', error);

    res.status(500).json({
      error: 'Undo 30 days database error'
    });
  }
});

/* =========================
   DELETE USER
========================= */

app.delete('/api/admin/user/:id', admin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM users
       WHERE id = $1 AND role <> 'admin'
       RETURNING id, phone`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found ama Admin lama tirtiri karo'
      });
    }

    res.json({
      ok: true,
      message: '🗑️ User-ka waa la tirtiray.'
    });
  } catch (error) {
    console.error('DELETE USER DB ERROR:', error);

    res.status(500).json({
      error: 'User-ka lama tirtiri karin database-ka.'
    });
  }
});

/* =========================
   SET ACTIVE / EXPIRED
========================= */

app.post('/api/admin/user/:id/activate', admin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users
       SET expires_at = $1
       WHERE id = $2 AND role <> 'admin'
       RETURNING *`,
      [
        new Date(Date.now() + MEMBERSHIP_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found ama Admin lama activate-gareyn karo'
      });
    }

    res.json({
      ok: true,
      message: '🟢 User-ka waa Active.',
      user: userFromRow(result.rows[0])
    });
  } catch (error) {
    console.error('ACTIVATE USER DB ERROR:', error);

    res.status(500).json({
      error: 'Activate user database error'
    });
  }
});

app.post('/api/admin/user/:id/expire', admin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users
       SET expires_at = NULL
       WHERE id = $1 AND role <> 'admin'
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found ama Admin lama expire-gareyn karo'
      });
    }

    res.json({
      ok: true,
      message: '🔴 User-ka waa Expired.',
      user: userFromRow(result.rows[0])
    });
  } catch (error) {
    console.error('EXPIRE USER DB ERROR:', error);

    res.status(500).json({
      error: 'Expire user database error'
    });
  }
});

/* =========================
   LOCK / UNLOCK USER
========================= */

app.post('/api/admin/user/:id/lock', admin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users
       SET locked = true
       WHERE id = $1 AND role <> 'admin'
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found ama Admin lama xiri karo'
      });
    }

    res.json({
      ok: true,
      message: '🔒 Account-ka waa la xiray.',
      user: userFromRow(result.rows[0])
    });
  } catch (error) {
    console.error('LOCK USER DB ERROR:', error);

    res.status(500).json({
      error: 'Lock account database error'
    });
  }
});

app.post('/api/admin/user/:id/unlock', admin, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users
       SET locked = false
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      ok: true,
      message: '🔓 Account-ka waa la furay.',
      user: userFromRow(result.rows[0])
    });
  } catch (error) {
    console.error('UNLOCK USER DB ERROR:', error);

    res.status(500).json({
      error: 'Unlock account database error'
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
          locked: user.locked === true,
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
   AUTO ENGLISH SUBTITLES
   Local FFmpeg + Whisper
   No OpenAI / No paid API
========================= */

app.post(
  '/api/admin/auto-subtitles',
  admin,
  upload.single('video'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Video geli'
        });
      }

      const videoFile = req.file.path;
      const audioFile = videoFile + '.wav';
      const srtFile = audioFile + '.srt';

      const whisperBin =
        path.join(
          __dirname,
          'whisper.cpp',
          'build',
          'bin',
          'whisper-cli'
        );

      const whisperModel =
        path.join(
          __dirname,
          'whisper.cpp',
          'models',
          'ggml-base.en.bin'
        );

      if (!fs.existsSync(whisperBin)) {
        return res.status(500).json({
          error: 'Whisper engine lama helin.'
        });
      }

      if (!fs.existsSync(whisperModel)) {
        return res.status(500).json({
          error: 'Whisper model lama helin.'
        });
      }

      console.log('🎬 Video:', videoFile);
      console.log('🎧 Audio extraction bilaabatay...');

      /* 1. Video → WAV */
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', videoFile,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'pcm_s16le',
        audioFile
      ]);

      console.log('✅ WAV waa la sameeyay.');
      console.log('🤖 Whisper transcription bilaabatay...');

      /* 2. WAV → English SRT */
      await execFileAsync(
        whisperBin,
        [
          '-m', whisperModel,
          '-f', audioFile,
          '-l', 'en',
          '-otxt',
          '-osrt'
        ],
        {
          maxBuffer: 20 * 1024 * 1024
        }
      );

      if (!fs.existsSync(srtFile)) {
        throw new Error('Whisper SRT ma uusan soo saarin.');
      }

      const srt = fs.readFileSync(srtFile, 'utf8');

      /*
       * SRT:
       *
       * 1
       * 00:00:00,000 --> 00:00:07,920
       * English text
       */

      const blocks = srt
        .replace(/\r/g, '')
        .split(/\n\s*\n/)
        .map(x => x.trim())
        .filter(Boolean);

      const lines = [];

      for (const block of blocks) {
        const parts = block.split('\n');

        if (parts.length < 3) continue;

        const timeLine = parts[1];

        if (!timeLine.includes('-->')) continue;

        const [startTime, endTime] =
          timeLine.split('-->').map(x => x.trim());

        const english = parts
          .slice(2)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!english) continue;

        function srtTimeToSeconds(value) {
          const m = value.match(
            /(\d+):(\d+):(\d+),(\d+)/
          );

          if (!m) return 0;

          return (
            Number(m[1]) * 3600 +
            Number(m[2]) * 60 +
            Number(m[3]) +
            Number(m[4]) / 1000
          );
        }

        lines.push({
          start: srtTimeToSeconds(startTime),
          end: srtTimeToSeconds(endTime),
          en: english,
          so: ''
        });
      }

      console.log(
        `✅ Whisper wuxuu helay ${lines.length} English subtitle.`
      );

      /* WAV/SRT waa temporary */
      try {
        if (fs.existsSync(audioFile)) {
          fs.unlinkSync(audioFile);
        }

        if (fs.existsSync(srtFile)) {
          fs.unlinkSync(srtFile);
        }

        const txtFile = audioFile + '.txt';

        if (fs.existsSync(txtFile)) {
          fs.unlinkSync(txtFile);
        }
      } catch (cleanupError) {
        console.warn(
          'Temporary files cleanup warning:',
          cleanupError.message
        );
      }

      res.json({
        ok: true,
        message: 'English subtitles si otomaatig ah ayaa loo sameeyay.',
        video: req.file.filename,
        lines
      });

    } catch (error) {
      console.error(
        'AUTO WHISPER SUBTITLE ERROR:',
        error
      );

      try {
        const videoFile = req.file?.path;

        if (videoFile) {
          const audioFile = videoFile + '.wav';
          const srtFile = audioFile + '.srt';
          const txtFile = audioFile + '.txt';

          for (const file of [
            audioFile,
            srtFile,
            txtFile
          ]) {
            if (fs.existsSync(file)) {
              fs.unlinkSync(file);
            }
          }
        }
      } catch (_) {}

      res.status(500).json({
        error:
          error?.message ||
          'Whisper transcription waa fashilmay.'
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
  "/api/admin/lesson",
  admin,
  upload.single("video"),
  async (req, res) => {
    let uploadedFile = null;

    try {
      const { title, description, lines } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "Video geli." });
      }

      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: "Magaca casharka geli" });
      }

      let parsedLines;

      try {
        parsedLines =
          typeof lines === "string"
            ? JSON.parse(lines)
            : lines;
      } catch (e) {
        return res.status(400).json({
          error: "Subtitles-ka JSON sax ma aha."
        });
      }

      if (!Array.isArray(parsedLines) || !parsedLines.length) {
        return res.status(400).json({
          error: "Ku dar ugu yaraan hal subtitle"
        });
      }

      uploadedFile = await uploadVideoToCloudinary(
        req.file.path
      );

      const videoUrl = uploadedFile.secure_url;
      const videoPublicId = uploadedFile.public_id;

      const id = Date.now().toString();

      const cleanTitle = String(title).trim();
      const cleanDescription = String(description || "").trim();

      const cleanLines = parsedLines.map((x) => ({
        start: Number(x.start),
        end: Number(x.end),
        en: String(x.en || ""),
        so: String(x.so || "")
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

      try {
        await fs.promises.unlink(req.file.path);
      } catch (deleteError) {
        console.log(
          "Local video delete warning:",
          deleteError.message
        );
      }

      const row = result.rows[0];

      const item = {
        id: row.id,
        title: row.title,
        description: row.description || "",
        video: row.video_url || row.video || "",
        videoUrl: row.video_url || "",
        videoPublicId: row.video_public_id || "",
        lines: Array.isArray(row.lines) ? row.lines : [],
        createdAt: row.created_at
          ? new Date(row.created_at).toISOString()
          : null
      };

      res.json({
        ok: true,
        item,
        message: "✅ Casharka waa la geliyey."
      });

    } catch (error) {
      console.error("ADD LESSON ERROR:", error);

      if (uploadedFile?.public_id) {
        try {
          await cloudinary.uploader.destroy(
            uploadedFile.public_id,
            { resource_type: "video" }
          );
        } catch (cleanupError) {
          console.error(
            "Cloudinary cleanup error:",
            cleanupError.message
          );
        }
      }

      if (req.file?.path) {
        try {
          await fs.promises.unlink(req.file.path);
        } catch (deleteError) {}
      }

      res.status(500).json({
        error: error.message || "Lesson upload error"
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
   GLOBAL ERROR PROTECTION
========================= */

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED PROMISE REJECTION:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
});

app.use((err, req, res, next) => {
  console.error('GLOBAL EXPRESS ERROR:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Server error. Fadlan mar kale isku day.'
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

