require('dotenv').config();

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL lama helin');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10
});

async function query(text, params = []) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await pool.query(text, params);
      return {
        rows: result.rows
      };
    } catch (error) {
      lastError = error;

      console.error(
        `DB QUERY FAILED (${attempt}/2):`,
        error?.message || error
      );

      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  throw lastError;
}

async function close() {
  await pool.end();
}

module.exports = {
  query,
  close
};
