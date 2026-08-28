const { Redis } = require("@upstash/redis");
const { getSession } = require("./_session");
const { getProfile, AVATAR_COUNT } = require("./_profile");

const redis = Redis.fromEnv();

const GU_LIST = ["종로구","중구","용산구","성동구","광진구","동대문구","중랑구","성북구","강북구","도봉구",
  "노원구","은평구","서대문구","마포구","양천구","강서구","구로구","금천구","영등포구","동작구",
  "관악구","서초구","강남구","송파구","강동구"];

const CATEGORY_BY_ID = {};
for (let i = 1; i <= 15; i++) CATEGORY_BY_ID[i] = "lit";
for (let i = 16; i <= 20; i++) CATEGORY_BY_ID[i] = "poem";

function clean(str, maxLen) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>]/g, "").trim().slice(0, maxLen);
}

function parseHash(hash) {
  return Object.values(hash || {})
    .map((item) => {
      try { return typeof item === "string" ? JSON.parse(item) : item; } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

async function getLeaderboard() {
  const raw = await redis.zrange("leaderboard", 0, 9, { rev: true, withScores: true });
  const entries = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ uid: raw[i], count: Number(raw[i + 1]) });
  }
  if (entries.length === 0) return [];
  const names = await redis.hmget("user_names", ...entries.map((e) => e.uid));
  const avatars = await redis.hmget("user_avatars", ...entries.map((e) => e.uid));
  return entries.map((e) => ({
    name: (names && names[e.uid]) || "이용자",
    avatar: Number((avatars && avatars[e.uid]) || 0),
    count: e.count,
  }));
}

async function getState(uid) {
  const [checklistRaw, tradesRaw, restocksRaw, owned, leaderboard] = await Promise.all([
    redis.hgetall("checklist"),
    redis.hgetall("trades"),
    redis.hgetall("restocks"),
    uid ? redis.smembers(`owned:${uid}`) : Promise.resolve([]),
    getLeaderboard(),
  ]);

  const checklist = [];
  for (let id = 1; id <= 20; id++) {
    const entry = checklistRaw && checklistRaw[String(id)];
    let title = null, note = null;
    if (entry) {
      try {
        const parsed = typeof entry === "string" ? JSON.parse(entry) : entry;
        title = parsed.title || null;
        note = parsed.note || null;
      } catch (e) { /* ignore malformed */ }
    }
    checklist.push({ id, category: CATEGORY_BY_ID[id], title, note });
  }

  const myOwned = (owned || []).map(Number).filter((n) => Number.isInteger(n));

  return { checklist, trades: parseHash(tradesRaw), restocks: parseHash(restocksRaw), myOwned, leaderboard };
}

async function withMe(state, uid, knownProfile) {
  const [profile, unread] = await Promise.all([
    knownProfile ? Promise.resolve(knownProfile) : getProfile(redis, uid),
    redis.get(`unread:${uid}`).catch(() => 0),
  ]);
  state.me = { uid, name: profile.nickname, avatar: profile.avatar, avatarCount: AVATAR_COUNT, unread: Number(unread) || 0 };
  return state;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    try {
      const session = getSession(req);
      const state = await getState(session && session.uid);
      if (session) {
        await withMe(state, session.uid);
      } else {
        state.me = null;
      }
      res.status(200).json(state);
    } catch (err) {
      res.status(500).json({ error: "server_error" });
    }
    return;
  }

  if (req.method === "POST") {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "login_required" });
      return;
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};
    const type = body.type;

    try {
      const profile = await getProfile(redis, session.uid);

      if (type === "identify") {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id < 1 || id > 20) {
          res.status(400).json({ error: "invalid_id" });
          return;
        }
        const title = clean(body.title, 60);
        const note = clean(body.note, 80);
        if (!title) {
          res.status(400).json({ error: "title_required" });
          return;
        }
        await redis.hset("checklist", {
          [String(id)]: JSON.stringify({ title, note: note || null, byUid: session.uid, byName: profile.nickname }),
        });
      } else if (type === "trade") {
        const have = clean(body.have, 60);
        const want = clean(body.want, 60);
        const gu = clean(body.gu, 10);
        const note = clean(body.note, 80);
        if (!have || !want || !GU_LIST.includes(gu)) {
          res.status(400).json({ error: "invalid_trade" });
          return;
        }
        const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
        const entry = {
          id, have, want, gu, note: note || null, ts: Date.now(),
          authorUid: session.uid, authorName: profile.nickname, authorAvatar: profile.avatar,
        };
        await redis.hset("trades", { [id]: JSON.stringify(entry) });
      } else if (type === "restock") {
        const gu = clean(body.gu, 10);
        const time = clean(body.time, 30);
        const note = clean(body.note, 80);
        if (!time || !GU_LIST.includes(gu)) {
          res.status(400).json({ error: "invalid_restock" });
          return;
        }
        const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
        const entry = {
          id, gu, time, note: note || null, ts: Date.now(),
          authorUid: session.uid, authorName: profile.nickname, authorAvatar: profile.avatar,
        };
        await redis.hset("restocks", { [id]: JSON.stringify(entry) });
      } else if (type === "delete_trade" || type === "delete_restock") {
        const key = type === "delete_trade" ? "trades" : "restocks";
        const id = clean(body.id, 40);
        if (!id) { res.status(400).json({ error: "invalid_id" }); return; }
        const raw = await redis.hget(key, id);
        if (!raw) { res.status(404).json({ error: "not_found" }); return; }
        const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (entry.authorUid !== session.uid) {
          res.status(403).json({ error: "not_owner" });
          return;
        }
        await redis.hdel(key, id);
      } else if (type === "toggle_own") {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id < 1 || id > 20) {
          res.status(400).json({ error: "invalid_id" });
          return;
        }
        const key = `owned:${session.uid}`;
        const isOwned = await redis.sismember(key, id);
        if (isOwned) {
          await redis.srem(key, id);
        } else {
          await redis.sadd(key, id);
        }
        const newCount = await redis.scard(key);
        await Promise.all([
          redis.zadd("leaderboard", { score: newCount, member: session.uid }),
          redis.hset("user_names", { [session.uid]: profile.nickname }),
          redis.hset("user_avatars", { [session.uid]: String(profile.avatar) }),
        ]);
      } else if (type === "set_nickname") {
        const nickname = clean(body.nickname, 20);
        if (!nickname || nickname.length < 2) {
          res.status(400).json({ error: "invalid_nickname" });
          return;
        }
        await redis.hset(`profile:${session.uid}`, { nickname });
        await redis.hset("user_names", { [session.uid]: nickname });
      } else if (type === "set_avatar") {
        const avatar = Number(body.avatar);
        if (!Number.isInteger(avatar) || avatar < 0 || avatar >= AVATAR_COUNT) {
          res.status(400).json({ error: "invalid_avatar" });
          return;
        }
        await redis.hset(`profile:${session.uid}`, { avatar: String(avatar) });
        await redis.hset("user_avatars", { [session.uid]: String(avatar) });
      } else {
        res.status(400).json({ error: "unknown_type" });
        return;
      }

      const profileChanged = type === "set_nickname" || type === "set_avatar";
      const state = await getState(session.uid);
      await withMe(state, session.uid, profileChanged ? null : profile);
      res.status(200).json(state);
    } catch (err) {
      res.status(500).json({ error: "server_error" });
    }
    return;
  }

  res.status(405).json({ error: "method_not_allowed" });
};
