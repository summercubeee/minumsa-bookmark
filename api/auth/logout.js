const { clearSessionCookie } = require("../_session");

module.exports = async (req, res) => {
  clearSessionCookie(res);
  res.writeHead(302, { Location: "/" });
  res.end();
};
