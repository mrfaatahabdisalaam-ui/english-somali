require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL lama helin');
}

const sql = neon(process.env.DATABASE_URL);

async function query(text, params = []) {
  let lastError;

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const rows = await sql.query(text, params);
      return { rows };
    } catch (error) {
      lastError = error;

      console.error(
        `DB QUERY FAILED (${attempt}/6):`,
        error?.message || error
      );

      if (attempt < 6) {
        const delay = Math.min(attempt * 3000, 15000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

async function close() {}

module.exports = {
  query,
  close
};
