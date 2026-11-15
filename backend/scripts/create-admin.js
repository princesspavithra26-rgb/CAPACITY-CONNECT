require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function main() {
  const name = process.env.ADMIN_NAME || 'CAPACITY CONNECT Admin';
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in the root .env file.');
  if (password.length < 12) throw new Error('Use an administrator password with at least 12 characters.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) throw new Error('Set JWT_SECRET in the root .env file.');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'capacity_connect'
  });
  try {
    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
    await connection.execute(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, 'administrator', 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), role = 'administrator', is_active = 1`,
      [name, email, hash]
    );
    console.log(`Administrator account is ready: ${email}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Administrator setup failed:', error.message);
  process.exitCode = 1;
});
