const NICK_WORDS = [
  "책갈피요정", "완독요정", "책벌레", "도서관요정", "페이지요정", "낭독가", "수집가", "서점러",
  "다독가", "북마커", "시집러버", "표지덕후", "완주자", "밑줄러", "필사가", "고전홀릭",
  "문학러버", "책덕후", "글맛집", "챕터헌터",
];

function randomNickname() {
  const word = NICK_WORDS[Math.floor(Math.random() * NICK_WORDS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}${num}`;
}

const AVATAR_COUNT = 30;

async function getProfile(redis, uid) {
  const raw = await redis.hgetall(`profile:${uid}`);
  if (raw && raw.nickname) {
    return { nickname: raw.nickname, avatar: Number(raw.avatar) || 0 };
  }
  const nickname = randomNickname();
  const avatar = Math.floor(Math.random() * AVATAR_COUNT);
  await redis.hset(`profile:${uid}`, { nickname, avatar: String(avatar) });
  return { nickname, avatar };
}

module.exports = { getProfile, randomNickname, AVATAR_COUNT };
