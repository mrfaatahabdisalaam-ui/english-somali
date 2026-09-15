require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL lama helin');
}

const sql = neon(process.env.DATABASE_URL);

async function query(text, params = []) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const rows = await sql.query(text, params);
      return { rows };
    } catch (error) {
      lastError = error;

      console.error(
        `DB QUERY FAILED (${attempt}/4):`,
        error?.message || error
      );

      if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
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
