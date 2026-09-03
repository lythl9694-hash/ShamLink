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
    role TEXT NOT NULL CHECK (role IN ('owner','agent','employee','client')),
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
  CREATE INDEX IF NOT EXISTS idx_users_status_role ON users(status, role);
  CREATE INDEX IF NOT EXISTS idx_users_agency ON users(agency_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

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
  "/agent-dashboard.html": ["owner", "agent"],
  "/transfers.html": ["owner", "agent", "employee"],
  "/dashboard.js": ["owner", "agent"],
  "/admin-accounts.js": ["owner", "agent"],
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

function now() {
  return new Date().toISOString();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9+]/g, "");
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
        `SELECT u.id,u.name,u.phone,u.role,u.status,u.agency_id AS agencyId
                FROM sessions s JOIN users u ON u.id=s.user_id
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
    const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
    return json(res, 201, {
      code,
      expiresAt,
      url: `${origin}/register.html?invite=${encodeURIComponent(code)}`,
    });
  }

  if (req.method === "GET" && pathname === "/api/agent/employees") {
    const agent = requireRole(req, res, ["agent"]);
    if (!agent) return;
    const employees = db
      .prepare(
        "SELECT id,name,phone,status,created_at AS createdAt FROM users WHERE role='employee' AND agency_id=? ORDER BY created_at DESC",
      )
      .all(agent.agencyId);
    return json(res, 200, { employees });
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
    "Cache-Control": requested.endsWith(".html")
      ? "no-store"
      : "public, max-age=300",
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
