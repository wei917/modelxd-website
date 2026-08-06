'use client'

// Lightweight i18n. English is the canonical language; every other
// language is an OPTIONAL string mapping with automatic English fallback —
// which is what makes adding a language pure data entry (CC, July 17):
// add a code to LANGS, fill in whatever strings you have in STRINGS,
// missing keys silently render English.
//
// The language picker lives on the profile page; first-visit detection
// follows the browser's preference list (see LangProvider). Choice
// persists in localStorage and sets <html lang>.
//
// Use the `useT()` hook: `const t = useT()` then `t('nav.xduel')`.

import { createContext, useContext, useEffect, useState } from 'react'

export type Lang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'

/** Picker metadata — label is the language's own name (never translated). */
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en',      label: 'English' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'ja',      label: '日本語' },
  { code: 'ko',      label: '한국어' },
]

// en is required; every other language optional (falls back to en).
type Entry = { en: string } & Partial<Record<Lang, string>>

export const STRINGS: Record<string, Entry> = {
  // ── Brand + nav ──
  // Landing: value snapshot bar + tier comparator (CC, July 25).
  'home.picks':       { en: "Today's Best Value Picks", 'zh-Hant': '今日最超值精選', 'zh-Hans': '今日最超值精选', ja: '本日のベストバリュー', ko: '오늘의 최고 가성비' },
  'home.vc.save':     { en: 'Save More', 'zh-Hant': '更省錢', 'zh-Hans': '更省钱', ja: 'コスト重視', ko: '절약 우선' },
  'home.vc.push':     { en: 'Better Quality', 'zh-Hant': '更好品質', 'zh-Hans': '更好质量', ja: 'より高品質', ko: '더 나은 품질' },
  'home.vc.left':     { en: 'Left', 'zh-Hant': '左', 'zh-Hans': '左', ja: '左', ko: '왼쪽' },
  'home.vc.right':    { en: 'Right', 'zh-Hant': '右', 'zh-Hans': '右', ja: '右', ko: '오른쪽' },
  'home.vc.tier.a':   { en: 'Budget Buy', 'zh-Hant': '省錢之選', 'zh-Hans': '省钱之选', ja: 'コスパ重視', ko: '가성비 픽' },
  'home.vc.tier.b':   { en: 'Smart Value', 'zh-Hant': '超值之選', 'zh-Hans': '超值之选', ja: 'お得な選択', ko: '스마트 밸류' },
  'home.vc.tier.c':   { en: 'Premium Pick', 'zh-Hant': '高階之選', 'zh-Hans': '高阶之选', ja: 'プレミアム', ko: '프리미엄 픽' },
  'home.vc.tier.d':   { en: 'Flagship Class', 'zh-Hant': '旗艦等級', 'zh-Hans': '旗舰等级', ja: 'フラッグシップ級', ko: '플래그십 클래스' },
  'home.vc.badge.price':   { en: 'Price Pick', 'zh-Hant': '價格之選', 'zh-Hans': '价格之选', ja: '価格重視', ko: '가격 픽' },
  'home.vc.badge.quality': { en: 'Quality Pick', 'zh-Hant': '品質之選', 'zh-Hans': '质量之选', ja: '品質重視', ko: '품질 픽' },
  'home.vc.note':     { en: 'Same prompt, same scene — only the model changed.', 'zh-Hant': '相同提示詞、相同場景 — 只換了模型。', 'zh-Hans': '相同提示词、相同场景 — 只换了模型。', ja: '同じプロンプト、同じシーン — 変えたのはモデルだけ。', ko: '같은 프롬프트, 같은 장면 — 모델만 바꿨습니다.' },
  'brand':            { en: 'ModelXD', 'zh-Hant': '模型大對決', 'zh-Hans': '模型大对决' },
  'nav.xduel':        { en: 'XDuel',   'zh-Hant': 'X對決',   'zh-Hans': 'X对决',   ja: 'X対決',       ko: 'X대결' },
  'nav.xcreate':      { en: 'XCreate', 'zh-Hant': 'X創作',   'zh-Hans': 'X创作',   ja: 'X作成',       ko: 'X창작' },
  // "Direct" is the verb of director — the nav names what YOU do (duel,
  // create, direct, talk, vote), while the persona inside stays "the
  // director". 導演/导演 already read as verbs in zh, so only en changed.
  'nav.xdirect':      { en: 'XDirect', 'zh-Hant': 'X導演', 'zh-Hans': 'X导演', ja: 'Xディレクター', ko: 'X디렉터' },
  'xdirect.empty':    { en: 'The board is empty — everything the director makes lands here. Describe what you want on the left.', 'zh-Hant': '畫布還是空的——導演做出的每一步都會出現在這裡。在左邊說說你想做什麼。', 'zh-Hans': '画布还是空的——导演做出的每一步都会出现在这里。在左边说说你想做什么。', ja: 'ボードはまだ空です。ディレクターが作るものはすべてここに並びます。左側で作りたいものを教えてください。', ko: '보드가 아직 비어 있어요. 디렉터가 만드는 모든 것이 여기에 표시됩니다. 왼쪽에서 만들고 싶은 것을 알려주세요.' },
  'nav.xvote':        { en: 'XVote',   'zh-Hant': 'X投票',   'zh-Hans': 'X投票',   ja: 'X投票',       ko: 'X투표' },
  'xt.shell.title':  { en: 'Chat with AI. Let Agents Speak.', 'zh-Hant': '跟 AI 聊天，讓 Agent 開口。', 'zh-Hans': '跟 AI 聊天，让 Agent 开口。', ja: 'AI と話そう。エージェントに語らせよう。', ko: 'AI와 대화하고, 에이전트가 말하게 하세요.' },
  'xt.shell.choose': { en: 'Choose a format', 'zh-Hant': '選擇玩法', 'zh-Hans': '选择玩法', ja: '形式を選ぶ', ko: '형식 선택' },
  'xt.tpl.discussion.name':  { en: 'Discussion', 'zh-Hant': '討論', 'zh-Hans': '讨论', ja: 'ディスカッション', ko: '토론' },
  'xt.tpl.discussion.title': { en: 'Put Them in One Room.', 'zh-Hant': '把他們放進同一個房間。', 'zh-Hans': '把他们放进同一个房间。', ja: '同じ部屋に入れてみる。', ko: '한 방에 몰아넣기.' },
  'xt.tpl.discussion.blurb': { en: 'Set the topic, participate at any time, or let the models discuss it among themselves.', 'zh-Hant': '你出題目，隨時可以加入，也可以讓模型自己討論下去。', 'zh-Hans': '你出题目，随时可以加入，也可以让模型自己讨论下去。', ja: 'お題はあなたが決め、いつでも参加でき、モデル同士に任せることもできます。', ko: '주제를 정하고, 언제든 참여하거나, 모델끼리 이야기하도록 두세요.' },
  // No emoji in the name: one card had a wolf glyph and the other had
  // nothing, so the two titles didn't sit on the same baseline grid — and
  // the red seat pips already say "wolves" without spending the title on it.
  'xt.tpl.werewolf.name':    { en: 'Werewolf', 'zh-Hant': '狼人殺', 'zh-Hans': '狼人杀', ja: '人狼', ko: '마피아' },
  'xt.tpl.werewolf.title':   { en: 'Werewolf.', 'zh-Hant': '狼人殺。', 'zh-Hans': '狼人杀。', ja: '人狼。', ko: '마피아.' },
  'xt.seats':                { en: '{n} seats', 'zh-Hant': '{n} 席', 'zh-Hans': '{n} 席', ja: '{n} 席', ko: '{n}석' },
  // The first pair here were 'In turn' / 'Order rotates' — mechanics of the
  // room stated as if they were features. Nobody picks a format because the
  // speaking order rotates. These two are the things that actually change
  // what you get out of it.
  'xt.tpl.discussion.tag':   { en: 'Start a private discussion with the AI models you choose.', 'zh-Hant': '跟你挑選的 AI 模型開一場私人討論。', 'zh-Hans': '跟你挑选的 AI 模型开一场私人讨论。', ja: '選んだ AI モデルとプライベートな議論を始めましょう。', ko: '직접 고른 AI 모델들과 비공개 토론을 시작하세요.' },
  'xt.tpl.discussion.strip': { en: 'In turn · order rotates', 'zh-Hant': '輪流發言 · 每輪換順序', 'zh-Hans': '轮流发言 · 每轮换顺序', ja: '順番に発言 · 毎回入れ替え', ko: '순서대로 · 매 라운드 교대' },
  // Not "two of them are lying" — everyone may lie here, villagers included,
  // and the rules say so out loud. What is actually true of exactly two of
  // them is that they are wolves.
  'xt.tpl.werewolf.tag':     { en: 'Set up a private Werewolf game with AI players.', 'zh-Hant': '開一局由 AI 擔任玩家的私人狼人殺。', 'zh-Hans': '开一局由 AI 担任玩家的私人狼人杀。', ja: 'AI がプレイヤーを務めるプライベートな人狼を始めましょう。', ko: 'AI가 플레이어로 참가하는 비공개 마피아 게임을 열어보세요.' },
  'xt.tpl.werewolf.strip':   { en: '2 wolves · 2 power roles · 3 villagers', 'zh-Hant': '2 狼 · 2 神 · 3 民', 'zh-Hans': '2 狼 · 2 神 · 3 民', ja: '人狼2 · 役職2 · 村人3', ko: '늑대 2 · 특수 2 · 마을 3' },
  'xt.tpl.werewolf.blurb':   { en: 'Play a role yourself, or let the models play the entire game.', 'zh-Hant': '你可以自己下場擔任一個角色，也可以讓模型把整局打完。', 'zh-Hans': '你可以自己下场担任一个角色，也可以让模型把整局打完。', ja: '自分が一役を担っても、モデルだけに最後まで打たせても構いません。', ko: '직접 한 역할을 맡아도 되고, 모델들끼리 한 판을 끝까지 진행하게 둬도 됩니다.' },
  'ww.count.need':    { en: 'pick {n} more', 'zh-Hant': '還差 {n} 個', 'zh-Hans': '还差 {n} 个', ja: 'あと {n} 体', ko: '{n}개 더 필요' },
  'ww.count.ready':   { en: 'table is full', 'zh-Hant': '人數剛好', 'zh-Hans': '人数刚好', ja: '人数ちょうど', ko: '인원 충족' },
  'ww.tablesize':   { en: 'Table size', 'zh-Hant': '牌桌人數', 'zh-Hans': '牌桌人数', ja: 'テーブルの人数', ko: '테이블 인원' },
  'ww.standard':    { en: 'standard', 'zh-Hant': '標準', 'zh-Hans': '标准', ja: '標準', ko: '표준' },
  'ww.sec.human':        { en: 'Human players', 'zh-Hant': '真人玩家', 'zh-Hans': '真人玩家', ja: '人間プレイヤー', ko: '사람 플레이어' },
  'ww.sec.ai':           { en: 'AI players', 'zh-Hant': 'AI 玩家', 'zh-Hans': 'AI 玩家', ja: 'AI プレイヤー', ko: 'AI 플레이어' },
  'ww.imin':             { en: "I'm in", 'zh-Hant': '我要下場', 'zh-Hans': '我要下场', ja: '参加する', ko: '참가하기' },
  'ww.iwantto':     { en: 'I want to be', 'zh-Hant': '我想當', 'zh-Hans': '我想当', ja: '担当したい役職', ko: '맡고 싶은 역할' },
  'ww.random':      { en: 'Random', 'zh-Hant': '隨機', 'zh-Hans': '随机', ja: 'ランダム', ko: '랜덤' },
  // Role names are bare words. The emoji used to be baked into the string,
  // so every place that printed a role got a glyph whether it helped or not —
  // the board summary came out as a row of pictograms with numbers wedged
  // between them. Anything that wants a mark can add one at the call site.
  'ww.board':            { en: 'The board', 'zh-Hant': '牌型', 'zh-Hans': '牌型', ja: '配役', ko: '구성' },
  'ww.role.doctor': { en: 'Doctor', 'zh-Hant': '醫生', 'zh-Hans': '医生', ja: '医者', ko: '의사' },
  'ww.turn.protect':{ en: 'Your turn — who do you protect tonight?', 'zh-Hant': '輪到你 —— 今晚要保護誰？', 'zh-Hans': '轮到你 —— 今晚要保护谁？', ja: 'あなたの番 — 今夜は誰を守る？', ko: '당신 차례 — 오늘 밤 누구를 보호합니까?' },
  'ww.attable':     { en: 'at the table', 'zh-Hant': '人在桌上', 'zh-Hans': '人在桌上', ja: '人が着席', ko: '명 착석' },
  'ww.need4':       { en: 'need 4', 'zh-Hant': '至少 4 人', 'zh-Hans': '至少 4 人', ja: '4人必要', ko: '4명 필요' },
  'ww.yourname':    { en: 'your name at the table', 'zh-Hant': '你在桌上的名字', 'zh-Hans': '你在桌上的名字', ja: '席での名前', ko: '테이블에서 쓸 이름' },
  'ww.hint.play':   { en: 'You get dealt a role like everyone else, and you only see what your seat sees — the roles live on the server, not in this page.', 'zh-Hant': '你會跟其他人一樣被發到一個角色，而且只看得到你這個座位該看到的東西 —— 角色存在伺服器上，不在這個頁面裡。', 'zh-Hans': '你会和其他人一样被发到一个角色，而且只看得到你这个座位该看到的东西 —— 角色存在服务器上，不在这个页面里。', ja: 'あなたも他の全員と同じように役職が配られ、自分の席から見えるものしか見えません。役職はこのページではなくサーバー上にあります。', ko: '다른 모두와 똑같이 역할이 배정되고, 당신 자리에서 보이는 것만 볼 수 있습니다. 역할은 이 페이지가 아니라 서버에 있습니다.' },
  'ww.hint.watch':  { en: 'Watching: you see every private move, including the wolf choosing who to kill.', 'zh-Hant': '觀戰：你看得到每一個私密動作，包含狼在挑誰下手。', 'zh-Hans': '观战：你看得到每一个私密动作，包含狼在挑谁下手。', ja: '観戦：人狼が誰を襲うか選ぶ場面も含め、すべての秘密の行動が見えます。', ko: '관전: 늑대가 누구를 죽일지 고르는 장면까지 모든 비밀 행동이 보입니다.' },
  'ww.deal':        { en: 'Deal the roles →', 'zh-Hant': '發牌 →', 'zh-Hans': '发牌 →', ja: '役職を配る →', ko: '역할 배분 →' },
  'ww.dealing':     { en: 'Dealing…', 'zh-Hant': '發牌中…', 'zh-Hans': '发牌中…', ja: '配布中…', ko: '배분 중…' },
  'ww.leave':       { en: 'Leave the table', 'zh-Hant': '離開牌桌', 'zh-Hans': '离开牌桌', ja: '卓を離れる', ko: '테이블 나가기' },
  'ww.role.wolf':   { en: 'Wolf', 'zh-Hant': '狼人', 'zh-Hans': '狼人', ja: '人狼', ko: '늑대인간' },
  'ww.packmate':    { en: 'Your fellow wolf: {w}', 'zh-Hant': '你的狼人同伴：{w}', 'zh-Hans': '你的狼人同伴：{w}', ja: '仲間の人狼：{w}', ko: '동료 늑대: {w}' },
  'xt.recent':      { en: 'Recent games', 'zh-Hant': '最近對局', 'zh-Hans': '最近对局', ja: '最近の対局', ko: '최근 게임' },
  'ww.autofill':    { en: 'Auto-fill seats', 'zh-Hant': '自動補滿', 'zh-Hans': '自动补满', ja: '自動で埋める', ko: '자동 채우기' },
  'ww.thinking.show':  { en: 'Reveal AI thinking', 'zh-Hant': '顯示 AI 思考', 'zh-Hans': '显示 AI 思考', ja: 'AI の思考を表示', ko: 'AI 사고 표시' },
  'ww.thinking.hide':  { en: 'Hide AI thinking', 'zh-Hant': '隱藏 AI 思考', 'zh-Hans': '隐藏 AI 思考', ja: 'AI の思考を隠す', ko: 'AI 사고 숨기기' },
  'ww.thinking.label': { en: 'Private thinking · hidden from players', 'zh-Hant': '私密思考 · 玩家看不到', 'zh-Hans': '私密思考 · 玩家看不到', ja: '非公開の思考 · プレイヤーには見えない', ko: '비공개 사고 · 플레이어에게 안 보임' },
  'ww.delete':         { en: 'Delete game', 'zh-Hant': '刪除對局', 'zh-Hans': '删除对局', ja: '対局を削除', ko: '게임 삭제' },
  'ww.delete.confirm': { en: 'Delete this game?', 'zh-Hant': '刪除這局？', 'zh-Hans': '删除这局？', ja: 'この対局を削除？', ko: '이 게임을 삭제?' },
  'ww.delete.yes':     { en: 'Delete', 'zh-Hant': '刪除', 'zh-Hans': '删除', ja: '削除', ko: '삭제' },
  'ww.rename':         { en: 'Rename this game', 'zh-Hant': '重新命名', 'zh-Hans': '重命名', ja: '名前を変更', ko: '이름 변경' },
  'xt.village':     { en: 'Village', 'zh-Hant': '好人', 'zh-Hans': '好人', ja: '村人', ko: '마을' },
  'ww.role.seer':   { en: 'Seer', 'zh-Hant': '預言家', 'zh-Hans': '预言家', ja: '占い師', ko: '예언자' },
  'ww.role.villager': { en: 'Villager', 'zh-Hant': '平民', 'zh-Hans': '平民', ja: '村人', ko: '마을 주민' },
  'ww.youare':      { en: 'You are {n} · {r} · you see only what your seat sees', 'zh-Hant': '你是 {n} · {r} · 你只看得到你這個座位該看到的', 'zh-Hans': '你是 {n} · {r} · 你只看得到你这个座位该看到的', ja: 'あなたは {n} · {r} · 自分の席から見えるものだけが見えます', ko: '당신은 {n} · {r} · 당신 자리에서 보이는 것만 보입니다' },
  'ww.talking':     { en: 'the table is talking…', 'zh-Hant': '桌上正在討論…', 'zh-Hans': '桌上正在讨论…', ja: '議論中…', ko: '토론 중…' },
  'ww.thinkingnow': { en: 'is thinking…', 'zh-Hant': '思考中…', 'zh-Hans': '思考中…', ja: '思考中…', ko: '생각 중…' },
  'ww.resolving':   { en: 'resolving the night…', 'zh-Hant': '結算中…', 'zh-Hans': '结算中…', ja: '結果を処理中…', ko: '결과 처리 중…' },
  'ww.err.timeout': { en: 'A model took too long and this turn timed out. Reload to resume from the last finished turn.', 'zh-Hant': '某個模型思考太久，這一步逾時了。重新整理即可從最後完成的回合繼續。', 'zh-Hans': '某个模型思考太久，这一步超时了。刷新即可从最后完成的回合继续。', ja: 'あるモデルの応答に時間がかかり、このターンがタイムアウトしました。再読み込みで最後に完了したターンから再開できます。', ko: '한 모델이 너무 오래 걸려 이 차례가 시간 초과되었습니다. 새로고침하면 마지막으로 끝난 차례부터 이어집니다.' },
  'ww.err.network': { en: 'Lost connection to the table. Reload to resume.', 'zh-Hant': '與牌桌的連線中斷了。重新整理即可繼續。', 'zh-Hans': '与牌桌的连接中断了。刷新即可继续。', ja: 'テーブルとの接続が切れました。再読み込みで再開できます。', ko: '테이블과의 연결이 끊겼습니다. 새로고침하면 이어집니다.' },
  'ww.turn.kill':   { en: 'Your turn — who do the wolves kill?', 'zh-Hant': '輪到你 —— 狼群要殺誰？', 'zh-Hans': '轮到你 —— 狼群要杀谁？', ja: 'あなたの番 — 人狼は誰を襲う？', ko: '당신 차례 — 늑대는 누구를 죽입니까?' },
  'ww.turn.check':  { en: 'Your turn — who do you investigate?', 'zh-Hant': '輪到你 —— 你要查驗誰？', 'zh-Hans': '轮到你 —— 你要查验谁？', ja: 'あなたの番 — 誰を占う？', ko: '당신 차례 — 누구를 확인합니까?' },
  'ww.turn.vote':   { en: 'Your turn — who do you vote to eliminate?', 'zh-Hant': '輪到你 —— 你要投票出局誰？', 'zh-Hans': '轮到你 —— 你要投票出局谁？', ja: 'あなたの番 — 誰に投票する？', ko: '당신 차례 — 누구에게 투표합니까?' },
  'ww.turn.speak':  { en: 'Your turn — say something', 'zh-Hant': '輪到你發言', 'zh-Hans': '轮到你发言', ja: 'あなたの番 — 発言してください', ko: '당신 차례 — 발언하세요' },
  'ww.sayph':       { en: 'accuse someone, defend yourself, or ask a question', 'zh-Hant': '指控某人、替自己辯護，或提出問題', 'zh-Hans': '指控某人、替自己辩护，或提出问题', ja: '誰かを疑う、自分を弁護する、質問する', ko: '누군가를 지목하거나, 변호하거나, 질문하세요' },
  'ww.sayit':       { en: 'Say it', 'zh-Hant': '發言', 'zh-Hans': '发言', ja: '発言', ko: '발언' },
  'ww.day':         { en: 'Day {d}', 'zh-Hant': '第 {d} 天', 'zh-Hans': '第 {d} 天', ja: '{d} 日目', ko: '{d}일째' },
  'ww.newgame':     { en: 'New game', 'zh-Hant': '再來一局', 'zh-Hans': '再来一局', ja: 'もう一局', ko: '새 게임' },
  'nav.xtalk':   { en: 'XTalk', 'zh-Hant': 'X聊天', 'zh-Hans': 'X聊天', ja: 'Xトーク', ko: 'X토크' },
  'omni.placeholder':    { en: 'Search or ask…', 'zh-Hant': '搜尋，或直接提問…', 'zh-Hans': '搜索，或直接提问…', ja: '検索、または質問…', ko: '검색하거나 질문하세요…' },
  'omni.ask':            { en: 'Ask ModelXD', 'zh-Hant': '問 ModelXD', 'zh-Hans': '问 ModelXD', ja: 'ModelXD に聞く', ko: 'ModelXD에게 묻기' },
  'omni.asking':         { en: 'Thinking…', 'zh-Hant': '思考中…', 'zh-Hans': '思考中…', ja: '考え中…', ko: '생각 중…' },
  'omni.goto':           { en: 'Go to {n}', 'zh-Hant': '前往 {n}', 'zh-Hans': '前往 {n}', ja: '{n} へ移動', ko: '{n}(으)로 이동' },
  'omni.askfail':        { en: 'Could not reach the guide just now. Try again in a moment.', 'zh-Hant': '目前無法連上導覽助手，請稍後再試。', 'zh-Hans': '目前无法连上导览助手，请稍后再试。', ja: 'ガイドに接続できませんでした。少し時間をおいてお試しください。', ko: '지금은 가이드에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' },
  'omni.hero':           { en: 'Ask anything, or search ModelXD', 'zh-Hant': '有問題儘管問，或搜尋 ModelXD', 'zh-Hans': '有问题尽管问，或搜索 ModelXD', ja: '何でも質問、または ModelXD を検索', ko: '무엇이든 물어보거나 ModelXD를 검색하세요' },
  'omni.hero.hint':      { en: 'Try “where is Werewolf?” or “which video model is cheapest?”', 'zh-Hant': '試試「狼人殺在哪裡？」或「哪個影片模型最便宜？」', 'zh-Hans': '试试「狼人杀在哪里？」或「哪个视频模型最便宜？」', ja: '例：「人狼はどこ？」「一番安い動画モデルは？」', ko: '예: “마피아 게임은 어디 있나요?” 또는 “가장 저렴한 영상 모델은?”' },
  'la.intro':            { en: 'I am the ModelXD guide. ModelXD helps you find the AI model that gives you the best result for your money — compare models on your own prompt, and vote before the price is revealed.\n\nTell me what you want to do, and I will take you to the right place.', 'zh-Hant': '我是 ModelXD 導覽。ModelXD 幫你找出最划算的 AI 模型——用你自己的提示詞比較模型，在價格揭曉前先投票。\n\n告訴我你想做什麼，我帶你去對的地方。', 'zh-Hans': '我是 ModelXD 导览。ModelXD 帮你找出最划算的 AI 模型——用你自己的提示词比较模型，在价格揭晓前先投票。\n\n告诉我你想做什么，我带你去对的地方。', ja: 'ModelXD のガイドです。ModelXD は、支払った費用に対して最良の結果を出す AI モデルを見つけるお手伝いをします。自分のプロンプトでモデルを比べ、価格が明かされる前に投票します。\n\nやりたいことを教えてください。最適な場所へご案内します。', ko: 'ModelXD 가이드입니다. ModelXD는 지불한 만큼 가장 좋은 결과를 주는 AI 모델을 찾도록 도와줍니다. 직접 만든 프롬프트로 모델을 비교하고, 가격이 공개되기 전에 투표하세요.\n\n무엇을 하고 싶은지 알려주시면 알맞은 곳으로 안내해 드릴게요.' },
  'la.startover':        { en: 'Start over', 'zh-Hant': '重新開始', 'zh-Hans': '重新开始', ja: '最初から', ko: '새로 시작' },
  // ── XDirect storyboard strip ──
  'xd.sb.title':      { en: 'STORYBOARD', 'zh-Hant': '分鏡腳本', 'zh-Hans': '分镜脚本', ja: '絵コンテ', ko: '스토리보드' },
  'xd.sb.scene':      { en: 'Scene', 'zh-Hant': '場景', 'zh-Hans': '场景', ja: 'シーン', ko: '씬' },
  'xd.sb.script':     { en: 'Script', 'zh-Hant': '腳本', 'zh-Hans': '脚本', ja: 'スクリプト', ko: '스크립트' },
  'xd.sb.shot':       { en: 'Shot prompt', 'zh-Hant': '鏡頭提示詞', 'zh-Hans': '镜头提示词', ja: 'ショット指示', ko: '숏 프롬프트' },
  'xd.sb.gen':        { en: 'Generate', 'zh-Hant': '生成', 'zh-Hans': '生成', ja: '生成', ko: '생성' },
  'xd.sb.genall':     { en: 'Generate all', 'zh-Hant': '全部生成', 'zh-Hans': '全部生成', ja: 'すべて生成', ko: '모두 생성' },
  'xd.sb.add':        { en: 'Add scene', 'zh-Hant': '新增場景', 'zh-Hans': '新增场景', ja: 'シーン追加', ko: '씬 추가' },
  'xd.sb.total':      { en: 'Total', 'zh-Hant': '總計', 'zh-Hans': '总计', ja: '合計', ko: '합계' },
  'xd.sb.confirmdel': { en: 'Delete?', 'zh-Hant': '刪除？', 'zh-Hans': '删除？', ja: '削除？', ko: '삭제?' },
  'la.badge':            { en: 'ModelXD Guide', 'zh-Hant': 'ModelXD 導覽', 'zh-Hans': 'ModelXD 导览', ja: 'ModelXD ガイド', ko: 'ModelXD 가이드' },
  // Starter chips. Each one is sent verbatim as a question, and each is
  // chosen to exercise a different routing path — free duel, a template,
  // the director, the board — so the first click demonstrates what the
  // agent is actually for.
  'la.chip.duel':        { en: 'Run a free blind test', 'zh-Hant': '免費盲測比較', 'zh-Hans': '免费盲测比较', ja: '無料でブラインドテスト', ko: '무료 블라인드 테스트' },
  'la.chip.bg':          { en: 'Remove a photo background', 'zh-Hant': '去除照片背景', 'zh-Hans': '去除照片背景', ja: '写真の背景を消す', ko: '사진 배경 지우기' },
  'la.chip.ad':          { en: 'Make an ad video for my product', 'zh-Hant': '幫我的產品做廣告影片', 'zh-Hans': '帮我的产品做广告视频', ja: '商品の広告動画をつくる', ko: '제품 광고 영상 만들기' },
  'la.chip.price':       { en: 'Which video model is cheapest?', 'zh-Hant': '哪個影片模型最便宜？', 'zh-Hans': '哪个视频模型最便宜？', ja: '一番安い動画モデルは？', ko: '가장 저렴한 영상 모델은?' },
  'omni.sec.ask':        { en: 'Agent', 'zh-Hant': '代理人', 'zh-Hans': '代理人', ja: 'エージェント', ko: '에이전트' },
  'omni.sec.pages':      { en: 'Pages', 'zh-Hant': '頁面', 'zh-Hans': '页面', ja: 'ページ', ko: '페이지' },
  'omni.sec.models':     { en: 'Models', 'zh-Hant': '模型', 'zh-Hans': '模型', ja: 'モデル', ko: '모델' },
  'omni.sec.creations':  { en: 'Your creations', 'zh-Hant': '你的作品', 'zh-Hans': '你的作品', ja: 'あなたの作品', ko: '내 작업물' },
  'omni.sec.talks':      { en: 'Your XTalk rooms', 'zh-Hant': '你的 XTalk 房間', 'zh-Hans': '你的 XTalk 房间', ja: 'あなたの XTalk ルーム', ko: '내 XTalk 방' },
  'nav.xboard':       { en: 'XBoard',  'zh-Hant': 'X排行榜', 'zh-Hans': 'X排行榜', ja: 'Xランキング', ko: 'X랭킹' },
  'xcreate.recent':   { en: 'Recent',  'zh-Hant': '最近作品', 'zh-Hans': '最近作品', ja: '最近の作品',  ko: '최근 작품' },
  'nav.profile':      { en: 'Profile', 'zh-Hant': '個人檔案', 'zh-Hans': '个人档案', ja: 'プロフィール', ko: '프로필' },
  'nav.home':         { en: 'Home', 'zh-Hant': '首頁', 'zh-Hans': '首页', ja: 'ホーム', ko: '홈' },
  'nav.terms':        { en: 'Terms', 'zh-Hant': '服務條款', 'zh-Hans': '服务条款', ja: '利用規約', ko: '이용약관' },
  'nav.privacy':      { en: 'Privacy', 'zh-Hant': '隱私政策', 'zh-Hans': '隐私政策', ja: 'プライバシー', ko: '개인정보처리방침' },
  'nav.contact':      { en: 'Contact Us', 'zh-Hant': '聯絡我們', 'zh-Hans': '联系我们', ja: 'お問い合わせ', ko: '문의하기' },
  'home.eyebrow':     { en: 'ModelXD', 'zh-Hant': 'ModelXD', 'zh-Hans': 'ModelXD', ja: 'ModelXD', ko: 'ModelXD' },
  'auth.signin':      { en: 'Sign In',  'zh-Hant': '登入', 'zh-Hans': '登录', ja: 'ログイン',  ko: '로그인' },
  'auth.signout':     { en: 'Sign Out', 'zh-Hant': '登出', 'zh-Hans': '退出', ja: 'ログアウト', ko: '로그아웃' },

  // ── XVote / XBoard (title bar) ──
  'xvote.eyebrow':    { en: 'XVote',         'zh-Hant': 'X投票',    'zh-Hans': 'X投票',    ja: 'X投票',      ko: 'X투표' },
  'xvote.title':      { en: 'Vote on Duels', 'zh-Hant': '為對決投票', 'zh-Hans': '为对决投票', ja: '対決に投票', ko: '대결에 투표' },
  'xboard.eyebrow':   { en: 'XBoard',        'zh-Hant': 'X排行榜',   'zh-Hans': 'X排行榜',   ja: 'Xランキング', ko: 'X랭킹' },
  'xboard.title':     { en: 'Model Leaderboard', 'zh-Hant': '模型排行榜', 'zh-Hans': '模型排行榜', ja: 'モデルランキング', ko: '모델 랭킹' },

  // ── XCreate ──
  'xcreate.eyebrow':  { en: 'XCreate',             'zh-Hant': 'X創作',       'zh-Hans': 'X创作',       ja: 'X作成',                   ko: 'X창작' },
  'xcreate.subtitle': { en: 'Your Private Studio. Bring Ideas to Life.', 'zh-Hant': '你的私人創作室，讓靈感成真。', 'zh-Hans': '你的私人创作室，让灵感成真。', ja: 'あなたのプライベートスタジオ。アイデアを形に。', ko: '나만의 프라이빗 스튜디오. 아이디어를 현실로.' },
  'xcreate.title':    { en: 'Your Private Studio. Bring Ideas to Life.', 'zh-Hant': '你的私人創作室，讓靈感成真。', 'zh-Hans': '你的私人创作室，让灵感成真。', ja: 'あなたのプライベートスタジオ。アイデアを形に。', ko: '나만의 프라이빗 스튜디오. 아이디어를 현실로.' },
  'xcreate.output':   { en: 'Output',              'zh-Hant': '產出類型',    'zh-Hans': '产出类型',    ja: '出力タイプ',              ko: '출력 유형' },
  'mode.text':        { en: 'Text',  'zh-Hant': '文字', 'zh-Hans': '文字', ja: 'テキスト', ko: '텍스트' },
  'mode.image':       { en: 'Image', 'zh-Hant': '圖片', 'zh-Hans': '图片', ja: '画像',    ko: '이미지' },
  'mode.video':       { en: 'Video', 'zh-Hant': '影片', 'zh-Hans': '视频', ja: '動画',    ko: '동영상' },
  'xcreate.template': { en: 'Or start from a template', 'zh-Hant': '或從範本開始', 'zh-Hans': '或从模板开始', ja: 'またはテンプレートから開始', ko: '또는 템플릿에서 시작' },
  'xcreate.provide':  { en: 'You provide:',  'zh-Hant': '你需提供：', 'zh-Hans': '你需提供：', ja: '用意するもの：', ko: '준비물:' },
  'xcreate.popular':       { en: 'Popular', 'zh-Hant': '熱門', 'zh-Hans': '热门', ja: '人気', ko: '인기' },
  // Multi-model discount labels — full strings per language, since the
  // phrasing differs structurally (zh counts what you PAY: 9折 = 90%).
  'discount.2':            { en: '10% off', 'zh-Hant': '9折',  'zh-Hans': '9折',  ja: '10%オフ', ko: '10% 할인' },
  'discount.3':            { en: '15% off', 'zh-Hant': '85折', 'zh-Hans': '85折', ja: '15%オフ', ko: '15% 할인' },
  'discount.4':            { en: '20% off', 'zh-Hant': '8折',  'zh-Hans': '8折',  ja: '20%オフ', ko: '20% 할인' },
  'xcreate.submode':       { en: 'What you start from', 'zh-Hant': '從什麼開始',  'zh-Hans': '从什么开始',  ja: '何から始めるか', ko: '무엇으로 시작할지' },
  'xcreate.creationmode':  { en: 'Creation Mode:',      'zh-Hant': '創作模式：',  'zh-Hans': '创作模式：',  ja: '作成モード：',   ko: '창작 모드:' },
  'xcreate.createfrom':    { en: 'Create from',         'zh-Hant': '創作來源',    'zh-Hans': '创作来源',    ja: '作成元',        ko: '시작 소스' },
  'xcreate.generate':      { en: 'Generate:',           'zh-Hant': '生成：',      'zh-Hans': '生成：',      ja: '生成：',        ko: '생성:' },
  'xcreate.from':          { en: 'From:',               'zh-Hant': '來源：',      'zh-Hans': '来源：',      ja: '入力：',        ko: '입력:' },
  'xcreate.selectmodels':  { en: 'Select Models:',      'zh-Hant': '選擇模型：',  'zh-Hans': '选择模型：',  ja: 'モデルを選択：', ko: '모델 선택:' },
  'xcreate.to':            { en: 'to',                  'zh-Hant': '轉',         'zh-Hans': '转',         ja: '→',            ko: '→' },
  'xcreate.alltools':      { en: 'Tools',     'zh-Hant': '工具', 'zh-Hans': '工具', ja: 'ツール',      ko: '도구' },
  'xcreate.alltemplates':  { en: 'Templates', 'zh-Hant': '範本', 'zh-Hans': '模板', ja: 'テンプレート', ko: '템플릿' },

  // Sub-mode labels — full input→output names, shown in the dropdown menu.
  'recipe.text_to_text':     { en: 'Text to Text',       'zh-Hant': '文字轉文字',   'zh-Hans': '文字转文字',   ja: 'テキスト → テキスト', ko: '텍스트 → 텍스트' },
  'recipe.image_to_text':    { en: 'Image to Text',      'zh-Hant': '圖片轉文字',   'zh-Hans': '图片转文字',   ja: '画像 → テキスト',    ko: '이미지 → 텍스트' },
  'recipe.pdf_to_text':      { en: 'PDF to Text',        'zh-Hant': 'PDF 轉文字',  'zh-Hans': 'PDF 转文字',  ja: 'PDF → テキスト',     ko: 'PDF → 텍스트' },
  'recipe.video_to_text':    { en: 'Video to Text',      'zh-Hant': '影片轉文字',   'zh-Hans': '视频转文字',   ja: '動画 → テキスト',    ko: '동영상 → 텍스트' },
  'recipe.text_to_image':    { en: 'Text to Image',      'zh-Hant': '文字轉圖片',   'zh-Hans': '文字转图片',   ja: 'テキスト → 画像',    ko: '텍스트 → 이미지' },
  'recipe.image_edit':       { en: 'Image to Image',     'zh-Hant': '圖片轉圖片',   'zh-Hans': '图片转图片',   ja: '画像 → 画像',       ko: '이미지 → 이미지' },
  'recipe.text_to_video':    { en: 'Text to Video',      'zh-Hant': '文字轉影片',   'zh-Hans': '文字转视频',   ja: 'テキスト → 動画',    ko: '텍스트 → 동영상' },
  'recipe.image_to_video':   { en: 'Image to Video',     'zh-Hant': '圖片轉影片',   'zh-Hans': '图片转视频',   ja: '画像 → 動画',       ko: '이미지 → 동영상' },
  'recipe.video_to_video':   { en: 'Video to Video',     'zh-Hant': '影片轉影片',   'zh-Hans': '视频转视频',   ja: '動画 → 動画',       ko: '동영상 → 동영상' },
  'recipe.start_end_frames': { en: 'Frames to Video',    'zh-Hant': '頭尾幀轉影片', 'zh-Hans': '首尾帧转视频', ja: 'フレーム → 動画',    ko: '프레임 → 동영상' },
  'recipe.video_edit':       { en: 'Video Edit',          'zh-Hant': '影片編輯',     'zh-Hans': '视频编辑',     ja: '動画編集',          ko: '동영상 편집' },
  'recipe.reference_frames': { en: 'Reference to Video', 'zh-Hant': '參考圖轉影片', 'zh-Hans': '参考图转视频', ja: '参照画像 → 動画',    ko: '참조 이미지 → 동영상' },

  // "From: ___" button values — plain input nouns. Every sub-mode also
  // takes a text prompt; that's understood, so we don't spell it out.
  'recipefrom.text_to_text':     { en: 'Text',  'zh-Hant': '文字', 'zh-Hans': '文字', ja: 'テキスト', ko: '텍스트' },
  'recipefrom.image_to_text':    { en: 'Image', 'zh-Hant': '圖片', 'zh-Hans': '图片', ja: '画像',    ko: '이미지' },
  'recipefrom.pdf_to_text':      { en: 'PDF',   'zh-Hant': 'PDF', 'zh-Hans': 'PDF', ja: 'PDF',    ko: 'PDF' },
  'recipefrom.video_to_text':    { en: 'Video', 'zh-Hant': '影片', 'zh-Hans': '视频', ja: '動画',    ko: '동영상' },
  'recipefrom.text_to_image':    { en: 'Text',  'zh-Hant': '文字', 'zh-Hans': '文字', ja: 'テキスト', ko: '텍스트' },
  'recipefrom.image_edit':       { en: 'Image', 'zh-Hant': '圖片', 'zh-Hans': '图片', ja: '画像',    ko: '이미지' },
  'recipefrom.text_to_video':    { en: 'Text',  'zh-Hant': '文字', 'zh-Hans': '文字', ja: 'テキスト', ko: '텍스트' },
  'recipefrom.image_to_video':   { en: 'Image', 'zh-Hant': '圖片', 'zh-Hans': '图片', ja: '画像',    ko: '이미지' },
  'recipefrom.video_to_video':   { en: 'Video', 'zh-Hant': '影片', 'zh-Hans': '视频', ja: '動画',    ko: '동영상' },
  'recipefrom.video_edit':       { en: 'Video + Ref Images', 'zh-Hant': '影片＋參考圖', 'zh-Hans': '视频＋参考图', ja: '動画＋参照画像', ko: '동영상+참조 이미지' },
  'recipefrom.start_end_frames': { en: 'Start + End Frames', 'zh-Hant': '頭尾幀',  'zh-Hans': '首尾帧',   ja: '最初+最後のフレーム', ko: '시작+끝 프레임' },
  'recipefrom.reference_frames': { en: 'Reference Images',   'zh-Hant': '參考圖片', 'zh-Hans': '参考图片', ja: '参照画像',          ko: '참조 이미지' },

  // ── XDuel ──
  'xduel.eyebrow':    { en: 'XDuel',            'zh-Hant': 'X對決',       'zh-Hans': 'X对决',       ja: 'X対決',          ko: 'X대결' },
  // Page identity — what XDuel IS, shown in the title bar (CC, July 19).
  'xduel.title':      { en: 'Blind Model Battle', 'zh-Hant': '模型盲測對決', 'zh-Hans': '模型盲测对决', ja: 'ブラインドモデル対決', ko: '블라인드 모델 대결' },
  'xduel.start':      { en: 'Create Your Task', 'zh-Hant': '建立你的任務', 'zh-Hans': '创建你的任务', ja: 'タスクを作成',   ko: '작업 만들기' },
  'xduel.reveal':     { en: 'The Reveal',       'zh-Hant': '揭曉',       'zh-Hans': '揭晓',       ja: '結果発表',       ko: '공개' },
  'xduel.voteblind':  { en: 'Vote Blind',       'zh-Hant': '盲測投票',    'zh-Hans': '盲测投票',    ja: 'ブラインド投票',  ko: '블라인드 투표' },
  'xduel.voteagain':  { en: 'Vote Again',       'zh-Hant': '再次投票',    'zh-Hans': '再次投票',    ja: 'もう一度投票',    ko: '다시 투표' },
  'xduel.cta':        { en: 'Start XDuel',      'zh-Hant': '開始對決',    'zh-Hans': '开始对决',    ja: '対決を開始',      ko: '대결 시작' },
  'xduel.publichint': { en: 'Duels are public. Yours will appear in XVote for others to vote on.', 'zh-Hant': '對決是公開的。你的結果會出現在 XVote 供其他人投票。', 'zh-Hans': '对决是公开的。你的结果会出现在 XVote 供其他人投票。', ja: '対決は公開されます。結果は XVote に表示され、他のユーザーが投票できます。', ko: '대결은 공개됩니다. 결과는 XVote에 표시되어 다른 사용자가 투표할 수 있습니다.' },

  // ── Home (hero + CTAs) ──
  'home.hero':        { en: 'Overpaying for AI?!', 'zh-Hant': '為 AI 付太多了嗎？', 'zh-Hans': '为 AI 付太多了吗？', ja: 'AIに払いすぎていませんか？', ko: 'AI 요금, 너무 많이 내고 있나요?' },
  'home.sub':         { en: 'See AI results side by side and find the best model for your budget', 'zh-Hant': '並排比較 AI 結果，找出最適合你預算的模型', 'zh-Hans': '并排比较 AI 结果，找出最适合你预算的模型', ja: 'AIの結果を並べて比較して、予算に合う最適なモデルを見つけよう', ko: 'AI 결과를 나란히 비교하고 예산에 맞는 최적의 모델을 찾으세요' },

  // ── Full-coverage pass (CC, July 19): page-body strings ──
  // Templates use {n}/{mode}/{l} placeholders — callers .replace() them.
  'common.all':          { en: 'All', 'zh-Hant': '全部', 'zh-Hans': '全部', ja: 'すべて', ko: '전체' },
  'common.cancel':       { en: 'Cancel', 'zh-Hant': '取消', 'zh-Hans': '取消', ja: 'キャンセル', ko: '취소' },
  'common.close':        { en: 'Close', 'zh-Hant': '關閉', 'zh-Hans': '关闭', ja: '閉じる', ko: '닫기' },
  'xt.help':             { en: 'How to play', 'zh-Hant': '玩法說明', 'zh-Hans': '玩法说明', ja: '遊び方', ko: '게임 방법' },
  'xt.help.setup':       { en: 'How it works', 'zh-Hant': '使用說明', 'zh-Hans': '使用说明', ja: '使い方', ko: '사용 방법' },
  'xt.d.pick':           { en: 'Pick 2–{n} models', 'zh-Hant': '選擇 2–{n} 個模型', 'zh-Hans': '选择 2–{n} 个模型', ja: 'モデルを 2〜{n} 個選ぶ', ko: '모델 2–{n}개 선택' },
  'xt.d.chosen':         { en: '{n} chosen', 'zh-Hant': '已選 {n} 個', 'zh-Hans': '已选 {n} 个', ja: '{n} 個選択済み', ko: '{n}개 선택됨' },
  'xt.d.order':          { en: 'Speaking order', 'zh-Hant': '發言順序', 'zh-Hans': '发言顺序', ja: '発言順', ko: '발언 순서' },
  'xt.d.order.inorder':  { en: 'In order', 'zh-Hant': '依序', 'zh-Hans': '依序', ja: '順番に', ko: '순서대로' },
  'xt.d.order.auto':     { en: 'Auto', 'zh-Hant': '自動', 'zh-Hans': '自动', ja: '自動', ko: '자동' },
  'xt.d.order.manual':   { en: 'Manual pick', 'zh-Hant': '手動指定', 'zh-Hans': '手动指定', ja: '手動指名', ko: '직접 지명' },
  'xt.d.rotate':         { en: 'rotate who opens each round', 'zh-Hant': '每輪輪流由不同人開場', 'zh-Hans': '每轮轮流由不同人开场', ja: '毎ラウンド先頭を入れ替える', ko: '매 라운드 시작하는 사람을 교대' },
  'xt.d.character':      { en: 'Character', 'zh-Hant': '角色設定', 'zh-Hans': '角色设定', ja: 'キャラクター', ko: '캐릭터' },
  'xt.d.whonext':        { en: 'Who speaks next', 'zh-Hant': '接下來由誰發言', 'zh-Hans': '接下来由谁发言', ja: '次に発言する人', ko: '다음 발언자' },
  'xt.d.bidnote':        { en: 'Before every turn each model bids 0–4 for the floor — 4 means “someone addressed me directly and I must respond”. The highest bid speaks and pays its bid in speaking credits ({s} to start, +{r} a round, {c} max), so hogging the floor leaves you broke while listening a while lets you outbid anyone. Ties go to whoever was just named.', 'zh-Hant': '每次發言前，每個模型都會為發言權出價 0–4；4 代表「有人直接點名我，我必須回應」。出價最高的模型發言，並支付等額的發言點數（初始 {s} 點，每輪回復 {r} 點，上限 {c} 點）。一直搶話會把點數用光，安靜一陣子反而能出價蓋過任何人。平手時由剛被點名的人發言。', 'zh-Hans': '每次发言前，每个模型都会为发言权出价 0–4；4 代表「有人直接点名我，我必须回应」。出价最高的模型发言，并支付等额的发言点数（初始 {s} 点，每轮回复 {r} 点，上限 {c} 点）。一直抢话会把点数用光，安静一阵子反而能出价盖过任何人。平手时由刚被点名的人发言。', ja: '各ターンの前に、すべてのモデルが発言権を 0〜4 で入札します。4 は「直接名指しされたので答えなければならない」という意味です。最高額を入札したモデルが発言し、その額を発言クレジットで支払います（初期 {s}、毎ラウンド +{r}、上限 {c}）。話し続ければ底をつき、しばらく聞き役に回れば誰よりも高く入札できます。同額の場合は直前に名前を呼ばれたモデルが発言します。', ko: '매 차례 전에 모든 모델이 발언권을 0–4로 입찰합니다. 4는 「누군가 나를 직접 지목했으므로 반드시 답해야 한다」는 뜻입니다. 최고 입찰자가 발언하고 그 값만큼 발언 크레딧을 지불합니다(시작 {s}, 매 라운드 +{r}, 최대 {c}). 계속 발언하면 크레딧이 바닥나고, 잠시 듣기만 하면 누구보다 높게 입찰할 수 있습니다. 동점이면 방금 이름이 불린 쪽이 발언합니다.' },
  'xt.d.manualnote':     { en: 'Nobody speaks until you call on them — once the room opens, click a speaker to give them the floor.', 'zh-Hant': '在你點名之前沒有人會發言——房間開始後，點一下某個模型就把發言權交給它。', 'zh-Hans': '在你点名之前没有人会发言——房间开始后，点一下某个模型就把发言权交给它。', ja: 'あなたが指名するまで誰も発言しません。ルームを開いたあと、話させたいモデルをクリックしてください。', ko: '직접 지명하기 전까지는 아무도 발언하지 않습니다. 방을 연 뒤 발언시킬 모델을 클릭하세요.' },
  'xt.d.open':           { en: 'Open the room →', 'zh-Hant': '開啟房間 →', 'zh-Hans': '开启房间 →', ja: 'ルームを開く →', ko: '방 열기 →' },
  'xt.d.need2':          { en: 'Pick at least 2 models', 'zh-Hant': '至少選 2 個模型', 'zh-Hans': '至少选 2 个模型', ja: 'モデルを 2 つ以上選択', ko: '모델을 2개 이상 선택' },
  'xt.d.speakers':       { en: '{n} speakers', 'zh-Hant': '{n} 位發言者', 'zh-Hans': '{n} 位发言者', ja: '発言者 {n} 名', ko: '발언자 {n}명' },
  'xt.d.sum.manual':     { en: 'you call on them', 'zh-Hant': '由你點名', 'zh-Hans': '由你点名', ja: 'あなたが指名', ko: '직접 지명' },
  'xt.d.sum.bid':        { en: 'they bid for the floor', 'zh-Hant': '競標發言權', 'zh-Hans': '竞标发言权', ja: '発言権を入札', ko: '발언권 입찰' },
  'xt.d.inroom':         { en: 'In the room', 'zh-Hant': '房間成員', 'zh-Hans': '房间成员', ja: 'ルームの参加者', ko: '방 참가자' },
  'xt.d.ph.start':       { en: 'Say something to start them off — e.g. “Is buying an AI wrapper startup ever a good idea?”', 'zh-Hant': '說點什麼當開場——例如「買下一家 AI 套殼新創到底划不划算？」', 'zh-Hans': '说点什么当开场——例如「买下一家 AI 套壳新创到底划不划算？」', ja: '口火を切る一言を入力してください——例：「AI ラッパーのスタートアップを買収するのは得策か？」', ko: '대화를 시작할 말을 입력하세요 — 예: “AI 래퍼 스타트업을 인수하는 게 과연 좋은 선택일까?”' },
  'xt.d.ph.cutin':       { en: 'Cut in — whoever has not spoken yet will read it', 'zh-Hant': '插話——還沒發言的人都會讀到', 'zh-Hans': '插话——还没发言的人都会读到', ja: '割り込む——まだ発言していない全員が読みます', ko: '끼어들기 — 아직 발언하지 않은 모두가 읽습니다' },
  'xt.d.ph.manual':      { en: 'Say something yourself — nobody replies until you call on them', 'zh-Hant': '你先說點什麼——在你點名之前沒有人會回應', 'zh-Hans': '你先说点什么——在你点名之前没有人会回应', ja: '何か発言してください——指名するまで誰も返しません', ko: '먼저 말해 보세요 — 지명하기 전까지 아무도 답하지 않습니다' },
  'xt.d.ph.say':         { en: 'Say something — they will all read it', 'zh-Hant': '說點什麼——所有人都會讀到', 'zh-Hans': '说点什么——所有人都会读到', ja: '何か発言してください——全員が読みます', ko: '무언가 말해 보세요 — 모두가 읽습니다' },
  'dc.help.title':       { en: 'How Discussion works', 'zh-Hant': '討論功能怎麼用', 'zh-Hans': '讨论功能怎么用', ja: 'ディスカッションの使い方', ko: '토론 사용 방법' },
  'dc.help.what.h':      { en: 'What it is', 'zh-Hant': '這是什麼', 'zh-Hans': '这是什么', ja: 'これは何か', ko: '무엇인가요' },
  'dc.help.what.b':      { en: 'A private room where the AI models you choose talk to each other about a topic you set. You can sit back and watch, or join in at any time — anything you type goes into the transcript, and every model reads it before its next turn.', 'zh-Hant': '一個私人房間，由你挑選的 AI 模型針對你出的題目彼此對話。你可以純觀看，也可以隨時加入——你打的任何內容都會進入對話紀錄，每個模型在下一次發言前都會讀到。', 'zh-Hans': '一个私人房间，由你挑选的 AI 模型针对你出的题目彼此对话。你可以纯观看，也可以随时加入——你打的任何内容都会进入对话记录，每个模型在下一次发言前都会读到。', ja: 'あなたが選んだ AI モデルが、あなたの出したお題について語り合うプライベートルームです。眺めているだけでも、いつでも会話に加わってもかまいません。入力した内容はすべて記録に残り、各モデルは次の発言前にそれを読みます。', ko: '직접 고른 AI 모델들이 여러분이 정한 주제로 대화하는 비공개 방입니다. 지켜보기만 해도 되고 언제든 끼어들어도 됩니다. 입력한 내용은 모두 대화 기록에 들어가며, 각 모델은 다음 발언 전에 이를 읽습니다.' },
  'dc.help.models.h':    { en: 'Choose the models', 'zh-Hant': '選擇模型', 'zh-Hans': '选择模型', ja: 'モデルを選ぶ', ko: '모델 선택' },
  'dc.help.models.b':    { en: 'Pick 2 to 8 models. Each seat has a gear where you can set that model’s thinking depth and switch web search on, so you can deliberately put a fast answer up against a slow one.', 'zh-Hant': '可以選 2 到 8 個模型。每個座位都有一個齒輪，可以設定該模型的思考深度、開啟網路搜尋，所以你能刻意讓「快答」跟「慢想」同場較勁。', 'zh-Hans': '可以选 2 到 8 个模型。每个座位都有一个齿轮，可以设定该模型的思考深度、开启网络搜索，所以你能刻意让「快答」跟「慢想」同场较劲。', ja: 'モデルは 2〜8 個選べます。各席の歯車から、そのモデルの思考の深さを設定したりウェブ検索を有効にしたりできるので、速い回答と遅い熟考をあえてぶつけることもできます。', ko: '모델은 2~8개까지 고를 수 있습니다. 각 자리의 톱니바퀴에서 해당 모델의 사고 깊이를 정하고 웹 검색을 켤 수 있어, 빠른 답변과 느린 숙고를 일부러 맞붙일 수도 있습니다.' },
  'dc.help.order.h':     { en: 'Speaking order', 'zh-Hant': '發言順序', 'zh-Hans': '发言顺序', ja: '発言順', ko: '발언 순서' },
  'dc.help.order.b':     { en: 'In order — everyone speaks once per round, in the order shown, and you can rotate who opens.\nAuto — before each turn every model bids for the floor and the highest bid speaks, paying its bid in speaking credits, so nobody can hold the floor forever.\nManual pick — nobody speaks until you call on them.\nYou can switch between these in the middle of a conversation; the change takes effect from the next turn.', 'zh-Hant': '依序——每輪每個人各發言一次，按畫面上的順序，也可以讓每輪的開場者輪流。\n自動——每次發言前所有模型競標發言權，出價最高的發言並支付等額點數，所以沒有人能一直霸佔發言權。\n手動指定——在你點名之前沒有人會發言。\n這三種模式在對話進行中隨時可以切換，切換後從下一次發言開始生效。', 'zh-Hans': '依序——每轮每个人各发言一次，按画面上的顺序，也可以让每轮的开场者轮流。\n自动——每次发言前所有模型竞标发言权，出价最高的发言并支付等额点数，所以没有人能一直霸占发言权。\n手动指定——在你点名之前没有人会发言。\n这三种模式在对话进行中随时可以切换，切换后从下一次发言开始生效。', ja: '順番に——毎ラウンド全員が表示順に一度ずつ発言します。先頭を毎回入れ替えることもできます。\n自動——各ターンの前に全モデルが発言権を入札し、最高額のモデルが発言してその分の発言クレジットを支払います。誰も発言権を独占できません。\n手動指名——あなたが指名するまで誰も発言しません。\nこれらは会話の途中でも切り替えられ、次のターンから反映されます。', ko: '순서대로 — 매 라운드 화면에 보이는 순서로 한 번씩 발언하며, 시작하는 사람을 교대시킬 수도 있습니다.\n자동 — 매 차례 전에 모든 모델이 발언권을 입찰하고 최고 입찰자가 발언하며 그만큼 발언 크레딧을 지불합니다. 누구도 발언권을 독점할 수 없습니다.\n직접 지명 — 여러분이 지명하기 전까지 아무도 발언하지 않습니다.\n이 세 가지는 대화 도중에도 전환할 수 있으며, 다음 차례부터 적용됩니다.' },
  'dc.help.char.h':      { en: 'Character', 'zh-Hant': '角色設定', 'zh-Hans': '角色设定', ja: 'キャラクター', ko: '캐릭터' },
  'dc.help.char.b':      { en: 'Each seat can be given a character — a short instruction shaping how that model behaves. This is the real lever for disagreement: without it, several capable models tend to agree with each other, and simply ordering them to argue makes the conflict an artefact of your instruction rather than a real difference of view.', 'zh-Hant': '每個座位都可以設定一個角色，也就是一段簡短的指示，決定該模型的行為風格。這才是製造分歧的真正手段：不設定的話，幾個能力相近的模型通常會互相附和；而直接命令它們吵架，衝突就只是指令的產物，不是真正的意見差異。', 'zh-Hans': '每个座位都可以设定一个角色，也就是一段简短的指示，决定该模型的行为风格。这才是制造分歧的真正手段：不设定的话，几个能力相近的模型通常会互相附和；而直接命令它们吵架，冲突就只是指令的产物，不是真正的意见差异。', ja: '各席にはキャラクター（そのモデルの振る舞いを形づくる短い指示）を設定できます。意見の相違を生む本当のレバーはここです。設定しなければ、能力の高いモデル同士はたいてい同意し合いますし、単に「議論しろ」と命じれば、その対立は指示が作った産物であって本当の見解の違いではなくなります。', ko: '각 자리에는 캐릭터, 즉 해당 모델의 행동 방식을 정하는 짧은 지시를 줄 수 있습니다. 이것이 의견 차이를 만드는 진짜 수단입니다. 설정하지 않으면 뛰어난 모델들끼리는 대체로 서로 동의하게 되고, 그냥 논쟁하라고 시키면 그 갈등은 실제 견해 차이가 아니라 지시가 만들어낸 산물이 됩니다.' },
  'dc.help.join.h':      { en: 'Joining in', 'zh-Hant': '你也可以參與', 'zh-Hans': '你也可以参与', ja: '会話に加わる', ko: '대화 참여' },
  'dc.help.join.b':      { en: 'Type at any time to steer the room, ask a follow-up or push back. You can also add or remove a model in the middle of a conversation — one added later reads the whole transcript before its first turn.', 'zh-Hant': '你隨時可以打字，帶風向、追問或反駁。對話進行中也可以加入或移除模型——後來才加入的模型，第一次發言前會先讀完整份對話紀錄。', 'zh-Hans': '你随时可以打字，带风向、追问或反驳。对话进行中也可以加入或移除模型——后来才加入的模型，第一次发言前会先读完整份对话记录。', ja: 'いつでも入力して、話の向きを変えたり、追加で質問したり、反論したりできます。会話の途中でモデルを追加・削除することも可能で、後から加わったモデルは最初の発言前に記録全体を読みます。', ko: '언제든 입력해서 대화의 방향을 바꾸거나, 추가로 질문하거나, 반박할 수 있습니다. 대화 도중에 모델을 추가하거나 뺄 수도 있으며, 나중에 합류한 모델은 첫 발언 전에 기록 전체를 읽습니다.' },
  'dc.help.cost.h':      { en: 'Cost', 'zh-Hant': '費用', 'zh-Hans': '费用', ja: '料金', ko: '비용' },
  'dc.help.cost.b':      { en: 'Every turn is a real API call, priced per model. The cost of each turn is shown on its card and charged to your ModelXD balance, so a long round with expensive models is visible as it happens rather than a surprise afterwards.', 'zh-Hant': '每一次發言都是一次真實的 API 呼叫，依模型計價。每則發言的花費會顯示在該則卡片上，並從你的 ModelXD 餘額扣除，所以用貴模型跑長對話時，花費是當下就看得到的，不會事後才嚇一跳。', 'zh-Hans': '每一次发言都是一次真实的 API 调用，依模型计价。每则发言的花费会显示在该则卡片上，并从你的 ModelXD 余额扣除，所以用贵模型跑长对话时，花费是当下就看得到的，不会事后才吓一跳。', ja: '発言は一つひとつが実際の API 呼び出しで、モデルごとに課金されます。各ターンの費用はそのカードに表示され、ModelXD の残高から差し引かれます。高価なモデルで長く回した場合も、費用はその場で見えるので後から驚くことはありません。', ko: '모든 발언은 실제 API 호출이며 모델별로 과금됩니다. 각 차례의 비용은 해당 카드에 표시되고 ModelXD 잔액에서 차감되므로, 비싼 모델로 길게 돌려도 비용이 그 자리에서 보이며 나중에 놀랄 일이 없습니다.' },
  'ww.help.title':       { en: 'How to play Werewolf', 'zh-Hant': '狼人殺怎麼玩', 'zh-Hans': '狼人杀怎么玩', ja: '人狼の遊び方', ko: '마피아 게임 방법' },
  'ww.help.goal.h':      { en: 'The goal', 'zh-Hant': '目標', 'zh-Hans': '目标', ja: '目的', ko: '목표' },
  'ww.help.goal.b':      { en: 'Seven players sit at the table. Two of them are secretly werewolves; everyone else is a villager trying to find them. The wolves win by surviving. The village wins by voting both wolves out.', 'zh-Hant': '牌桌上有七位玩家，其中兩位是狼人，其餘都是好人，任務是把狼人找出來。狼人活到最後就贏；好人把兩隻狼都投出去就贏。', 'zh-Hans': '牌桌上有七位玩家，其中两位是狼人，其余都是好人，任务是把狼人找出来。狼人活到最后就赢；好人把两只狼都投出去就赢。', ja: '卓には7人が座ります。うち2人が人狼で、残りは人狼を探す村人です。人狼は生き残れば勝ち、村人は2人の人狼を追放できれば勝ちです。', ko: '테이블에는 7명이 앉습니다. 그중 2명이 늑대인간이고, 나머지는 이들을 찾아내야 하는 마을 사람입니다. 늑대는 살아남으면 이기고, 마을은 늑대 2명을 모두 처형하면 이깁니다.' },
  'ww.help.roles.h':     { en: 'The board', 'zh-Hant': '角色配置', 'zh-Hans': '角色配置', ja: '配役', ko: '역할 구성' },
  'ww.help.roles.b':     { en: '2 Werewolves — they know each other, and kill one player each night.\n1 Seer — checks one player each night and learns whether they are a wolf.\n1 Doctor — protects one player each night, and may protect themselves.\n3 Villagers — no ability at all, only their judgement.', 'zh-Hant': '2 狼人——彼此知道身分，每晚可以殺一個人。\n1 預言家——每晚查驗一位玩家，得知他是不是狼。\n1 醫生——每晚保護一位玩家，也可以保護自己。\n3 平民——沒有任何技能，只能靠推理。', 'zh-Hans': '2 狼人——彼此知道身分，每晚可以杀一个人。\n1 预言家——每晚查验一位玩家，得知他是不是狼。\n1 医生——每晚保护一位玩家，也可以保护自己。\n3 平民——没有任何技能，只能靠推理。', ja: '人狼 2 ——お互いを知っており、毎晩1人を襲撃します。\n占い師 1 ——毎晩1人を占い、人狼かどうかを知ります。\n医者 1 ——毎晩1人を守ります。自分を守ることもできます。\n村人 3 ——能力はなく、推理だけが武器です。', ko: '늑대인간 2 — 서로를 알고 있으며, 매일 밤 한 명을 죽입니다.\n예언자 1 — 매일 밤 한 명을 확인해 늑대인지 알아냅니다.\n의사 1 — 매일 밤 한 명을 보호하며, 자신도 보호할 수 있습니다.\n마을 주민 3 — 능력이 없고 추리로만 싸웁니다.' },
  'ww.help.night.h':     { en: 'Night', 'zh-Hant': '夜晚', 'zh-Hans': '夜晚', ja: '夜', ko: '밤' },
  'ww.help.night.b':     { en: 'Everyone closes their eyes. The wolves choose someone to kill, then the Seer investigates one player, then the Doctor chooses someone to protect. Because the Doctor acts after the wolves have already chosen, protecting the right person saves them — and the morning is quiet.', 'zh-Hant': '所有人閉眼。狼人先選擇要殺的人，接著預言家查驗一位玩家，最後醫生選擇要保護的人。因為醫生是在狼人選完之後才行動，只要保對人，那個人就會活下來，隔天就是平安夜。', 'zh-Hans': '所有人闭眼。狼人先选择要杀的人，接着预言家查验一位玩家，最后医生选择要保护的人。因为医生是在狼人选完之后才行动，只要保对人，那个人就会活下来，隔天就是平安夜。', ja: '全員が目を閉じます。まず人狼が襲撃先を決め、次に占い師が1人を占い、最後に医者が守る相手を選びます。医者は人狼の後に動くため、正しい相手を守れればその人は助かり、朝は平和になります。', ko: '모두 눈을 감습니다. 늑대가 먼저 죽일 대상을 고르고, 이어서 예언자가 한 명을 확인하며, 마지막으로 의사가 보호할 대상을 정합니다. 의사가 늑대보다 나중에 행동하므로, 제대로 보호하면 그 사람은 살아남고 아침은 평화롭습니다.' },
  'ww.help.day.h':       { en: 'Day', 'zh-Hant': '白天', 'zh-Hans': '白天', ja: '昼', ko: '낮' },
  'ww.help.day.b':       { en: 'The night’s death is announced. Every living player speaks once, in a rotating order, and then everyone votes. Whoever takes the most votes is eliminated and their role is revealed. A tie eliminates nobody.', 'zh-Hant': '先公布昨晚的死訊。所有存活玩家依輪替順序各發言一次，然後全體投票。得票最高的人出局並公開身分；平票則無人出局。', 'zh-Hans': '先公布昨晚的死讯。所有存活玩家依轮替顺序各发言一次，然后全体投票。得票最高的人出局并公开身分；平票则无人出局。', ja: '夜の犠牲者が発表されます。生存者全員が順番に1回ずつ発言し、その後で全員が投票します。最多票の人が追放され、正体が公開されます。同数の場合は誰も追放されません。', ko: '밤에 생긴 희생자가 발표됩니다. 살아 있는 모든 플레이어가 순서를 바꿔가며 한 번씩 발언한 뒤 전원이 투표합니다. 최다 득표자가 처형되고 정체가 공개되며, 동점이면 아무도 처형되지 않습니다.' },
  'ww.help.win.h':       { en: 'Winning', 'zh-Hant': '勝負條件', 'zh-Hans': '胜负条件', ja: '勝敗', ko: '승패' },
  'ww.help.win.b':       { en: 'The village wins the moment both wolves are eliminated. The wolves win as soon as they equal the number of villagers left alive — from that point on they can no longer be out-voted.', 'zh-Hant': '兩隻狼都被投出去，好人陣營獲勝。當狼人數量等於剩下的好人時，狼人陣營獲勝——因為從那一刻起，好人已經投不掉他們了。', 'zh-Hans': '两只狼都被投出去，好人阵营获胜。当狼人数量等于剩下的好人时，狼人阵营获胜——因为从那一刻起，好人已经投不掉他们了。', ja: '人狼2人が追放された時点で村人陣営の勝ちです。人狼の数が生存する村人の数と並んだ時点で人狼陣営の勝ちです——そうなると、もう投票では覆せません。', ko: '늑대 2명이 모두 처형되면 마을 진영의 승리입니다. 늑대의 수가 살아남은 마을 사람의 수와 같아지면 늑대 진영의 승리입니다 — 그 순간부터는 투표로 이길 수 없기 때문입니다.' },
  'ww.help.you.h':       { en: 'Playing or watching', 'zh-Hant': '下場或觀戰', 'zh-Hans': '下场或观战', ja: 'プレイと観戦', ko: '참가와 관전' },
  'ww.help.you.b':       { en: 'You can take a seat yourself and even ask for the role you want, or let seven AI models play the whole game while you watch. Lying is allowed for everyone, villagers included. While watching you can reveal each model’s private reasoning — but while you are playing, it stays hidden.', 'zh-Hant': '你可以自己下場，甚至指定想要的角色；也可以讓七個 AI 模型自己把整局打完，你在旁邊觀戰。所有人都可以說謊，包括好人。觀戰時你可以打開 AI 的私密思考；但當你自己下場時，思考會被隱藏。', 'zh-Hans': '你可以自己下场，甚至指定想要的角色；也可以让七个 AI 模型自己把整局打完，你在旁边观战。所有人都可以说谎，包括好人。观战时你可以打开 AI 的私密思考；但当你自己下场时，思考会被隐藏。', ja: '自分が席に着き、希望の役職を指定することもできますし、7つの AI モデルだけに最後まで打たせて観戦することもできます。嘘は村人も含め全員に許されています。観戦中は各モデルの非公開の思考を表示できますが、自分がプレイしている間は隠されます。', ko: '직접 자리에 앉아 원하는 역할을 요청할 수도 있고, AI 모델 7개가 한 판을 끝까지 진행하는 것을 관전할 수도 있습니다. 거짓말은 마을 사람을 포함해 모두에게 허용됩니다. 관전 중에는 각 모델의 비공개 사고를 볼 수 있지만, 직접 플레이하는 동안에는 숨겨집니다.' },
  'beta.official':       { en: 'Official site', 'zh-Hant': '前往正式版', 'zh-Hans': '前往正式版', ja: '公式サイトへ', ko: '공식 사이트로' },
  'common.share':     { en: '↗ Share', 'zh-Hant': '↗ 分享', 'zh-Hans': '↗ 分享', ja: '↗ 共有', ko: '↗ 공유' },
  'common.copied':    { en: '✓ Copied', 'zh-Hant': '✓ 已複製', 'zh-Hans': '✓ 已复制', ja: '✓ コピー済み', ko: '✓ 복사됨' },
  'common.delete':    { en: '✕ Delete', 'zh-Hant': '✕ 刪除', 'zh-Hans': '✕ 删除', ja: '✕ 削除', ko: '✕ 삭제' },
  'xcreate.modelslot': { en: 'Model {l}', 'zh-Hant': '模型 {l}', 'zh-Hans': '模型 {l}', ja: 'モデル {l}', ko: '모델 {l}' },
  'xduel.subtitle':      { en: 'Create a Task. Let AI Compete. Vote for Your Favorite.', 'zh-Hant': '建立任務，讓 AI 同場競技，投票給你的最愛。', 'zh-Hans': '创建任务，让 AI 同场竞技，投票给你的最爱。', ja: 'タスクを作成。AIを競わせて、お気に入りに投票。', ko: '작업을 만들고, AI를 경쟁시키고, 마음에 드는 결과에 투표하세요.' },
  'xduel.step.task':     { en: 'Task', 'zh-Hant': '任務', 'zh-Hans': '任务', ja: 'タスク', ko: '작업' },
  'xduel.step.vote':     { en: 'Vote', 'zh-Hant': '投票', 'zh-Hans': '投票', ja: '投票', ko: '투표' },
  'xduel.step.reveal':   { en: 'Reveal Price', 'zh-Hant': '揭曉價格', 'zh-Hans': '揭晓价格', ja: '価格公開', ko: '가격 공개' },
  'xduel.step.voteagain':{ en: 'Vote Again', 'zh-Hant': '再次投票', 'zh-Hans': '再次投票', ja: 'もう一度投票', ko: '다시 투표' },
  'xduel.step.meet':     { en: 'Meet the Model', 'zh-Hant': '揭曉模型', 'zh-Hans': '揭晓模型', ja: 'モデル発表', ko: '모델 공개' },
  'xduel.tasktype':      { en: 'Task Type:', 'zh-Hant': '任務類型：', 'zh-Hans': '任务类型：', ja: 'タスクの種類：', ko: '작업 유형:' },
  'xboard.board.search.note': { en: 'Ranked from duels where every model could search the web. Kept separate from the plain text ranking on purpose — answering from memory and answering after eight searches are not the same skill, so the two scores are not comparable.', 'zh-Hant': '這裡的排名來自「所有模型都能上網搜尋」的對決。刻意跟一般文字榜分開：憑記憶回答和搜了八次之後回答不是同一種能力，兩邊的分數不能互相比較。', 'zh-Hans': '这里的排名来自「所有模型都能上网搜索」的对决。刻意跟一般文字榜分开：凭记忆回答和搜了八次之后回答不是同一种能力，两边的分数不能互相比较。', ja: '全モデルがウェブ検索を使えた対戦のみのランキングです。通常のテキストランキングとは意図的に分けています — 記憶だけで答えるのと8回検索してから答えるのは別の能力で、スコアは比較できません。', ko: '모든 모델이 웹 검색을 쓸 수 있었던 대결만의 순위입니다. 일반 텍스트 순위와 일부러 분리했습니다 — 기억만으로 답하는 것과 여덟 번 검색한 뒤 답하는 것은 다른 능력이라 점수를 비교할 수 없습니다.' },
  'xboard.text.search':  { en: 'With search', 'zh-Hant': '搜尋', 'zh-Hans': '搜索', ja: '検索あり', ko: '검색' },
  'xboard.ww.note': { en: 'Standings from full AI-vs-AI Werewolf games in XTalk. A game scoreboard, kept apart from XD Score on purpose — talking six models into mislynching a villager is not the skill the duels measure.', 'zh-Hant': '這裡是 XTalk 狼人殺（全 AI 對局）的戰績表。它是遊戲記分板，刻意跟 XD Score 分開——說服六個模型投錯人，跟對決比的能力不是同一回事。', 'zh-Hans': '这里是 XTalk 狼人杀（全 AI 对局）的战绩表。它是游戏记分板，刻意跟 XD Score 分开——说服六个模型投错人，跟对决比的能力不是同一回事。', ja: 'XTalk の人狼（AI 同士の対局）の戦績表です。ゲームのスコアボードであり、XD Score とは意図的に分けています。', ko: 'XTalk 마피아 게임(AI 간 대국)의 전적표입니다. 게임 스코어보드로, XD Score와는 의도적으로 분리되어 있습니다.' },
  'xboard.ww.provisional': { en: 'Provisional · {n} games so far.', 'zh-Hant': '暫定 · 目前 {n} 場。', 'zh-Hans': '暂定 · 目前 {n} 场。', ja: '暫定 · 現在 {n} 局。', ko: '잠정 · 현재 {n}판.' },
  'xboard.ww.col.games':    { en: 'Games',    'zh-Hant': '場次', 'zh-Hans': '场次', ja: '対局', ko: '판수' },
  'xboard.ww.col.winrate':  { en: 'Win rate', 'zh-Hant': '勝率', 'zh-Hans': '胜率', ja: '勝率', ko: '승률' },
  'xboard.ww.col.wolf':     { en: 'As wolf',  'zh-Hant': '狼人局', 'zh-Hans': '狼人局', ja: '人狼側', ko: '늑대 진영' },
  'xboard.ww.col.village':  { en: 'As village', 'zh-Hant': '好人局', 'zh-Hans': '好人局', ja: '村人側', ko: '마을 진영' },
  'xboard.ww.col.survival': { en: 'Survived', 'zh-Hant': '存活', 'zh-Hans': '存活', ja: '生存', ko: '생존' },
  'xboard.provisional':  { en: 'Provisional · {n} votes so far.', 'zh-Hant': '暫定 · 目前 {n} 票。', 'zh-Hans': '暂定 · 目前 {n} 票。', ja: '暫定 · 現在 {n} 票。', ko: '잠정 · 현재 {n}표.' },
  'xduel.howmany':       { en: 'How Many Models to Compete?', 'zh-Hant': '幾個模型參賽？', 'zh-Hans': '几个模型参赛？', ja: '競わせるモデルの数は？', ko: '몇 개의 모델이 경쟁할까요?' },
  'xduel.countsas':      { en: 'counts as {n} duels', 'zh-Hant': '計為 {n} 場對決', 'zh-Hans': '计为 {n} 场对决', ja: '{n}回の対決としてカウント', ko: '{n}회 대결로 계산' },
  'xduel.countsas1':     { en: 'counts as 1 duel', 'zh-Hant': '計為 1 場對決', 'zh-Hans': '计为 1 场对决', ja: '1回の対決としてカウント', ko: '1회 대결로 계산' },
  'xduel.freeleft':      { en: '{n} free {mode} XDuels left today', 'zh-Hant': '今日剩餘 {n} 場免費{mode}對決', 'zh-Hans': '今日剩余 {n} 场免费{mode}对决', ja: '本日残り{n}回の{mode}無料対決', ko: '오늘 남은 무료 {mode} 대결 {n}회' },
  'xduel.noneleft':      { en: '0 free {mode} XDuels left · resets UTC midnight', 'zh-Hant': '今日{mode}免費對決已用完 · UTC 午夜重置', 'zh-Hans': '今日{mode}免费对决已用完 · UTC 午夜重置', ja: '{mode}無料対決は本日分終了 · UTC深夜にリセット', ko: '오늘 무료 {mode} 대결 소진 · UTC 자정 초기화' },
  'xduel.ph.text':       { en: "Ask anything... e.g. 'Explain quantum entanglement in simple terms'", 'zh-Hant': '問任何問題…例如「用簡單的話解釋量子糾纏」', 'zh-Hans': '问任何问题…例如“用简单的话解释量子纠缠”', ja: '何でも質問してください…例：「量子もつれをわかりやすく説明して」', ko: '무엇이든 물어보세요… 예: “양자 얽힘을 쉽게 설명해줘”' },
  'xduel.ph.image':      { en: "Describe an image... e.g. 'A cinematic photo of a red panda in a snowy forest at dusk'", 'zh-Hant': '描述一張圖片…例如「黃昏雪林中的小熊貓電影感照片」', 'zh-Hans': '描述一张图片…例如“黄昏雪林中的小熊猫电影感照片”', ja: '画像を説明してください…例：「夕暮れの雪の森にいるレッサーパンダの映画のような写真」', ko: '이미지를 설명하세요… 예: “해질녘 눈 덮인 숲의 레서판다, 영화 같은 사진”' },
  'xduel.ph.video':      { en: "Describe a video... e.g. 'A timelapse of a thunderstorm rolling over a mountain range'", 'zh-Hant': '描述一段影片…例如「雷暴掠過山脈的縮時攝影」', 'zh-Hans': '描述一段视频…例如“雷暴掠过山脉的延时摄影”', ja: '動画を説明してください…例：「山脈を越える雷雨のタイムラプス」', ko: '동영상을 설명하세요… 예: “산맥 위로 몰아치는 뇌우의 타임랩스”' },
  'xduel.attachhint':    { en: '📷 This prompt works on a photo — add one to the ATTACH slot above.', 'zh-Hant': '📷 這個提示需要一張照片——請加到上方的附件欄位。', 'zh-Hans': '📷 这个提示需要一张照片——请加到上方的附件栏位。', ja: '📷 このプロンプトには写真が必要です——上の添付スロットに追加してください。', ko: '📷 이 프롬프트는 사진이 필요합니다 — 위의 첨부 슬롯에 추가하세요.' },
  'xduel.rv.same':       { en: 'Same answer. Very different price.', 'zh-Hant': '答案一樣，價格差很多。', 'zh-Hans': '答案一样，价格差很多。', ja: '同じ答え。値段は大違い。', ko: '같은 답변, 전혀 다른 가격.' },
  'xduel.rv.spread':     { en: 'One of these costs {p}% less.', 'zh-Hant': '其中一個便宜 {p}%。', 'zh-Hans': '其中一个便宜 {p}%。', ja: '一方は {p}% 安い。', ko: '한쪽이 {p}% 더 쌉니다.' },
  'xduel.rv.neutral':    { en: 'Now you can see what each one costs.', 'zh-Hant': '現在你看得到各自的價格了。', 'zh-Hans': '现在你看得到各自的价格了。', ja: 'それぞれの価格が見えました。', ko: '이제 각각의 가격이 보입니다.' },
  'xduel.rv.bothwin':    { en: 'Model {l} is {p}% cheaper AND {s}% faster', 'zh-Hant': '模型 {l} 便宜 {p}%，而且快 {s}%', 'zh-Hans': '模型 {l} 便宜 {p}%，而且快 {s}%', ja: 'モデル {l} は {p}% 安く、しかも {s}% 高速', ko: '모델 {l}가 {p}% 저렴하고 {s}% 빠름' },
  'xduel.rv.faster':     { en: 'Model {l} is {p}% faster', 'zh-Hant': '模型 {l} 快 {p}%', 'zh-Hans': '模型 {l} 快 {p}%', ja: 'モデル {l} が {p}% 高速', ko: '모델 {l}가 {p}% 빠름' },
  'xduel.rv.cheaper':    { en: 'Model {l} is {p}% cheaper', 'zh-Hant': '模型 {l} 便宜 {p}%', 'zh-Hans': '模型 {l} 便宜 {p}%', ja: 'モデル {l} が {p}% 安い', ko: '모델 {l}가 {p}% 저렴' },
  'xduel.badgepick':     { en: 'Your blind pick', 'zh-Hant': '你的盲測選擇', 'zh-Hans': '你的盲测选择', ja: 'ブラインド選択', ko: '블라인드 선택' },
  'xduel.badgebest':     { en: 'Best price', 'zh-Hant': '最佳價格', 'zh-Hans': '最佳价格', ja: '最安値', ko: '최저가' },
  'xduel.lockedlabel':   { en: 'Your blind pick — on quality alone', 'zh-Hant': '你的盲測選擇——僅憑品質', 'zh-Hans': '你的盲测选择——仅凭质量', ja: 'ブラインド選択 — 品質のみで', ko: '블라인드 선택 — 품질만 보고' },
  'xduel.lockedpick':    { en: 'Model {l}', 'zh-Hant': '模型 {l}', 'zh-Hans': '模型 {l}', ja: 'モデル {l}', ko: '모델 {l}' },
  'xduel.lockedtie':     { en: 'Tie', 'zh-Hant': '平手', 'zh-Hans': '平手', ja: '引き分け', ko: '무승부' },
  'xduel.lockedhint':    { en: 'Locked in. This vote is already counted.', 'zh-Hant': '已鎖定，這一票已計入。', 'zh-Hans': '已锁定，这一票已计入。', ja: '確定済み。この投票は集計されました。', ko: '확정됨. 이 투표는 이미 반영되었습니다.' },
  'xduel.total':      { en: 'total', 'zh-Hant': '總計', 'zh-Hans': '总计', ja: '合計', ko: '합계' },
  'xduel.q2':            { en: 'Does the price change your mind?', 'zh-Hant': '價格會改變你的選擇嗎？', 'zh-Hans': '价格会改变你的选择吗？', ja: '価格を見て、気は変わりますか？', ko: '가격을 보니 생각이 바뀌셨나요?' },
  'xduel.stickwith':     { en: 'Stick with {l}', 'zh-Hant': '維持 {l}', 'zh-Hans': '维持 {l}', ja: '{l} のまま', ko: '{l} 유지' },
  'xduel.switchto':      { en: 'Switch to {l}', 'zh-Hant': '改選 {l}', 'zh-Hans': '改选 {l}', ja: '{l} に変更', ko: '{l}로 변경' },
  'xduel.eithernow':     { en: 'Either', 'zh-Hant': '都可以', 'zh-Hans': '都可以', ja: 'どちらでも', ko: '둘 다 좋음' },
  'xduel.isbetter':      { en: '{l} is better', 'zh-Hant': '{l} 較佳', 'zh-Hans': '{l} 更好', ja: '{l} が良い', ko: '{l}가 더 좋아요' },
  'xduel.picked':        { en: '✓ Picked {l}', 'zh-Hant': '✓ 已選 {l}', 'zh-Hans': '✓ 已选 {l}', ja: '✓ {l} を選択', ko: '✓ {l} 선택됨' },
  'xduel.changeprompt':  { en: 'Change Prompt', 'zh-Hant': '更改提示詞', 'zh-Hans': '更改提示词', ja: 'プロンプトを変更', ko: '프롬프트 변경' },
  'xduel.pickhint':      { en: 'Pick the response you prefer — identities are hidden', 'zh-Hant': '選出你偏好的回應——身分保密', 'zh-Hans': '选出你偏好的回应——身份保密', ja: '好みの回答を選んでください——正体は非公開', ko: '선호하는 응답을 선택하세요 — 정체는 비공개' },
  'xduel.finalvote':     { en: 'Now you know the cost — cast your final vote', 'zh-Hant': '現在你知道價格了——投下最終一票', 'zh-Hans': '现在你知道价格了——投下最终一票', ja: '価格が分かった今、最終投票を', ko: '이제 가격을 알았으니 최종 투표하세요' },
  'xduel.responding':    { en: 'Models are responding…', 'zh-Hant': '模型回應中…', 'zh-Hans': '模型回应中…', ja: 'モデルが応答中…', ko: '모델이 응답 중…' },
  'xvote.subtitle':      { en: 'Explore AI Duels. Pick Your Favorites.', 'zh-Hant': '探索 AI 對決，選出你的最愛。', 'zh-Hans': '探索 AI 对决，选出你的最爱。', ja: 'AI対決を見て、お気に入りを選ぼう。', ko: 'AI 대결을 둘러보고 마음에 드는 쪽을 고르세요.' },
  'xvote.search':        { en: 'Search duels…', 'zh-Hant': '搜尋對決…', 'zh-Hans': '搜索对决…', ja: '対決を検索…', ko: '대결 검색…' },
  'xvote.duelcount':     { en: '{n} duels', 'zh-Hant': '{n} 場對決', 'zh-Hans': '{n} 场对决', ja: '{n}件の対決', ko: '대결 {n}개' },
  'xvote.votebtn':       { en: 'Vote', 'zh-Hant': '投票', 'zh-Hans': '投票', ja: '投票', ko: '투표' },
  'xboard.subtitle':     { en: 'The AI Leaderboard. See Who Comes Out on Top.', 'zh-Hant': 'AI 排行榜。看看誰勝出。', 'zh-Hans': 'AI 排行榜。看看谁胜出。', ja: 'AIリーダーボード。頂点に立つのは誰か。', ko: 'AI 리더보드. 최종 승자를 확인하세요.' },
  'xboard.how':          { en: 'How scoring works', 'zh-Hant': '計分方式', 'zh-Hans': '计分方式', ja: 'スコアの仕組み', ko: '점수 산정 방식' },
  'xboard.search':       { en: 'Search models…', 'zh-Hant': '搜尋模型…', 'zh-Hans': '搜索模型…', ja: 'モデルを検索…', ko: '모델 검색…' },
  'xboard.providers':    { en: 'Providers', 'zh-Hant': '供應商', 'zh-Hans': '供应商', ja: 'プロバイダー', ko: '제공사' },
  'xboard.allproviders': { en: 'All providers', 'zh-Hant': '全部供應商', 'zh-Hans': '全部供应商', ja: 'すべてのプロバイダー', ko: '모든 제공사' },
  'xboard.modelcount':   { en: '{n} models', 'zh-Hant': '{n} 個模型', 'zh-Hans': '{n} 个模型', ja: '{n}モデル', ko: '모델 {n}개' },
  'xboard.col.model':    { en: 'Model', 'zh-Hant': '模型', 'zh-Hans': '模型', ja: 'モデル', ko: '모델' },
  'xboard.col.quality':  { en: 'Score', 'zh-Hant': '分數', 'zh-Hans': '分数', ja: 'スコア', ko: '점수' },
  'xboard.col.provider': { en: 'Provider', 'zh-Hant': '供應商', 'zh-Hans': '供应商', ja: 'プロバイダー', ko: '제공사' },
  'xboard.col.released': { en: 'Released', 'zh-Hant': '發布', 'zh-Hans': '发布', ja: 'リリース', ko: '출시' },
  'xboard.col.input':    { en: 'Input', 'zh-Hant': '輸入', 'zh-Hans': '输入', ja: '入力', ko: '입력' },
  'xboard.col.price':    { en: 'Price', 'zh-Hant': '價格', 'zh-Hans': '价格', ja: '価格', ko: '가격' },
  'profile.account':     { en: 'Account', 'zh-Hant': '帳戶', 'zh-Hans': '账户', ja: 'アカウント', ko: '계정' },
  'profile.signedin':    { en: 'Signed in', 'zh-Hant': '已登入', 'zh-Hans': '已登录', ja: 'ログイン中', ko: '로그인됨' },
  'profile.balance':     { en: 'Credit Balance', 'zh-Hant': '點數餘額', 'zh-Hans': '点数余额', ja: 'クレジット残高', ko: '크레딧 잔액' },
  'profile.spent':       { en: 'Spent', 'zh-Hant': '已花費', 'zh-Hans': '已花费', ja: '使用済み', ko: '사용액' },
  'profile.granted':     { en: 'Granted', 'zh-Hant': '已獲得', 'zh-Hans': '已获得', ja: '付与済み', ko: '지급액' },
  'profile.addcredits':  { en: '+ Add credits', 'zh-Hant': '＋ 加值', 'zh-Hans': '＋ 充值', ja: '＋ チャージ', ko: '＋ 충전' },
  'profile.activity':    { en: '◈ Activity', 'zh-Hant': '◈ 活動紀錄', 'zh-Hans': '◈ 活动记录', ja: '◈ 履歴', ko: '◈ 활동 내역' },
  'profile.danger':        { en: 'Danger Zone', 'zh-Hant': '危險區域', 'zh-Hans': '危险区域', ja: '危険な操作', ko: '위험 구역' },
  'profile.deleteaccount': { en: 'Delete Account', 'zh-Hant': '刪除帳戶', 'zh-Hans': '删除账户', ja: 'アカウントを削除', ko: '계정 삭제' },
  'profile.deletewarn':    { en: 'Permanently deletes your account, all your XDuels and XCreates, uploaded files, votes, and credit history. This cannot be undone.', 'zh-Hant': '將永久刪除你的帳戶、所有 XDuel 與 XCreate、上傳的檔案、投票與點數紀錄。此操作無法復原。', 'zh-Hans': '将永久删除你的账户、所有 XDuel 与 XCreate、上传的文件、投票与点数记录。此操作无法恢复。', ja: 'アカウント、すべてのXDuelとXCreate、アップロードしたファイル、投票、クレジット履歴が完全に削除されます。この操作は取り消せません。', ko: '계정, 모든 XDuel과 XCreate, 업로드한 파일, 투표, 크레딧 기록이 영구 삭제됩니다. 되돌릴 수 없습니다.' },
  'profile.deleteconfirm': { en: 'Type DELETE to confirm', 'zh-Hant': '輸入 DELETE 以確認', 'zh-Hans': '输入 DELETE 以确认', ja: '確認のため DELETE と入力してください', ko: '확인을 위해 DELETE를 입력하세요' },
  'profile.deleting':      { en: 'Deleting…', 'zh-Hant': '刪除中…', 'zh-Hans': '删除中…', ja: '削除中…', ko: '삭제 중…' },
  'profile.hideactivity':{ en: '◈ Hide activity', 'zh-Hant': '◈ 隱藏紀錄', 'zh-Hans': '◈ 隐藏记录', ja: '◈ 履歴を隠す', ko: '◈ 내역 숨기기' },
  'profile.privacy':     { en: '🔒 Your XDuels are public (they appear in XVote) · your XCreates are private · your XVote votes are private.', 'zh-Hant': '🔒 你的 XDuel 是公開的（會出現在 XVote）· XCreate 是私人的 · XVote 投票是私人的。', 'zh-Hans': '🔒 你的 XDuel 是公开的（会出现在 XVote）· XCreate 是私人的 · XVote 投票是私人的。', ja: '🔒 あなたのXDuelは公開されます（XVoteに表示）· XCreateは非公開 · XVoteの投票も非公開です。', ko: '🔒 XDuel은 공개됩니다(XVote에 표시) · XCreate는 비공개 · XVote 투표도 비공개입니다.' },
  'profile.noduels':     { en: 'No XDuels yet — head to XDuel to start.', 'zh-Hant': '還沒有 XDuel——前往 XDuel 開始吧。', 'zh-Hans': '还没有 XDuel——前往 XDuel 开始吧。', ja: 'まだXDuelがありません——XDuelで始めましょう。', ko: '아직 XDuel이 없습니다 — XDuel에서 시작하세요.' },
  'profile.novotes':     { en: 'No votes yet — head to the Vote page to start voting on community duels.', 'zh-Hant': '還沒有投票——前往投票頁為社群對決投票吧。', 'zh-Hans': '还没有投票——前往投票页为社区对决投票吧。', ja: 'まだ投票がありません——投票ページでコミュニティの対決に投票しましょう。', ko: '아직 투표가 없습니다 — 투표 페이지에서 커뮤니티 대결에 투표하세요.' },
  'auth.titleprefix':    { en: 'Sign in to', 'zh-Hant': '登入', 'zh-Hans': '登录', ja: 'ログイン：', ko: '로그인:' },
  'auth.google':         { en: 'Continue with Google', 'zh-Hant': '使用 Google 繼續', 'zh-Hans': '使用 Google 继续', ja: 'Googleで続行', ko: 'Google로 계속하기' },
  'auth.signingin':      { en: 'Signing in...', 'zh-Hant': '登入中…', 'zh-Hans': '登录中…', ja: 'ログイン中…', ko: '로그인 중…' },
  'auth.f.xduel':        { en: 'anonymous models compete on your task, revealing the best-value model for you', 'zh-Hant': '匿名模型同場競技，為你揭曉最超值的模型', 'zh-Hans': '匿名模型同场竞技，为你揭晓最超值的模型', ja: '匿名モデルが競い合い、最高のコスパモデルを明らかに', ko: '익명 모델들이 경쟁하여 최고의 가성비 모델을 찾아드립니다' },
  'auth.f.xcreate':      { en: 'your private studio: run up to 4 models side by side', 'zh-Hant': '你的私人工作室：最多 4 個模型並排執行', 'zh-Hans': '你的私人工作室：最多 4 个模型并排运行', ja: 'プライベートスタジオ：最大4モデルを並べて実行', ko: '나만의 스튜디오: 최대 4개 모델을 나란히 실행' },
  'auth.f.xvote':        { en: 'judge community duels and shape the rankings', 'zh-Hant': '評判社群對決，影響排行榜', 'zh-Hans': '评判社区对决，影响排行榜', ja: 'コミュニティの対決を審査してランキングに反映', ko: '커뮤니티 대결을 심사하고 랭킹에 반영하세요' },
  'auth.f.xboard':       { en: 'the model leaderboard, ranked by real blind votes', 'zh-Hant': '模型排行榜，由真實盲測投票排名', 'zh-Hans': '模型排行榜，由真实盲测投票排名', ja: '実際のブラインド投票によるモデルランキング', ko: '실제 블라인드 투표로 매기는 모델 랭킹' },
  'xcreate.showconfigs': { en: 'Show Configs', 'zh-Hant': '顯示設定', 'zh-Hans': '显示设置', ja: '設定を表示', ko: '설정 표시' },
  'xcreate.hideconfigs': { en: 'Hide Configs', 'zh-Hant': '隱藏設定', 'zh-Hans': '隐藏设置', ja: '設定を隠す', ko: '설정 숨기기' },
  'xcreate.savemore':    { en: 'Select more, save more', 'zh-Hant': '選越多，省越多', 'zh-Hans': '选越多，省越多', ja: '多く選ぶほどお得', ko: '많이 고를수록 더 할인' },
  'xcreate.thinking':    { en: 'Thinking', 'zh-Hant': '思考深度', 'zh-Hans': '思考深度', ja: '思考レベル', ko: '추론 수준' },
  'xcreate.auto':        { en: 'Auto', 'zh-Hant': '自動', 'zh-Hans': '自动', ja: '自動', ko: '자동' },
  'xcreate.websearch':   { en: 'Web search', 'zh-Hant': '網路搜尋', 'zh-Hans': '网络搜索', ja: 'ウェブ検索', ko: '웹 검색' },
  'xcreate.on':          { en: 'On', 'zh-Hant': '開', 'zh-Hans': '开', ja: 'オン', ko: '켜기' },
  'xcreate.off':         { en: 'Off', 'zh-Hant': '關', 'zh-Hans': '关', ja: 'オフ', ko: '끄기' },
  'xcreate.ph.text':     { en: 'Ask anything…', 'zh-Hant': '問任何問題…', 'zh-Hans': '问任何问题…', ja: '何でも質問…', ko: '무엇이든 물어보세요…' },
  'xcreate.ph.image':    { en: 'Describe an image…', 'zh-Hant': '描述一張圖片…', 'zh-Hans': '描述一张图片…', ja: '画像を説明…', ko: '이미지를 설명하세요…' },
  'xcreate.ph.video':    { en: 'Describe a video…', 'zh-Hant': '描述一段影片…', 'zh-Hans': '描述一段视频…', ja: '動画を説明…', ko: '동영상을 설명하세요…' },
  'xcreate.pickone':     { en: 'Pick at least one model', 'zh-Hant': '至少選擇一個模型', 'zh-Hans': '至少选择一个模型', ja: 'モデルを1つ以上選択', ko: '모델을 하나 이상 선택하세요' },
  'xcreate.selected':    { en: '{n} models selected', 'zh-Hant': '已選 {n} 個模型', 'zh-Hans': '已选 {n} 个模型', ja: '{n}モデル選択中', ko: '모델 {n}개 선택됨' },
  'xcreate.selected1':   { en: '1 model selected', 'zh-Hant': '已選 1 個模型', 'zh-Hans': '已选 1 个模型', ja: '1モデル選択中', ko: '모델 1개 선택됨' },
  'xcreate.estcost':     { en: 'Estimated Cost ~', 'zh-Hant': '預估費用 ~', 'zh-Hans': '预估费用 ~', ja: '推定コスト ~', ko: '예상 비용 ~' },
  'xcreate.addcredits':  { en: 'Add credits', 'zh-Hant': '加值', 'zh-Hans': '充值', ja: 'クレジット追加', ko: '크레딧 충전' },
  'xcreate.lowbalance':  { en: 'Not enough credits. Balance:', 'zh-Hant': '點數不足。餘額：', 'zh-Hans': '点数不足。余额：', ja: 'クレジット不足。残高：', ko: '크레딧 부족. 잔액:' },
  'xdirector.skills':    { en: 'Start with a skill (optional)', 'zh-Hant': '從技能開始（選填）', 'zh-Hans': '从技能开始（选填）', ja: 'スキルから始める（任意）', ko: '스킬로 시작하기 (선택)' },
  'xdirector.skillactive': { en: 'skill', 'zh-Hant': '技能', 'zh-Hans': '技能', ja: 'スキル', ko: '스킬' },
  'xdirector.plan':      { en: 'PLAN', 'zh-Hant': '方案', 'zh-Hans': '方案', ja: 'プラン', ko: '플랜' },
  'xdirector.generate':  { en: 'Generate', 'zh-Hant': '開始生成', 'zh-Hans': '开始生成', ja: '生成する', ko: '생성하기' },
  'xdirector.change':    { en: 'Change something', 'zh-Hant': '調整一下', 'zh-Hans': '调整一下', ja: '変更する', ko: '수정하기' },
  'xdirector.sent':      { en: 'Sent', 'zh-Hant': '已送出', 'zh-Hans': '已发送', ja: '送信済み', ko: '전송됨' },
  'xcreate.surface.studio': { en: 'Studio', 'zh-Hant': '工作室', 'zh-Hans': '工作室', ja: 'スタジオ', ko: '스튜디오' },
  'xdirector.eyebrow':     { en: 'XDIRECT', 'zh-Hant': 'X導演', 'zh-Hans': 'X导演', ja: 'Xディレクター', ko: 'X디렉터' },
  'xdirector.title':       { en: 'Tell Me the Story. I Direct the Models.', 'zh-Hant': '說出你的故事，我來指揮模型。', 'zh-Hans': '说出你的故事，我来指挥模型。', ja: 'ストーリーを話して。モデルはこちらで指揮します。', ko: '스토리를 말해 주세요. 모델은 제가 지휘합니다.' },
  'xdirector.subtitle':    { en: 'A personal director that picks the right model at the right price, writes the prompt, and generates your video — all in one conversation.', 'zh-Hant': '你的個人導演：以最合適的價格挑選模型、撰寫提示詞並生成影片，全部在一段對話中完成。', 'zh-Hans': '你的个人导演：以最合适的价格挑选模型、编写提示词并生成视频，全部在一段对话中完成。', ja: '最適な価格でモデルを選び、プロンプトを書き、動画を生成するあなた専属のディレクター。すべて会話の中で。', ko: '적절한 가격의 모델을 고르고, 프롬프트를 쓰고, 영상을 생성하는 나만의 디렉터. 모두 대화 하나로.' },
  'xdirector.placeholder': { en: 'Describe the video you want — attach photos for characters or products…', 'zh-Hant': '描述你想要的影片，可附上角色或商品照片…', 'zh-Hans': '描述你想要的视频，可附上角色或商品照片…', ja: '作りたい動画を説明 — 人物や商品の写真も添付できます…', ko: '원하는 영상을 설명하세요 — 인물이나 제품 사진 첨부 가능…' },
  'xdirector.intro':       { en: '🎬 Tell me what you want to make — an ad, a story scene, a product shot. I\'ll suggest the best-value model with real prices, write the prompt, and generate it here in the chat. Attach photos if you want a specific person, product, or style kept consistent.', 'zh-Hant': '🎬 告訴我你想做什麼——廣告、劇情場景或商品影片。我會推薦最划算的模型（附真實價格）、撰寫提示詞並直接在對話中生成。想保持人物或商品一致，請附上照片。', 'zh-Hans': '🎬 告诉我你想做什么——广告、剧情场景或商品视频。我会推荐最划算的模型（附真实价格）、编写提示词并直接在对话中生成。想保持人物或商品一致，请附上照片。', ja: '🎬 作りたいものを教えてください — 広告、ストーリーシーン、商品動画など。実際の価格でコスパ最良のモデルを提案し、プロンプトを書いて、このチャット内で生成します。人物や商品の一貫性を保ちたい場合は写真を添付してください。', ko: '🎬 만들고 싶은 것을 알려 주세요 — 광고, 스토리 장면, 제품 영상. 실제 가격으로 가성비 최고의 모델을 추천하고, 프롬프트를 작성해 이 채팅에서 바로 생성합니다. 인물이나 제품의 일관성이 필요하면 사진을 첨부하세요.' },
  'wf.batch':            { en: 'Batch Apply', 'zh-Hant': '批次處理', 'zh-Hans': '批量处理', ja: '一括適用', ko: '일괄 적용' },
  'wf.batchhint':        { en: 'Upload up to 10 photos and run this edit on every one. Each photo bills like a normal creation and lands in your gallery.', 'zh-Hant': '上傳最多 10 張照片，對每一張套用此編輯。每張照片照常計費並存入作品庫。', 'zh-Hans': '上传最多 10 张照片，对每一张应用此编辑。每张照片照常计费并存入作品库。', ja: '写真を最大10枚アップロードし、この編集をすべてに適用します。各写真は通常どおり課金され、ギャラリーに保存されます。', ko: '사진을 최대 10장 업로드해 이 편집을 모두에 적용하세요. 각 사진은 일반 생성과 동일하게 과금되며 갤러리에 저장됩니다.' },
  'wf.batchrun':         { en: 'Run', 'zh-Hant': '執行', 'zh-Hans': '运行', ja: '実行', ko: '실행' },
  'wf.inputnodelete':    { en: 'Uploaded reference images cannot be deleted from the board', 'zh-Hant': '上傳的參考圖片無法從畫布刪除', 'zh-Hans': '上传的参考图片无法从画布删除', ja: 'アップロードした参照画像はボードから削除できません', ko: '업로드한 참조 이미지는 보드에서 삭제할 수 없습니다' },
  'wf.selected':         { en: 'selected', 'zh-Hant': '已選取', 'zh-Hans': '已选中', ja: '選択中', ko: '선택됨' },
  'wf.delete':           { en: 'Delete', 'zh-Hant': '刪除', 'zh-Hans': '删除', ja: '削除', ko: '삭제' },
  'wf.clearsel':         { en: 'Clear', 'zh-Hant': '清除', 'zh-Hans': '清除', ja: 'クリア', ko: '지우기' },
  'wf.boardcost':        { en: 'Board total', 'zh-Hant': '畫布總計', 'zh-Hans': '画布总计', ja: 'ボード合計', ko: '보드 합계' },
  'wf.canvashint':       { en: 'drag to pan · scroll to zoom · shift-click to multi-select', 'zh-Hant': '拖曳平移 · 滾動縮放 · Shift 點選可複選', 'zh-Hans': '拖拽平移 · 滚动缩放 · Shift 点选可多选', ja: 'ドラッグで移動 · スクロールで拡大縮小 · Shift クリックで複数選択', ko: '드래그로 이동 · 스크롤로 확대 · Shift 클릭으로 다중 선택' },
  'wf.addphotos':        { en: 'Add product photos', 'zh-Hant': '新增產品照片', 'zh-Hans': '添加产品照片', ja: '商品写真を追加', ko: '제품 사진 추가' },
  'wf.addphotoshint':    { en: 'Uploaded photos join the board as source nodes. Nothing is generated and nothing is charged.', 'zh-Hant': '上傳的照片會作為來源節點加入畫布，不會生成也不會計費。', 'zh-Hans': '上传的照片会作为来源节点加入画布，不会生成也不会计费。', ja: 'アップロードした写真はソースノードとしてボードに追加されます。生成も課金もされません。', ko: '업로드한 사진은 소스 노드로 보드에 추가됩니다. 생성이나 과금은 없습니다.' },
  'wf.canvas':           { en: 'Canvas', 'zh-Hant': '畫布', 'zh-Hans': '画布', ja: 'キャンバス', ko: '캔버스' },
  'wf.simple':           { en: 'Simple', 'zh-Hant': '簡易', 'zh-Hans': '简易', ja: 'シンプル', ko: '간단히' },
  'wf.step':             { en: 'Step', 'zh-Hant': '步驟', 'zh-Hans': '步骤', ja: 'ステップ', ko: '단계' },
  'wf.editwith':         { en: 'Edit with', 'zh-Hant': '編輯模型', 'zh-Hans': '编辑模型', ja: '編集モデル', ko: '편집 모델' },
  'wf.generate':         { en: 'Generate', 'zh-Hant': '生成', 'zh-Hans': '生成', ja: '生成', ko: '생성' },
  'wf.placeholder':      { en: 'Describe the change — e.g. "make the car red"', 'zh-Hant': '描述要修改的內容，例如「把車改成紅色」', 'zh-Hans': '描述要修改的内容，例如"把车改成红色"', ja: '変更内容を入力 — 例「車を赤に」', ko: '수정할 내용 입력 — 예: "차를 빨간색으로"' },
  'xcreate.generatebtn': { en: '✦ Generate →', 'zh-Hant': '✦ 生成 →', 'zh-Hans': '✦ 生成 →', ja: '✦ 生成 →', ko: '✦ 생성 →' },
  'xcreate.generating':  { en: '⏳ Generating…', 'zh-Hant': '⏳ 生成中…', 'zh-Hans': '⏳ 生成中…', ja: '⏳ 生成中…', ko: '⏳ 생성 중…' },
  'xcreate.attach':      { en: 'Attach', 'zh-Hant': '附件', 'zh-Hans': '附件', ja: '添付', ko: '첨부' },
}

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string }
const Ctx = createContext<LangCtx>({ lang: 'en', setLang: () => {}, t: (k) => k })

const VALID_CODES = new Set<string>(LANGS.map(l => l.code))

/** Map a BCP-47 browser tag to a supported Lang, or null if unsupported.
 *  Traditional and Simplified Chinese are DIFFERENT language settings:
 *  Hant script / TW / HK / MO → zh-Hant; every other zh → zh-Hans. */
function langFromTag(tag: string): Lang | null {
  const t = tag.toLowerCase()
  if (t.startsWith('en')) return 'en'
  if (t.startsWith('zh')) {
    return (t.includes('hant') || t === 'zh-tw' || t === 'zh-hk' || t === 'zh-mo') ? 'zh-Hant' : 'zh-Hans'
  }
  if (t.startsWith('ja')) return 'ja'
  if (t.startsWith('ko')) return 'ko'
  return null
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    // Priority: explicit user choice (persisted by the picker) → browser
    // preference list, in the USER'S order, first supported language wins
    // → English. Detection is NOT persisted, so users who never touched
    // the picker keep following their browser settings.
    const savedRaw = typeof window !== 'undefined' ? window.localStorage.getItem('modelxd:lang') : null
    // Migration: the old two-language toggle stored 'zh' (Traditional).
    const saved = savedRaw === 'zh' ? 'zh-Hant' : savedRaw
    if (saved && VALID_CODES.has(saved)) {
      setLangState(saved as Lang)
      document.documentElement.lang = saved
      return
    }
    const prefs = (navigator.languages?.length ? navigator.languages : [navigator.language]) ?? []
    for (const tag of prefs) {
      const match = langFromTag(tag ?? '')
      if (match) {
        setLangState(match)
        document.documentElement.lang = match
        return
      }
    }
    // No supported language in the list → English (the default state).
  }, [])

  const setLang = (l: Lang) => {
    setLangState(l)
    try { window.localStorage.setItem('modelxd:lang', l) } catch {}
    if (typeof document !== 'undefined') document.documentElement.lang = l
  }

  const t = (k: string) => {
    const entry = STRINGS[k]
    if (!entry) return k
    return entry[lang] ?? entry.en
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export const useLang = () => useContext(Ctx)
export const useT = () => useContext(Ctx).t
