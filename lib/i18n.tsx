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
  'home.vc.tier.a':   { en: 'Budget', 'zh-Hant': '預算型', 'zh-Hans': '预算型', ja: 'バジェット', ko: '가성비' },
  'home.vc.tier.b':   { en: 'Value', 'zh-Hant': '超值型', 'zh-Hans': '超值型', ja: 'バリュー', ko: '밸류' },
  'home.vc.tier.c':   { en: 'Quality', 'zh-Hant': '品質型', 'zh-Hans': '品质型', ja: 'クオリティ', ko: '퀄리티' },
  'home.vc.tier.d':   { en: 'Flagship', 'zh-Hant': '旗艦型', 'zh-Hans': '旗舰型', ja: 'フラッグシップ', ko: '플래그십' },
  'brand':            { en: 'ModelXD', 'zh-Hant': '模型大對決', 'zh-Hans': '模型大对决' },
  'nav.xduel':        { en: 'XDuel',   'zh-Hant': 'X對決',   'zh-Hans': 'X对决',   ja: 'X対決',       ko: 'X대결' },
  'nav.xcreate':      { en: 'XCreate', 'zh-Hant': 'X創作',   'zh-Hans': 'X创作',   ja: 'X作成',       ko: 'X창작' },
  'nav.xvote':        { en: 'XVote',   'zh-Hant': 'X投票',   'zh-Hans': 'X投票',   ja: 'X投票',       ko: 'X투표' },
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

  // ── Home (hero + CTAs) ──
  'home.hero':        { en: 'Overpaying for AI?!', 'zh-Hant': '為 AI 付太多了嗎？', 'zh-Hans': '为 AI 付太多了吗？', ja: 'AIに払いすぎていませんか？', ko: 'AI 요금, 너무 많이 내고 있나요?' },
  'home.sub':         { en: 'See AI results side by side and find the best model for your budget', 'zh-Hant': '並排比較 AI 結果，找出最適合你預算的模型', 'zh-Hans': '并排比较 AI 结果，找出最适合你预算的模型', ja: 'AIの結果を並べて比較して、予算に合う最適なモデルを見つけよう', ko: 'AI 결과를 나란히 비교하고 예산에 맞는 최적의 모델을 찾으세요' },

  // ── Full-coverage pass (CC, July 19): page-body strings ──
  // Templates use {n}/{mode}/{l} placeholders — callers .replace() them.
  'common.all':          { en: 'All', 'zh-Hant': '全部', 'zh-Hans': '全部', ja: 'すべて', ko: '전체' },
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
  'xduel.howmany':       { en: 'How Many Models to Compete?', 'zh-Hant': '幾個模型參賽？', 'zh-Hans': '几个模型参赛？', ja: '競わせるモデルの数は？', ko: '몇 개의 모델이 경쟁할까요?' },
  'xduel.countsas':      { en: 'counts as {n} duels', 'zh-Hant': '計為 {n} 場對決', 'zh-Hans': '计为 {n} 场对决', ja: '{n}回の対決としてカウント', ko: '{n}회 대결로 계산' },
  'xduel.countsas1':     { en: 'counts as 1 duel', 'zh-Hant': '計為 1 場對決', 'zh-Hans': '计为 1 场对决', ja: '1回の対決としてカウント', ko: '1회 대결로 계산' },
  'xduel.freeleft':      { en: '{n} free {mode} XDuels left today', 'zh-Hant': '今日剩餘 {n} 場免費{mode}對決', 'zh-Hans': '今日剩余 {n} 场免费{mode}对决', ja: '本日残り{n}回の{mode}無料対決', ko: '오늘 남은 무료 {mode} 대결 {n}회' },
  'xduel.noneleft':      { en: '0 free {mode} XDuels left · resets UTC midnight', 'zh-Hant': '今日{mode}免費對決已用完 · UTC 午夜重置', 'zh-Hans': '今日{mode}免费对决已用完 · UTC 午夜重置', ja: '{mode}無料対決は本日分終了 · UTC深夜にリセット', ko: '오늘 무료 {mode} 대결 소진 · UTC 자정 초기화' },
  'xduel.ph.text':       { en: "Ask anything... e.g. 'Explain quantum entanglement in simple terms'", 'zh-Hant': '問任何問題…例如「用簡單的話解釋量子糾纏」', 'zh-Hans': '问任何问题…例如“用简单的话解释量子纠缠”', ja: '何でも質問してください…例：「量子もつれをわかりやすく説明して」', ko: '무엇이든 물어보세요… 예: “양자 얽힘을 쉽게 설명해줘”' },
  'xduel.ph.image':      { en: "Describe an image... e.g. 'A cinematic photo of a red panda in a snowy forest at dusk'", 'zh-Hant': '描述一張圖片…例如「黃昏雪林中的小熊貓電影感照片」', 'zh-Hans': '描述一张图片…例如“黄昏雪林中的小熊猫电影感照片”', ja: '画像を説明してください…例：「夕暮れの雪の森にいるレッサーパンダの映画のような写真」', ko: '이미지를 설명하세요… 예: “해질녘 눈 덮인 숲의 레서판다, 영화 같은 사진”' },
  'xduel.ph.video':      { en: "Describe a video... e.g. 'A timelapse of a thunderstorm rolling over a mountain range'", 'zh-Hant': '描述一段影片…例如「雷暴掠過山脈的縮時攝影」', 'zh-Hans': '描述一段视频…例如“雷暴掠过山脉的延时摄影”', ja: '動画を説明してください…例：「山脈を越える雷雨のタイムラプス」', ko: '동영상을 설명하세요… 예: “산맥 위로 몰아치는 뇌우의 타임랩스”' },
  'xduel.attachhint':    { en: '📷 This prompt works on a photo — add one to the ATTACH slot above.', 'zh-Hant': '📷 這個提示需要一張照片——請加到上方的附件欄位。', 'zh-Hans': '📷 这个提示需要一张照片——请加到上方的附件栏位。', ja: '📷 このプロンプトには写真が必要です——上の添付スロットに追加してください。', ko: '📷 이 프롬프트는 사진이 필요합니다 — 위의 첨부 슬롯에 추가하세요.' },
  'xduel.isbetter':      { en: '{l} is better', 'zh-Hant': '{l} 較佳', 'zh-Hans': '{l} 更好', ja: '{l} が良い', ko: '{l}가 더 좋아요' },
  'xduel.picked':        { en: '✓ Picked {l}', 'zh-Hant': '✓ 已選 {l}', 'zh-Hans': '✓ 已选 {l}', ja: '✓ {l} を選択', ko: '✓ {l} 선택됨' },
  'xduel.changeprompt':  { en: 'Change Prompt', 'zh-Hant': '更改提示詞', 'zh-Hans': '更改提示词', ja: 'プロンプトを変更', ko: '프롬프트 변경' },
  'xduel.pickhint':      { en: 'Pick the response you prefer — identities are hidden', 'zh-Hant': '選出你偏好的回應——身分保密', 'zh-Hans': '选出你偏好的回应——身份保密', ja: '好みの回答を選んでください——正体は非公開', ko: '선호하는 응답을 선택하세요 — 정체는 비공개' },
  'xduel.finalvote':     { en: 'Now you know the cost — cast your final vote', 'zh-Hant': '現在你知道價格了——投下最終一票', 'zh-Hans': '现在你知道价格了——投下最终一票', ja: '価格が分かった今、最終投票を', ko: '이제 가격을 알았으니 최종 투표하세요' },
  'xduel.responding':    { en: 'Models are responding…', 'zh-Hant': '模型回應中…', 'zh-Hans': '模型回应中…', ja: 'モデルが応答中…', ko: '모델이 응답 중…' },
  'xvote.subtitle':      { en: 'Explore AI Duels. Pick Your Favorites.', 'zh-Hant': '探索 AI 對決，選出你的最愛。', 'zh-Hans': '探索 AI 对决，选出你的最爱。', ja: 'AI対決を見て、お気に入りを選ぼう。', ko: 'AI 대결을 둘러보고 마음에 드는 쪽을 고르세요.' },
  'xvote.search':        { en: 'Search duels…', 'zh-Hant': '搜尋對決…', 'zh-Hans': '搜索对决…', ja: '対決を検索…', ko: '대결 검색…' },
  'xvote.recentsort':    { en: 'Recent', 'zh-Hant': '最新', 'zh-Hans': '最新', ja: '新着', ko: '최신' },
  'xvote.popularsort':   { en: 'Popular', 'zh-Hant': '熱門', 'zh-Hans': '热门', ja: '人気', ko: '인기' },
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
  'xboard.col.output':   { en: 'Output', 'zh-Hant': '輸出', 'zh-Hans': '输出', ja: '出力', ko: '출력' },
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
  'xcreate.ph.text':     { en: 'Ask anything…', 'zh-Hant': '問任何問題…', 'zh-Hans': '问任何问题…', ja: '何でも質問…', ko: '무엇이든 물어보세요…' },
  'xcreate.ph.image':    { en: 'Describe an image…', 'zh-Hant': '描述一張圖片…', 'zh-Hans': '描述一张图片…', ja: '画像を説明…', ko: '이미지를 설명하세요…' },
  'xcreate.ph.video':    { en: 'Describe a video…', 'zh-Hant': '描述一段影片…', 'zh-Hans': '描述一段视频…', ja: '動画を説明…', ko: '동영상을 설명하세요…' },
  'xcreate.pickone':     { en: 'Pick at least one model', 'zh-Hant': '至少選擇一個模型', 'zh-Hans': '至少选择一个模型', ja: 'モデルを1つ以上選択', ko: '모델을 하나 이상 선택하세요' },
  'xcreate.selected':    { en: '{n} models selected', 'zh-Hant': '已選 {n} 個模型', 'zh-Hans': '已选 {n} 个模型', ja: '{n}モデル選択中', ko: '모델 {n}개 선택됨' },
  'xcreate.selected1':   { en: '1 model selected', 'zh-Hant': '已選 1 個模型', 'zh-Hans': '已选 1 个模型', ja: '1モデル選択中', ko: '모델 1개 선택됨' },
  'xcreate.estcost':     { en: 'Estimated Cost ~', 'zh-Hant': '預估費用 ~', 'zh-Hans': '预估费用 ~', ja: '推定コスト ~', ko: '예상 비용 ~' },
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
