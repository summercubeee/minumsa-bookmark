async function checkRateLimit(redis, key, limit, windowSec) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count <= limit;
}

module.exports = { checkRateLimit };
