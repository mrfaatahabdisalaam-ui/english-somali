require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL lama helin');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 60000
});

async function query(text, params = []) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await pool.query(text, params);
      return { rows: result.rows };
    } catch (error) {
      lastError = error;
      console.error(`DB QUERY FAILED (${attempt}/3):`, error.message);

      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
  }

  throw lastError;
}

async function close() {
  await pool.end();
}

module.exports = { query, close };
