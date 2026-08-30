const { getTrackRedis } = require("./_trackRedis");

const SITE_ID = process.env.SITE_ID || "minumsa-bookmark";

function kstToday() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function enumerateDates(from, to) {
  const dates = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function mergeCounts(target, src) {
  if (!src) return;
  for (const [k, v] of Object.entries(src)) {
    target[k] = (target[k] || 0) + Number(v);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.STATS_SECRET;
  const key = (req.query && req.query.key) || "";
  if (!secret || key !== secret) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const q = req.query || {};
  const days = Number(q.days || "7");
  const to = q.to || kstToday();
  const from = q.from || shiftDate(to, -(days - 1));
  const dates = enumerateDates(from, to);

  const result = {
    range: { from, to },
    days: [],
    totals: { pageviews: 0, uniqueVisitorDaySum: 0, ctaClicks: 0 },
    channels: {},
    campaigns: {},
    paths: {},
    cta: {},
    ctaByChannel: {},
  };

  try {
    const redis = getTrackRedis();
    const ns = `${SITE_ID}:`;

    for (const date of dates) {
      const [pv, uvSet, channels, campaigns, paths, cta, ctaByChannel] = await Promise.all([
        redis.get(`${ns}pv:${date}`),
        redis.smembers(`${ns}uv:${date}`),
        redis.hgetall(`${ns}channels:${date}`),
        redis.hgetall(`${ns}campaigns:${date}`),
        redis.hgetall(`${ns}paths:${date}`),
        redis.hgetall(`${ns}cta:${date}`),
        redis.hgetall(`${ns}cta_channel:${date}`),
      ]);

      const pvNum = pv || 0;
      const uvNum = (uvSet && uvSet.length) || 0;
      const ctaNum = cta ? Object.values(cta).reduce((a, b) => a + Number(b), 0) : 0;

      result.days.push({ date, pageviews: pvNum, uniqueVisitors: uvNum, ctaClicks: ctaNum });
      result.totals.pageviews += pvNum;
      result.totals.uniqueVisitorDaySum += uvNum;
      result.totals.ctaClicks += ctaNum;

      mergeCounts(result.channels, channels);
      mergeCounts(result.campaigns, campaigns);
      mergeCounts(result.paths, paths);
      mergeCounts(result.cta, cta);
      mergeCounts(result.ctaByChannel, ctaByChannel);
    }

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(503).json({ ok: false, error: "kv_unavailable" });
  }
};
