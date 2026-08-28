const crypto = require("crypto");

module.exports = async (req, res) => {
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https");
  const redirectUri = `${proto}://${host}/api/auth/callback`;

  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `mb_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`
  );

  const params = new URLSearchParams({
    client_id: process.env.KAKAO_REST_API_KEY,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  res.writeHead(302, { Location: `https://kauth.kakao.com/oauth/authorize?${params.toString()}` });
  res.end();
};
