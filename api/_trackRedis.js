const { Redis } = require("@upstash/redis");

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

const client = url && token ? new Redis({ url, token }) : null;

function getTrackRedis() {
  if (!client) {
    throw new Error(
      "KV_REST_API_URL/KV_REST_API_TOKEN not set — connect the shared 써머 대시보드 Upstash resource to this Vercel project."
    );
  }
  return client;
}

module.exports = { getTrackRedis };
