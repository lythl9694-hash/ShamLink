"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const databasePath =
  process.env.SHAMLINK_DB_PATH || path.join(root, "data", "shamlink.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','agent','deputy_agent','assistant_deputy','employee','client')),
    status TEXT NOT NULL CHECK (status IN ('pending_owner','pending_agent','pending_verification','active','rejected','suspended')),
    agency_id TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT
  );
  CREATE TABLE IF NOT EXISTS agencies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_user_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    FOREIGN KEY (agent_user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    agency_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_by TEXT,
    used_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    FOREIGN KEY (agency_id) REFERENCES agencies(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    transfer_number TEXT NOT NULL UNIQUE,
    source_agency_id TEXT NOT NULL,
    destination_agency_id TEXT,
    destination_name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    delivered_by TEXT,
    sender_name TEXT,
    receiver_name TEXT NOT NULL,
    receiver_phone TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    commission REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'قيد الانتظار',
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    FOREIGN KEY (source_agency_id) REFERENCES agencies(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (delivered_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS agency_balances (
    agency_id TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('USD','SYP','TRY','EUR')),
    balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (agency_id, currency),
    FOREIGN KEY (agency_id) REFERENCES agencies(id)
  );
  CREATE TABLE IF NOT EXISTS liquidity_ledger (
    id TEXT PRIMARY KEY,
    agency_id TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('USD','SYP','TRY','EUR')),
    amount_minor INTEGER NOT NULL,
    balance_before_minor INTEGER NOT NULL,
    balance_after_minor INTEGER NOT NULL CHECK (balance_after_minor >= 0),
    movement_type TEXT NOT NULL,
    transfer_id TEXT,
    counterparty_agency_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (agency_id) REFERENCES agencies(id),
    FOREIGN KEY (transfer_id) REFERENCES transfers(id),
    FOREIGN KEY (counterparty_agency_id) REFERENCES agencies(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_users_status_role ON users(status, role);
  CREATE INDEX IF NOT EXISTS idx_users_agency ON users(agency_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_transfers_source ON transfers(source_agency_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_transfers_destination ON transfers(destination_agency_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_transfers_created_by ON transfers(created_by, created_at);
  CREATE INDEX IF NOT EXISTS idx_transfers_delivered_by ON transfers(delivered_by, delivered_at);
  CREATE INDEX IF NOT EXISTS idx_liquidity_ledger_agency ON liquidity_ledger(agency_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_liquidity_ledger_transfer ON liquidity_ledger(transfer_id);
`);

// Keep existing development databases compatible as transfer verification evolves.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("transfers", "sms_code", "TEXT");
ensureColumn("transfers", "sms_sent_at", "TEXT");
ensureColumn("transfers", "sms_expires_at", "TEXT");
ensureColumn("transfers", "sms_attempts", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("transfers", "sms_locked", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("transfers", "code_channel", "TEXT");
ensureColumn("transfers", "recipient_id", "TEXT");
ensureColumn("transfers", "delivery_address", "TEXT");
ensureColumn("transfers", "notes", "TEXT");
ensureColumn("transfers", "settlement_method", "TEXT NOT NULL DEFAULT 'manual'");
ensureColumn("transfers", "idempotency_key", "TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_idempotency ON transfers(idempotency_key) WHERE idempotency_key IS NOT NULL;");
db.prepare(
  "INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES('exchange_rates',?,?)",
).run(JSON.stringify({ USD: 1, EUR: 1, TRY: 0, SYP: 0 }), now());
db.prepare(
  "INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES('commission_rates',?,?)",
).run(JSON.stringify({ USD: 0, EUR: 0, TRY: 0, SYP: 0 }), now());
db.prepare(
  "INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES('sms_validity_hours',?,?)",
).run(JSON.stringify(24), now());
db.exec("PRAGMA optimize;");

const publicFiles = new Set([
  "/",
  "/index.html",
  "/login.html",
  "/register.html",
  "/account.js",
  "/dashboard.css",
]);
const rolePages = {
  "/owner-dashboard.html": ["owner"],
  "/settings.html": ["owner"],
  "/agent-dashboard.html": [
    "owner",
    "agent",
    "deputy_agent",
    "assistant_deputy",
  ],
  "/transfers.html": [
    "owner",
    "agent",
    "deputy_agent",
    "assistant_deputy",
    "employee",
  ],
  "/dashboard.js": ["owner", "agent", "deputy_agent", "assistant_deputy"],
  "/admin-accounts.js": ["owner", "agent", "deputy_agent", "assistant_deputy"],
};
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};
const attempts = new Map();
let marketCache = { expiresAt: 0, data: null };

function now() {
  return new Date().toISOString();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9+]/g, "");
}

const supportedCurrencies = new Set(["USD", "SYP", "TRY", "EUR"]);

function currencyDecimals(currency) {
  return currency === "SYP" ? 0 : 2;
}

function toMinorUnits(value, currency) {
  const text = String(value ?? "").trim();
  const decimals = currencyDecimals(currency);
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2] || "").length > decimals) return null;
  const factor = 10 ** decimals;
  const whole = Number(match[1]);
  const fraction = Number((match[2] || "").padEnd(decimals, "0") || 0);
  const minor = whole * factor + fraction;
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function fromMinorUnits(value, currency) {
  return Number(value || 0) / 10 ** currencyDecimals(currency);
}

function balanceRows(agencyId = null) {
  const rows = agencyId
    ? db.prepare(`SELECT b.agency_id AS agencyId,a.name AS agencyName,b.currency,
        b.balance_minor AS balanceMinor,b.updated_at AS updatedAt
        FROM agency_balances b JOIN agencies a ON a.id=b.agency_id
        WHERE b.agency_id=? ORDER BY b.currency`).all(agencyId)
    : db.prepare(`SELECT b.agency_id AS agencyId,a.name AS agencyName,b.currency,
        b.balance_minor AS balanceMinor,b.updated_at AS updatedAt
        FROM agency_balances b JOIN agencies a ON a.id=b.agency_id
        ORDER BY a.name,b.currency`).all();
  return rows.map((row) => ({
    ...row,
    balance: fromMinorUnits(row.balanceMinor, row.currency),
  }));
}

function ensureBalanceRow(agencyId, currency) {
  db.prepare(`INSERT OR IGNORE INTO agency_balances(agency_id,currency,balance_minor,updated_at)
    VALUES(?,?,0,?)`).run(agencyId, currency, now());
}

function transferSelect(where = "", order = "") {
  return `SELECT t.*,
    source.name AS source_name,
    destination.name AS destination_agency_name,
    creator.name AS creator_name,
    creator.phone AS creator_phone,
    deliverer.name AS deliverer_name,
    deliverer.phone AS deliverer_phone
    FROM transfers t
    JOIN agencies source ON source.id=t.source_agency_id
    LEFT JOIN agencies destination ON destination.id=t.destination_agency_id
    JOIN users creator ON creator.id=t.created_by
    LEFT JOIN users deliverer ON deliverer.id=t.delivered_by
    ${where} ${order}`;
}

function randomId(prefix) {
  return prefix + "-" + crypto.randomInt(100000, 1000000);
}

function uniqueId(table, prefix) {
  let id;
  do id = randomId(prefix);
  while (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
  return id;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) {
  const derived = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString("hex") };
}

async function verifyPassword(password, salt, expected) {
  const result = await hashPassword(password, salt);
  return crypto.timingSafeEqual(
    Buffer.from(result.hash, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [
          part.slice(0, index).trim(),
          decodeURIComponent(part.slice(index + 1)),
        ];
      }),
  );
}

function currentUser(req) {
  const token = parseCookies(req).shamlink_session;
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.id,u.name,u.phone,u.role,u.status,u.agency_id AS agencyId,a.name AS agencyName
                FROM sessions s JOIN users u ON u.id=s.user_id
                LEFT JOIN agencies a ON a.id=u.agency_id
                WHERE s.token_hash=? AND s.expires_at>?`,
      )
      .get(hashToken(token), now()) || null
  );
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100000) throw new Error("الطلب كبير جداً");
  }
  return body ? JSON.parse(body) : {};
}

function audit(actorId, action, targetType, targetId, details = {}) {
  db.prepare(
    `INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details,created_at)
              VALUES(?,?,?,?,?,?)`,
  ).run(
    actorId || null,
    action,
    targetType || null,
    targetId || null,
    JSON.stringify(details),
    now(),
  );
}

function requireRole(req, res, roles) {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: "يجب تسجيل الدخول أولاً." });
    return null;
  }
  if (user.status !== "active" || !roles.includes(user.role)) {
    json(res, 403, { error: "ليس لديك صلاحية لهذه العملية." });
    return null;
  }
  return user;
}

function rateLimited(req, key, limit = 10, windowMs = 15 * 60 * 1000) {
  const ip = req.socket.remoteAddress || "unknown";
  const name = ip + ":" + key;
  const item = attempts.get(name) || { count: 0, reset: Date.now() + windowMs };
  if (Date.now() > item.reset) {
    item.count = 0;
    item.reset = Date.now() + windowMs;
  }
  item.count += 1;
  attempts.set(name, item);
  return item.count > limit;
}

function sessionCookie(token, maxAge = 7 * 24 * 60 * 60) {
  const secure =
    process.env.SHAMLINK_COOKIE_SECURE === "true" ? "; Secure" : "";
  return `shamlink_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function getExchangeRates() {
  const row = db
    .prepare("SELECT value FROM settings WHERE key='exchange_rates'")
    .get();
  return row ? JSON.parse(row.value) : { USD: 1, EUR: 1, TRY: 0, SYP: 0 };
}

function profitUsdForAgency(agencyId) {
  const rates = getExchangeRates();
  const rows = db
    .prepare(
      "SELECT currency,COALESCE(SUM(commission),0) AS profit FROM transfers WHERE source_agency_id=? AND status='تم التسليم' GROUP BY currency",
    )
    .all(agencyId);
  return rows.reduce(
    (sum, row) =>
      sum + Number(row.profit || 0) * Number(rates[row.currency] || 0),
    0,
  );
}

function levelDetails(totalProfit) {
  const bands = [
    { from: 1, to: 10, step: 50 },
    { from: 11, to: 20, step: 100 },
    { from: 21, to: 35, step: 150 },
    { from: 36, to: 50, step: 200 },
    { from: 51, to: 60, step: 250 },
    { from: 61, to: 70, step: 300 },
    { from: 71, to: 80, step: 350 },
    { from: 81, to: 90, step: 400 },
    { from: 91, to: 100, step: 500 },
  ];
  let level = 1;
  let remainingProfit = Math.max(0, Number(totalProfit || 0));
  let currentStep = 50;
  for (const band of bands) {
    currentStep = band.step;
    while (level < band.to && remainingProfit >= band.step) {
      remainingProfit -= band.step;
      level += 1;
    }
    if (level < band.to) break;
  }
  if (level >= 100) {
    return {
      level: 100,
      progress: 100,
      profitUsd: totalProfit,
      remainingUsd: 0,
      max: true,
    };
  }
  return {
    level,
    progress: Math.min(100, Math.floor((remainingProfit / currentStep) * 100)),
    profitUsd: Number(totalProfit || 0),
    remainingUsd: Math.max(0, currentStep - remainingProfit),
    max: false,
  };
}

function agencySummary(agency, includePrivateLevel) {
  const profit = profitUsdForAgency(agency.id);
  const level = levelDetails(profit);
  const employees = db
    .prepare(
      "SELECT id,name,phone,role,status,created_at AS createdAt FROM users WHERE agency_id=? AND role IN ('employee','deputy_agent','assistant_deputy') ORDER BY created_at DESC",
    )
    .all(agency.id);
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
       SUM(CASE WHEN source_agency_id=? THEN 1 ELSE 0 END) AS outgoing,
       SUM(CASE WHEN destination_agency_id=? THEN 1 ELSE 0 END) AS incoming,
       SUM(CASE WHEN status='تم التسليم' THEN 1 ELSE 0 END) AS delivered
       FROM transfers WHERE source_agency_id=? OR destination_agency_id=?`,
    )
    .get(agency.id, agency.id, agency.id, agency.id);
  return {
    id: agency.id,
    name: agency.name,
    badge: "وكيل وكالة " + agency.name,
    agentUserId: agency.agent_user_id,
    level: level.level,
    levelPrivate: includePrivateLevel ? level : undefined,
    employees,
    counts: {
      total: Number(counts.total || 0),
      outgoing: Number(counts.outgoing || 0),
      incoming: Number(counts.incoming || 0),
      delivered: Number(counts.delivered || 0),
    },
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/auth/status") {
    const ownerExists = Boolean(
      db.prepare("SELECT 1 FROM users WHERE role='owner'").get(),
    );
    return json(res, 200, {
      user: currentUser(req),
      setupRequired: !ownerExists,
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/setup-owner") {
    if (db.prepare("SELECT 1 FROM users WHERE role='owner'").get()) {
      return json(res, 409, { error: "تم إنشاء حساب صاحب المنصة مسبقاً." });
    }
    if (!process.env.SHAMLINK_SETUP_TOKEN) {
      return json(res, 503, {
        error: "يجب ضبط رمز تأسيس المنصة في الخادم أولاً.",
      });
    }
    const body = await readJson(req);
    if (body.setupToken !== process.env.SHAMLINK_SETUP_TOKEN) {
      return json(res, 403, { error: "رمز تأسيس المنصة غير صحيح." });
    }
    const phone = normalizePhone(body.phone);
    if (
      !body.name ||
      phone.length < 7 ||
      String(body.password || "").length < 8
    ) {
      return json(res, 400, {
        error: "أدخل الاسم ورقمًا صحيحًا وكلمة مرور من 8 أحرف على الأقل.",
      });
    }
    const password = await hashPassword(body.password);
    const id = uniqueId("users", "OWN");
    db.prepare(
      `INSERT INTO users(id,name,phone,password_hash,password_salt,role,status,created_at,approved_at)
                VALUES(?,?,?,?,?,'owner','active',?,?)`,
    ).run(
      id,
      body.name.trim(),
      phone,
      password.hash,
      password.salt,
      now(),
      now(),
    );
    audit(id, "إنشاء حساب صاحب المنصة", "user", id);
    return json(res, 201, { message: "تم إنشاء حساب صاحب المنصة." });
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    if (rateLimited(req, "register", 8))
      return json(res, 429, { error: "محاولات كثيرة. حاول لاحقاً." });
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    if (
      !body.name ||
      phone.length < 7 ||
      String(body.password || "").length < 8
    ) {
      return json(res, 400, {
        error: "أدخل الاسم ورقمًا صحيحًا وكلمة مرور من 8 أحرف على الأقل.",
      });
    }
    if (db.prepare("SELECT 1 FROM users WHERE phone=?").get(phone)) {
      return json(res, 409, { error: "رقم الجوال مسجل مسبقاً." });
    }
    let role = body.accountType === "agent" ? "agent" : "client";
    let status = role === "agent" ? "pending_owner" : "pending_verification";
    let agencyId = null;
    let invitation = null;
    if (body.inviteCode) {
      invitation = db
        .prepare(
          "SELECT * FROM invitations WHERE code_hash=? AND status='active' AND expires_at>?",
        )
        .get(hashToken(String(body.inviteCode).trim()), now());
      if (!invitation)
        return json(res, 400, { error: "كود الدعوة غير صحيح أو منتهي." });
      role = "employee";
      status = "pending_agent";
      agencyId = invitation.agency_id;
    }
    const password = await hashPassword(body.password);
    const id = uniqueId(
      "users",
      role === "employee" ? "EMP" : role === "agent" ? "USR" : "CLI",
    );
    db.prepare(
      `INSERT INTO users(id,name,phone,password_hash,password_salt,role,status,agency_id,created_at)
                VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      body.name.trim(),
      phone,
      password.hash,
      password.salt,
      role,
      status,
      agencyId,
      now(),
    );
    if (invitation) {
      db.prepare(
        "UPDATE invitations SET status='used',used_by=?,used_at=? WHERE id=?",
      ).run(id, now(), invitation.id);
    }
    audit(id, "إنشاء حساب", "user", id, { role, status });
    return json(res, 201, {
      message: "تم إنشاء الحساب وهو بانتظار الموافقة.",
      id,
      status,
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    if (rateLimited(req, "login", 12))
      return json(res, 429, { error: "محاولات كثيرة. حاول لاحقاً." });
    const body = await readJson(req);
    const user = db
      .prepare("SELECT * FROM users WHERE phone=?")
      .get(normalizePhone(body.phone));
    if (
      !user ||
      !(await verifyPassword(
        body.password || "",
        user.password_salt,
        user.password_hash,
      ))
    ) {
      return json(res, 401, { error: "رقم الجوال أو كلمة المرور غير صحيحة." });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    ).run(hashToken(token), user.id, expires, now());
    audit(user.id, "تسجيل دخول", "user", user.id);
    return json(
      res,
      200,
      {
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          status: user.status,
        },
      },
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req).shamlink_session;
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        hashToken(token),
      );
    return json(
      res,
      200,
      { message: "تم تسجيل الخروج." },
      { "Set-Cookie": sessionCookie("", 0) },
    );
  }

  if (req.method === "GET" && pathname === "/api/owner/agents") {
    const owner = requireRole(req, res, ["owner"]);
    if (!owner) return;
    const agents = db
      .prepare(
        "SELECT id,name,phone,status,agency_id AS agencyId,created_at AS createdAt FROM users WHERE role='agent' ORDER BY created_at DESC",
      )
      .all();
    return json(res, 200, { agents });
  }

  const approveAgent = pathname.match(
    /^\/api\/owner\/agents\/([^/]+)\/approve$/,
  );
  if (req.method === "POST" && approveAgent) {
    const owner = requireRole(req, res, ["owner"]);
    if (!owner) return;
    const body = await readJson(req);
    const agent = db
      .prepare("SELECT * FROM users WHERE id=? AND role='agent'")
      .get(approveAgent[1]);
    if (!agent) return json(res, 404, { error: "طلب الوكيل غير موجود." });
    if (!String(body.agencyName || "").trim())
      return json(res, 400, { error: "أدخل اسم الوكالة." });
    const agencyId = uniqueId("agencies", "AG");
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO agencies(id,name,agent_user_id,created_at,created_by) VALUES(?,?,?,?,?)",
      ).run(agencyId, body.agencyName.trim(), agent.id, now(), owner.id);
      db.prepare(
        "UPDATE users SET status='active',agency_id=?,approved_at=?,approved_by=? WHERE id=?",
      ).run(agencyId, now(), owner.id, agent.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    audit(owner.id, "الموافقة على وكيل", "agency", agencyId, {
      agentId: agent.id,
    });
    return json(res, 200, { message: "تمت الموافقة على الوكيل.", agencyId });
  }

  const rejectAgent = pathname.match(/^\/api\/owner\/agents\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectAgent) {
    const owner = requireRole(req, res, ["owner"]);
    if (!owner) return;
    db.prepare(
      "UPDATE users SET status='rejected',approved_by=?,approved_at=? WHERE id=? AND role='agent'",
    ).run(owner.id, now(), rejectAgent[1]);
    audit(owner.id, "رفض طلب وكيل", "user", rejectAgent[1]);
    return json(res, 200, { message: "تم رفض الطلب." });
  }

  if (req.method === "POST" && pathname === "/api/agent/invitations") {
    const agent = requireRole(req, res, ["agent"]);
    if (!agent) return;
    const code = crypto.randomBytes(18).toString("base64url");
    const inviteId = uniqueId("invitations", "INV");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO invitations(id,code_hash,agency_id,created_by,expires_at,created_at)
                VALUES(?,?,?,?,?,?)`,
    ).run(
      inviteId,
      hashToken(code),
      agent.agencyId,
      agent.id,
      expiresAt,
      now(),
    );
    audit(agent.id, "إنشاء دعوة موظف", "invitation", inviteId);
    const forwardedProto = String(
      req.headers["x-forwarded-proto"] || "http",
    )
      .split(",")[0]
      .trim();
    const forwardedHost = String(
      req.headers["x-forwarded-host"] || req.headers.host,
    )
      .split(",")[0]
      .trim();
    const origin = `${forwardedProto}://${forwardedHost}`;
    return json(res, 201, {
      code,
      expiresAt,
      url: `${origin}/register.html?invite=${encodeURIComponent(code)}`,
    });
  }

  if (req.method === "GET" && pathname === "/api/agent/employees") {
    const agent = requireRole(req, res, [
      "agent",
      "deputy_agent",
      "assistant_deputy",
    ]);
    if (!agent) return;
    const employees = db
      .prepare(
        "SELECT id,name,phone,role,status,created_at AS createdAt FROM users WHERE role IN ('employee','deputy_agent','assistant_deputy') AND agency_id=? ORDER BY created_at DESC",
      )
      .all(agent.agencyId);
    return json(res, 200, { employees });
  }

  const staffRole = pathname.match(/^\/api\/agent\/employees\/([^/]+)\/role$/);
  if (req.method === "POST" && staffRole) {
    const agent = requireRole(req, res, ["agent"]);
    if (!agent) return;
    const body = await readJson(req);
    const allowedRoles = ["employee", "deputy_agent", "assistant_deputy"];
    if (!allowedRoles.includes(body.role)) {
      return json(res, 400, { error: "الدور المطلوب غير صالح." });
    }
    const employee = db
      .prepare(
        "SELECT id,role FROM users WHERE id=? AND agency_id=? AND role IN ('employee','deputy_agent','assistant_deputy')",
      )
      .get(staffRole[1], agent.agencyId);
    if (!employee) {
      return json(res, 404, { error: "الموظف غير موجود في وكالتك." });
    }
    if (body.role !== "employee") {
      const occupied = db
        .prepare(
          "SELECT id FROM users WHERE agency_id=? AND role=? AND id<>? AND status='active'",
        )
        .get(agent.agencyId, body.role, employee.id);
      if (occupied) {
        return json(res, 409, {
          error:
            body.role === "deputy_agent"
              ? "يوجد نائب وكيل مفعّل لهذه الوكالة بالفعل."
              : "يوجد مساعد نائب مفعّل لهذه الوكالة بالفعل.",
        });
      }
    }
    db.prepare("UPDATE users SET role=? WHERE id=? AND agency_id=?").run(
      body.role,
      employee.id,
      agent.agencyId,
    );
    audit(agent.id, "تغيير دور موظف", "user", employee.id, {
      from: employee.role,
      to: body.role,
    });
    return json(res, 200, { message: "تم تحديث صلاحيات الموظف." });
  }

  const employeeDecision = pathname.match(
    /^\/api\/agent\/employees\/([^/]+)\/(approve|reject)$/,
  );
  if (req.method === "POST" && employeeDecision) {
    const agent = requireRole(req, res, ["agent"]);
    if (!agent) return;
    const status = employeeDecision[2] === "approve" ? "active" : "rejected";
    const result = db
      .prepare(
        "UPDATE users SET status=?,approved_at=?,approved_by=? WHERE id=? AND role='employee' AND agency_id=?",
      )
      .run(status, now(), agent.id, employeeDecision[1], agent.agencyId);
    if (!result.changes)
      return json(res, 404, { error: "الموظف غير موجود في وكالتك." });
    audit(
      agent.id,
      status === "active" ? "الموافقة على موظف" : "رفض موظف",
      "user",
      employeeDecision[1],
    );
    return json(res, 200, {
      message: status === "active" ? "تم تفعيل الموظف." : "تم رفض الطلب.",
    });
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    const user = requireRole(req, res, [
      "owner",
      "agent",
      "deputy_agent",
      "assistant_deputy",
    ]);
    if (!user) return;
    if (user.role === "owner") {
      const agencies = db
        .prepare(
          "SELECT * FROM agencies WHERE status='active' ORDER BY created_at DESC",
        )
        .all();
      return json(res, 200, {
        viewer: user,
        agencies: agencies.map((agency) => agencySummary(agency, true)),
      });
    }
    const agency = db
      .prepare("SELECT * FROM agencies WHERE id=? AND status='active'")
      .get(user.agencyId);
    if (!agency) return json(res, 404, { error: "الوكالة غير موجودة." });
    return json(res, 200, {
      viewer: user,
      agencies: [agencySummary(agency, user.role === "agent")],
    });
  }

  const employeeHistory = pathname.match(
    /^\/api\/employees\/([^/]+)\/transfers$/,
  );
  if (req.method === "GET" && employeeHistory) {
    const viewer = requireRole(req, res, [
      "owner",
      "agent",
      "deputy_agent",
      "assistant_deputy",
    ]);
    if (!viewer) return;
    const employee = db
      .prepare(
        "SELECT id,name,phone,role,status,agency_id AS agencyId FROM users WHERE id=?",
      )
      .get(employeeHistory[1]);
    if (!employee) return json(res, 404, { error: "الموظف غير موجود." });
    if (viewer.role !== "owner" && viewer.agencyId !== employee.agencyId) {
      return json(res, 403, { error: "لا يمكنك مشاهدة موظف من وكالة أخرى." });
    }
    const created = db
      .prepare(
        "SELECT * FROM transfers WHERE created_by=? ORDER BY created_at DESC",
      )
      .all(employee.id);
    const delivered = db
      .prepare(
        "SELECT * FROM transfers WHERE delivered_by=? ORDER BY delivered_at DESC",
      )
      .all(employee.id);
    return json(res, 200, { employee, created, delivered });
  }

  if (req.method === "GET" && pathname === "/api/settings") {
    const viewer = requireRole(req, res, [
      "owner",
      "agent",
      "deputy_agent",
      "assistant_deputy",
      "employee",
    ]);
    if (!viewer) return;
    const rows = db.prepare("SELECT key,value FROM settings").all();
    const settings = Object.fromEntries(
      rows.map((row) => [row.key, JSON.parse(row.value)]),
    );
    return json(res, 200, { settings });
  }

  if (req.method === "GET" && pathname === "/api/market-rates") {
    const viewer = requireRole(req, res, [
      "owner",
      "agent",
      "deputy_agent",
      "assistant_deputy",
      "employee",
    ]);
    if (!viewer) return;
    const forceRefresh = new URL(req.url, "http://localhost").searchParams.get("refresh") === "1";
    if (!forceRefresh && marketCache.data && Date.now() < marketCache.expiresAt) {
      return json(res, 200, marketCache.data);
    }
    try {
      const [currencyResponse, goldResponse] = await Promise.all([
        fetch("https://open.er-api.com/v6/latest/USD", {
          signal: AbortSignal.timeout(8000),
        }),
        fetch("https://api.gold-api.com/price/XAU", {
          signal: AbortSignal.timeout(8000),
        }),
      ]);
      if (!currencyResponse.ok || !goldResponse.ok) {
        throw new Error("Market provider unavailable");
      }
      const currencyData = await currencyResponse.json();
      const goldData = await goldResponse.json();
      const data = {
        base: "USD",
        rates: {
          USD: 1,
          EUR: Number(currencyData.rates?.EUR || 0),
          TRY: Number(currencyData.rates?.TRY || 0),
          SYP: Number(currencyData.rates?.SYP || 0),
        },
        goldUsdPerOunce: Number(goldData.price || goldData.price_usd || 0),
        updatedAt:
          goldData.updatedAt ||
          goldData.updated_at ||
          currencyData.time_last_update_utc ||
          now(),
        sources: {
          currencies: "ExchangeRate-API",
          gold: "Gold API",
        },
      };
      if (!data.rates.EUR || !data.rates.TRY || !data.rates.SYP) {
        throw new Error("Incomplete market rates");
      }
      db.prepare(
        `INSERT INTO settings(key,value,updated_at,updated_by) VALUES('exchange_rates',?,?,NULL)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=NULL`,
      ).run(
        JSON.stringify({
          USD: 1,
          EUR: 1 / data.rates.EUR,
          TRY: 1 / data.rates.TRY,
          SYP: 1 / data.rates.SYP,
        }),
        now(),
      );
      marketCache = { expiresAt: Date.now() + 15 * 60 * 1000, data };
      return json(res, 200, data);
    } catch (error) {
      if (marketCache.data) return json(res, 200, marketCache.data);
      return json(res, 503, {
        error: "تعذر تحديث أسعار السوق حالياً. حاول بعد قليل.",
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/owner/settings") {
    const owner = requireRole(req, res, ["owner"]);
    if (!owner) return;
    const body = await readJson(req);
    const commissionRates = body.commissionRates || {};
    const normalizedCommission = {};
    for (const currency of ["USD", "SYP", "TRY", "EUR"]) {
      normalizedCommission[currency] = Math.max(
        0,
        Number(commissionRates[currency] || 0),
      );
    }
    const validity = Math.min(
      168,
      Math.max(1, Number(body.smsValidityHours || 24)),
    );
    const statement = db.prepare(
      `INSERT INTO settings(key,value,updated_at,updated_by) VALUES(?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
    );
    db.exec("BEGIN");
    try {
      statement.run(
        "commission_rates",
        JSON.stringify(normalizedCommission),
        now(),
        owner.id,
      );
      statement.run(
        "sms_validity_hours",
        JSON.stringify(validity),
        now(),
        owner.id,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    audit(
      owner.id,
      "تحديث إعدادات العمولة وأسعار الصرف",
      "settings",
      "platform",
    );
    return json(res, 200, { message: "تم حفظ الإعدادات." });
  }

  if (req.method === "GET" && pathname === "/api/transfers") {
    const viewer = requireRole(req, res, [
      "owner",
      "agent",
      "deputy_agent",
      "assistant_deputy",
      "employee",
    ]);
    if (!viewer) return;
    const rows =
      viewer.role === "owner"
        ? db
            .prepare(transferSelect("", "ORDER BY t.created_at DESC LIMIT 500"))
            .all()
        : db
            .prepare(
              transferSelect(
                "WHERE t.source_agency_id=? OR t.destination_agency_id=?",
                "ORDER BY t.created_at DESC LIMIT 500",
              ),
            )
            .all(viewer.agencyId, viewer.agencyId);
    return json(res, 200, { transfers: rows });
  }

  if (req.method === "GET" && pathname === "/api/liquidity") {
    const viewer = requireRole(req, res, [
      "owner", "agent", "deputy_agent", "assistant_deputy", "employee",
    ]);
    if (!viewer) return;
    const requestedAgency = new URL(req.url, "http://localhost").searchParams.get("agencyId");
    const agencyId = viewer.role === "owner" ? requestedAgency : viewer.agencyId;
    const balances = balanceRows(agencyId || null);
    const ledger = viewer.role === "owner"
      ? db.prepare(`SELECT l.*,a.name AS agency_name,c.name AS counterparty_name
          FROM liquidity_ledger l JOIN agencies a ON a.id=l.agency_id
          LEFT JOIN agencies c ON c.id=l.counterparty_agency_id
          ORDER BY l.created_at DESC LIMIT 200`).all()
      : db.prepare(`SELECT l.*,a.name AS agency_name,c.name AS counterparty_name
          FROM liquidity_ledger l JOIN agencies a ON a.id=l.agency_id
          LEFT JOIN agencies c ON c.id=l.counterparty_agency_id
          WHERE l.agency_id=? ORDER BY l.created_at DESC LIMIT 100`).all(viewer.agencyId);
    return json(res, 200, {
      balances,
      ledger: ledger.map((row) => ({
        ...row,
        amount: fromMinorUnits(row.amount_minor, row.currency),
        balanceBefore: fromMinorUnits(row.balance_before_minor, row.currency),
        balanceAfter: fromMinorUnits(row.balance_after_minor, row.currency),
      })),
    });
  }

  if (req.method === "POST" && pathname === "/api/owner/liquidity/adjust") {
    const owner = requireRole(req, res, ["owner"]);
    if (!owner) return;
    const body = await readJson(req);
    const agencyId = String(body.agencyId || "").trim();
    const currency = String(body.currency || "").trim();
    const direction = body.direction === "subtract" ? -1 : 1;
    const amountMinor = toMinorUnits(body.amount, currency);
    const reason = String(body.reason || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!supportedCurrencies.has(currency) || !amountMinor || !reason || idempotencyKey.length < 12) {
      return json(res, 400, { error: "أدخل الوكالة والعملة والمبلغ والسبب بصورة صحيحة." });
    }
    const agency = db.prepare("SELECT id,name FROM agencies WHERE id=? AND status='active'").get(agencyId);
    if (!agency) return json(res, 404, { error: "الوكالة غير موجودة أو غير مفعّلة." });
    const existing = db.prepare("SELECT id FROM liquidity_ledger WHERE idempotency_key=?").get(idempotencyKey);
    if (existing) return json(res, 200, { message: "تم تسجيل هذه العملية مسبقاً.", duplicate: true });
    db.exec("BEGIN IMMEDIATE");
    try {
      ensureBalanceRow(agency.id, currency);
      const before = Number(db.prepare("SELECT balance_minor FROM agency_balances WHERE agency_id=? AND currency=?").get(agency.id, currency).balance_minor);
      const signedAmount = direction * amountMinor;
      const after = before + signedAmount;
      if (after < 0) throw Object.assign(new Error("رصيد الوكالة غير كافٍ لإجراء الخصم."), { statusCode: 409 });
      db.prepare("UPDATE agency_balances SET balance_minor=?,updated_at=? WHERE agency_id=? AND currency=?")
        .run(after, now(), agency.id, currency);
      db.prepare(`INSERT INTO liquidity_ledger(id,agency_id,currency,amount_minor,balance_before_minor,
        balance_after_minor,movement_type,idempotency_key,reason,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        uniqueId("liquidity_ledger", "LIQ"), agency.id, currency, signedAmount,
        before, after, direction > 0 ? "owner_credit" : "owner_debit",
        idempotencyKey, reason, owner.id, now(),
      );
      db.exec("COMMIT");
      audit(owner.id, direction > 0 ? "إضافة سيولة" : "خصم سيولة", "agency", agency.id, {
        currency, amount: fromMinorUnits(amountMinor, currency), reason,
      });
      return json(res, 200, { message: "تم تحديث سيولة الوكالة.", balance: fromMinorUnits(after, currency) });
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.statusCode) return json(res, error.statusCode, { error: error.message });
      if (String(error.message).includes("UNIQUE constraint failed")) {
        return json(res, 200, { message: "تم تسجيل هذه العملية مسبقاً.", duplicate: true });
      }
      throw error;
    }
  }

  if (req.method === "POST" && pathname === "/api/transfers") {
    const creator = requireRole(req, res, [
      "owner",
      "agent",
      "deputy_agent",
      "assistant_deputy",
      "employee",
    ]);
    if (!creator) return;
    const body = await readJson(req);
    const sourceAgencyId =
      creator.role === "owner" ? body.sourceAgencyId : creator.agencyId;
    const sourceAgency = db
      .prepare(
        "SELECT id,name FROM agencies WHERE status='active' AND (id=? OR lower(name)=lower(?)) LIMIT 1",
      )
      .get(sourceAgencyId || "", String(body.source || "").trim());
    if (!sourceAgency)
      return json(res, 400, { error: "الوكالة المرسلة غير صحيحة." });
    const destination = db
      .prepare(
        "SELECT id,name FROM agencies WHERE id=? OR lower(name)=lower(?) LIMIT 1",
      )
      .get(
        body.destinationAgencyId || "",
        String(body.destination || "").trim(),
      );
    const amount = Number(body.amount || 0);
    const settlementMethod = body.settlementMethod === "liquidity" ? "liquidity" : "manual";
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (
      !body.receiver ||
      !body.phone ||
      amount <= 0 ||
      !supportedCurrencies.has(body.currency) ||
      idempotencyKey.length < 12
    ) {
      return json(res, 400, { error: "بيانات الحوالة غير مكتملة." });
    }
    const settingsRow = db
      .prepare("SELECT value FROM settings WHERE key='commission_rates'")
      .get();
    const rates = settingsRow ? JSON.parse(settingsRow.value) : {};
    const commission = (amount * Number(rates[body.currency] || 0)) / 100;
    const existingTransfer = db.prepare("SELECT id,transfer_number FROM transfers WHERE idempotency_key=?").get(idempotencyKey);
    if (existingTransfer) return json(res, 200, {
      message: "تم إنشاء هذه الحوالة مسبقاً.", id: existingTransfer.id,
      transferNumber: existingTransfer.transfer_number, duplicate: true,
    });
    if (settlementMethod === "liquidity" && (!destination || destination.id === sourceAgency.id)) {
      return json(res, 400, { error: "الدفع من السيولة يتطلب وكالة استلام مسجّلة ومختلفة." });
    }
    const amountMinor = toMinorUnits(body.amount, body.currency);
    if (!amountMinor) return json(res, 400, { error: "صيغة مبلغ الحوالة غير صحيحة." });
    const id = uniqueId("transfers", "TR");
    let transferNumber;
    do transferNumber = String(crypto.randomInt(100000, 1000000));
    while (
      db
        .prepare("SELECT 1 FROM transfers WHERE transfer_number=?")
        .get(transferNumber)
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
      `INSERT INTO transfers(id,transfer_number,source_agency_id,destination_agency_id,destination_name,created_by,sender_name,receiver_name,receiver_phone,amount,currency,commission,total,status,created_at,delivery_address,notes,settlement_method,idempotency_key)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'قيد الانتظار',?,?,?,?,?)`,
      ).run(
      id,
      transferNumber,
      sourceAgency.id,
      destination?.id || null,
      destination?.name || String(body.destination || "غير محددة").trim(),
      creator.id,
      String(body.sender || "").trim(),
      String(body.receiver).trim(),
      normalizePhone(body.phone),
      amount,
      body.currency,
      commission,
      amount + commission,
      now(),
      String(body.deliveryAddress || "").trim(),
      String(body.notes || "").trim(),
      settlementMethod,
      idempotencyKey,
      );
      if (settlementMethod === "liquidity") {
        ensureBalanceRow(sourceAgency.id, body.currency);
        ensureBalanceRow(destination.id, body.currency);
        const sourceBefore = Number(db.prepare("SELECT balance_minor FROM agency_balances WHERE agency_id=? AND currency=?").get(sourceAgency.id, body.currency).balance_minor);
        const destinationBefore = Number(db.prepare("SELECT balance_minor FROM agency_balances WHERE agency_id=? AND currency=?").get(destination.id, body.currency).balance_minor);
        if (sourceBefore < amountMinor) {
          throw Object.assign(new Error("رصيد السيولة غير كافٍ لإرسال هذه الحوالة."), { statusCode: 409 });
        }
        const sourceAfter = sourceBefore - amountMinor;
        const destinationAfter = destinationBefore + amountMinor;
        if (!Number.isSafeInteger(destinationAfter)) throw new Error("تجاوز الرصيد الحد المسموح.");
        db.prepare("UPDATE agency_balances SET balance_minor=?,updated_at=? WHERE agency_id=? AND currency=?")
          .run(sourceAfter, now(), sourceAgency.id, body.currency);
        db.prepare("UPDATE agency_balances SET balance_minor=?,updated_at=? WHERE agency_id=? AND currency=?")
          .run(destinationAfter, now(), destination.id, body.currency);
        const ledgerInsert = db.prepare(`INSERT INTO liquidity_ledger(id,agency_id,currency,amount_minor,
          balance_before_minor,balance_after_minor,movement_type,transfer_id,counterparty_agency_id,
          idempotency_key,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        ledgerInsert.run(uniqueId("liquidity_ledger", "LIQ"), sourceAgency.id, body.currency,
          -amountMinor, sourceBefore, sourceAfter, "transfer_debit", id, destination.id,
          idempotencyKey + ":debit", "دفع حوالة من رصيد السيولة", creator.id, now());
        ledgerInsert.run(uniqueId("liquidity_ledger", "LIQ"), destination.id, body.currency,
          amountMinor, destinationBefore, destinationAfter, "transfer_credit", id, sourceAgency.id,
          idempotencyKey + ":credit", "استلام حوالة في رصيد السيولة", creator.id, now());
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.statusCode) return json(res, error.statusCode, { error: error.message });
      if (String(error.message).includes("UNIQUE constraint failed")) {
        const repeated = db.prepare("SELECT id,transfer_number FROM transfers WHERE idempotency_key=?").get(idempotencyKey);
        if (repeated) return json(res, 200, { message: "تم إنشاء هذه الحوالة مسبقاً.", id: repeated.id, transferNumber: repeated.transfer_number, duplicate: true });
      }
      throw error;
    }
    audit(creator.id, "إنشاء حوالة", "transfer", id, { transferNumber });
    return json(res, 201, {
      message: "تم إنشاء الحوالة.",
      id,
      transferNumber,
      commission,
      total: amount + commission,
    });
  }

  const sendTransferCode = pathname.match(
    /^\/api\/transfers\/([^/]+)\/send-code$/,
  );
  if (req.method === "POST" && sendTransferCode) {
    const employee = requireRole(req, res, [
      "owner",
      "agent",
      "deputy_agent",
      "assistant_deputy",
      "employee",
    ]);
    if (!employee) return;
    const body = await readJson(req);
    const transfer = db
      .prepare("SELECT * FROM transfers WHERE id=?")
      .get(sendTransferCode[1]);
    if (!transfer)
      return json(res, 404, { error: "الحوالة غير موجودة." });
    if (
      employee.role !== "owner" &&
      transfer.source_agency_id !== employee.agencyId &&
      transfer.destination_agency_id !== employee.agencyId
    ) {
      return json(res, 403, { error: "ليس لديك صلاحية لهذه الحوالة." });
    }
    if (
      normalizePhone(body.recipientPhone) !==
      normalizePhone(transfer.receiver_phone)
    ) {
      return json(res, 400, {
        error: "رقم الهاتف لا يطابق الرقم المسجل بالحوالة.",
      });
    }
    if (!["sms", "whatsapp"].includes(body.channel)) {
      return json(res, 400, { error: "طريقة الإرسال غير صحيحة." });
    }
    const validityRow = db
      .prepare("SELECT value FROM settings WHERE key='sms_validity_hours'")
      .get();
    const validityHours = Math.min(
      168,
      Math.max(1, Number(validityRow ? JSON.parse(validityRow.value) : 24)),
    );
    const code = String(crypto.randomInt(1000, 10000));
    const sentAt = now();
    const expiresAt = new Date(
      Date.now() + validityHours * 60 * 60 * 1000,
    ).toISOString();
    db.prepare(
      "UPDATE transfers SET sms_code=?,sms_sent_at=?,sms_expires_at=?,sms_attempts=0,sms_locked=0,code_channel=? WHERE id=? AND status<>'تم التسليم'",
    ).run(code, sentAt, expiresAt, body.channel, transfer.id);
    audit(
      employee.id,
      body.channel === "whatsapp"
        ? "إرسال كود عبر واتساب"
        : "إرسال كود عبر SMS",
      "transfer",
      transfer.id,
    );
    return json(res, 200, { code, expiresAt, validityHours });
  }

  const deliverTransfer = pathname.match(
    /^\/api\/transfers\/([^/]+)\/deliver$/,
  );
  if (req.method === "POST" && deliverTransfer) {
    const employee = requireRole(req, res, [
      "agent",
      "deputy_agent",
      "assistant_deputy",
      "employee",
    ]);
    if (!employee) return;
    const transfer = db
      .prepare("SELECT * FROM transfers WHERE id=?")
      .get(deliverTransfer[1]);
    if (!transfer) return json(res, 404, { error: "الحوالة غير موجودة." });
    if (
      transfer.destination_agency_id &&
      transfer.destination_agency_id !== employee.agencyId
    ) {
      return json(res, 403, { error: "الحوالة ليست موجّهة إلى وكالتك." });
    }
    const body = await readJson(req);
    if (transfer.status === "تم التسليم")
      return json(res, 409, { error: "تم تسليم الحوالة مسبقاً." });
    if (!transfer.sms_sent_at)
      return json(res, 400, { error: "يجب إرسال كود الاستلام أولاً." });
    if (transfer.sms_locked || Number(transfer.sms_attempts || 0) >= 3)
      return json(res, 423, {
        error: "تم إيقاف التحقق بعد 3 محاولات خاطئة.",
      });
    if (!transfer.sms_expires_at || transfer.sms_expires_at < now())
      return json(res, 410, { error: "انتهت صلاحية كود الاستلام." });
    if (String(body.smsCode || "").trim() !== String(transfer.sms_code)) {
      const attemptsCount = Number(transfer.sms_attempts || 0) + 1;
      const locked = attemptsCount >= 3 ? 1 : 0;
      db.prepare(
        "UPDATE transfers SET sms_attempts=?,sms_locked=? WHERE id=?",
      ).run(attemptsCount, locked, transfer.id);
      audit(employee.id, "محاولة تسليم فاشلة", "transfer", transfer.id, {
        attempts: attemptsCount,
      });
      return json(res, 400, {
        error: locked
          ? "تم إيقاف التحقق بعد 3 محاولات خاطئة."
          : `كود غير صحيح. المحاولات المتبقية: ${3 - attemptsCount}`,
      });
    }
    if (!String(body.recipientId || "").trim())
      return json(res, 400, { error: "أدخل رقم هوية المستلم." });
    db.prepare(
      "UPDATE transfers SET status='تم التسليم',delivered_by=?,delivered_at=?,recipient_id=?,sms_attempts=0 WHERE id=? AND status<>'تم التسليم'",
    ).run(
      employee.id,
      now(),
      String(body.recipientId).trim(),
      transfer.id,
    );
    audit(employee.id, "تسليم حوالة", "transfer", transfer.id);
    return json(res, 200, { message: "تم تسليم الحوالة." });
  }

  return json(res, 404, { error: "المسار غير موجود." });
}

function serveFile(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const roles = rolePages[requested];
  if (roles) {
    const user = currentUser(req);
    if (!user) {
      res.writeHead(302, {
        Location: "/login.html?returnTo=" + encodeURIComponent(requested),
      });
      return res.end();
    }
    if (user.status !== "active" || !roles.includes(user.role)) {
      res.writeHead(302, {
        Location: "/login.html?status=" + encodeURIComponent(user.status),
      });
      return res.end();
    }
  } else if (!publicFiles.has(requested)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const filePath = path.join(root, requested.replace(/^\//, ""));
  if (
    !filePath.startsWith(root) ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type":
      mimeTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'",
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now());
    if (url.pathname.startsWith("/api/"))
      return await handleApi(req, res, url.pathname);
    return serveFile(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "حدث خطأ داخلي في النظام." });
  }
});

const port = Number(process.env.PORT || 8080);
server.listen(port, "0.0.0.0", () => {
  console.log(`ShamLink server running on port ${port}`);
});
