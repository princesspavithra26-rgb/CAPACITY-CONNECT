require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit').rateLimit;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const uploadDirectory = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.txt', '.png', '.jpg', '.jpeg', '.mp4', '.webm']);
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExtensions.has(extension)) return callback(fail(400, 'This file type is not allowed. Upload PDF, Office documents, images, CSV, TXT, MP4 or WEBM.'));
    callback(null, true);
  }
});
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'capacity_connect',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const VALID_ROLES = ['trainee', 'trainer', 'administrator'];
const VALID_COURSE_STATUS = ['draft', 'published', 'archived'];
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',').map((x) => x.trim()) : true,
  credentials: true
}));
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

function signToken(user) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
    throw fail(500, 'JWT_SECRET must be set to a secret of at least 24 characters in the .env file.');
  }
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
}

const authenticate = asyncRoute(async (req, res, next) => {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw fail(401, 'Please sign in to continue.');
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); }
  catch (_) { throw fail(401, 'Your session has expired. Please sign in again.'); }
  const [rows] = await pool.execute(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1',
    [payload.id]
  );
  if (!rows.length || !rows[0].is_active) throw fail(401, 'This account is inactive or unavailable.');
  req.user = rows[0];
  next();
});

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(fail(403, 'You do not have permission to perform this action.'));
    next();
  };
}

function sendRows(res, key, rows) { res.json({ success: true, [key]: rows }); }
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function validId(value) { return /^\d+$/.test(String(value)); }

app.get('/api', (req, res) => res.json({ name: 'CAPACITY CONNECT API', status: 'running', health: '/api/health' }));
app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ success: true, message: 'CAPACITY CONNECT API and database are working.' });
}));

// -----------------------------------------------------------------------------
// AUTHENTICATION AND USER PROFILE
// -----------------------------------------------------------------------------
app.post('/api/auth/register', authLimiter, asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) throw fail(400, 'Name, email, and password are required.');
  if (String(password).length < 8) throw fail(400, 'Password must contain at least 8 characters.');
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await bcrypt.hash(String(password), Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
  const [[registrationSetting]] = await pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'registration_mode' LIMIT 1");
  const requiresApproval = registrationSetting?.setting_value === 'Admin approval';
  const [result] = await pool.execute(
    "INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, 'trainee', ?)",
    [String(name).trim(), normalizedEmail, passwordHash, requiresApproval ? 0 : 1]
  );
  const user = { id: result.insertId, name: String(name).trim(), email: normalizedEmail, role: 'trainee' };
  if (requiresApproval) {
    return res.status(201).json({ success: true, pendingApproval: true, message: 'Registration submitted. An administrator must activate your account before you can sign in.' });
  }
  res.status(201).json({ success: true, message: 'Account created successfully.', user, token: signToken(user) });
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw fail(400, 'Email and password are required.');
  const [rows] = await pool.execute(
    'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1',
    [normalizeEmail(email)]
  );
  if (!rows.length) throw fail(401, 'Invalid email or password.');
  const record = rows[0];
  if (!record.is_active || !(await bcrypt.compare(String(password), record.password_hash))) throw fail(401, 'Invalid email or password.');
  const user = { id: record.id, name: record.name, email: record.email, role: record.role };
  res.json({ success: true, message: 'Login successful.', user, token: signToken(user) });
}));

app.get('/api/auth/me', authenticate, (req, res) => res.json({ success: true, user: req.user }));

app.get('/api/profile/me', authenticate, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.email, u.role, p.language, p.notification_preference,
            p.learning_preference, p.professional_summary
     FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id WHERE u.id = ?`,
    [req.user.id]
  );
  res.json({ success: true, profile: rows[0] });
}));

app.patch('/api/profile/me', authenticate, asyncRoute(async (req, res) => {
  const { name, email, language, notification_preference, learning_preference, professional_summary } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (name !== undefined || email !== undefined) {
      const sets = []; const values = [];
      if (name !== undefined) { if (!String(name).trim()) throw fail(400, 'Name cannot be empty.'); sets.push('name = ?'); values.push(String(name).trim()); }
      if (email !== undefined) { if (!String(email).includes('@')) throw fail(400, 'Enter a valid email address.'); sets.push('email = ?'); values.push(normalizeEmail(email)); }
      values.push(req.user.id);
      await connection.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
    }
    await connection.execute(
      `INSERT INTO user_preferences (user_id, language, notification_preference, learning_preference, professional_summary)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE language = COALESCE(VALUES(language), language),
       notification_preference = COALESCE(VALUES(notification_preference), notification_preference),
       learning_preference = COALESCE(VALUES(learning_preference), learning_preference),
       professional_summary = COALESCE(VALUES(professional_summary), professional_summary)`,
      [req.user.id, language ?? null, notification_preference ?? null, learning_preference ?? null, professional_summary ?? null]
    );
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  const [rows] = await pool.execute('SELECT id, name, email, role FROM users WHERE id = ?', [req.user.id]);
  res.json({ success: true, message: 'Profile updated.', user: rows[0] });
}));

// -----------------------------------------------------------------------------
// ADMINISTRATOR USER MANAGEMENT
// -----------------------------------------------------------------------------
app.get('/api/users', authenticate, authorize('administrator'), asyncRoute(async (req, res) => {
  let sql = 'SELECT id, name, email, role, is_active, created_at FROM users';
  const values = [];
  if (req.query.role && VALID_ROLES.includes(req.query.role)) { sql += ' WHERE role = ?'; values.push(req.query.role); }
  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.execute(sql, values);
  sendRows(res, 'users', rows);
}));

app.post('/api/users', authenticate, authorize('administrator'), asyncRoute(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) throw fail(400, 'Name, email, password, and role are required.');
  if (!VALID_ROLES.includes(role)) throw fail(400, 'Select a valid user role.');
  if (String(password).length < 8) throw fail(400, 'Password must contain at least 8 characters.');
  const passwordHash = await bcrypt.hash(String(password), Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
  const [result] = await pool.execute(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [String(name).trim(), normalizeEmail(email), passwordHash, role]
  );
  res.status(201).json({ success: true, message: 'User created.', user: { id: result.insertId, name: String(name).trim(), email: normalizeEmail(email), role } });
}));


app.post('/api/trainer/trainees', authenticate, authorize('trainer'), asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) throw fail(400, 'Name, email, and password are required.');
  if (String(password).length < 8) throw fail(400, 'Password must contain at least 8 characters.');
  const passwordHash = await bcrypt.hash(String(password), Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
  const [result] = await pool.execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'trainee')",
    [String(name).trim(), normalizeEmail(email), passwordHash]
  );
  res.status(201).json({ success: true, message: 'Trainee account created.', user: { id: result.insertId, name: String(name).trim(), email: normalizeEmail(email), role: 'trainee' } });
}));

app.patch('/api/users/:id', authenticate, authorize('administrator'), asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) throw fail(400, 'Invalid user ID.');
  const { name, role, is_active } = req.body;
  const sets = []; const values = [];
  if (name !== undefined) { if (!String(name).trim()) throw fail(400, 'Name cannot be empty.'); sets.push('name = ?'); values.push(String(name).trim()); }
  if (role !== undefined) { if (!VALID_ROLES.includes(role)) throw fail(400, 'Invalid user role.'); sets.push('role = ?'); values.push(role); }
  if (is_active !== undefined) { sets.push('is_active = ?'); values.push(is_active ? 1 : 0); }
  if (!sets.length) throw fail(400, 'No update fields were provided.');
  values.push(req.params.id);
  const [result] = await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
  if (!result.affectedRows) throw fail(404, 'User not found.');
  res.json({ success: true, message: 'User updated.' });
}));

// -----------------------------------------------------------------------------
// COURSES AND ENROLLMENTS
// -----------------------------------------------------------------------------
app.get('/api/courses', authenticate, asyncRoute(async (req, res) => {
  const values = [req.user.id]; const conditions = [];
  if (req.user.role === 'trainee') conditions.push("c.status = 'published'");
  if (req.user.role === 'trainer') { conditions.push('c.created_by = ?'); values.push(req.user.id); }
  if (req.query.status && req.user.role !== 'trainee') { conditions.push('c.status = ?'); values.push(req.query.status); }
  if (req.query.search) {
    conditions.push('(c.title LIKE ? OR c.description LIKE ? OR c.category LIKE ?)');
    const term = `%${req.query.search}%`; values.push(term, term, term);
  }
  let sql = `SELECT c.id, c.title, c.description, c.category, c.status, c.difficulty,
                    c.duration, c.max_learners, c.objectives, c.created_by,
                    u.name AS trainer_name, c.created_at,
                    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learner_count,
                    EXISTS(SELECT 1 FROM enrollments e2 WHERE e2.course_id = c.id AND e2.trainee_id = ?) AS is_enrolled
             FROM courses c JOIN users u ON u.id = c.created_by`;
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ' ORDER BY c.created_at DESC';
  const [rows] = await pool.execute(sql, values);
  sendRows(res, 'courses', rows);
}));

app.get('/api/courses/my-enrollments', authenticate, authorize('trainee'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT e.id AS enrollment_id, e.enrolled_at, c.id AS course_id, c.title, c.description,
            c.category, c.difficulty, c.duration, c.objectives,
            (SELECT COUNT(*) FROM course_modules m WHERE m.course_id = c.id) AS total_modules,
            (SELECT COUNT(*) FROM module_completions mc JOIN course_modules m2 ON m2.id = mc.module_id
             WHERE m2.course_id = c.id AND mc.trainee_id = ?) AS completed_modules
     FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.trainee_id = ? ORDER BY e.enrolled_at DESC`, [req.user.id, req.user.id]
  );
  sendRows(res, 'enrollments', rows);
}));

app.get('/api/courses/:id', authenticate, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) throw fail(400, 'Invalid course ID.');
  const [rows] = await pool.execute(
    `SELECT c.*, u.name AS trainer_name,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learner_count,
      EXISTS(SELECT 1 FROM enrollments e2 WHERE e2.course_id = c.id AND e2.trainee_id = ?) AS is_enrolled
     FROM courses c JOIN users u ON u.id = c.created_by WHERE c.id = ?`, [req.user.id, req.params.id]
  );
  if (!rows.length || (req.user.role === 'trainee' && rows[0].status !== 'published')) throw fail(404, 'Course not found.');
  res.json({ success: true, course: rows[0] });
}));

app.post('/api/courses', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { title, description = '', category = '', status = 'draft', difficulty = 'Beginner', duration = '', max_learners = null, objectives = '' } = req.body;
  if (!title || !description) throw fail(400, 'Course title and description are required.');
  if (!VALID_COURSE_STATUS.includes(status)) throw fail(400, 'Invalid course status.');
  const [result] = await pool.execute(
    `INSERT INTO courses (title, description, category, status, difficulty, duration, max_learners, objectives, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [String(title).trim(), description, category, status, difficulty, duration, max_learners || null, objectives, req.user.id]
  );
  res.status(201).json({ success: true, message: 'Course created.', courseId: result.insertId });
}));

app.patch('/api/courses/:id', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const [existing] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [req.params.id]);
  if (!existing.length) throw fail(404, 'Course not found.');
  if (req.user.role === 'trainer' && existing[0].created_by !== req.user.id) throw fail(403, 'You can update only your own courses.');
  const allowed = ['title', 'description', 'category', 'status', 'difficulty', 'duration', 'max_learners', 'objectives'];
  const sets = []; const values = [];
  for (const key of allowed) if (req.body[key] !== undefined) {
    if (key === 'status' && !VALID_COURSE_STATUS.includes(req.body[key])) throw fail(400, 'Invalid course status.');
    sets.push(`${key} = ?`); values.push(req.body[key]);
  }
  if (!sets.length) throw fail(400, 'No course fields to update.');
  values.push(req.params.id);
  await pool.execute(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`, values);
  res.json({ success: true, message: 'Course updated.' });
}));

app.delete('/api/courses/:id', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [req.params.id]);
  if (!rows.length) throw fail(404, 'Course not found.');
  if (req.user.role === 'trainer' && rows[0].created_by !== req.user.id) throw fail(403, 'You can delete only your own courses.');
  const [resources] = await pool.execute('SELECT file_url FROM resources WHERE course_id = ?', [req.params.id]);
  await pool.execute('DELETE FROM courses WHERE id = ?', [req.params.id]);
  resources.forEach((resource) => {
    if (String(resource.file_url).startsWith('/uploads/')) fs.unlink(path.join(uploadDirectory, path.basename(resource.file_url)), () => {});
  });
  res.json({ success: true, message: 'Course deleted.' });
}));

app.post('/api/courses/:id/enroll', authenticate, authorize('trainee'), asyncRoute(async (req, res) => {
  const [courses] = await pool.execute("SELECT id, max_learners FROM courses WHERE id = ? AND status = 'published'", [req.params.id]);
  if (!courses.length) throw fail(404, 'Published course not found.');
  if (courses[0].max_learners) {
    const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM enrollments WHERE course_id = ?', [req.params.id]);
    if (count.total >= courses[0].max_learners) throw fail(409, 'This course has reached its learner limit.');
  }
  await pool.execute('INSERT INTO enrollments (course_id, trainee_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE course_id = course_id', [req.params.id, req.user.id]);
  res.status(201).json({ success: true, message: 'You are enrolled in this course.' });
}));

// COURSE MODULES AND COMPLETION TRACKING
// A trainee can complete a module only after visiting every resource assigned to it.
app.get('/api/modules', authenticate, asyncRoute(async (req, res) => {
  if (!req.query.courseId) throw fail(400, 'courseId is required.');

  if (req.user.role === 'trainee') {
    const [access] = await pool.execute(
      `SELECT c.id FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id AND e.trainee_id = ?
       WHERE c.id = ? AND (c.status = 'published' OR e.id IS NOT NULL)`, [req.user.id, req.query.courseId]
    );
    if (!access.length) throw fail(403, 'Enroll in this course to access its modules.');

    const [rows] = await pool.execute(
      `SELECT m.id, m.course_id, m.title, m.description, m.sort_order,
              (SELECT COUNT(*) FROM resources r WHERE r.module_id = m.id) AS resource_count,
              (SELECT COUNT(*) FROM resources r
                 JOIN resource_visits rv ON rv.resource_id = r.id AND rv.trainee_id = ?
               WHERE r.module_id = m.id) AS visited_resource_count,
              IF(mc.id IS NOT NULL
                 AND (SELECT COUNT(*) FROM resources r WHERE r.module_id = m.id) > 0
                 AND (SELECT COUNT(*) FROM resources r
                        JOIN resource_visits rv ON rv.resource_id = r.id AND rv.trainee_id = ?
                      WHERE r.module_id = m.id) =
                     (SELECT COUNT(*) FROM resources r WHERE r.module_id = m.id),
                 1, 0) AS is_completed
       FROM course_modules m
       LEFT JOIN module_completions mc ON mc.module_id = m.id AND mc.trainee_id = ?
       WHERE m.course_id = ? ORDER BY m.sort_order, m.id`,
      [req.user.id, req.user.id, req.user.id, req.query.courseId]
    );
    return sendRows(res, 'modules', rows);
  }

  if (req.user.role === 'trainer') {
    const [access] = await pool.execute('SELECT id FROM courses WHERE id = ? AND created_by = ?', [req.query.courseId, req.user.id]);
    if (!access.length) throw fail(403, 'You can view modules only for your own courses.');
  }
  const [rows] = await pool.execute(
    `SELECT m.id, m.course_id, m.title, m.description, m.sort_order,
            (SELECT COUNT(*) FROM resources r WHERE r.module_id = m.id) AS resource_count,
            0 AS visited_resource_count, 0 AS is_completed
     FROM course_modules m WHERE m.course_id = ? ORDER BY m.sort_order, m.id`,
    [req.query.courseId]
  );
  sendRows(res, 'modules', rows);
}));

app.post('/api/modules', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { course_id, title, description = '', sort_order = 1 } = req.body;
  if (!course_id || !title) throw fail(400, 'course_id and module title are required.');
  const [courses] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [course_id]);
  if (!courses.length) throw fail(404, 'Course not found.');
  if (req.user.role === 'trainer' && courses[0].created_by !== req.user.id) throw fail(403, 'You can add modules only to your own courses.');
  const [result] = await pool.execute('INSERT INTO course_modules (course_id, title, description, sort_order) VALUES (?, ?, ?, ?)', [course_id, title, description, Number(sort_order) || 1]);
  res.status(201).json({ success: true, moduleId: result.insertId });
}));

app.put('/api/modules/course/:courseId', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { modules } = req.body;
  if (!Array.isArray(modules)) throw fail(400, 'modules must be an array of module titles.');
  if (modules.length > 40) throw fail(400, 'A course can contain up to 40 modules.');
  const [courses] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [req.params.courseId]);
  if (!courses.length) throw fail(404, 'Course not found.');
  if (req.user.role === 'trainer' && courses[0].created_by !== req.user.id) throw fail(403, 'You can update modules only for your own courses.');

  const titles = [...new Set(modules.map((item) => String(item).trim()).filter(Boolean))];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id, title FROM course_modules WHERE course_id = ? ORDER BY sort_order, id', [req.params.courseId]);
    const used = new Set();
    const keepIds = [];
    for (let index = 0; index < titles.length; index++) {
      const title = titles[index];
      const match = existing.find((row) => !used.has(Number(row.id)) && String(row.title).trim().toLowerCase() === title.toLowerCase());
      if (match) {
        used.add(Number(match.id)); keepIds.push(Number(match.id));
        await connection.execute('UPDATE course_modules SET sort_order = ? WHERE id = ?', [index + 1, match.id]);
      } else {
        const [inserted] = await connection.execute('INSERT INTO course_modules (course_id, title, sort_order) VALUES (?, ?, ?)', [req.params.courseId, title, index + 1]);
        keepIds.push(Number(inserted.insertId));
      }
    }
    const removeIds = existing.filter((row) => !used.has(Number(row.id))).map((row) => Number(row.id));
    if (removeIds.length) {
      const placeholders = removeIds.map(() => '?').join(',');
      await connection.execute(`DELETE FROM course_modules WHERE id IN (${placeholders})`, removeIds);
    }
    await connection.commit();
    res.json({ success: true, message: 'Course module outline updated.', modules: keepIds.length });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

app.post('/api/modules/:id/complete', authenticate, authorize('trainee'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT m.id, m.course_id FROM course_modules m
     JOIN enrollments e ON e.course_id = m.course_id
     WHERE m.id = ? AND e.trainee_id = ?`, [req.params.id, req.user.id]
  );
  if (!rows.length) throw fail(404, 'Module not found for an enrolled course.');

  const [[resourceStatus]] = await pool.execute(
    `SELECT COUNT(DISTINCT r.id) AS total_resources,
            COUNT(DISTINCT rv.resource_id) AS visited_resources
     FROM resources r
     LEFT JOIN resource_visits rv ON rv.resource_id = r.id AND rv.trainee_id = ?
     WHERE r.module_id = ?`, [req.user.id, req.params.id]
  );
  const totalResources = Number(resourceStatus.total_resources || 0);
  const visitedResources = Number(resourceStatus.visited_resources || 0);
  if (totalResources === 0) {
    throw fail(409, 'This module has no learning resources yet. Ask your trainer to add a resource before completing the module.');
  }
  if (visitedResources < totalResources) {
    throw fail(409, 'Visit every learning resource assigned to this module before marking it complete.');
  }

  await pool.execute(
    'INSERT INTO module_completions (module_id, trainee_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE completed_at = CURRENT_TIMESTAMP',
    [req.params.id, req.user.id]
  );
  res.json({ success: true, message: 'Module marked as complete after visiting all its learning resources.' });
}));

// LEARNING RESOURCES (URL-based; actual file hosting can be connected later)
app.get('/api/resources', authenticate, asyncRoute(async (req, res) => {
  const values = [];
  const where = [];
  let visitField = '0 AS visited_by_user';
  if (req.user.role === 'trainee') {
    // SELECT placeholders appear before WHERE placeholders in the final SQL statement.
    visitField = `IF(EXISTS (SELECT 1 FROM resource_visits rv
                              WHERE rv.resource_id = r.id AND rv.trainee_id = ?), 1, 0) AS visited_by_user`;
    values.push(req.user.id);
  }
  if (req.query.courseId) { where.push('r.course_id = ?'); values.push(req.query.courseId); }
  if (req.user.role === 'trainee') { where.push('e.trainee_id = ?'); values.push(req.user.id); }
  if (req.user.role === 'trainer') { where.push('c.created_by = ?'); values.push(req.user.id); }
  let sql = `SELECT r.id, r.course_id, r.module_id, c.title AS course_title, r.title,
                    r.description, r.file_url, r.resource_type, r.created_at, m.title AS module_title,
                    u.name AS uploaded_by, ${visitField}
             FROM resources r JOIN courses c ON c.id = r.course_id
             LEFT JOIN course_modules m ON m.id = r.module_id
             JOIN users u ON u.id = r.uploaded_by`;
  if (req.user.role === 'trainee') sql += ' JOIN enrollments e ON e.course_id = c.id';
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY r.created_at DESC';
  const [rows] = await pool.execute(sql, values);
  sendRows(res, 'resources', rows);
}));

app.post('/api/resources/upload', authenticate, authorize('trainer', 'administrator'), upload.single('file'), asyncRoute(async (req, res) => {
  const { course_id, module_id, title, description = '', resource_type = 'document' } = req.body;
  if (!req.file) throw fail(400, 'Choose a file to upload.');
  if (!course_id || !module_id || !title) {
    fs.unlink(path.join(uploadDirectory, req.file.filename), () => {});
    throw fail(400, 'Course, module, and resource title are required.');
  }
  if (!['document', 'video', 'link', 'other'].includes(resource_type)) {
    fs.unlink(path.join(uploadDirectory, req.file.filename), () => {});
    throw fail(400, 'Invalid resource type.');
  }
  const [courses] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [course_id]);
  if (!courses.length || (req.user.role === 'trainer' && courses[0].created_by !== req.user.id)) {
    fs.unlink(path.join(uploadDirectory, req.file.filename), () => {});
    throw fail(courses.length ? 403 : 404, courses.length ? 'You can upload only to your own courses.' : 'Course not found.');
  }
  const [modules] = await pool.execute('SELECT id FROM course_modules WHERE id = ? AND course_id = ?', [module_id, course_id]);
  if (!modules.length) {
    fs.unlink(path.join(uploadDirectory, req.file.filename), () => {});
    throw fail(400, 'Select a module that belongs to the chosen course.');
  }
  const publicPath = `/uploads/${req.file.filename}`;
  try {
    const [result] = await pool.execute(
      'INSERT INTO resources (course_id, module_id, title, description, file_url, resource_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [course_id, module_id, title, description, publicPath, resource_type, req.user.id]
    );
    res.status(201).json({ success: true, message: 'File uploaded and assigned to the selected module.', resourceId: result.insertId, file_url: publicPath });
  } catch (error) {
    fs.unlink(path.join(uploadDirectory, req.file.filename), () => {});
    throw error;
  }
}));

app.post('/api/resources', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { course_id, module_id, title, description = '', file_url, resource_type = 'link' } = req.body;
  if (!course_id || !module_id || !title || !file_url) throw fail(400, 'Course, module, resource title, and resource URL are required.');
  let parsedResourceUrl;
  try { parsedResourceUrl = new URL(String(file_url)); } catch (_) { throw fail(400, 'Enter a valid resource URL.'); }
  if (!['http:', 'https:'].includes(parsedResourceUrl.protocol)) throw fail(400, 'Resource URL must begin with http:// or https://.');
  if (!['document', 'video', 'link', 'other'].includes(resource_type)) throw fail(400, 'Invalid resource type.');
  const [courses] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [course_id]);
  if (!courses.length) throw fail(404, 'Course not found.');
  if (req.user.role === 'trainer' && courses[0].created_by !== req.user.id) throw fail(403, 'You can add resources only to your own courses.');
  const [modules] = await pool.execute('SELECT id FROM course_modules WHERE id = ? AND course_id = ?', [module_id, course_id]);
  if (!modules.length) throw fail(400, 'Select a module that belongs to the chosen course.');
  const [result] = await pool.execute(
    'INSERT INTO resources (course_id, module_id, title, description, file_url, resource_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [course_id, module_id, title, description, file_url, resource_type, req.user.id]
  );
  res.status(201).json({ success: true, resourceId: result.insertId, message: 'Resource added and assigned to the selected module.' });
}));

// A resource visit is recorded only when a trainee explicitly opens the resource.
app.post('/api/resources/:id/visit', authenticate, authorize('trainee'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, course_id, module_id FROM resources WHERE id = ? LIMIT 1', [req.params.id]
  );
  if (!rows.length) throw fail(404, 'Resource not found.');
  if (!rows[0].module_id) throw fail(409, 'This resource is not assigned to a learning module.');
  const [enrollments] = await pool.execute(
    'SELECT id FROM enrollments WHERE course_id = ? AND trainee_id = ?', [rows[0].course_id, req.user.id]
  );
  if (!enrollments.length) throw fail(403, 'Enroll in this course before visiting its resources.');
  await pool.execute(
    `INSERT INTO resource_visits (resource_id, trainee_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE visited_at = CURRENT_TIMESTAMP`, [req.params.id, req.user.id]
  );
  res.json({ success: true, message: 'Resource visit recorded. You can now mark the module complete after visiting its remaining resources.' });
}));

app.get('/api/resources/:id/file', authenticate, asyncRoute(async (req, res, next) => {
  const [rows] = await pool.execute(
    'SELECT r.file_url, c.created_by, r.course_id, r.module_id FROM resources r JOIN courses c ON c.id = r.course_id WHERE r.id = ?',
    [req.params.id]
  );
  if (!rows.length) throw fail(404, 'Resource not found.');
  if (req.user.role === 'trainee') {
    const [access] = await pool.execute('SELECT id FROM enrollments WHERE course_id = ? AND trainee_id = ?', [rows[0].course_id, req.user.id]);
    if (!access.length) throw fail(403, 'Enroll in this course to access the resource.');
  }
  if (req.user.role === 'trainer' && rows[0].created_by !== req.user.id) throw fail(403, 'You can access files only from your own courses.');
  if (!String(rows[0].file_url).startsWith('/uploads/')) throw fail(400, 'This resource is an external URL, not an uploaded file.');
  const filename = path.basename(rows[0].file_url);
  res.sendFile(path.join(uploadDirectory, filename), (error) => { if (error && !res.headersSent) next(error); });
}));

app.delete('/api/resources/:id', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT r.id, r.file_url, c.created_by FROM resources r JOIN courses c ON c.id = r.course_id WHERE r.id = ?', [req.params.id]);
  if (!rows.length) throw fail(404, 'Resource not found.');
  if (req.user.role === 'trainer' && rows[0].created_by !== req.user.id) throw fail(403, 'You can delete only your own course resources.');
  await pool.execute('DELETE FROM resources WHERE id = ?', [req.params.id]);
  if (String(rows[0].file_url).startsWith('/uploads/')) fs.unlink(path.join(uploadDirectory, path.basename(rows[0].file_url)), () => {});
  res.json({ success: true, message: 'Resource deleted.' });
}));

// COMPETENCIES AND COURSE MAPPING
app.get('/api/competencies', authenticate, asyncRoute(async (req, res) => {
  if (req.user.role === 'trainee') {
    // Return every course mapped to each competency, including courses the
    // trainee has not enrolled in yet, so the learner can see the full pathway.
    const [rows] = await pool.execute(
      `SELECT cp.id, cp.name, cp.description, cp.category, cp.created_at,
              c.id AS course_id, c.title AS course_title,
              CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS is_enrolled,
              (SELECT COUNT(*) FROM course_modules cm
               WHERE cm.course_id = c.id) AS total_modules,
              (SELECT COUNT(*) FROM module_completions mc
               JOIN course_modules cm2 ON cm2.id = mc.module_id
               WHERE cm2.course_id = c.id AND mc.trainee_id = ?) AS completed_modules,
              (SELECT AVG((s.marks_obtained / NULLIF(a.total_marks, 0)) * 100)
               FROM assessments a
               JOIN assessment_submissions s ON s.assessment_id = a.id
               WHERE a.course_id = c.id AND s.trainee_id = ?
                 AND s.marks_obtained IS NOT NULL AND a.total_marks > 0) AS average_percentage,
              (SELECT COUNT(*) FROM assessments a2
               JOIN assessment_submissions s2 ON s2.assessment_id = a2.id
               WHERE a2.course_id = c.id AND s2.trainee_id = ?
                 AND s2.marks_obtained IS NOT NULL) AS evaluated_assessments
       FROM competencies cp
       JOIN course_competencies cc ON cc.competency_id = cp.id
       JOIN courses c ON c.id = cc.course_id
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.trainee_id = ?
       ORDER BY cp.name, c.title`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );
    return sendRows(res, 'competencies', rows);
  }
  const [rows] = await pool.execute(
    'SELECT id, name, description, category, created_at FROM competencies ORDER BY category, name'
  );
  sendRows(res, 'competencies', rows);
}));

app.post('/api/competencies', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { name, description = '', category = '' } = req.body;
  if (!name) throw fail(400, 'Competency name is required.');
  const [result] = await pool.execute('INSERT INTO competencies (name, description, category, created_by) VALUES (?, ?, ?, ?)', [name, description, category, req.user.id]);
  res.status(201).json({ success: true, competencyId: result.insertId });
}));

app.put('/api/competencies/course/:courseId', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { competencyIds } = req.body;
  if (!Array.isArray(competencyIds)) throw fail(400, 'competencyIds must be an array.');
  const [courses] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [req.params.courseId]);
  if (!courses.length) throw fail(404, 'Course not found.');
  if (req.user.role === 'trainer' && courses[0].created_by !== req.user.id) throw fail(403, 'You can map competencies only to your own courses.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM course_competencies WHERE course_id = ?', [req.params.courseId]);
    for (const id of competencyIds) await conn.execute('INSERT INTO course_competencies (course_id, competency_id) VALUES (?, ?)', [req.params.courseId, id]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  res.json({ success: true, message: 'Course competency mapping updated.' });
}));

app.get('/api/competencies/course/:courseId', authenticate, asyncRoute(async (req, res) => {
  if (req.user.role === 'trainee') {
    const [access] = await pool.execute(
      `SELECT c.id FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id AND e.trainee_id = ?
       WHERE c.id = ? AND (c.status = 'published' OR e.id IS NOT NULL)`, [req.user.id, req.params.courseId]
    );
    if (!access.length) throw fail(403, 'You are not allowed to view this course competency mapping.');
  }
  const [rows] = await pool.execute(
    `SELECT cp.id, cp.name, cp.description, cp.category FROM course_competencies cc
     JOIN competencies cp ON cp.id = cc.competency_id WHERE cc.course_id = ? ORDER BY cp.name`, [req.params.courseId]
  );
  sendRows(res, 'competencies', rows);
}));

// ASSESSMENTS, SUBMISSIONS AND MANUAL GRADING
function parseJsonColumn(value, fallback = []) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return fallback; } }
  return fallback;
}

function normalizeCheckText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function keywordMatches(keyword, answer) {
  const normalizedKeyword = normalizeCheckText(keyword);
  if (!normalizedKeyword) return false;
  if (answer.includes(normalizedKeyword)) return true;
  const answerWords = new Set(answer.split(' ').filter(Boolean));
  const terms = normalizedKeyword.split(' ').filter((word) => word.length > 2);
  if (!terms.length) return answerWords.has(normalizedKeyword);
  const found = terms.filter((word) => answerWords.has(word)).length;
  return found >= Math.ceil(terms.length * 0.7);
}

function evaluateAssessmentAnswers(questions, answersPayload, answerKeys) {
  const responses = Array.isArray(answersPayload?.responses) ? answersPayload.responses : [];
  const keyRows = Array.isArray(answerKeys) ? answerKeys : [];
  const isQuiz = questions.length > 0 && questions.every((question) => question && typeof question === 'object' && Array.isArray(question.options) && question.correctAnswer);
  if (isQuiz) {
    const results = questions.map((question, index) => {
      const selected = String(responses[index]?.answer || '').trim().toUpperCase();
      const correct = selected === String(question.correctAnswer).trim().toUpperCase();
      return { questionIndex: index, question: question.question, status: correct ? 'correct' : 'incorrect', selectedAnswer: selected, correctAnswer: question.correctAnswer };
    });
    const correctCount = results.filter((item) => item.status === 'correct').length;
    return { checked: true, correctCount, totalQuestions: questions.length, results };
  }
  if (!keyRows.length || keyRows.length !== questions.length) {
    return { checked: false, correctCount: null, totalQuestions: questions.length,
      results: questions.map((question, index) => ({ questionIndex: index, question, status: 'needs_review', matchedKeywords: 0, totalKeywords: 0 })) };
  }
  const results = questions.map((question, index) => {
    const answer = normalizeCheckText(responses[index]?.answer || '');
    const keywords = Array.isArray(keyRows[index]) ? keyRows[index] : [];
    const validKeywords = keywords.map((item) => String(item || '').trim()).filter(Boolean);
    const matched = validKeywords.filter((keyword) => keywordMatches(keyword, answer)).length;
    const threshold = Math.ceil(validKeywords.length * 0.6);
    const correct = validKeywords.length > 0 && matched >= Math.max(1, threshold);
    return {
      questionIndex: index,
      question,
      status: validKeywords.length ? (correct ? 'correct' : 'incorrect') : 'needs_review',
      matchedKeywords: matched,
      totalKeywords: validKeywords.length
    };
  });
  const checkedResults = results.filter((item) => item.status !== 'needs_review');
  return {
    checked: checkedResults.length === questions.length,
    correctCount: checkedResults.filter((item) => item.status === 'correct').length,
    totalQuestions: questions.length,
    results
  };
}

app.get('/api/assessments', authenticate, asyncRoute(async (req, res) => {
  // The reference answer keywords are returned only to trainers/administrators.
  const answerKeyField = req.user.role === 'trainee' ? '' : ', a.answer_key_json';
  let sql = `SELECT a.id, a.course_id, c.title AS course_title, a.title, a.instructions, a.total_marks,
                    a.due_date, a.questions_json${answerKeyField}, a.created_at, u.name AS created_by_name
             FROM assessments a JOIN courses c ON c.id = a.course_id JOIN users u ON u.id = a.created_by`;
  const conditions = []; const values = [];
  if (req.query.courseId) { conditions.push('a.course_id = ?'); values.push(req.query.courseId); }
  if (req.user.role === 'trainee') { conditions.push('e.trainee_id = ?'); values.push(req.user.id); }
  if (req.user.role === 'trainer') { conditions.push('c.created_by = ?'); values.push(req.user.id); }
  if (req.user.role === 'trainee') sql += ' JOIN enrollments e ON e.course_id = c.id';
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ' ORDER BY a.created_at DESC';
  const [rows] = await pool.execute(sql, values);
  if (req.user.role === 'trainee') {
    rows.forEach((row) => {
      const questions = parseJsonColumn(row.questions_json, []);
      row.questions_json = JSON.stringify(questions.map((item) => {
        if (!item || typeof item !== 'object' || !Array.isArray(item.options)) return item;
        const { correctAnswer, answer, ...safeQuestion } = item;
        return safeQuestion;
      }));
    });
  }
  sendRows(res, 'assessments', rows);
}));

app.post('/api/assessments', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { course_id, title, instructions = '', total_marks = 100, due_date = null, questions = [] } = req.body;
  if (!course_id || !title) throw fail(400, 'Course and assessment title are required.');
  if (!Number.isFinite(Number(total_marks)) || Number(total_marks) <= 0) throw fail(400, 'Total marks must be greater than zero.');
  if (!Array.isArray(questions) || !questions.length) throw fail(400, 'Add at least one assessment question.');
  const [courses] = await pool.execute('SELECT id, created_by FROM courses WHERE id = ?', [course_id]);
  if (!courses.length) throw fail(404, 'Course not found.');
  if (req.user.role === 'trainer' && courses[0].created_by !== req.user.id) throw fail(403, 'You can create assessments only for your own courses.');
  const [result] = await pool.execute(
    'INSERT INTO assessments (course_id, title, instructions, total_marks, due_date, questions_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [course_id, title, instructions, total_marks, due_date || null, JSON.stringify(questions), req.user.id]
  );
  res.status(201).json({ success: true, assessmentId: result.insertId });
}));

app.delete('/api/assessments/:id', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT a.id, c.created_by FROM assessments a JOIN courses c ON c.id = a.course_id WHERE a.id = ? LIMIT 1', [req.params.id]);
  if (!rows.length) throw fail(404, 'Assessment or assignment not found.');
  if (req.user.role === 'trainer' && Number(rows[0].created_by) !== Number(req.user.id)) throw fail(403, 'You can delete only assessments for your own courses.');
  await pool.execute('DELETE FROM assessments WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Assessment and its submissions deleted.' });
}));

// Trainer configures accepted keywords for the existing assessment questions.
app.patch('/api/assessments/:id/answer-key', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const answerKeys = req.body.answerKeys;
  if (!Array.isArray(answerKeys)) throw fail(400, 'answerKeys must be an array with one entry per question.');
  const [rows] = await pool.execute(
    'SELECT id, course_id, questions_json FROM assessments WHERE id = ? LIMIT 1', [req.params.id]
  );
  if (!rows.length) throw fail(404, 'Assessment not found.');
  const [courses] = await pool.execute('SELECT created_by FROM courses WHERE id = ?', [rows[0].course_id]);
  if (req.user.role === 'trainer' && (!courses.length || Number(courses[0].created_by) !== Number(req.user.id))) {
    throw fail(403, 'You can configure answer keys only for your own courses.');
  }
  const questions = parseJsonColumn(rows[0].questions_json, []);
  if (!Array.isArray(questions) || answerKeys.length !== questions.length) {
    throw fail(400, `Provide exactly ${questions.length} answer-key lines, one for each question.`);
  }
  const normalizedKeys = answerKeys.map((line) => {
    const list = Array.isArray(line) ? line : String(line || '').split(',');
    return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
  });
  if (normalizedKeys.some((line) => !line.length)) throw fail(400, 'Every question must have at least one accepted keyword.');
  await pool.execute('UPDATE assessments SET answer_key_json = ? WHERE id = ?', [JSON.stringify(normalizedKeys), req.params.id]);
  res.json({ success: true, message: 'Automatic answer-check keywords saved.', questionCount: questions.length });
}));

app.post('/api/assessments/:id/submit', authenticate, authorize('trainee'), asyncRoute(async (req, res) => {
  if (req.body.answers === undefined || typeof req.body.answers !== 'object') throw fail(400, 'Answers are required.');
  const [rows] = await pool.execute(
    `SELECT a.id, a.questions_json, a.answer_key_json FROM assessments a
     JOIN enrollments e ON e.course_id = a.course_id
     WHERE a.id = ? AND e.trainee_id = ?`, [req.params.id, req.user.id]
  );
  if (!rows.length) throw fail(404, 'Assessment not found for your enrolled courses.');
  const questions = parseJsonColumn(rows[0].questions_json, []);
  const answerKeys = parseJsonColumn(rows[0].answer_key_json, []);
  const autoCheck = evaluateAssessmentAnswers(questions, req.body.answers, answerKeys);
  await pool.execute(
    `INSERT INTO assessment_submissions (assessment_id, trainee_id, answers_json, auto_check_json, marks_obtained, feedback, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE answers_json = VALUES(answers_json), auto_check_json = VALUES(auto_check_json),
       marks_obtained = NULL, feedback = NULL, reviewed_by = NULL, reviewed_at = NULL, submitted_at = CURRENT_TIMESTAMP`,
    [req.params.id, req.user.id, JSON.stringify(req.body.answers), JSON.stringify(autoCheck)]
  );
  res.status(201).json({
    success: true,
    message: 'Assessment submitted. Automatic keyword checks are provisional; the trainer confirms the final marks.',
    autoCheck
  });
}));

app.get('/api/assessments/submissions', authenticate, asyncRoute(async (req, res) => {
  let sql = `SELECT s.id, s.assessment_id, a.title AS assessment_title, c.title AS course_title,
                    s.trainee_id, u.name AS trainee_name, s.answers_json, s.auto_check_json, s.marks_obtained,
                    a.total_marks, s.feedback, s.submitted_at, s.reviewed_at
             FROM assessment_submissions s JOIN users u ON u.id = s.trainee_id
             JOIN assessments a ON a.id = s.assessment_id JOIN courses c ON c.id = a.course_id`;
  const values = []; const where = [];
  if (req.user.role === 'trainee') { where.push('s.trainee_id = ?'); values.push(req.user.id); }
  if (req.user.role === 'trainer') { where.push('c.created_by = ?'); values.push(req.user.id); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY s.submitted_at DESC';
  const [rows] = await pool.execute(sql, values);
  sendRows(res, 'submissions', rows);
}));

app.patch('/api/assessments/submissions/:submissionId/grade', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { marks_obtained, feedback = '' } = req.body;
  if (marks_obtained === undefined || !Number.isFinite(Number(marks_obtained)) || Number(marks_obtained) < 0) throw fail(400, 'Enter valid marks.');
  const [rows] = await pool.execute(
    `SELECT s.id, a.total_marks, c.created_by FROM assessment_submissions s
     JOIN assessments a ON a.id = s.assessment_id JOIN courses c ON c.id = a.course_id WHERE s.id = ?`, [req.params.submissionId]
  );
  if (!rows.length) throw fail(404, 'Submission not found.');
  if (Number(marks_obtained) > Number(rows[0].total_marks)) throw fail(400, 'Marks cannot exceed total marks.');
  if (req.user.role === 'trainer' && rows[0].created_by !== req.user.id) throw fail(403, 'You can grade only submissions for your own courses.');
  await pool.execute(
    'UPDATE assessment_submissions SET marks_obtained = ?, feedback = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?',
    [marks_obtained, feedback, req.user.id, req.params.submissionId]
  );
  res.json({ success: true, message: 'Submission graded.' });
}));

// TRAINING PROGRAMS
app.get('/api/programs', authenticate, asyncRoute(async (req, res) => {
  let sql = `SELECT p.id, p.title, p.description, p.goal, p.status, p.created_at,
                    u.name AS created_by_name, COUNT(pc.course_id) AS course_count
             FROM training_programs p JOIN users u ON u.id = p.created_by
             LEFT JOIN program_courses pc ON pc.program_id = p.id`;
  const values = [];
  if (req.user.role === 'trainer') { sql += ' WHERE p.created_by = ?'; values.push(req.user.id); }
  if (req.user.role === 'trainee') { sql += " WHERE p.status = 'published'"; }
  sql += ' GROUP BY p.id ORDER BY p.created_at DESC';
  const [rows] = await pool.execute(sql, values);
  sendRows(res, 'programs', rows);
}));

app.post('/api/programs', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const { title, description = '', goal = '', status = 'draft', course_ids = [] } = req.body;
  if (!title) throw fail(400, 'Program title is required.');
  if (!['draft', 'published', 'archived'].includes(status)) throw fail(400, 'Invalid program status.');
  if (!Array.isArray(course_ids)) throw fail(400, 'course_ids must be an array.');
  const uniqueCourseIds = [...new Set(course_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (req.user.role === 'trainer' && uniqueCourseIds.length) {
    const placeholders = uniqueCourseIds.map(() => '?').join(',');
    const [owned] = await pool.execute(`SELECT id FROM courses WHERE created_by = ? AND id IN (${placeholders})`, [req.user.id, ...uniqueCourseIds]);
    if (owned.length !== uniqueCourseIds.length) throw fail(403, 'A trainer can add only their own courses to a program.');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute('INSERT INTO training_programs (title, description, goal, status, created_by) VALUES (?, ?, ?, ?, ?)', [title, description, goal, status, req.user.id]);
    for (const courseId of uniqueCourseIds) await conn.execute('INSERT INTO program_courses (program_id, course_id) VALUES (?, ?)', [result.insertId, courseId]);
    await conn.commit();
    res.status(201).json({ success: true, programId: result.insertId });
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}));

app.get('/api/programs/:id/courses', authenticate, asyncRoute(async (req, res) => {
  const [programs] = await pool.execute('SELECT id, created_by, status FROM training_programs WHERE id = ?', [req.params.id]);
  if (!programs.length) throw fail(404, 'Training program not found.');
  if (req.user.role === 'trainee' && programs[0].status !== 'published') throw fail(404, 'Training program not found.');
  if (req.user.role === 'trainer' && programs[0].created_by !== req.user.id) throw fail(403, 'You can view only your own training programs.');
  const [rows] = await pool.execute(
    `SELECT c.id, c.title, c.description, c.category, c.status FROM program_courses pc
     JOIN courses c ON c.id = pc.course_id WHERE pc.program_id = ? ORDER BY c.title`, [req.params.id]
  );
  sendRows(res, 'courses', rows);
}));

// FEEDBACK
app.get('/api/feedback', authenticate, asyncRoute(async (req, res) => {
  let sql = `SELECT f.id, f.course_id, c.title AS course_title, f.feedback_type, f.rating,
                    f.subject, f.comments, f.created_at, u.name AS user_name
             FROM feedback f JOIN users u ON u.id = f.user_id LEFT JOIN courses c ON c.id = f.course_id`;
  const values = [];
  if (req.user.role !== 'administrator') { sql += ' WHERE f.user_id = ?'; values.push(req.user.id); }
  sql += ' ORDER BY f.created_at DESC';
  const [rows] = await pool.execute(sql, values);
  sendRows(res, 'feedback', rows);
}));

app.post('/api/feedback', authenticate, authorize('trainee'), asyncRoute(async (req, res) => {
  const { course_id = null, feedback_type = 'General', rating, subject = '', comments } = req.body;
  if (!comments || !rating) throw fail(400, 'Rating and comments are required.');
  if (Number(rating) < 1 || Number(rating) > 5) throw fail(400, 'Rating must be between 1 and 5.');
  const [result] = await pool.execute(
    'INSERT INTO feedback (user_id, course_id, feedback_type, rating, subject, comments) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, course_id || null, feedback_type, Number(rating), subject, comments]
  );
  res.status(201).json({ success: true, feedbackId: result.insertId });
}));

// NOTIFICATIONS
app.get('/api/notifications', authenticate, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT n.id, n.title, n.message, n.category, n.created_at, u.name AS created_by,
            IF(nr.user_id IS NULL, 0, 1) AS is_read
     FROM notifications n JOIN users u ON u.id = n.created_by
     LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
     WHERE n.target_role IS NULL OR n.target_role = ? OR n.created_by = ? OR ? = 'administrator'
     ORDER BY n.created_at DESC`, [req.user.id, req.user.role, req.user.id, req.user.role]
  );
  sendRows(res, 'notifications', rows);
}));

app.post('/api/notifications', authenticate, authorize('administrator'), asyncRoute(async (req, res) => {
  const { title, message, category = 'Announcement', target_role = null } = req.body;
  if (!title || !message) throw fail(400, 'Notification title and message are required.');
  if (target_role && !VALID_ROLES.includes(target_role)) throw fail(400, 'Invalid target role.');
  const [result] = await pool.execute(
    'INSERT INTO notifications (title, message, category, target_role, created_by) VALUES (?, ?, ?, ?, ?)',
    [title, message, category, target_role, req.user.id]
  );
  res.status(201).json({ success: true, notificationId: result.insertId });
}));

app.post('/api/notifications/:id/read', authenticate, asyncRoute(async (req, res) => {
  await pool.execute('INSERT IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
  res.json({ success: true, message: 'Notification marked as read.' });
}));

// PLATFORM SETTINGS (administrator only)
app.get('/api/settings', authenticate, authorize('administrator'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM app_settings ORDER BY setting_key');
  const settings = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  res.json({ success: true, settings });
}));

app.put('/api/settings', authenticate, authorize('administrator'), asyncRoute(async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length) throw fail(400, 'No settings were provided.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [key, value] of entries) {
      await conn.execute(
        'INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
        [key, String(value), req.user.id]
      );
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  res.json({ success: true, message: 'Platform settings saved.' });
}));

// PROGRESS, REPORTS AND DASHBOARDS
app.get('/api/progress/my', authenticate, authorize('trainee'), asyncRoute(async (req, res) => {
  const [progress] = await pool.execute(
    `SELECT c.id AS course_id, c.title, e.enrolled_at,
      (SELECT COUNT(*) FROM course_modules m WHERE m.course_id = c.id) AS total_modules,
      (SELECT COUNT(*) FROM module_completions mc JOIN course_modules m2 ON m2.id = mc.module_id WHERE m2.course_id = c.id AND mc.trainee_id = ?) AS completed_modules,
      (SELECT COUNT(*) FROM assessments a WHERE a.course_id = c.id) AS total_assessments,
      (SELECT COUNT(*) FROM assessment_submissions s JOIN assessments a2 ON a2.id = s.assessment_id WHERE a2.course_id = c.id AND s.trainee_id = ?) AS submitted_assessments
     FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.trainee_id = ? ORDER BY e.enrolled_at DESC`,
    [req.user.id, req.user.id, req.user.id]
  );
  const [assessmentResults] = await pool.execute(
    `SELECT a.title AS assessment_title, c.title AS course_title, s.marks_obtained, a.total_marks,
            s.feedback, s.submitted_at, s.reviewed_at
     FROM assessment_submissions s JOIN assessments a ON a.id = s.assessment_id
     JOIN courses c ON c.id = a.course_id WHERE s.trainee_id = ? ORDER BY s.submitted_at DESC`, [req.user.id]
  );
  const [[assessmentSummary]] = await pool.execute(
    `SELECT AVG((s.marks_obtained / NULLIF(a.total_marks, 0)) * 100) AS assessment_average,
            COUNT(*) AS reviewed_count
     FROM assessment_submissions s JOIN assessments a ON a.id = s.assessment_id
     WHERE s.trainee_id = ? AND s.marks_obtained IS NOT NULL`, [req.user.id]
  );
  const totalModules = progress.reduce((sum, row) => sum + Number(row.total_modules || 0), 0);
  const completedModules = progress.reduce((sum, row) => sum + Number(row.completed_modules || 0), 0);
  const completedCourses = progress.filter(row => Number(row.total_modules) > 0 && Number(row.completed_modules) >= Number(row.total_modules)).length;
  res.json({ success: true, progress, assessmentResults,
    summary: { total_modules: totalModules, completed_modules: completedModules,
      completed_courses: completedCourses,
      overall_progress: totalModules ? Math.round(completedModules / totalModules * 100) : null,
      assessment_average: assessmentSummary.assessment_average === null ? null : Number(assessmentSummary.assessment_average),
      reviewed_assessments: Number(assessmentSummary.reviewed_count || 0) }
  });
}));

app.get('/api/progress/courses', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  let sql = `SELECT u.id AS trainee_id, u.name AS trainee_name, u.email AS trainee_email,
                    c.id AS course_id, c.title AS course_title, e.enrolled_at,
                    COUNT(DISTINCT a.id) AS total_assessments,
                    COUNT(DISTINCT s.id) AS submitted_assessments,
                    AVG(s.marks_obtained) AS average_marks
             FROM enrollments e JOIN users u ON u.id = e.trainee_id JOIN courses c ON c.id = e.course_id
             LEFT JOIN assessments a ON a.course_id = c.id
             LEFT JOIN assessment_submissions s ON s.assessment_id = a.id AND s.trainee_id = u.id`;
  const values = [];
  if (req.user.role === 'trainer') { sql += ' WHERE c.created_by = ?'; values.push(req.user.id); }
  sql += ' GROUP BY u.id, u.name, u.email, c.id, c.title, e.enrolled_at ORDER BY c.title, u.name';
  const [rows] = await pool.execute(sql, values);
  sendRows(res, 'progress', rows);
}));

app.get('/api/reports/summary', authenticate, authorize('trainer', 'administrator'), asyncRoute(async (req, res) => {
  const condition = req.user.role === 'trainer' ? ' WHERE created_by = ?' : '';
  const args = req.user.role === 'trainer' ? [req.user.id] : [];
  const [[courseStats]] = await pool.execute(`SELECT COUNT(*) AS courses, SUM(status = 'published') AS published FROM courses${condition}`, args);
  const [[learnerStats]] = await pool.execute(
    `SELECT COUNT(DISTINCT e.trainee_id) AS learners FROM enrollments e JOIN courses c ON c.id = e.course_id${req.user.role === 'trainer' ? ' WHERE c.created_by = ?' : ''}`,
    args
  );
  const [[assessmentStats]] = await pool.execute(
    `SELECT COUNT(DISTINCT a.id) AS assessments, COUNT(s.id) AS submissions, AVG(s.marks_obtained) AS average_score
     FROM assessments a JOIN courses c ON c.id = a.course_id LEFT JOIN assessment_submissions s ON s.assessment_id = a.id${req.user.role === 'trainer' ? ' WHERE c.created_by = ?' : ''}`,
    args
  );
  res.json({ success: true, summary: { ...courseStats, ...learnerStats, ...assessmentStats } });
}));

app.get('/api/dashboard', authenticate, asyncRoute(async (req, res) => {
  const role = req.user.role;
  if (role === 'trainee') {
    const [[courses]] = await pool.execute('SELECT COUNT(*) AS total FROM enrollments WHERE trainee_id = ?', [req.user.id]);
    const [[submissions]] = await pool.execute('SELECT COUNT(*) AS total FROM assessment_submissions WHERE trainee_id = ?', [req.user.id]);
    const [[reviewed]] = await pool.execute('SELECT COUNT(*) AS total FROM assessment_submissions WHERE trainee_id = ? AND marks_obtained IS NOT NULL', [req.user.id]);
    const [[modules]] = await pool.execute('SELECT COUNT(*) AS total FROM module_completions WHERE trainee_id = ?', [req.user.id]);
    const [[assigned]] = await pool.execute('SELECT COUNT(*) AS total FROM assessments a JOIN enrollments e ON e.course_id = a.course_id WHERE e.trainee_id = ?', [req.user.id]);
    const [[courseProgress]] = await pool.execute(
      `SELECT COUNT(*) AS enrolled_courses,
              SUM(CASE WHEN totals.total_modules > 0 AND COALESCE(done.completed_modules, 0) >= totals.total_modules THEN 1 ELSE 0 END) AS completed_courses,
              SUM(totals.total_modules) AS total_modules,
              SUM(COALESCE(done.completed_modules, 0)) AS completed_course_modules
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       LEFT JOIN (SELECT course_id, COUNT(*) AS total_modules FROM course_modules GROUP BY course_id) totals ON totals.course_id = c.id
       LEFT JOIN (SELECT m.course_id, mc.trainee_id, COUNT(*) AS completed_modules FROM module_completions mc JOIN course_modules m ON m.id = mc.module_id GROUP BY m.course_id, mc.trainee_id) done ON done.course_id = c.id AND done.trainee_id = e.trainee_id
       WHERE e.trainee_id = ?`, [req.user.id]
    );
    const [[assessmentAverage]] = await pool.execute(
      `SELECT AVG((s.marks_obtained / NULLIF(a.total_marks, 0)) * 100) AS average_score
       FROM assessment_submissions s JOIN assessments a ON a.id = s.assessment_id
       WHERE s.trainee_id = ? AND s.marks_obtained IS NOT NULL`, [req.user.id]
    );
    const totalModules = Number(courseProgress.total_modules || 0);
    const completedCourseModules = Number(courseProgress.completed_course_modules || 0);
    res.json({ success: true, role, summary: {
      enrolledCourses: courses.total, submittedAssessments: submissions.total,
      reviewedAssessments: reviewed.total, assignedAssessments: assigned.total,
      completedModules: modules.total,
      completedCourses: Number(courseProgress.completed_courses || 0),
      overallProgress: totalModules ? Math.round(completedCourseModules / totalModules * 100) : null,
      assessmentAverage: assessmentAverage.average_score === null ? null : Number(assessmentAverage.average_score)
    } });
  } else if (role === 'trainer') {
    const [[courses]] = await pool.execute('SELECT COUNT(*) AS total FROM courses WHERE created_by = ?', [req.user.id]);
    const [[learners]] = await pool.execute('SELECT COUNT(DISTINCT e.trainee_id) AS total FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.created_by = ?', [req.user.id]);
    const [[assessments]] = await pool.execute('SELECT COUNT(*) AS total FROM assessments a JOIN courses c ON c.id = a.course_id WHERE c.created_by = ?', [req.user.id]);
    const [[pending]] = await pool.execute('SELECT COUNT(*) AS total FROM assessment_submissions s JOIN assessments a ON a.id = s.assessment_id JOIN courses c ON c.id = a.course_id WHERE c.created_by = ? AND s.marks_obtained IS NULL', [req.user.id]);
    const [[completion]] = await pool.execute(
      `SELECT AVG(CASE WHEN totals.total_modules = 0 THEN 0
                       ELSE COALESCE(done.completed_modules, 0) / totals.total_modules * 100 END) AS completion_rate
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       JOIN (SELECT course_id, COUNT(*) AS total_modules FROM course_modules GROUP BY course_id) totals ON totals.course_id = c.id
       LEFT JOIN (SELECT m.course_id, mc.trainee_id, COUNT(*) AS completed_modules
                  FROM module_completions mc JOIN course_modules m ON m.id = mc.module_id
                  GROUP BY m.course_id, mc.trainee_id) done ON done.course_id = c.id AND done.trainee_id = e.trainee_id
       WHERE c.created_by = ?`, [req.user.id]
    );
    res.json({ success: true, role, summary: { coursesCreated: courses.total, enrolledTrainees: learners.total, assessments: assessments.total, pendingReviews: pending.total, completionRate: Number(completion.completion_rate || 0) } });
  } else {
    const [[users]] = await pool.execute('SELECT COUNT(*) AS total FROM users');
    const [[courses]] = await pool.execute('SELECT COUNT(*) AS total FROM courses');
    const [[programs]] = await pool.execute('SELECT COUNT(*) AS total FROM training_programs');
    const [[resources]] = await pool.execute('SELECT COUNT(*) AS total FROM resources');
    const [[assessments]] = await pool.execute('SELECT COUNT(*) AS total FROM assessments');
    res.json({ success: true, role, summary: { totalUsers: users.total, totalCourses: courses.total, totalPrograms: programs.total, totalResources: resources.total, totalAssessments: assessments.total } });
  }
}));

// Serve the actual website from the same application.
app.get('/', (req, res) => res.redirect('/html/INDEX.html'));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` }));
app.use((error, req, res, next) => {
  console.error(error);
  let status = error.statusCode || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  let message = error.code === 'LIMIT_FILE_SIZE' ? 'File is too large. Maximum upload size is 25 MB.' : (error.message || 'Internal server error.');
  if (error.code === 'ER_DUP_ENTRY') { status = 409; message = 'A record with this unique value already exists.'; }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') { status = 400; message = 'A referenced record does not exist.'; }
  if (error.code === 'ER_BAD_FIELD_ERROR' || error.code === 'ER_NO_SUCH_TABLE') message = 'Database schema is not up to date. Run database/schema.sql in MySQL Workbench.';
  res.status(status).json({ success: false, message, ...(process.env.NODE_ENV !== 'production' && { detail: error.message }) });
});

const PORT = Number(process.env.PORT) || 5000;
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    app.listen(PORT, () => console.log(`CAPACITY CONNECT running at http://localhost:${PORT}\nHealth: http://localhost:${PORT}/api/health`));
  } catch (error) {
    console.error('Database connection failed:', error.message);
    console.error('Check MySQL is running, database/schema.sql has been executed, and .env contains the correct DB details.');
    process.exit(1);
  }
})();
