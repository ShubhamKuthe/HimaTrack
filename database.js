const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(process.cwd(), 'himatrack.sqlite');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    app_name TEXT NOT NULL,
    window_title TEXT NOT NULL DEFAULT '',
    executable_path TEXT NOT NULL DEFAULT '',
    task_name TEXT NOT NULL DEFAULT '',
    device_id TEXT NOT NULL DEFAULT '',
    device_name TEXT NOT NULL DEFAULT '',
    device_platform TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_app_usage_timestamp
  ON app_usage (timestamp);

  CREATE INDEX IF NOT EXISTS idx_app_usage_app_name
  ON app_usage (app_name);

`);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('app_usage', 'user_id', 'INTEGER');
ensureColumn('app_usage', 'window_title', "TEXT NOT NULL DEFAULT ''");
ensureColumn('app_usage', 'executable_path', "TEXT NOT NULL DEFAULT ''");
ensureColumn('app_usage', 'task_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('app_usage', 'device_id', "TEXT NOT NULL DEFAULT ''");
ensureColumn('app_usage', 'device_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('app_usage', 'device_platform', "TEXT NOT NULL DEFAULT ''");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_app_usage_user_id
  ON app_usage (user_id);
`);

const selectUserByUsername = db.prepare(`
  SELECT id, username, password_hash, password_salt, created_at
  FROM users
  WHERE lower(username) = lower(?)
`);

const selectUserById = db.prepare(`
  SELECT id, username, created_at
  FROM users
  WHERE id = ?
`);

const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, password_salt, created_at)
  VALUES (?, ?, ?, ?)
`);

const attachUnownedUsageStatement = db.prepare(`
  UPDATE app_usage
  SET user_id = ?
  WHERE user_id IS NULL
`);

const insertUsage = db.prepare(`
  INSERT INTO app_usage (
    user_id,
    app_name,
    window_title,
    executable_path,
    task_name,
    device_id,
    device_name,
    device_platform,
    duration_ms,
    timestamp
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectUsageSince = db.prepare(`
  SELECT
    app_name,
    window_title,
    executable_path,
    task_name,
    device_id,
    device_name,
    device_platform,
    duration_ms,
    timestamp
  FROM app_usage
  WHERE timestamp >= ?
    AND user_id = ?
  ORDER BY timestamp ASC
`);

const deleteUsageBefore = db.prepare(`
  DELETE FROM app_usage
  WHERE timestamp < ?
`);

const deleteAllUsageStatement = db.prepare(`
  DELETE FROM app_usage
  WHERE user_id = ?
`);

function normalizeUsername(username) {
  return String(username || '').trim();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function safeUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at
  };
}

function createUser(username, password) {
  const cleanUsername = normalizeUsername(username);

  if (cleanUsername.length < 3) {
    throw new Error('Username must be at least 3 characters.');
  }

  if (String(password || '').length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }

  if (selectUserByUsername.get(cleanUsername)) {
    throw new Error('That username already exists.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const createdAt = new Date().toISOString();
  const result = insertUser.run(cleanUsername, passwordHash, salt, createdAt);

  return {
    id: Number(result.lastInsertRowid),
    username: cleanUsername,
    createdAt
  };
}

function authenticateUser(username, password) {
  const cleanUsername = normalizeUsername(username);
  const row = selectUserByUsername.get(cleanUsername);

  if (!row) {
    throw new Error('Invalid username or password.');
  }

  const passwordHash = hashPassword(password, row.password_salt);

  if (passwordHash !== row.password_hash) {
    throw new Error('Invalid username or password.');
  }

  return safeUser(row);
}

function getUserById(userId) {
  if (!userId) {
    return null;
  }

  return safeUser(selectUserById.get(userId));
}

function attachUnownedUsageToUser(userId) {
  if (!userId) {
    return;
  }

  attachUnownedUsageStatement.run(userId);
}

function saveUsage(
  appName,
  durationMs,
  timestamp,
  windowTitle = '',
  executablePath = '',
  taskName = '',
  userId = null,
  deviceId = '',
  deviceName = '',
  devicePlatform = ''
) {
  if (!userId || !appName || durationMs <= 0) {
    return;
  }

  insertUsage.run(
    userId,
    appName,
    windowTitle || '',
    executablePath || '',
    taskName || '',
    deviceId || '',
    deviceName || '',
    devicePlatform || '',
    Math.round(durationMs),
    timestamp
  );
}

function loadUsageSince(timestamp, userId) {
  if (!userId) {
    return [];
  }

  return selectUsageSince.all(timestamp, userId);
}

function deleteOldUsage(timestamp) {
  deleteUsageBefore.run(timestamp);
}

function deleteAllUsage(userId) {
  if (!userId) {
    return;
  }

  deleteAllUsageStatement.run(userId);
}

module.exports = {
  dbPath,
  createUser,
  authenticateUser,
  getUserById,
  attachUnownedUsageToUser,
  saveUsage,
  loadUsageSince,
  deleteOldUsage,
  deleteAllUsage
};
