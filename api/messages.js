const { Redis } = require("@upstash/redis");
const { getSession } = require("./_session");
const { getProfile } = require("./_profile");

const redis = Redis.fromEnv();

function clean(str, maxLen) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>]/g, "").trim().slice(0, maxLen);
}

function parseList(list) {
  return (list || [])
    .map((item) => { try { return typeof item === "string" ? JSON.parse(item) : item; } catch (e) { return null; } })
    .filter(Boolean)
    .reverse();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "login_required" });
    return;
  }

  if (req.method === "GET") {
    try {
      const raw = await redis.lrange(`inbox:${session.uid}`, 0, 49);
      await redis.set(`unread:${session.uid}`, 0);
      res.status(200).json({ messages: parseList(raw) });
    } catch (err) {
      res.status(500).json({ error: "server_error" });
    }
    return;
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    const toUid = clean(body.toUid, 60);
    const text = clean(body.text, 300);
    const tradeId = clean(body.tradeId, 40);
    const tradeSummary = clean(body.tradeSummary, 80);

    if (!toUid || !text) {
      res.status(400).json({ error: "invalid_message" });
      return;
    }
    if (toUid === session.uid) {
      res.status(400).json({ error: "cannot_message_self" });
      return;
    }

    try {
      const profile = await getProfile(redis, session.uid);
      const msg = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
        fromUid: session.uid,
        fromName: profile.nickname,
        fromAvatar: profile.avatar,
        tradeId: tradeId || null,
        tradeSummary: tradeSummary || null,
        text,
        ts: Date.now(),
      };
      await redis.rpush(`inbox:${toUid}`, JSON.stringify(msg));
      await redis.ltrim(`inbox:${toUid}`, -50, -1);
      await redis.incr(`unread:${toUid}`);
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "server_error" });
    }
    return;
  }

  res.status(405).json({ error: "method_not_allowed" });
};
