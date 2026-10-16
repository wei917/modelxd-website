// app/xsports/copy.ts — the XSports page's words, per site language.

export interface Copy {
  eyebrow: string
  title: string
  sub: string
  live: string
  final: string
  noGames: string
  loading: string
  feedDown: string
  back: string
  /** Phones: the one-line score that brings back the score header and the bars. */
  showHeader: string
  placeholder: string
  send: string
  spent: string
  idle: string
  noCredits: string
  topUp: string
  failed: string
  signIn: string
  change: string
  firstPitch: (t: string) => string
  you: string
  dataNote: string
  prevDay: string
  nextDay: string
  today: string
  tabChat: string
  tabBox: string
  half: (inning: number, top: boolean) => string
  batting: (team: string) => string
  halfSum: (team: string, runs: number, hits: number) => string
  pitchesN: (n: number) => string
  todayLine: (line: string) => string
  pitcherLbl: string
  batterLbl: string
  batters: string
  pitchersLbl: string
  notes: string
  bullpen: string
  /** Shown beside MLB's win probability bar. */
  winProb: string
  /** Beside the prediction market's bar. */
  market: string
  poly: string
  /** NBA: a period's name ("Q1", "第 1 節", "OT"). */
  period: (n: number) => string
  /** NBA: the score when a period ends. */
  periodSum: (label: string, away: string, a: number, home: string, h: number) => string
  winProbEspn: string
  /** A sportsbook's line: "DraftKings line". */
  lineLbl: (provider: string) => string
  total: (n: number) => string
  /** The page's title: the product's name, as the left nav says it. */
  brand: string
  /** Under the name on the scores page (design 02, Oct 13). */
  /** A game that has not begun, on its card. */
  notStarted: string
  /** The room's left side (Oct 13, the approved split room): the plays as
   *  they happen, and the clips the leagues publish of them. */
  tabFeed: string
  clipsFilter: string
  newClips: (n: number) => string
  newPlays: (n: number) => string
  playClip: string
  backToFeed: string
  watchOriginal: string
  moreClips: string
  gameClips: string
  noClips: string
  clipsLoading: string
  clipsDown: string
  clipsRegion: (n: number) => string
  clipsRegionAll: (n: number) => string
  clipNoEmbed: string
  clipBadge: string
  aiCommentator: string
  /** 晴晴, the room's AI cheerleader (Oct 15): her tag, and what she is. */
  cheerTag: string
  cheerRole: string
  // An admin's asks of 晴晴, in her card (Oct 16).
  askHer: string
  actDance: string
  actSelfie: string
  actCheer: string
  actShout: string
  shoutName: string
  shoutDraw: string
  shoutDrawing: string
  shoutRedo: string
  shoutPost: string
  cheerAsked: string
  cheerActFailed: string
  cheerNameRefused: string
  /** The @AI row of the public chat's @ list: whichever commentator is up. */
  aiAny: string
  /** The private AI chat's tab (owner, Oct 13: "we need a private chat room
   *  with AI"), what it is, and the top bar's name for the leagues row. */
  tabPrivate: string
  privateEmpty: string
  leaguesNav: string
  /** XSports settings (the top bar's gear) and hiding people in the chats. */
  settings: string
  settingsTitle: string
  yourName: string
  editName: string
  nameSync: string
  showAi: string
  showAiHint: string
  hiddenList: string
  hiddenEmpty: string
  hiddenNote: string
  unhide: string
  hidePerson: string
  hideAi: (handle: string) => string
  hideAllAi: string
  reportThis: string
  hiddenFlash: (name: string) => string
  undo: string
  /** The private chat's head (Oct 13 redesign): the models that answer
   *  (several may), automatic watching, what it costs. */
  privateTitle: string
  privateOnly: string
  modelsLabel: string
  addModel: string
  removeModel: (name: string) => string
  maxModels: (max: number) => string
  pickerDone: string
  pickerCount: (n: number, max: number) => string
  watchStart: string
  watchPause: string
  watchOn: string
  watchOff: string
  answering: string
  waitingTurn: string
  askCost: (x: string) => string
  watchCost: (x: string) => string
  rotateNote: string
  /** Questions that only fill the composer (never sent by themselves). */
  prompts: string[]
  /** Asking one model (a chip, 回覆, or @), and how much they talk. */
  askOnly: (names: string) => string
  askAll: string
  reply: string
  /** One model's settings (owner, Oct 13: "each model should have
   *  config"): how much it talks while watching, how hard it thinks. */
  settingsOf: (name: string) => string
  closeLabel: string
  talkLabel: string
  talk: Record<'off' | 'low' | 'mid' | 'high', string>
  talkHint: Record<'off' | 'low' | 'mid' | 'high', string>
  thinkLabel: string
  thinkFast: string
  thinkHint: string
  quietModel: (name: string) => string
  lastWatcher: string
  /** The tag before the commentator's model name in the chat. */
  commentator: string
  roomPlaceholder: string
  /** The box in another language's room (X體育設定): which one. */
  roomPlaceholderIn: (name: string) => string
  /** X體育設定: the chat's language (Oct 15). */
  roomLangTitle: string
  roomLangHint: string
  /** The AI 球友 tab before a conversation starts. */
  buddyEmpty: string
  all: string
  tabBuddy: string
  tabPlays: string
  tabOdds: string
  outsN: (n: number) => string
  modelOf: (league: string) => string
  liveUpdate: string
  traded: (v: string) => string
  pregameLine: (provider: string) => string
  oddsNote: string
  noOdds: string
  /** The 賠率 timeline (OddsChart). */
  trendTitle: string
  rangeGame: string
  rangeAll: string
  trendEmpty: string
  trendNow: string
  noPlays: string
  /** 數據 before the first pitch or tip-off. */
  boxNotStarted: string
  noGamesFor: (league: string) => string
  /** The feed's English series words, in this language ("ALCS Game 2"). */
  series: (s: string) => string
  tabRoom: string
  watching: (n: number) => string
  /** The empty room's hint, with the commentators' @handles (Luna, Qwen). */
  roomHint: (handles: string[]) => string
  roomEmpty: string
  roomDown: string
  /** The chat, going back (Oct 14: "all the way back") and to the newest. */
  loadOlder: string
  chatStart: string
  olderCap: (n: string) => string
  toNewest: string
  signInChat: string
  nameTitle: string
  nameHelp: string
  nameLabel: string
  nameUse: string
  cancel: string
  report: string
  reported: string
  slowDown: string
  refusedMsg: string
  mutedMsg: string
  checkDown: string
  nameError: string
  namePlaceholder: string
  /** AI 私聊: one chat per game, cleared on demand (owner, Oct 14). */
  clearChat: string
  clearTitle: string
  clearBody: string
  clearAction: string
  /** The public chat: taking back your own message (owner, Oct 14). */
  deleteMsg: string
  deleteTitle: string
  deleteBody: string
  deleteAction: string
  /** The report dialog (owner, Oct 14: "fill more data? why 檢舉"). */
  reportTitle: string
  reportAiTitle: string
  reportWhy: string
  reasons: Record<'spam' | 'harassment' | 'hate' | 'sexual' | 'misinfo' | 'wrong' | 'clueless' | 'inappropriate' | 'other', string>
  reportDetails: string
  reportDetailsPh: string
  reportSend: string
  reportNote: string
  reportThanks: string
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

const en: Copy = {
  eyebrow: 'XSports · MLB live',
  title: 'Watch the game with an AI that talks.',
  sub: 'Pick a game. Your buddy follows every pitch from the live feed, speaks up on its own, and you can talk about anything. Each remark is billed at the model\'s list price.',
  live: 'LIVE',
  final: 'Final',
  noGames: 'No MLB games on this day.',
  loading: 'Loading…',
  feedDown: 'The game feed is not answering. Trying again…',
  back: 'All games',
  showHeader: 'Show the score and menus',
  placeholder: 'Say anything…',
  send: 'Send',
  spent: 'Spent',
  idle: 'Watching paused: 20 minutes without a word from you, so nothing is spent while you are away.',
  noCredits: 'Out of credits, so the AI stopped.',
  topUp: 'Top up',
  failed: 'Could not answer',
  signIn: 'Sign in to start',
  change: 'Change',
  firstPitch: t => `First pitch ${t}`,
  you: 'You',
  dataNote: 'Game data from MLB and ESPN. Odds from Kalshi, Polymarket and DraftKings (via ESPN).',
  prevDay: 'Previous day',
  nextDay: 'Next day',
  today: 'Today',
  tabChat: 'Public chat',
  tabBox: 'Box score',
  half: (n, top) => `${top ? 'Top' : 'Bottom'} ${ordinal(n)}`,
  batting: t => `${t} batting`,
  halfSum: (t, r, h) => `${t}: ${r} ${r === 1 ? 'run' : 'runs'}, ${h} ${h === 1 ? 'hit' : 'hits'}`,
  pitchesN: n => `${n} pitches`,
  todayLine: l => `today ${l}`,
  pitcherLbl: 'Pitching',
  batterLbl: 'At bat',
  batters: 'Batters',
  pitchersLbl: 'Pitchers',
  notes: 'Notes',
  bullpen: 'Bullpen not used yet',
  winProb: 'Win probability (MLB)',
  market: 'Market (Kalshi)',
  poly: 'Polymarket',
  period: n => (n > 4 ? (n === 5 ? 'OT' : `OT${n - 4}`) : `Q${n}`),
  periodSum: (l, a, x, h, y) => `${l} ends: ${a} ${x}, ${h} ${y}`,
  winProbEspn: 'Win probability (ESPN)',
  lineLbl: p => `${p} line`,
  total: n => `total ${n}`,
  brand: 'XSports',
  notStarted: 'Not started',
  tabFeed: 'Game feed',
  clipsFilter: 'Highlights',
  newClips: n => `${n} new highlight${n === 1 ? '' : 's'}`,
  newPlays: n => `${n} new play${n === 1 ? '' : 's'}`,
  playClip: 'Play highlight',
  backToFeed: 'Back to the feed',
  watchOriginal: 'Watch on the source',
  moreClips: 'More highlights',
  gameClips: 'Game highlights',
  noClips: 'No highlights for this game yet. They appear here as the leagues publish them.',
  clipsLoading: 'Looking for highlights…',
  clipsDown: 'The highlight sources are not answering right now.',
  clipsRegion: n => `${n} more clip${n === 1 ? '' : 's'} can't be played in your region.`,
  clipsRegionAll: n => `This game's ${n} clip${n === 1 ? '' : 's'} can't be played in your region.`,
  clipNoEmbed: 'This clip plays only on its own site.',
  clipBadge: 'Highlight',
  aiCommentator: 'AI commentator',
  cheerTag: 'Cheerleader',
  cheerRole: 'AI cheerleader',
  askHer: 'Ask 晴晴 (only admins see this)',
  actDance: 'Dance',
  actSelfie: 'Take a selfie',
  actCheer: 'Post a cheer clip',
  actShout: 'Cheer someone on',
  shoutName: 'Name in the bubble',
  shoutDraw: 'Draw it',
  shoutDrawing: 'Drawing… about a minute',
  shoutRedo: 'Draw again',
  shoutPost: 'Post it',
  cheerAsked: '晴晴 is on it: her post appears in a moment',
  cheerActFailed: "That didn't work. Try again.",
  cheerNameRefused: "That name can't go in her bubble. Try another.",
  aiAny: 'Whichever commentator is up',
  tabPrivate: 'My AI',
  privateEmpty: 'Every model you picked answers a question; tap a model, press Reply on its answer or @ it to ask just that one. Press “Start watching” and they talk through the game, each as much as its settings say. Billed at each model’s list price.',
  leaguesNav: 'Leagues',
  settings: 'Settings',
  settingsTitle: 'XSports settings',
  yourName: 'Your name',
  editName: 'Change name',
  nameSync: 'Your name here is your profile\'s display name: change it once and it changes everywhere (messages already sent keep the old one).',
  showAi: 'Show the AI commentators',
  showAiHint: 'Off: no AI commentator messages in any chat room.',
  hiddenList: 'Hidden',
  hiddenEmpty: 'Tap a name in a chat room to hide that person.',
  hiddenNote: 'Kept in this browser only, for 30 days.',
  unhide: 'Show again',
  hidePerson: 'Hide this person',
  hideAi: h => `Hide ${h}`,
  hideAllAi: 'Hide all AI commentators',
  reportThis: 'Report this message',
  hiddenFlash: n => `${n} hidden`,
  undo: 'Undo',
  privateTitle: 'Your private AI watch party',
  privateOnly: 'Only you can see this',
  modelsLabel: 'Models that answer',
  addModel: 'Add model',
  removeModel: name => `Remove ${name}`,
  maxModels: max => `Up to ${max} models`,
  pickerDone: 'Done',
  pickerCount: (n, max) => `${n} of ${max} selected`,
  watchStart: 'Start watching',
  watchPause: 'Pause',
  watchOn: 'Watching',
  watchOff: 'Paused',
  answering: 'Answering…',
  waitingTurn: 'Waiting',
  askCost: x => `≈ ${x} per question`,
  watchCost: x => `watching ≈ ${x}/hour`,
  rotateNote: 'While watching, each model talks as much as its settings say; each remark is billed at its model’s list price.',
  prompts: ['How is the game going?', 'Who has played best so far?', 'What should I watch for next?'],
  askOnly: names => `Only ${names}`,
  askAll: 'Ask all models',
  reply: 'Reply',
  settingsOf: name => `${name} settings`,
  closeLabel: 'Close',
  talkLabel: 'While watching',
  talk: { off: 'Off', low: 'Quiet', mid: 'Normal', high: 'Chatty' },
  talkHint: { off: 'Answers only when asked', low: 'Only big moments: scores, the end of an inning or quarter, the final', mid: 'Big moments and regular plays, now and then in quiet stretches', high: 'Most plays, and often in quiet stretches' },
  thinkLabel: 'Thinking',
  thinkFast: 'Fast',
  thinkHint: 'Deeper thinking answers slower and costs more (the estimate leaves the thinking out).',
  quietModel: name => `${name}: answers only when asked`,
  lastWatcher: 'At least one model keeps watching',
  commentator: 'Commentator',
  roomPlaceholder: 'Comment, or ask the commentator with @AI',
  roomPlaceholderIn: n => `Comment in the ${n} chat, or ask @AI`,
  roomLangTitle: 'Chat language',
  roomLangHint: 'Each language has its own chat, and the AI commentators speak it. Saved in this browser only.',
  buddyEmpty: 'This is your own AI buddy. Press Start and it talks through the game on its own; ask it anything at any time. Each remark is billed at the price of the model you pick.',
  all: 'All',
  tabBuddy: 'AI buddy',
  tabPlays: 'Play-by-play',
  tabOdds: 'Odds',
  outsN: n => `${n} out`,
  modelOf: l => (l === 'nba' ? 'ESPN win model' : 'MLB win model'),
  liveUpdate: 'Live',
  traded: v => `${v} traded`,
  pregameLine: p => `${p} line, before the game`,
  oddsNote: 'For information only. ModelXD does not take bets.',
  noOdds: 'No odds for this game yet.',
  trendTitle: 'Over time',
  rangeGame: 'This game',
  rangeAll: 'Since open',
  trendEmpty: 'No history for this game yet.',
  trendNow: 'Now',
  noPlays: 'No plays yet.',
  boxNotStarted: 'The game hasn\'t started yet. Both teams\' numbers show here once it does.',
  noGamesFor: l => `No ${l} games on this day.`,
  series: (s: string) => {
    const m = /^(ALCS|NLCS|ALDS|NLDS|ALWC|NLWC|World Series|Wild Card)\D*(\d+)?/i.exec(s)
    if (/^preseason$/i.test(s)) return 'Preseason'
    if (m) { const n = ({} as Record<string, string>)[m[1].toUpperCase()] ?? m[1]; return m[2] ? ((n: string, g: string) => `${n} Game ${g}`)(n, m[2]) : n }
    const lead = /^(\w+) leads (\d+-\d+)$/i.exec(s); if (lead) return ((t: string, x: string) => `${t} leads ${x}`)(lead[1], lead[2])
    const tied = /^series tied (\d+-\d+)$/i.exec(s); if (tied) return ((x: string) => `Series tied ${x}`)(tied[1])
    const won = /^(\w+) wins? (\d+-\d+)$/i.exec(s); if (won) return ((t: string, x: string) => `${t} wins ${x}`)(won[1], won[2])
    return s
  },
  tabRoom: 'Live chat',
  watching: n => `${n} watching`,
  roomHint: h => `Type @AI to ask whichever commentator is up, or ${h.map(x => `@${x}`).join(' or ')} to ask that one.`,
  roomEmpty: 'No one has said anything yet. Say hi.',
  roomDown: 'The live chat is not open yet.',
  loadOlder: 'Load earlier messages',
  chatStart: 'This is where the chat began',
  olderCap: n => `Showing the latest ${n} messages`,
  toNewest: 'Newest',
  signInChat: 'Sign in to join the chat',
  nameTitle: 'Your name in live chats',
  nameHelp: 'Everyone in the room sees your name, @ID and picture. The name does not have to be your real one.',
  nameLabel: 'Name',
  nameUse: 'Use this name',
  cancel: 'Cancel',
  report: 'Report',
  reported: 'Reported',
  slowDown: 'Slow down a little: one message every 2 seconds.',
  refusedMsg: 'That message was not sent: it breaks the room rules.',
  mutedMsg: 'You are muted in live chats for now.',
  checkDown: 'Messages cannot be checked right now. Try again in a moment.',
  nameError: 'That name cannot be used. Try another (up to 30 characters).',
  namePlaceholder: 'For example: RaysFan99',
  clearChat: 'Clear chat',
  clearTitle: 'Clear your private chat for this game?',
  clearBody: 'Everything in it is deleted and can’t be brought back. What you spent stays in your credit history.',
  clearAction: 'Clear',
  deleteMsg: 'Delete',
  deleteTitle: 'Delete this message?',
  deleteBody: 'It disappears for everyone and can’t be brought back.',
  deleteAction: 'Delete',
  reportTitle: 'Report this message',
  reportAiTitle: 'Report the AI commentator’s message',
  reportWhy: 'Why are you reporting it?',
  reasons: { spam: 'Spam or ads', harassment: 'Harassment or personal attacks', hate: 'Hate or discrimination', sexual: 'Sexual or violent content', misinfo: 'False or misleading information', wrong: 'Wrong facts about the game or players', clueless: 'Doesn\'t know the game', inappropriate: 'Inappropriate content', other: 'Something else' },
  reportDetails: 'More details (optional)',
  reportDetailsPh: 'For example: what was wrong',
  reportSend: 'Send report',
  reportNote: 'Reports are anonymous. A message with enough reports is hidden.',
  reportThanks: 'Thanks, your report was received.',
}

const zhHant: Copy = {
  eyebrow: 'X體育 · MLB 直播',
  title: '跟會聊天的 AI 球友一起看球',
  sub: '選一場比賽，和其他球迷、AI 球評一起看。比分、文字轉播、賠率和聊天都在裡面。',
  live: '直播中',
  final: '終場',
  noGames: '這天沒有 MLB 比賽。',
  loading: '載入中…',
  feedDown: '比賽資料暫時沒有回應，重試中…',
  back: '所有比賽',
  showHeader: '展開比分與選單',
  placeholder: '想聊什麼都可以…',
  send: '送出',
  spent: '已花費',
  idle: '你 20 分鐘沒說話，陪看先暫停，免得你不在時還在花錢。',
  noCredits: '餘額不足，AI 先停下來了。',
  topUp: '儲值',
  failed: '沒能回答',
  signIn: '登入後開始',
  change: '更換',
  firstPitch: t => `${t} 開打`,
  you: '你',
  dataNote: '比賽資料來自 MLB 與 ESPN；賠率來自 Kalshi、Polymarket 與 DraftKings（經 ESPN）。',
  prevDay: '前一天',
  nextDay: '後一天',
  today: '今天',
  tabChat: '公開聊天室',
  tabBox: '數據',
  half: (n, top) => `${n} 局${top ? '上' : '下'}`,
  batting: t => `${t} 進攻`,
  halfSum: (t, r, h) => `${t} ${r} 分 ${h} 安`,
  pitchesN: n => `${n} 球`,
  todayLine: l => `今天 ${l}`,
  pitcherLbl: '投手',
  batterLbl: '打者',
  batters: '打者',
  pitchersLbl: '投手',
  notes: '備註',
  bullpen: '牛棚還沒上場',
  winProb: '勝率（MLB 模型）',
  market: '市場（Kalshi）',
  poly: 'Polymarket',
  period: n => (n > 4 ? (n === 5 ? '延長賽' : `第 ${n - 4} 次延長`) : `第 ${n} 節`),
  periodSum: (l, a, x, h, y) => `${l}結束 ${a} ${x} : ${y} ${h}`,
  winProbEspn: '勝率（ESPN 模型）',
  lineLbl: p => `${p} 盤口`,
  total: n => `總分 ${n}`,
  brand: 'X體育',
  notStarted: '尚未開始',
  tabFeed: '戰況',
  clipsFilter: '精彩影片',
  newClips: n => `新增 ${n} 則精彩影片`,
  newPlays: n => `有 ${n} 則新戰況`,
  playClip: '播放精彩片段',
  backToFeed: '返回戰況',
  watchOriginal: '觀看原片',
  moreClips: '更多精彩',
  gameClips: '比賽精華',
  noClips: '這場還沒有精彩影片。聯盟發布後會出現在這裡。',
  clipsLoading: '正在找精彩影片…',
  clipsDown: '影片來源暫時沒有回應。',
  clipsRegion: n => `另有 ${n} 段影片無法在你所在的地區播放。`,
  clipsRegionAll: n => `這場的 ${n} 段影片都無法在你所在的地區播放。`,
  clipNoEmbed: '這段影片只能在原網站觀看。',
  clipBadge: '精彩片段',
  aiCommentator: 'AI 球評',
  cheerTag: '啦啦隊',
  cheerRole: 'AI 啦啦隊',
  askHer: '請晴晴…（只有管理員看得到）',
  actDance: '跳舞',
  actSelfie: '自拍',
  actCheer: '應援影片',
  actShout: '幫某人加油',
  shoutName: '要加油的名字',
  shoutDraw: '畫出來',
  shoutDrawing: '畫圖中，約一分鐘…',
  shoutRedo: '重畫',
  shoutPost: '貼出',
  cheerAsked: '晴晴收到了，馬上貼出來',
  cheerActFailed: '沒有成功，請再試一次',
  cheerNameRefused: '這個名字不能放進對話框，換一個試試',
  aiAny: '輪到的球評',
  tabPrivate: 'AI 私聊',
  privateEmpty: '提問時，每個選的模型都會回答；點一下模型、按答案上的「回覆」或 @ 它，就只問它。按「開始陪看」，它們會跟著比賽聊，各說多少在模型的設定裡選。依各模型定價計費。',
  leaguesNav: '聯盟',
  settings: '設定',
  settingsTitle: 'X體育設定',
  yourName: '你的名字',
  editName: '修改名字',
  nameSync: '這就是你個人頁的網站名稱，兩邊同步：改一次，所有地方都會用新名字（已發的訊息維持原本的名字）。',
  showAi: '顯示 AI 球評',
  showAiHint: '關掉後，每個聊天室都看不到 AI 球評的留言。',
  hiddenList: '隱藏名單',
  hiddenEmpty: '點聊天室裡的名字就能隱藏。',
  hiddenNote: '只存在這個瀏覽器，30 天後自動解除。',
  unhide: '取消隱藏',
  hidePerson: '隱藏這個人',
  hideAi: h => `隱藏 ${h}`,
  hideAllAi: '隱藏所有 AI 球評',
  reportThis: '檢舉這則訊息',
  hiddenFlash: n => `已隱藏 ${n}`,
  undo: '復原',
  privateTitle: '你的 AI 私人陪看',
  privateOnly: '只有你看得到',
  modelsLabel: '回答的模型',
  addModel: '加入模型',
  removeModel: name => `移除 ${name}`,
  maxModels: max => `最多 ${max} 個模型`,
  pickerDone: '完成',
  pickerCount: (n, max) => `已選 ${n} / ${max}`,
  watchStart: '開始陪看',
  watchPause: '暫停陪看',
  watchOn: '陪看中',
  watchOff: '已暫停',
  answering: '回覆中…',
  waitingTurn: '等待中',
  askCost: x => `提問約 ${x}/次`,
  watchCost: x => `陪看約 ${x}/小時`,
  rotateNote: '陪看時各模型依自己的設定發言，每句依該模型的定價計費。',
  prompts: ['現在比賽局勢如何？', '目前誰表現最好？', '接下來要注意什麼？'],
  askOnly: names => `只問 ${names}`,
  askAll: '改問全部模型',
  reply: '回覆',
  settingsOf: name => `${name} 設定`,
  closeLabel: '關閉',
  talkLabel: '陪看',
  talk: { off: '關', low: '少說', mid: '一般', high: '多說' },
  talkHint: { off: '只在被問時回答', low: '只在關鍵時刻發言：得分、一局或一節結束、終場', mid: '關鍵時刻和一般進展都會聊，安靜時偶爾開口', high: '幾乎每個進展都聊，安靜時也常開口' },
  thinkLabel: '思考',
  thinkFast: '快',
  thinkHint: '想得越深，回答越慢、越貴（估價不含思考的部分）。',
  quietModel: name => `${name}：只在被問時回答`,
  lastWatcher: '至少留一個模型陪看',
  commentator: '球評',
  roomPlaceholder: '留言，或用 @AI 問球評',
  roomPlaceholderIn: n => `在${n}聊天室留言，或用 @AI 問球評`,
  roomLangTitle: '聊天室語言',
  roomLangHint: '每種語言各有一個聊天室，AI 球評也說那種語言。只存在這個瀏覽器。',
  buddyEmpty: '這是你自己的 AI 球友。按「開始一起看」，它會跟著比賽自己開口聊，你也可以隨時問它任何事。每一句依你選的模型定價計費。',
  all: '全部',
  tabBuddy: 'AI 球友',
  tabPlays: '文字轉播',
  tabOdds: '賠率',
  outsN: n => `${n} 出局`,
  modelOf: l => (l === 'nba' ? 'ESPN 勝率模型' : 'MLB 勝率模型'),
  liveUpdate: '即時',
  traded: v => `成交 ${v}`,
  pregameLine: p => `${p} 賽前盤口`,
  oddsNote: '僅供參考。本站不提供下注。',
  noOdds: '這場還沒有賠率。',
  trendTitle: '走勢',
  rangeGame: '比賽中',
  rangeAll: '開盤以來',
  trendEmpty: '這場還沒有走勢資料。',
  trendNow: '現在',
  noPlays: '還沒有比賽過程。',
  boxNotStarted: '比賽還沒開始，開打後這裡會有兩隊的數據。',
  noGamesFor: l => `這天沒有 ${l} 比賽。`,
  series: (s: string) => {
    const m = /^(ALCS|NLCS|ALDS|NLDS|ALWC|NLWC|World Series|Wild Card)\D*(\d+)?/i.exec(s)
    if (/^preseason$/i.test(s)) return '熱身賽'
    if (m) { const n = ({ ALCS: '美聯冠軍賽', NLCS: '國聯冠軍賽', ALDS: '美聯分區賽', NLDS: '國聯分區賽', ALWC: '美聯外卡賽', NLWC: '國聯外卡賽', 'WORLD SERIES': '世界大賽', 'WILD CARD': '外卡賽' } as Record<string, string>)[m[1].toUpperCase()] ?? m[1]; return m[2] ? ((n: string, g: string) => `${n} 第 ${g} 戰`)(n, m[2]) : n }
    const lead = /^(\w+) leads (\d+-\d+)$/i.exec(s); if (lead) return ((t: string, x: string) => `${t} 系列賽 ${x} 領先`)(lead[1], lead[2])
    const tied = /^series tied (\d+-\d+)$/i.exec(s); if (tied) return ((x: string) => `系列賽 ${x} 平手`)(tied[1])
    const won = /^(\w+) wins? (\d+-\d+)$/i.exec(s); if (won) return ((t: string, x: string) => `${t} ${x} 晉級`)(won[1], won[2])
    return s
  },
  tabRoom: '聊天室',
  watching: n => `${n} 人在看`,
  roomHint: h => `輸入 @AI 可以問輪到的球評，或用 ${h.map(x => `@${x}`).join('、')} 指定一位。`,
  roomEmpty: '還沒有人說話，打個招呼吧。',
  roomDown: '聊天室還沒開放。',
  loadOlder: '載入更早的訊息',
  chatStart: '聊天從這裡開始',
  olderCap: n => `只顯示最近 ${n} 則訊息`,
  toNewest: '回到最新',
  signInChat: '登入後加入聊天',
  nameTitle: '你在聊天室的名字',
  nameHelp: '聊天室裡的人都會看到你的名字、@ID 和照片。名字不必是本名。',
  nameLabel: '名字',
  nameUse: '用這個名字',
  cancel: '取消',
  report: '檢舉',
  reported: '已檢舉',
  slowDown: '慢一點：每 2 秒一則。',
  refusedMsg: '這則訊息沒有送出：違反聊天室規則。',
  mutedMsg: '你目前在聊天室被禁言。',
  checkDown: '現在無法檢查訊息，請稍後再試。',
  nameError: '這個名字不能用，換一個（最多 30 字）。',
  namePlaceholder: '例如：光芒小王子',
  clearChat: '清除對話',
  clearTitle: '清除這場比賽的私聊？',
  clearBody: '裡面的內容都會刪除，無法復原。已花費的金額仍會留在點數紀錄裡。',
  clearAction: '清除',
  deleteMsg: '刪除',
  deleteTitle: '刪除這則留言？',
  deleteBody: '刪除後所有人都看不到，無法復原。',
  deleteAction: '刪除',
  reportTitle: '檢舉這則留言',
  reportAiTitle: '檢舉 AI 球評的留言',
  reportWhy: '為什麼檢舉？',
  reasons: { spam: '洗版或廣告', harassment: '騷擾或人身攻擊', hate: '仇恨或歧視', sexual: '色情或暴力', misinfo: '錯誤或誤導的資訊', wrong: '說錯比賽或球員資訊', clueless: '不懂球', inappropriate: '內容不恰當', other: '其他' },
  reportDetails: '補充說明（選填）',
  reportDetailsPh: '例如：哪裡說錯了',
  reportSend: '送出檢舉',
  reportNote: '檢舉不會讓對方知道是誰。累積足夠檢舉的留言會被隱藏。',
  reportThanks: '已收到檢舉，謝謝。',
}

const zhHans: Copy = {
  eyebrow: 'X体育 · MLB 直播',
  title: '和会聊天的 AI 球友一起看球',
  sub: '选一场比赛，和其他球迷、AI 球评一起看。比分、文字直播、赔率和聊天都在里面。',
  live: '直播中',
  final: '终场',
  noGames: '这天没有 MLB 比赛。',
  loading: '加载中…',
  feedDown: '比赛数据暂时没有响应，重试中…',
  back: '所有比赛',
  showHeader: '展开比分与菜单',
  placeholder: '想聊什么都可以…',
  send: '发送',
  spent: '已花费',
  idle: '你 20 分钟没说话，陪看先暂停，免得你不在时还在花钱。',
  noCredits: '余额不足，AI 先停下来了。',
  topUp: '充值',
  failed: '没能回答',
  signIn: '登录后开始',
  change: '更换',
  firstPitch: t => `${t} 开打`,
  you: '你',
  dataNote: '比赛数据来自 MLB 与 ESPN；赔率来自 Kalshi、Polymarket 与 DraftKings（经 ESPN）。',
  prevDay: '前一天',
  nextDay: '后一天',
  today: '今天',
  tabChat: '公开聊天室',
  tabBox: '数据',
  half: (n, top) => `${n} 局${top ? '上' : '下'}`,
  batting: t => `${t} 进攻`,
  halfSum: (t, r, h) => `${t} ${r} 分 ${h} 安`,
  pitchesN: n => `${n} 球`,
  todayLine: l => `今天 ${l}`,
  pitcherLbl: '投手',
  batterLbl: '打者',
  batters: '打者',
  pitchersLbl: '投手',
  notes: '备注',
  bullpen: '牛棚还没上场',
  winProb: '胜率（MLB 模型）',
  market: '市场（Kalshi）',
  poly: 'Polymarket',
  period: n => (n > 4 ? (n === 5 ? '加时赛' : `第 ${n - 4} 个加时`) : `第 ${n} 节`),
  periodSum: (l, a, x, h, y) => `${l}结束 ${a} ${x} : ${y} ${h}`,
  winProbEspn: '胜率（ESPN 模型）',
  lineLbl: p => `${p} 盘口`,
  total: n => `总分 ${n}`,
  brand: 'X体育',
  notStarted: '尚未开始',
  tabFeed: '战况',
  clipsFilter: '精彩视频',
  newClips: n => `新增 ${n} 则精彩视频`,
  newPlays: n => `有 ${n} 则新战况`,
  playClip: '播放精彩片段',
  backToFeed: '返回战况',
  watchOriginal: '观看原片',
  moreClips: '更多精彩',
  gameClips: '比赛精华',
  noClips: '这场还没有精彩视频。联盟发布后会出现在这里。',
  clipsLoading: '正在找精彩视频…',
  clipsDown: '视频来源暂时没有响应。',
  clipsRegion: n => `另有 ${n} 段视频无法在你所在的地区播放。`,
  clipsRegionAll: n => `这场的 ${n} 段视频都无法在你所在的地区播放。`,
  clipNoEmbed: '这段视频只能在原网站观看。',
  clipBadge: '精彩片段',
  aiCommentator: 'AI 球评',
  cheerTag: '啦啦队',
  cheerRole: 'AI 啦啦队',
  askHer: '请晴晴…（只有管理员看得到）',
  actDance: '跳舞',
  actSelfie: '自拍',
  actCheer: '应援视频',
  actShout: '帮某人加油',
  shoutName: '要加油的名字',
  shoutDraw: '画出来',
  shoutDrawing: '画图中，约一分钟…',
  shoutRedo: '重画',
  shoutPost: '发出',
  cheerAsked: '晴晴收到了，马上发出来',
  cheerActFailed: '没有成功，请再试一次',
  cheerNameRefused: '这个名字不能放进对话框，换一个试试',
  aiAny: '轮到的球评',
  tabPrivate: 'AI 私聊',
  privateEmpty: '提问时，每个选的模型都会回答；点一下模型、按答案上的「回复」或 @ 它，就只问它。按「开始陪看」，它们会跟着比赛聊，各说多少在模型的设置里选。按各模型定价计费。',
  leaguesNav: '联盟',
  settings: '设置',
  settingsTitle: 'X体育设置',
  yourName: '你的名字',
  editName: '修改名字',
  nameSync: '这就是你个人页的网站名称，两边同步：改一次，所有地方都会用新名字（已发的消息保持原来的名字）。',
  showAi: '显示 AI 球评',
  showAiHint: '关掉后，每个聊天室都看不到 AI 球评的留言。',
  hiddenList: '隐藏名单',
  hiddenEmpty: '点聊天室里的名字就能隐藏。',
  hiddenNote: '只存在这个浏览器，30 天后自动解除。',
  unhide: '取消隐藏',
  hidePerson: '隐藏这个人',
  hideAi: h => `隐藏 ${h}`,
  hideAllAi: '隐藏所有 AI 球评',
  reportThis: '举报这条消息',
  hiddenFlash: n => `已隐藏 ${n}`,
  undo: '撤销',
  privateTitle: '你的 AI 私人陪看',
  privateOnly: '只有你看得到',
  modelsLabel: '回答的模型',
  addModel: '加入模型',
  removeModel: name => `移除 ${name}`,
  maxModels: max => `最多 ${max} 个模型`,
  pickerDone: '完成',
  pickerCount: (n, max) => `已选 ${n} / ${max}`,
  watchStart: '开始陪看',
  watchPause: '暂停陪看',
  watchOn: '陪看中',
  watchOff: '已暂停',
  answering: '回复中…',
  waitingTurn: '等待中',
  askCost: x => `提问约 ${x}/次`,
  watchCost: x => `陪看约 ${x}/小时`,
  rotateNote: '陪看时各模型按自己的设置发言，每句按该模型的定价计费。',
  prompts: ['现在比赛局势如何？', '目前谁表现最好？', '接下来要注意什么？'],
  askOnly: names => `只问 ${names}`,
  askAll: '改问全部模型',
  reply: '回复',
  settingsOf: name => `${name} 设置`,
  closeLabel: '关闭',
  talkLabel: '陪看',
  talk: { off: '关', low: '少说', mid: '一般', high: '多说' },
  talkHint: { off: '只在被问时回答', low: '只在关键时刻发言：得分、一局或一节结束、终场', mid: '关键时刻和一般进展都会聊，安静时偶尔开口', high: '几乎每个进展都聊，安静时也常开口' },
  thinkLabel: '思考',
  thinkFast: '快',
  thinkHint: '想得越深，回答越慢、越贵（估价不含思考的部分）。',
  quietModel: name => `${name}：只在被问时回答`,
  lastWatcher: '至少留一个模型陪看',
  commentator: '球评',
  roomPlaceholder: '留言，或用 @AI 问球评',
  roomPlaceholderIn: n => `在${n}聊天室留言，或用 @AI 问球评`,
  roomLangTitle: '聊天室语言',
  roomLangHint: '每种语言各有一个聊天室，AI 球评也说那种语言。只保存在这个浏览器。',
  buddyEmpty: '这是你自己的 AI 球友。按「开始一起看」，它会跟着比赛自己开口聊，你也可以随时问它任何事。每一句按你选的模型定价计费。',
  all: '全部',
  tabBuddy: 'AI 球友',
  tabPlays: '文字直播',
  tabOdds: '赔率',
  outsN: n => `${n} 出局`,
  modelOf: l => (l === 'nba' ? 'ESPN 胜率模型' : 'MLB 胜率模型'),
  liveUpdate: '实时',
  traded: v => `成交 ${v}`,
  pregameLine: p => `${p} 赛前盘口`,
  oddsNote: '仅供参考。本站不提供投注。',
  noOdds: '这场还没有赔率。',
  trendTitle: '走势',
  rangeGame: '比赛中',
  rangeAll: '开盘以来',
  trendEmpty: '这场还没有走势数据。',
  trendNow: '现在',
  noPlays: '还没有比赛过程。',
  boxNotStarted: '比赛还没开始，开打后这里会有两队的数据。',
  noGamesFor: l => `这天没有 ${l} 比赛。`,
  series: (s: string) => {
    const m = /^(ALCS|NLCS|ALDS|NLDS|ALWC|NLWC|World Series|Wild Card)\D*(\d+)?/i.exec(s)
    if (/^preseason$/i.test(s)) return '热身赛'
    if (m) { const n = ({ ALCS: '美联冠军赛', NLCS: '国联冠军赛', ALDS: '美联分区赛', NLDS: '国联分区赛', ALWC: '美联外卡赛', NLWC: '国联外卡赛', 'WORLD SERIES': '世界大赛', 'WILD CARD': '外卡赛' } as Record<string, string>)[m[1].toUpperCase()] ?? m[1]; return m[2] ? ((n: string, g: string) => `${n} 第 ${g} 战`)(n, m[2]) : n }
    const lead = /^(\w+) leads (\d+-\d+)$/i.exec(s); if (lead) return ((t: string, x: string) => `${t} 系列赛 ${x} 领先`)(lead[1], lead[2])
    const tied = /^series tied (\d+-\d+)$/i.exec(s); if (tied) return ((x: string) => `系列赛 ${x} 平手`)(tied[1])
    const won = /^(\w+) wins? (\d+-\d+)$/i.exec(s); if (won) return ((t: string, x: string) => `${t} ${x} 晋级`)(won[1], won[2])
    return s
  },
  tabRoom: '聊天室',
  watching: n => `${n} 人在看`,
  roomHint: h => `输入 @AI 可以问轮到的球评，或用 ${h.map(x => `@${x}`).join('、')} 指定一位。`,
  roomEmpty: '还没有人说话，打个招呼吧。',
  roomDown: '聊天室还没开放。',
  loadOlder: '加载更早的消息',
  chatStart: '聊天从这里开始',
  olderCap: n => `只显示最近 ${n} 条消息`,
  toNewest: '回到最新',
  signInChat: '登录后加入聊天',
  nameTitle: '你在聊天室的名字',
  nameHelp: '聊天室里的人都会看到你的名字、@ID 和照片。名字不必是真名。',
  nameLabel: '名字',
  nameUse: '用这个名字',
  cancel: '取消',
  report: '举报',
  reported: '已举报',
  slowDown: '慢一点：每 2 秒一条。',
  refusedMsg: '这条消息没有发出：违反聊天室规则。',
  mutedMsg: '你目前在聊天室被禁言。',
  checkDown: '现在无法检查消息，请稍后再试。',
  nameError: '这个名字不能用，换一个（最多 30 字）。',
  namePlaceholder: '例如：光芒小王子',
  clearChat: '清除对话',
  clearTitle: '清除这场比赛的私聊？',
  clearBody: '里面的内容都会删除，无法恢复。已花费的金额仍会留在点数记录里。',
  clearAction: '清除',
  deleteMsg: '删除',
  deleteTitle: '删除这条留言？',
  deleteBody: '删除后所有人都看不到，无法恢复。',
  deleteAction: '删除',
  reportTitle: '举报这条留言',
  reportAiTitle: '举报 AI 球评的留言',
  reportWhy: '为什么举报？',
  reasons: { spam: '刷屏或广告', harassment: '骚扰或人身攻击', hate: '仇恨或歧视', sexual: '色情或暴力', misinfo: '错误或误导的信息', wrong: '说错比赛或球员信息', clueless: '不懂球', inappropriate: '内容不恰当', other: '其他' },
  reportDetails: '补充说明（选填）',
  reportDetailsPh: '例如：哪里说错了',
  reportSend: '提交举报',
  reportNote: '举报是匿名的。累计足够举报的留言会被隐藏。',
  reportThanks: '已收到举报，谢谢。',
}

const ja: Copy = {
  eyebrow: 'Xスポーツ · MLB ライブ',
  title: 'しゃべるAIと一緒に試合観戦',
  sub: '試合を選んで、ほかのファンやAI解説と一緒に観戦。スコア、速報、オッズ、チャットがそろっています。',
  live: 'LIVE',
  final: '試合終了',
  noGames: 'この日はMLBの試合がありません。',
  loading: '読み込み中…',
  feedDown: '試合データが応答しません。再試行中…',
  back: '試合一覧',
  showHeader: 'スコアとメニューを表示',
  placeholder: '何でも話しかけて…',
  send: '送信',
  spent: '利用額',
  idle: '20分間発言がなかったので観戦を一時停止しました。離席中に料金がかからないようにしています。',
  noCredits: 'クレジットが足りないため、AI は止まりました。',
  topUp: 'チャージ',
  failed: '回答できませんでした',
  signIn: 'ログインして始める',
  change: '変更',
  firstPitch: t => `${t} 試合開始`,
  you: 'あなた',
  dataNote: '試合データ：MLB、ESPN。オッズ：Kalshi、Polymarket、DraftKings（ESPN経由）。',
  prevDay: '前の日',
  nextDay: '次の日',
  today: '今日',
  tabChat: '公開チャット',
  tabBox: 'データ',
  half: (n, top) => `${n}回${top ? '表' : '裏'}`,
  batting: t => `${t}の攻撃`,
  halfSum: (t, r, h) => `${t} ${r}点 ${h}安打`,
  pitchesN: n => `${n}球`,
  todayLine: l => `今日 ${l}`,
  pitcherLbl: '投手',
  batterLbl: '打者',
  batters: '打者',
  pitchersLbl: '投手',
  notes: 'メモ',
  bullpen: '未登板のリリーフ',
  winProb: '勝率（MLBのモデル）',
  market: 'マーケット（Kalshi）',
  poly: 'Polymarket',
  period: n => (n > 4 ? (n === 5 ? '延長' : `延長${n - 4}`) : `第${n}Q`),
  periodSum: (l, a, x, h, y) => `${l}終了 ${a} ${x} - ${y} ${h}`,
  winProbEspn: '勝率（ESPNのモデル）',
  lineLbl: p => `${p}のライン`,
  total: n => `合計 ${n}`,
  brand: 'Xスポーツ',
  notStarted: '試合前',
  tabFeed: '試合経過',
  clipsFilter: 'ハイライト',
  newClips: n => `新しいハイライト ${n} 件`,
  newPlays: n => `新しいプレー ${n} 件`,
  playClip: 'ハイライトを再生',
  backToFeed: '試合経過に戻る',
  watchOriginal: '元の動画を見る',
  moreClips: 'ほかのハイライト',
  gameClips: '試合のハイライト',
  noClips: 'この試合のハイライトはまだありません。リーグが公開するとここに出ます。',
  clipsLoading: 'ハイライトを探しています…',
  clipsDown: '動画の配信元が応答していません。',
  clipsRegion: n => `ほかに ${n} 本、お住まいの地域では再生できない動画があります。`,
  clipsRegionAll: n => `この試合の動画 ${n} 本は、お住まいの地域では再生できません。`,
  clipNoEmbed: 'この動画は配信元のサイトでのみ再生できます。',
  clipBadge: 'ハイライト',
  aiCommentator: 'AI解説',
  cheerTag: 'チア',
  cheerRole: 'AIチアリーダー',
  askHer: '晴晴にお願い（管理者にだけ表示）',
  actDance: 'ダンス',
  actSelfie: '自撮り',
  actCheer: '応援動画',
  actShout: '誰かを応援',
  shoutName: '吹き出しに入れる名前',
  shoutDraw: '描く',
  shoutDrawing: '描いています（1分ほど）…',
  shoutRedo: '描き直す',
  shoutPost: '投稿する',
  cheerAsked: '晴晴が受け取りました。まもなく投稿されます',
  cheerActFailed: 'うまくいきませんでした。もう一度お試しください',
  cheerNameRefused: 'この名前は吹き出しに入れられません。別の名前でお試しください',
  aiAny: '次の番の解説',
  tabPrivate: 'マイAI',
  privateEmpty: '質問には選んだモデル全員が答えます。モデルをタップするか、回答の「返信」や @ で、そのモデルだけに聞けます。「観戦を始める」を押すと試合について話し、どれだけ話すかはモデルごとの設定で選べます。各モデルの定価で課金されます。',
  leaguesNav: 'リーグ',
  settings: '設定',
  settingsTitle: 'Xスポーツの設定',
  yourName: 'あなたの名前',
  editName: '名前を変更',
  nameSync: 'プロフィールのサイト名と同じで、連動しています。一度変えればどこでも新しい名前になります（送信済みのメッセージは元の名前のまま）。',
  showAi: 'AI解説を表示',
  showAiHint: 'オフにすると、どのチャットでもAI解説のコメントが表示されません。',
  hiddenList: '非表示リスト',
  hiddenEmpty: 'チャットで名前をタップすると非表示にできます。',
  hiddenNote: 'このブラウザにだけ保存され、30日で解除されます。',
  unhide: '再表示',
  hidePerson: 'この人を非表示',
  hideAi: h => `${h}を非表示`,
  hideAllAi: 'AI解説をすべて非表示',
  reportThis: 'このコメントを報告',
  hiddenFlash: n => `${n}を非表示にしました`,
  undo: '元に戻す',
  privateTitle: 'あなた専用の AI 観戦',
  privateOnly: 'あなただけに表示',
  modelsLabel: '答えるモデル',
  addModel: 'モデルを追加',
  removeModel: name => `${name} を外す`,
  maxModels: max => `最大 ${max} モデル`,
  pickerDone: '完了',
  pickerCount: (n, max) => `${n} / ${max} 選択中`,
  watchStart: '観戦を始める',
  watchPause: '一時停止',
  watchOn: '観戦中',
  watchOff: '停止中',
  answering: '回答中…',
  waitingTurn: '待機中',
  askCost: x => `質問1回 約 ${x}`,
  watchCost: x => `観戦 約 ${x}/時間`,
  rotateNote: '観戦中は各モデルが設定どおりに話し、発言ごとにそのモデルの定価で課金されます。',
  prompts: ['いまの試合展開は？', 'ここまで一番活躍しているのは？', 'このあと注目すべき点は？'],
  askOnly: names => `${names} だけに質問`,
  askAll: 'すべてのモデルに質問',
  reply: '返信',
  settingsOf: name => `${name} の設定`,
  closeLabel: '閉じる',
  talkLabel: '観戦中',
  talk: { off: 'オフ', low: '控えめ', mid: 'ふつう', high: 'にぎやか' },
  talkHint: { off: '質問されたときだけ答える', low: '大事な場面だけ：得点、イニングやクォーターの終わり、試合終了', mid: '大事な場面とふだんのプレー、静かなときにも時々', high: 'ほとんどのプレーで、静かなときもよく話す' },
  thinkLabel: '思考',
  thinkFast: '速い',
  thinkHint: '深く考えるほど回答は遅く、高くなります（見積もりに思考の分は含みません）。',
  quietModel: name => `${name}：質問されたときだけ答える`,
  lastWatcher: '少なくとも1つのモデルは観戦します',
  commentator: '解説',
  roomPlaceholder: 'コメント、または @AI で解説に質問',
  roomPlaceholderIn: n => `${n}のチャットにコメント、または @AI で質問`,
  roomLangTitle: 'チャットの言語',
  roomLangHint: '言語ごとに別のチャットがあり、AI解説もその言語で話します。このブラウザにだけ保存されます。',
  buddyEmpty: 'あなた専用のAI観戦仲間です。「一緒に観戦する」を押すと、試合に合わせて自分から話しかけます。いつでも何でも質問できます。発言ごとに、選んだモデルの定価で課金されます。',
  all: 'すべて',
  tabBuddy: 'AI観戦仲間',
  tabPlays: '速報',
  tabOdds: 'オッズ',
  outsN: n => `${n}アウト`,
  modelOf: l => (l === 'nba' ? 'ESPN 勝率モデル' : 'MLB 勝率モデル'),
  liveUpdate: 'リアルタイム',
  traded: v => `取引 ${v}`,
  pregameLine: p => `${p} 試合前ライン`,
  oddsNote: '参考情報です。当サイトでは賭けを受け付けていません。',
  noOdds: 'この試合のオッズはまだありません。',
  trendTitle: '推移',
  rangeGame: 'この試合',
  rangeAll: '取引開始から',
  trendEmpty: 'この試合の推移はまだありません。',
  trendNow: '現在',
  noPlays: 'まだプレーがありません。',
  boxNotStarted: '試合はまだ始まっていません。始まると、ここに両チームのデータが出ます。',
  noGamesFor: l => `この日は ${l} の試合がありません。`,
  series: (s: string) => {
    const m = /^(ALCS|NLCS|ALDS|NLDS|ALWC|NLWC|World Series|Wild Card)\D*(\d+)?/i.exec(s)
    if (/^preseason$/i.test(s)) return 'プレシーズン'
    if (m) { const n = ({ ALCS: 'ア・リーグ優勝決定S', NLCS: 'ナ・リーグ優勝決定S', ALDS: 'ア・リーグ地区S', NLDS: 'ナ・リーグ地区S', ALWC: 'ア・リーグWC', NLWC: 'ナ・リーグWC', 'WORLD SERIES': 'ワールドシリーズ', 'WILD CARD': 'ワイルドカード' } as Record<string, string>)[m[1].toUpperCase()] ?? m[1]; return m[2] ? ((n: string, g: string) => `${n} 第${g}戦`)(n, m[2]) : n }
    const lead = /^(\w+) leads (\d+-\d+)$/i.exec(s); if (lead) return ((t: string, x: string) => `${t} ${x} リード`)(lead[1], lead[2])
    const tied = /^series tied (\d+-\d+)$/i.exec(s); if (tied) return ((x: string) => `${x} タイ`)(tied[1])
    const won = /^(\w+) wins? (\d+-\d+)$/i.exec(s); if (won) return ((t: string, x: string) => `${t} ${x} 勝ち抜け`)(won[1], won[2])
    return s
  },
  tabRoom: 'みんなで実況',
  watching: n => `${n}人が観戦中`,
  roomHint: h => `@AI と書くと次の番の解説に、${h.map(x => `@${x}`).join('・')} と書くとその解説に質問できます。`,
  roomEmpty: 'まだ誰も話していません。あいさつしてみましょう。',
  roomDown: '実況チャットはまだ開いていません。',
  loadOlder: '前のメッセージを読み込む',
  chatStart: 'ここからチャットが始まりました',
  olderCap: n => `最新の${n}件まで表示しています`,
  toNewest: '最新へ',
  signInChat: 'ログインしてチャットに参加',
  nameTitle: '実況チャットでの名前',
  nameHelp: '名前・@ID・写真は部屋の全員に見えます。名前は本名でなくてかまいません。',
  nameLabel: '名前',
  nameUse: 'この名前を使う',
  cancel: 'キャンセル',
  report: '通報',
  reported: '通報済み',
  slowDown: '少しゆっくり：2秒に1件まで。',
  refusedMsg: 'このメッセージは送信されませんでした：ルール違反です。',
  mutedMsg: '現在、実況チャットで発言できません。',
  checkDown: '今はメッセージを確認できません。少し待ってからもう一度どうぞ。',
  nameError: 'この名前は使えません。別の名前にしてください（30文字まで）。',
  namePlaceholder: '例：レイズ好き',
  clearChat: '会話を消去',
  clearTitle: 'この試合のプライベートチャットを消去しますか？',
  clearBody: '内容はすべて削除され、元に戻せません。利用額はクレジット履歴に残ります。',
  clearAction: '消去',
  deleteMsg: '削除',
  deleteTitle: 'このメッセージを削除しますか？',
  deleteBody: '削除すると全員から見えなくなり、元に戻せません。',
  deleteAction: '削除',
  reportTitle: 'このメッセージを報告',
  reportAiTitle: 'AI解説のメッセージを報告',
  reportWhy: '報告する理由は？',
  reasons: { spam: 'スパム・宣伝', harassment: '嫌がらせ・個人攻撃', hate: 'ヘイト・差別', sexual: '性的・暴力的な内容', misinfo: '誤った・誤解を招く情報', wrong: '試合や選手の情報の誤り', clueless: '試合を分かっていない', inappropriate: '不適切な内容', other: 'その他' },
  reportDetails: '詳細（任意）',
  reportDetailsPh: '例：どこが間違っていたか',
  reportSend: '報告する',
  reportNote: '報告は匿名です。一定数の報告があったメッセージは非表示になります。',
  reportThanks: '報告を受け付けました。ありがとうございます。',
}

const ko: Copy = {
  eyebrow: 'X스포츠 · MLB 라이브',
  title: '말하는 AI와 함께 경기 보기',
  sub: '경기를 골라 다른 팬들, AI 해설과 함께 보세요. 스코어, 문자중계, 배당, 채팅이 모두 있습니다.',
  live: 'LIVE',
  final: '종료',
  noGames: '이날은 MLB 경기가 없습니다.',
  loading: '불러오는 중…',
  feedDown: '경기 데이터가 응답하지 않습니다. 다시 시도 중…',
  back: '전체 경기',
  showHeader: '점수와 메뉴 펼치기',
  placeholder: '무엇이든 말해 보세요…',
  send: '보내기',
  spent: '사용',
  idle: '20분 동안 말이 없어 함께 보기를 일시정지했습니다. 자리를 비운 동안 비용이 나가지 않게 합니다.',
  noCredits: '크레딧이 부족해 AI가 멈췄습니다.',
  topUp: '충전',
  failed: '답하지 못했습니다',
  signIn: '로그인하고 시작',
  change: '변경',
  firstPitch: t => `${t} 경기 시작`,
  you: '나',
  dataNote: '경기 데이터: MLB, ESPN. 배당: Kalshi, Polymarket, DraftKings(ESPN 경유).',
  prevDay: '이전 날',
  nextDay: '다음 날',
  today: '오늘',
  tabChat: '공개 채팅',
  tabBox: '박스스코어',
  half: (n, top) => `${n}회${top ? '초' : '말'}`,
  batting: t => `${t} 공격`,
  halfSum: (t, r, h) => `${t} ${r}점 ${h}안타`,
  pitchesN: n => `${n}구`,
  todayLine: l => `오늘 ${l}`,
  pitcherLbl: '투수',
  batterLbl: '타자',
  batters: '타자',
  pitchersLbl: '투수',
  notes: '메모',
  bullpen: '아직 안 나온 불펜',
  winProb: '승리 확률 (MLB 모델)',
  market: '시장 (Kalshi)',
  poly: 'Polymarket',
  period: n => (n > 4 ? (n === 5 ? '연장' : `연장 ${n - 4}`) : `${n}쿼터`),
  periodSum: (l, a, x, h, y) => `${l} 종료 ${a} ${x} : ${y} ${h}`,
  winProbEspn: '승리 확률 (ESPN 모델)',
  lineLbl: p => `${p} 라인`,
  total: n => `합계 ${n}`,
  brand: 'X스포츠',
  notStarted: '경기 전',
  tabFeed: '경기 상황',
  clipsFilter: '하이라이트',
  newClips: n => `새 하이라이트 ${n}개`,
  newPlays: n => `새 플레이 ${n}개`,
  playClip: '하이라이트 재생',
  backToFeed: '경기 상황으로',
  watchOriginal: '원본 보기',
  moreClips: '하이라이트 더 보기',
  gameClips: '경기 하이라이트',
  noClips: '이 경기의 하이라이트는 아직 없습니다. 리그가 공개하면 여기에 나옵니다.',
  clipsLoading: '하이라이트를 찾는 중…',
  clipsDown: '영상 출처가 지금 응답하지 않습니다.',
  clipsRegion: n => `지역 제한으로 재생할 수 없는 영상이 ${n}개 더 있습니다.`,
  clipsRegionAll: n => `이 경기의 영상 ${n}개는 지역 제한으로 재생할 수 없습니다.`,
  clipNoEmbed: '이 영상은 원래 사이트에서만 재생됩니다.',
  clipBadge: '하이라이트',
  aiCommentator: 'AI 해설',
  cheerTag: '치어리더',
  cheerRole: 'AI 치어리더',
  askHer: '晴晴에게 부탁하기 (관리자에게만 보임)',
  actDance: '춤',
  actSelfie: '셀카',
  actCheer: '응원 영상',
  actShout: '누군가 응원하기',
  shoutName: '말풍선에 넣을 이름',
  shoutDraw: '그리기',
  shoutDrawing: '그리는 중 (약 1분)…',
  shoutRedo: '다시 그리기',
  shoutPost: '올리기',
  cheerAsked: '晴晴이 받았어요. 곧 올라옵니다',
  cheerActFailed: '실패했어요. 다시 시도해 주세요',
  cheerNameRefused: '이 이름은 말풍선에 넣을 수 없어요. 다른 이름으로 해 보세요',
  aiAny: '차례인 해설',
  tabPrivate: '내 AI',
  privateEmpty: '질문하면 고른 모델이 모두 답합니다. 모델을 누르거나 답의 「답장」 또는 @로 그 모델에게만 물을 수 있습니다. 「함께 보기 시작」을 누르면 경기 이야기를 하며, 얼마나 말할지는 모델별 설정에서 고릅니다. 모델별 정가로 청구됩니다.',
  leaguesNav: '리그',
  settings: '설정',
  settingsTitle: 'X스포츠 설정',
  yourName: '내 이름',
  editName: '이름 바꾸기',
  nameSync: '프로필의 사이트 이름과 같고 함께 바뀌어요. 한 번 바꾸면 모든 곳에서 새 이름이 쓰여요(이미 보낸 메시지는 원래 이름으로 남아요).',
  showAi: 'AI 해설 보기',
  showAiHint: '끄면 모든 채팅방에서 AI 해설 메시지가 보이지 않아요.',
  hiddenList: '숨긴 사람',
  hiddenEmpty: '채팅방에서 이름을 누르면 숨길 수 있어요.',
  hiddenNote: '이 브라우저에만 저장되며 30일 뒤 자동으로 해제돼요.',
  unhide: '다시 보기',
  hidePerson: '이 사람 숨기기',
  hideAi: h => `${h} 숨기기`,
  hideAllAi: 'AI 해설 모두 숨기기',
  reportThis: '이 메시지 신고',
  hiddenFlash: n => `${n} 숨김`,
  undo: '되돌리기',
  privateTitle: '나만의 AI 관전',
  privateOnly: '나만 볼 수 있음',
  modelsLabel: '답할 모델',
  addModel: '모델 추가',
  removeModel: name => `${name} 제거`,
  maxModels: max => `최대 ${max}개 모델`,
  pickerDone: '완료',
  pickerCount: (n, max) => `${n} / ${max} 선택됨`,
  watchStart: '함께 보기 시작',
  watchPause: '일시정지',
  watchOn: '함께 보는 중',
  watchOff: '일시정지됨',
  answering: '답하는 중…',
  waitingTurn: '대기 중',
  askCost: x => `질문 1회 약 ${x}`,
  watchCost: x => `함께 보기 약 ${x}/시간`,
  rotateNote: '함께 볼 때는 모델마다 설정대로 말하고, 한마디마다 그 모델의 정가로 청구됩니다.',
  prompts: ['지금 경기 흐름은 어때?', '지금까지 누가 제일 잘하고 있어?', '다음에 주목할 점은?'],
  askOnly: names => `${names}에게만 질문`,
  askAll: '모든 모델에게 질문',
  reply: '답장',
  settingsOf: name => `${name} 설정`,
  closeLabel: '닫기',
  talkLabel: '함께 볼 때',
  talk: { off: '끔', low: '조용히', mid: '보통', high: '활발히' },
  talkHint: { off: '물어볼 때만 답함', low: '중요한 순간만: 득점, 이닝이나 쿼터 종료, 경기 종료', mid: '중요한 순간과 일반 플레이, 조용할 때 가끔', high: '대부분의 플레이에서, 조용할 때도 자주' },
  thinkLabel: '생각',
  thinkFast: '빠르게',
  thinkHint: '깊이 생각할수록 답이 느리고 비쌉니다(예상 비용에 생각 분량은 빠짐).',
  quietModel: name => `${name}: 물어볼 때만 답함`,
  lastWatcher: '최소 한 모델은 함께 봅니다',
  commentator: '해설',
  roomPlaceholder: '댓글, 또는 @AI로 해설에게 질문',
  roomPlaceholderIn: n => `${n} 채팅방에 댓글, 또는 @AI로 질문`,
  roomLangTitle: '채팅방 언어',
  roomLangHint: '언어마다 채팅방이 따로 있고, AI 해설도 그 언어로 말합니다. 이 브라우저에만 저장됩니다.',
  buddyEmpty: '나만의 AI 친구입니다. 「함께 보기 시작」을 누르면 경기를 따라 먼저 말을 걸고, 언제든 무엇이든 물어볼 수 있어요. 한마디마다 고른 모델의 정가로 과금됩니다.',
  all: '전체',
  tabBuddy: 'AI 친구',
  tabPlays: '문자중계',
  tabOdds: '배당',
  outsN: n => `${n}아웃`,
  modelOf: l => (l === 'nba' ? 'ESPN 승률 모델' : 'MLB 승률 모델'),
  liveUpdate: '실시간',
  traded: v => `거래 ${v}`,
  pregameLine: p => `${p} 경기 전 라인`,
  oddsNote: '참고용입니다. 이 사이트는 베팅을 받지 않습니다.',
  noOdds: '이 경기의 배당은 아직 없습니다.',
  trendTitle: '추이',
  rangeGame: '이번 경기',
  rangeAll: '개장 이후',
  trendEmpty: '이 경기의 추이는 아직 없어요.',
  trendNow: '지금',
  noPlays: '아직 플레이가 없습니다.',
  boxNotStarted: '경기가 아직 시작되지 않았어요. 시작하면 여기에 두 팀의 기록이 나와요.',
  noGamesFor: l => `이날은 ${l} 경기가 없습니다.`,
  series: (s: string) => {
    const m = /^(ALCS|NLCS|ALDS|NLDS|ALWC|NLWC|World Series|Wild Card)\D*(\d+)?/i.exec(s)
    if (/^preseason$/i.test(s)) return '프리시즌'
    if (m) { const n = ({ ALCS: 'ALCS', NLCS: 'NLCS', ALDS: 'ALDS', NLDS: 'NLDS', ALWC: 'AL 와일드카드', NLWC: 'NL 와일드카드', 'WORLD SERIES': '월드시리즈', 'WILD CARD': '와일드카드' } as Record<string, string>)[m[1].toUpperCase()] ?? m[1]; return m[2] ? ((n: string, g: string) => `${n} ${g}차전`)(n, m[2]) : n }
    const lead = /^(\w+) leads (\d+-\d+)$/i.exec(s); if (lead) return ((t: string, x: string) => `${t} ${x} 리드`)(lead[1], lead[2])
    const tied = /^series tied (\d+-\d+)$/i.exec(s); if (tied) return ((x: string) => `시리즈 ${x} 동률`)(tied[1])
    const won = /^(\w+) wins? (\d+-\d+)$/i.exec(s); if (won) return ((t: string, x: string) => `${t} ${x} 진출`)(won[1], won[2])
    return s
  },
  tabRoom: '라이브 채팅',
  watching: n => `${n}명 시청 중`,
  roomHint: h => `@AI 라고 쓰면 차례인 해설이, ${h.map(x => `@${x}`).join('·')} 라고 쓰면 그 해설이 답해요.`,
  roomEmpty: '아직 아무도 말하지 않았어요. 인사해 보세요.',
  roomDown: '라이브 채팅이 아직 열리지 않았습니다.',
  loadOlder: '이전 메시지 불러오기',
  chatStart: '여기서 채팅이 시작됐어요',
  olderCap: n => `최근 메시지 ${n}개까지 표시합니다`,
  toNewest: '최신으로',
  signInChat: '로그인하고 채팅 참여',
  nameTitle: '라이브 채팅에서 쓸 이름',
  nameHelp: '방에 있는 모두가 이름, @ID, 사진을 봅니다. 이름은 실명이 아니어도 됩니다.',
  nameLabel: '이름',
  nameUse: '이 이름 사용',
  cancel: '취소',
  report: '신고',
  reported: '신고됨',
  slowDown: '조금 천천히: 2초에 한 번.',
  refusedMsg: '이 메시지는 보내지지 않았습니다: 규칙 위반입니다.',
  mutedMsg: '지금은 라이브 채팅에서 말할 수 없습니다.',
  checkDown: '지금은 메시지를 확인할 수 없습니다. 잠시 후 다시 시도하세요.',
  nameError: '이 이름은 쓸 수 없습니다. 다른 이름으로 해 주세요(30자까지).',
  namePlaceholder: '예: 레이스팬',
  clearChat: '대화 지우기',
  clearTitle: '이 경기의 개인 채팅을 지울까요?',
  clearBody: '내용은 모두 삭제되며 되돌릴 수 없습니다. 사용한 금액은 크레딧 기록에 남습니다.',
  clearAction: '지우기',
  deleteMsg: '삭제',
  deleteTitle: '이 메시지를 삭제할까요?',
  deleteBody: '삭제하면 모두에게서 사라지며 되돌릴 수 없습니다.',
  deleteAction: '삭제',
  reportTitle: '이 메시지 신고',
  reportAiTitle: 'AI 해설 메시지 신고',
  reportWhy: '신고 이유가 무엇인가요?',
  reasons: { spam: '도배 또는 광고', harassment: '괴롭힘 또는 인신공격', hate: '혐오 또는 차별', sexual: '선정적이거나 폭력적인 내용', misinfo: '잘못되었거나 오해의 소지가 있는 정보', wrong: '경기나 선수 정보 오류', clueless: '경기를 잘 모름', inappropriate: '부적절한 내용', other: '기타' },
  reportDetails: '추가 설명(선택)',
  reportDetailsPh: '예: 어디가 틀렸는지',
  reportSend: '신고하기',
  reportNote: '신고는 익명입니다. 신고가 충분히 쌓인 메시지는 숨겨집니다.',
  reportThanks: '신고가 접수되었습니다. 감사합니다.',
}

export const COPY: Record<string, Copy> = { en, 'zh-Hant': zhHant, 'zh-Hans': zhHans, ja, ko }
export const copyFor = (lang: string): Copy => COPY[lang] ?? en
