// lib/werewolf-lang.ts
// The table speaks the player's language.
//
// Two things have to follow the locale, and they are easy to confuse:
//   1. the MODERATOR's announcements, which are strings we own, and
//   2. what the MODELS say, which we can only ask for in the prompt.
//
// Both live here so they can never drift apart. The language is sent with
// every request rather than stored on the session — the user's locale is a
// client preference, and sending it per step means switching the site
// language mid-game simply carries the table with it.

export type Lang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'

const NAMES: Record<Lang, string> = {
  en: 'English',
  'zh-Hant': 'Traditional Chinese (繁體中文)',
  'zh-Hans': 'Simplified Chinese (简体中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
}

export const langName = (l: Lang) => NAMES[l] ?? NAMES.en

/**
 * The instruction that actually decides what language a game is played in.
 * Without it every game opens in English, because on turn one nobody has
 * spoken yet and "use the language the others are using" has nothing to
 * point at — which also made watch-only games English no matter what.
 */
export function languageRule(l: Lang): string {
  const n = langName(l)
  return l === 'en'
    ? 'Speak in English.'
    : `This table plays in ${n}. Write everything you say aloud in ${n} — natural, conversational ${n}, not translated English. Your private "reasoning" may be in any language you think best in.`
}

type Keys = {
  night: (d: number) => string
  dawnDead: (name: string) => string
  dawnQuiet: string
  day: (d: number, names: string) => string
  seerResult: (name: string, isWolf: boolean) => string
  votes: (summary: string, out: string, role: string) => string
  votesTied: (summary: string) => string
  wolvesWin: string
  villageWin: string
  packKills: (name: string) => string
  protects: (name: string) => string
  noReply: (name: string, target: string) => string
  abstain: (name: string, reason: string) => string
  role: Record<'wolf' | 'seer' | 'doctor' | 'villager', string>
}

const EN: Keys = {
  night: d => `Night ${d}. Everyone closes their eyes.`,
  dawnDead: n => `Morning. ${n} was found dead.`,
  dawnQuiet: 'Morning. Nobody died last night.',
  day: (d, names) => `Day ${d}. ${names} are alive. Discuss.`,
  seerResult: (n, w) => `You investigated ${n}. ${n} is ${w ? 'a WEREWOLF' : 'not a werewolf'}.`,
  votes: (s, out, role) => `Votes — ${s}. ${out} is eliminated and was ${role}.`,
  votesTied: s => `Votes — ${s}. Tied, nobody is eliminated.`,
  wolvesWin: '🐺 The wolves win.',
  villageWin: '🧑‍🌾 The village wins.',
  packKills: n => `The pack kills ${n}.`,
  protects: n => `Protects ${n}.`,
  noReply: (n, t) => `⚠ ${n} did not answer; the moderator chose ${t}.`,
  abstain: (n, why) => `⚠ ${n} did not answer (${why}) — sits this round out.`,
  role: { wolf: 'a Werewolf', seer: 'the Seer', doctor: 'the Doctor', villager: 'a Villager' },
}

const ZH_HANT: Keys = {
  night: d => `第 ${d} 夜。所有人請閉眼。`,
  dawnDead: n => `天亮了。${n} 昨晚死亡。`,
  dawnQuiet: '天亮了。昨晚是平安夜。',
  day: (d, names) => `第 ${d} 天。存活：${names}。開始討論。`,
  seerResult: (n, w) => `你查驗了 ${n}。${n} ${w ? '是狼人' : '不是狼人'}。`,
  votes: (s, out, role) => `票數 — ${s}。${out} 被投票出局，身分是${role}。`,
  votesTied: s => `票數 — ${s}。平票，無人出局。`,
  wolvesWin: '🐺 狼人陣營獲勝。',
  villageWin: '🧑‍🌾 好人陣營獲勝。',
  packKills: n => `狼群決定殺 ${n}。`,
  protects: n => `保護 ${n}。`,
  noReply: (n, t) => `⚠ ${n} 沒有回應，由法官代為選擇 ${t}。`,
  abstain: (n, why) => `⚠ ${n} 沒有回應（${why}）— 本回合棄權。`,
  role: { wolf: '狼人', seer: '預言家', doctor: '醫生', villager: '平民' },
}

const ZH_HANS: Keys = {
  ...ZH_HANT,
  night: d => `第 ${d} 夜。所有人请闭眼。`,
  dawnDead: n => `天亮了。${n} 昨晚死亡。`,
  dawnQuiet: '天亮了。昨晚是平安夜。',
  day: (d, names) => `第 ${d} 天。存活：${names}。开始讨论。`,
  seerResult: (n, w) => `你查验了 ${n}。${n} ${w ? '是狼人' : '不是狼人'}。`,
  votes: (s, out, role) => `票数 — ${s}。${out} 被投票出局，身分是${role}。`,
  votesTied: s => `票数 — ${s}。平票，无人出局。`,
  wolvesWin: '🐺 狼人阵营获胜。',
  villageWin: '🧑‍🌾 好人阵营获胜。',
  packKills: n => `狼群决定杀 ${n}。`,
  protects: n => `保护 ${n}。`,
  noReply: (n, t) => `⚠ ${n} 没有回应，由法官代为选择 ${t}。`,
  abstain: (n, why) => `⚠ ${n} 没有回应（${why}）— 本回合弃权。`,
  role: { wolf: '狼人', seer: '预言家', doctor: '医生', villager: '平民' },
}

const JA: Keys = {
  night: d => `${d} 日目の夜。全員、目を閉じてください。`,
  dawnDead: n => `朝になりました。${n} が死亡しています。`,
  dawnQuiet: '朝になりました。昨夜の犠牲者はいません。',
  day: (d, names) => `${d} 日目。生存者：${names}。議論を始めてください。`,
  seerResult: (n, w) => `${n} を占いました。${n} は${w ? '人狼です' : '人狼ではありません'}。`,
  votes: (s, out, role) => `投票 — ${s}。${out} が追放されました。正体は${role}。`,
  votesTied: s => `投票 — ${s}。同数のため、追放はありません。`,
  wolvesWin: '🐺 人狼陣営の勝利。',
  villageWin: '🧑‍🌾 村人陣営の勝利。',
  packKills: n => `人狼は ${n} を襲撃します。`,
  protects: n => `${n} を守ります。`,
  noReply: (n, t) => `⚠ ${n} が応答しなかったため、進行役が ${t} を選びました。`,
  abstain: (n, why) => `⚠ ${n} が応答しませんでした（${why}）— このラウンドは棄権です。`,
  role: { wolf: '人狼', seer: '占い師', doctor: '医者', villager: '村人' },
}

const KO: Keys = {
  night: d => `${d}일째 밤. 모두 눈을 감아 주세요.`,
  dawnDead: n => `아침이 밝았습니다. ${n} 님이 사망했습니다.`,
  dawnQuiet: '아침이 밝았습니다. 어젯밤 희생자는 없습니다.',
  day: (d, names) => `${d}일째 낮. 생존자: ${names}. 토론을 시작하세요.`,
  seerResult: (n, w) => `${n} 님을 확인했습니다. ${n} 님은 ${w ? '늑대인간입니다' : '늑대인간이 아닙니다'}.`,
  votes: (s, out, role) => `투표 — ${s}. ${out} 님이 처형되었고 정체는 ${role}였습니다.`,
  votesTied: s => `투표 — ${s}. 동점이라 아무도 처형되지 않았습니다.`,
  wolvesWin: '🐺 늑대인간 진영 승리.',
  villageWin: '🧑‍🌾 마을 진영 승리.',
  packKills: n => `늑대들이 ${n} 님을 지목했습니다.`,
  protects: n => `${n} 님을 보호합니다.`,
  noReply: (n, t) => `⚠ ${n} 님이 응답하지 않아 진행자가 ${t} 님을 선택했습니다.`,
  abstain: (n, why) => `⚠ ${n} 님이 응답하지 않아서(${why}) 이번 라운드는 기권합니다.`,
  role: { wolf: '늑대인간', seer: '예언자', doctor: '의사', villager: '마을 주민' },
}

const TABLE: Record<Lang, Keys> = { en: EN, 'zh-Hant': ZH_HANT, 'zh-Hans': ZH_HANS, ja: JA, ko: KO }

export const M = (l: unknown): Keys => TABLE[(l as Lang)] ?? EN
