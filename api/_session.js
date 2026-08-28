const crypto = require("crypto");

const SECRET = process.env.SESSION_SECRET;
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30일

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}

function verify(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, sessionObj) {
  const token = sign(Object.assign({}, sessionObj, { exp: Date.now() + MAX_AGE_SEC * 1000 }));
  res.setHeader(
    "Set-Cookie",
    `mb_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "mb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}

function getSession(req) {
  const cookies = parseCookies(req);
  return verify(cookies.mb_session);
}

module.exports = { setSessionCookie, clearSessionCookie, getSession };
