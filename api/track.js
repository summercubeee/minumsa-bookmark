const { getTrackRedis } = require("./_trackRedis");

// 써머 대시보드(summer-dashboard)가 여러 사이트의 Redis 키를 한 인스턴스에서 구분하도록
// 사이트별 네임스페이스를 둔다. summer-dashboard의 lib/sites.ts에 등록한 id와 같아야 한다.
const SITE_ID = process.env.SITE_ID || "minumsa-bookmark";
const RETENTION_SECONDS = 60 * 60 * 24 * 120; // 120일 보관 후 자동 만료

function str(v, max) {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
}

function classifyChannel(referrer, utmSource) {
  if (utmSource) return utmSource.toLowerCase();
  if (!referrer) return "direct";
  try {
    const u = new URL(referrer);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname;
    if (host.endsWith("naver.com")) {
      if (host === "search.naver.com" || path.startsWith("/search")) return "naver_search";
      if (host === "blog.naver.com") return "naver_blog";
      if (host === "cafe.naver.com") return "naver_cafe";
      return "naver_other";
    }
    if (host.includes("google.")) return "google_search";
    if (host.endsWith("daum.net")) return "daum_search";
    if (host.endsWith("dcinside.com")) return "dcinside";
    if (host.endsWith("kakaocorp.com") || host === "kakao.com") return "kakao";
    if (host.endsWith("instagram.com")) return "instagram";
    if (host.endsWith("threads.net") || host.endsWith("threads.com")) return "threads";
    return `referral:${host}`;
  } catch (e) {
    return "direct";
  }
}

function kstDate() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  const type = body.type;
  const path = str(body.path, 200);
  const visitorId = str(body.visitorId, 100);

  if ((type !== "pageview" && type !== "click") || !path || !visitorId) {
    res.status(400).json({ ok: false });
    return;
  }

  try {
    const date = kstDate();
    const channel = classifyChannel(str(body.referrer, 500) || "", str(body.utmSource, 100));
    const campaign = str(body.utmCampaign, 100) || "none";
    const redis = getTrackRedis();
    const pipeline = redis.pipeline();
    const ns = `${SITE_ID}:`;

    if (type === "pageview") {
      pipeline.incr(`${ns}pv:${date}`);
      pipeline.sadd(`${ns}uv:${date}`, visitorId);
      pipeline.hincrby(`${ns}channels:${date}`, channel, 1);
      pipeline.hincrby(`${ns}campaigns:${date}`, campaign, 1);
      pipeline.hincrby(`${ns}paths:${date}`, path, 1);
      pipeline.expire(`${ns}pv:${date}`, RETENTION_SECONDS);
      pipeline.expire(`${ns}uv:${date}`, RETENTION_SECONDS);
      pipeline.expire(`${ns}channels:${date}`, RETENTION_SECONDS);
      pipeline.expire(`${ns}campaigns:${date}`, RETENTION_SECONDS);
      pipeline.expire(`${ns}paths:${date}`, RETENTION_SECONDS);
    } else {
      const target = str(body.target, 100) || "unknown";
      pipeline.hincrby(`${ns}cta:${date}`, target, 1);
      pipeline.hincrby(`${ns}cta_channel:${date}`, `${target}|${channel}`, 1);
      pipeline.expire(`${ns}cta:${date}`, RETENTION_SECONDS);
      pipeline.expire(`${ns}cta_channel:${date}`, RETENTION_SECONDS);
    }

    await pipeline.exec();
  } catch (err) {
    // KV 미설정 등으로 실패해도 트래킹 오류가 사이트 이용에 영향을 주면 안 됨
    res.status(200).json({ ok: false });
    return;
  }

  res.status(200).json({ ok: true });
};
