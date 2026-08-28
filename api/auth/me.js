const { getSession } = require("../_session");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSession(req);
  if (!session) {
    res.status(200).json({ loggedIn: false });
    return;
  }
  res.status(200).json({ loggedIn: true, uid: session.uid, name: session.name });
};
