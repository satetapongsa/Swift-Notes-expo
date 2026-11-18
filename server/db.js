const { neon } = require('@neondatabase/serverless');

let client;

// Returns a function (text, params) => rows, using parameterized queries only.
function db() {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }
    client = neon(process.env.DATABASE_URL);
  }
  return (text, params = []) => client.query(text, params);
}

module.exports = { db };
