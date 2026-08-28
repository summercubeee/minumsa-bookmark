const { setSessionCookie } = require("../_session");

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

module.exports = async (req, res) => {
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https");
  const redirectUri = `${proto}://${host}/api/auth/callback`;

  const url = new URL(req.url, `${proto}://${host}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(req);

  if (!code || !state || state !== cookies.mb_oauth_state) {
    res.writeHead(302, { Location: "/?login=failed" });
    res.end();
    return;
  }

  try {
    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.KAKAO_REST_API_KEY,
        client_secret: process.env.KAKAO_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("no_access_token");

    const profileRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    const nickname =
      (profile.kakao_account && profile.kakao_account.profile && profile.kakao_account.profile.nickname) ||
      "이용자";

    setSessionCookie(res, { uid: String(profile.id), name: nickname });
    res.setHeader("Set-Cookie", [
      res.getHeader("Set-Cookie"),
      "mb_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    ].flat());
    res.writeHead(302, { Location: "/" });
    res.end();
  } catch (err) {
    res.writeHead(302, { Location: "/?login=failed" });
    res.end();
  }
};
