require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL lama helin');
}

const sql = neon(process.env.DATABASE_URL);

async function query(text, params = []) {
  const rows = await sql.query(text, params); return { rows };
}

async function close() {
  // Neon serverless does not require a persistent pool to close.
}

module.exports = {
  query,
  close
};
