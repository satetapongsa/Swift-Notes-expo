// Sets a new password for an account, signs it out everywhere and clears any sign-in pause.
// Usage: npm run reset-password -- someone@example.com
// The new password is typed into this terminal (hidden) and never stored in plain text.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

const envFile = path.join(__dirname, '..', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (add it to .env).');
  process.exit(1);
}

// One readline for every question, so typed-ahead or pasted lines are not lost.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const plainWrite = rl._writeToOutput.bind(rl);
let hiding = false;
rl._writeToOutput = text => {
  // While a hidden question is open, echo nothing the user types.
  if (!hiding) plainWrite(text);
};

// Lines can arrive before we ask for them (paste, piped input), so queue them.
const lines = [];
let waiting = null;
let ended = false;
rl.on('line', line => {
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(line);
  } else {
    lines.push(line);
  }
});
rl.on('close', () => {
  ended = true;
  if (waiting) waiting(null);
});

function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  hiding = hidden;
  return new Promise(resolve => {
    const done = answer => {
      hiding = false;
      if (hidden) process.stdout.write('\n');
      if (answer === null) {
        console.error('No input. Nothing was changed.');
        process.exit(1);
      }
      resolve(answer);
    };
    if (lines.length) done(lines.shift());
    else if (ended) done(null);
    else waiting = done;
  });
}

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const email = (process.argv[2] || (await ask('Email: '))).trim().toLowerCase();
  const users = await sql.query('SELECT id, name FROM users WHERE email = $1', [email]);
  if (!users[0]) {
    console.error(`No account uses ${email}.`);
    process.exit(1);
  }

  const password = await ask('New password (min 8 characters): ', { hidden: true });
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    console.error('Password is too long (max 72 bytes).');
    process.exit(1);
  }
  const again = await ask('Type it again: ', { hidden: true });
  if (again !== password) {
    console.error('The passwords do not match. Nothing was changed.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await sql.query('UPDATE users SET password_hash = $2 WHERE id = $1', [users[0].id, hash]);
  await sql.query('DELETE FROM sessions WHERE user_id = $1', [users[0].id]);
  await sql.query('DELETE FROM login_attempts WHERE email = $1', [email]);
  console.log(`Password updated for ${email}. Signed out on all devices; sign-in pause cleared.`);
  rl.close();
})().catch(err => {
  rl.close();
  console.error('Reset failed:', err.message);
  process.exit(1);
});
