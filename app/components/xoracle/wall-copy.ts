// app/components/xoracle/wall-copy.ts — the words of 觀音廟's 廟外, in the five
// languages (docs/GUANYIN-HANGING-PLAN.md §7). Kept beside the component,
// like X創作's film-copy.ts. Hedged on purpose: tying or wishing promises
// nothing (the masters' TONE rule); 觀音廟 is the general name, no real temple.

type L = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
type Words = Record<L, string>

const W = {
  section:      { en: 'Outside the temple', 'zh-Hant': '廟外', 'zh-Hans': '庙外', ja: 'お堂の外', ko: '절 마당' },
  tieSection:   { en: 'Where sticks are tied', 'zh-Hant': '結籤處', 'zh-Hans': '结签处', ja: 'おみくじ結び所', ko: '제비 묶는 곳' },
  tieCount:     { en: '{s} sticks are tied here now', 'zh-Hant': '現在綁著 {s} 支籤', 'zh-Hans': '现在绑着 {s} 支签', ja: 'いま {s} 本のおみくじが結ばれています', ko: '지금 제비 {s}개가 묶여 있어요' },
  tieEmpty:     { en: 'No sticks tied yet.', 'zh-Hant': '還沒有人綁籤。', 'zh-Hans': '还没有人绑签。', ja: 'まだ結ばれていません。', ko: '아직 묶인 제비가 없어요.' },
  tieHere:      { en: 'Drew a stick that worries you? Tie it here and leave the worry behind. Only its number and the date show, never your name or your question.', 'zh-Hant': '抽到不好的籤，可以綁在這裡，把不安留下。只掛籤號和日子，不會有你的名字或問的事。', 'zh-Hans': '抽到不好的签，可以绑在这里，把不安留下。只挂签号和日子，不会有你的名字或问的事。', ja: '気がかりなおみくじは、ここに結んで帰れます。結ばれるのは番号と日付だけ。お名前やお願いの内容は出ません。', ko: '마음에 걸리는 제비는 여기 묶어 두고 갈 수 있어요. 번호와 날짜만 걸리고, 이름이나 물은 일은 나오지 않아요.' },
  drawFirst:    { en: 'Draw a stick first', 'zh-Hant': '先抽一支籤', 'zh-Hans': '先抽一支签', ja: 'まずおみくじを引く', ko: '먼저 제비 뽑기' },
  wishCount:    { en: '{w} wishes hang here now', 'zh-Hant': '現在掛著 {w} 個心願', 'zh-Hans': '现在挂着 {w} 个心愿', ja: 'いま {w} 枚の絵馬', ko: '지금 소원 {w}개가 걸려 있어요' },
  wishEmpty:    { en: 'No wishes yet.', 'zh-Hant': '還沒有許願牌。', 'zh-Hans': '还没有许愿牌。', ja: 'まだ絵馬はありません。', ko: '아직 소원패가 없어요.' },
  wishHere:     { en: 'Write a wish on a plaque; it hangs here for a year. Your name never shows.', 'zh-Hant': '在許願牌寫下心願，掛在這裡一年。不會顯示你的名字。', 'zh-Hans': '在许愿牌写下心愿，挂在这里一年。不会显示你的名字。', ja: '絵馬に願いごとを書いて、ここに一年掛けておけます。お名前は出ません。', ko: '소원패에 소원을 적어 여기 1년 동안 걸어 둘 수 있어요. 이름은 나오지 않아요.' },
  nudge:        { en: 'Uneasy? You can tie this stick outside.', 'zh-Hant': '心裡不安嗎？可以把這支籤綁在廟外。', 'zh-Hans': '心里不安吗？可以把这支签绑在庙外。', ja: '気がかりなら、このおみくじをお堂の外に結んでいけます。', ko: '마음에 걸리나요? 이 제비를 절 마당에 묶어 두고 갈 수 있어요.' },
  nudgeBad:     { en: 'A stick like this is usually tied at the temple rather than taken home.', 'zh-Hant': '這樣的籤，習慣上會綁在廟裡，不帶回家。', 'zh-Hans': '这样的签，习惯上会绑在庙里，不带回家。', ja: '凶のおみくじは、結んで帰る習わしがあります。', ko: '이런 제비는 보통 집에 가져가지 않고 절에 묶어 둬요.' },
  tie:          { en: 'Tie it outside', 'zh-Hant': '綁在廟外', 'zh-Hans': '绑在庙外', ja: '結んでいく', ko: '묶어 두기' },
  tieNote:      { en: 'Only the stick number and the date go up. Never your name or your question. The poem stays in your history.', 'zh-Hant': '綁上去的只有籤號和日子，不會有你的名字或問的事。籤詩仍留在你的紀錄裡。', 'zh-Hans': '绑上去的只有签号和日子，不会有你的名字或问的事。签诗仍留在你的记录里。', ja: '結ばれるのは番号と日付だけ。お名前やお願いの内容は出ません。おみくじは記録に残ります。', ko: '묶이는 것은 제비 번호와 날짜뿐, 이름이나 물은 일은 나오지 않아요. 제비 내용은 기록에 남아요.' },
  tieGo:        { en: 'Tie it', 'zh-Hant': '綁上', 'zh-Hans': '绑上', ja: '結ぶ', ko: '묶기' },
  notNow:       { en: 'Not now', 'zh-Hant': '先不要', 'zh-Hans': '先不要', ja: 'やめておく', ko: '다음에' },
  tied:         { en: 'Tied. Leave the worry here; the road is still yours.', 'zh-Hant': '綁好了。不安留在這裡，路還是自己走。', 'zh-Hans': '绑好了。不安留在这里，路还是自己走。', ja: '結びました。気がかりはここに置いていきましょう。', ko: '묶었어요. 걱정은 여기 두고 가세요.' },
  tiedAlready:  { en: 'Tied outside', 'zh-Hant': '已綁在廟外', 'zh-Hans': '已绑在庙外', ja: 'お堂の外に結びました', ko: '절 마당에 묶었어요' },
  tying:        { en: 'Tying…', 'zh-Hant': '綁上中…', 'zh-Hans': '绑上中…', ja: '結んでいます…', ko: '묶는 중…' },
  seeWall:      { en: 'See the wall', 'zh-Hant': '看看廟外', 'zh-Hans': '看看庙外', ja: 'お堂の外を見る', ko: '절 마당 보기' },
  hideWall:     { en: 'Close', 'zh-Hant': '收起', 'zh-Hans': '收起', ja: '閉じる', ko: '접기' },
  alsoWish:     { en: 'Want to make a wish too?', 'zh-Hant': '也想許個願？', 'zh-Hans': '也想许个愿？', ja: '願いごとも掛けますか？', ko: '소원도 걸어 볼까요?' },
  stickLabel:   { en: 'Stick {n}', 'zh-Hant': '第{n}籤', 'zh-Hans': '第{n}签', ja: '第{n}番', ko: '{n}번 제비' },
  yours:        { en: 'yours', 'zh-Hant': '你的', 'zh-Hans': '你的', ja: 'あなたの', ko: '내 것' },
  // Wishes
  wishes:       { en: 'Wish plaques', 'zh-Hant': '許願牌', 'zh-Hans': '许愿牌', ja: '絵馬', ko: '소원패' },
  wishButton:   { en: 'Hang a wish', 'zh-Hant': '掛許願牌', 'zh-Hans': '挂许愿牌', ja: '絵馬を掛ける', ko: '소원패 걸기' },
  placeholder:  { en: 'Your wish (everyone can read it; no names, phone numbers or addresses)', 'zh-Hant': '寫下你的心願（大家都看得到，不寫名字、電話、地址）', 'zh-Hans': '写下你的心愿（大家都看得到，不写名字、电话、地址）', ja: '願いごと（みんなが読めます。名前・電話・住所は書かないで）', ko: '소원을 적어 주세요 (모두가 볼 수 있어요. 이름·전화·주소는 빼고)' },
  wishFor:      { en: 'What for (optional)', 'zh-Hant': '祈求什麼（可不選）', 'zh-Hans': '祈求什么（可不选）', ja: '何の願い（任意）', ko: '무엇을 비나요 (선택)' },
  seal:         { en: 'Seal it: for Guanyin\'s eyes only', 'zh-Hant': '封起來，只給觀音看', 'zh-Hans': '封起来，只给观音看', ja: '封をして、観音さまだけに', ko: '봉해서 관음보살님께만' },
  sealNote:     { en: 'Sealed, others see only the back: the stamp and the date.', 'zh-Hant': '封起來後，別人只看到背面：祈求的字和日子。', 'zh-Hans': '封起来后，别人只看到背面：祈求的字和日子。', ja: '封をすると、ほかの人には裏面（願いの種類と日付）だけが見えます。', ko: '봉하면 다른 사람은 뒷면(비는 것과 날짜)만 봐요.' },
  priceLine:    { en: 'Hangs for one year · $0.10 from your credit', 'zh-Hant': '掛一年 · 從餘額扣 0.10 美元', 'zh-Hans': '挂一年 · 从余额扣 0.10 美元', ja: '一年間掛かります · クレジットから0.10ドル（約15円）', ko: '1년 동안 걸려요 · 크레딧에서 0.10달러' },
  balance:      { en: 'Balance {b}', 'zh-Hant': '餘額 {b}', 'zh-Hans': '余额 {b}', ja: '残高 {b}', ko: '잔액 {b}' },
  pay:          { en: 'Hang it · $0.10', 'zh-Hant': '掛上 · 0.10 美元', 'zh-Hans': '挂上 · 0.10 美元', ja: '掛ける · 0.10ドル（約15円）', ko: '걸기 · 0.10달러' },
  paying:       { en: 'Checking and hanging…', 'zh-Hant': '檢查並掛上中…', 'zh-Hans': '检查并挂上中…', ja: '確認して掛けています…', ko: '확인하고 거는 중…' },
  hung:         { en: 'Hung. May it go well.', 'zh-Hant': '掛好了。願一切順心。', 'zh-Hans': '挂好了。愿一切顺心。', ja: '掛けました。叶いますように。', ko: '걸었어요. 잘 되길 바라요.' },
  cancel:       { en: 'Cancel', 'zh-Hant': '取消', 'zh-Hans': '取消', ja: 'やめる', ko: '취소' },
  sealedBack:   { en: 'A wish', 'zh-Hant': '一個心願', 'zh-Hans': '一个心愿', ja: 'ひとつの願い', ko: '하나의 소원' },
  cameTrue:     { en: 'It came true', 'zh-Hant': '還願', 'zh-Hans': '还愿', ja: '願いが叶った', ko: '소원 성취' },
  cameTrueTag:  { en: 'Came true', 'zh-Hant': '已還願', 'zh-Hans': '已还愿', ja: '叶いました', ko: '이루어짐' },
  undoTrue:     { en: 'Undo', 'zh-Hant': '取消還願', 'zh-Hans': '取消还愿', ja: '取り消す', ko: '취소' },
  takeDown:     { en: 'Take it down', 'zh-Hant': '取下', 'zh-Hans': '取下', ja: '下ろす', ko: '내리기' },
  takeDownAsk:  { en: 'Take it down? There is no refund.', 'zh-Hant': '確定取下？不退費。', 'zh-Hans': '确定取下？不退费。', ja: '下ろしますか？返金はありません。', ko: '내릴까요? 환불은 없어요.' },
  sealIt:       { en: 'Seal it', 'zh-Hant': '封起來', 'zh-Hans': '封起来', ja: '封をする', ko: '봉하기' },
  openIt:       { en: 'Show the words', 'zh-Hant': '打開', 'zh-Hans': '打开', ja: '見せる', ko: '열기' },
  mine:         { en: 'My wishes', 'zh-Hant': '我的心願', 'zh-Hans': '我的心愿', ja: '私の願い', ko: '내 소원' },
  daysLeft:     { en: '{d} days left', 'zh-Hant': '還掛 {d} 天', 'zh-Hans': '还挂 {d} 天', ja: 'あと {d} 日', ko: '{d}일 남음' },
  down:         { en: 'Taken down', 'zh-Hant': '已取下', 'zh-Hans': '已取下', ja: '下ろしました', ko: '내림' },
  done:         { en: 'Its year is over', 'zh-Hant': '已圓滿', 'zh-Hans': '已圆满', ja: '一年が満ちました', ko: '1년이 다 됐어요' },
  hidden:       { en: 'Hidden after reports: only you can see it', 'zh-Hant': '已隱藏，只有你看得到', 'zh-Hans': '已隐藏，只有你看得到', ja: '通報により非表示：あなただけに見えます', ko: '신고로 숨겨짐: 나만 볼 수 있어요' },
  newer:        { en: 'Newer', 'zh-Hant': '較新的', 'zh-Hans': '较新的', ja: '新しい絵馬', ko: '최근 것' },
  older:        { en: 'Older', 'zh-Hant': '較早的', 'zh-Hans': '较早的', ja: '前の絵馬', ko: '이전 것' },
  tapToRead:    { en: 'Tap a plaque to read it.', 'zh-Hant': '點一塊許願牌來看。', 'zh-Hans': '点一块许愿牌来看。', ja: '絵馬をタップすると読めます。', ko: '소원패를 누르면 읽을 수 있어요.' },
  report:       { en: 'Report', 'zh-Hant': '檢舉', 'zh-Hans': '举报', ja: '通報', ko: '신고' },
  reportWhy:    { en: 'Why?', 'zh-Hant': '原因？', 'zh-Hans': '原因？', ja: '理由は？', ko: '이유는?' },
  reportDetails:{ en: 'Details (optional)', 'zh-Hant': '補充說明（可不填）', 'zh-Hans': '补充说明（可不填）', ja: '詳しく（任意）', ko: '자세히 (선택)' },
  reportSend:   { en: 'Send report', 'zh-Hant': '送出檢舉', 'zh-Hans': '送出举报', ja: '通報する', ko: '신고하기' },
  reported:     { en: 'Thank you. We will look at it.', 'zh-Hant': '謝謝，我們會處理。', 'zh-Hans': '谢谢，我们会处理。', ja: 'ありがとうございます。確認します。', ko: '감사합니다. 확인할게요.' },
  hide:         { en: 'Hide (admin)', 'zh-Hant': '隱藏（管理員）', 'zh-Hans': '隐藏（管理员）', ja: '非表示（管理者）', ko: '숨기기 (관리자)' },
  topUp:        { en: 'Top up', 'zh-Hant': '加值', 'zh-Hans': '充值', ja: 'チャージ', ko: '충전' },
  signIn:       { en: 'Sign in first', 'zh-Hant': '請先登入', 'zh-Hans': '请先登录', ja: '先にログインしてください', ko: '먼저 로그인해 주세요' },
  entertainment:{ en: 'For reflection and entertainment. Tying or wishing promises nothing; the road is yours to walk.', 'zh-Hant': '僅供參考與娛樂。綁籤、許願不保證任何結果，路仍要自己走。', 'zh-Hans': '仅供参考与娱乐。绑签、许愿不保证任何结果，路仍要自己走。', ja: '参考と娯楽のためのものです。結んでも願っても結果は約束されません。道はご自分で。', ko: '참고와 재미를 위한 것이에요. 묶거나 빌어도 결과를 약속하지 않아요. 길은 스스로 걸어요.' },
} satisfies Record<string, Words>

const FOR: Record<string, Words> = {
  peace:  { en: 'Peace', 'zh-Hant': '平安', 'zh-Hans': '平安', ja: '平安', ko: '평안' },
  health: { en: 'Health', 'zh-Hant': '健康', 'zh-Hans': '健康', ja: '健康', ko: '건강' },
  study:  { en: 'Study', 'zh-Hant': '學業', 'zh-Hans': '学业', ja: '学業', ko: '학업' },
  love:   { en: 'Love', 'zh-Hant': '姻緣', 'zh-Hans': '姻缘', ja: '良縁', ko: '인연' },
  work:   { en: 'Work', 'zh-Hant': '事業', 'zh-Hans': '事业', ja: '仕事', ko: '사업' },
  wealth: { en: 'Wealth', 'zh-Hant': '財運', 'zh-Hans': '财运', ja: '金運', ko: '재물' },
  other:  { en: 'Other', 'zh-Hant': '其他', 'zh-Hans': '其他', ja: 'その他', ko: '기타' },
}

const REASON: Record<string, Words> = {
  personal_info: { en: 'Personal details', 'zh-Hant': '個資', 'zh-Hans': '个人信息', ja: '個人情報', ko: '개인 정보' },
  harassment:    { en: 'Harassment', 'zh-Hant': '騷擾', 'zh-Hans': '骚扰', ja: '嫌がらせ', ko: '괴롭힘' },
  hate:          { en: 'Hate', 'zh-Hant': '仇恨', 'zh-Hans': '仇恨', ja: 'ヘイト', ko: '혐오' },
  sexual:        { en: 'Sexual', 'zh-Hant': '色情', 'zh-Hans': '色情', ja: '性的', ko: '선정적' },
  spam:          { en: 'Advertising', 'zh-Hant': '廣告', 'zh-Hans': '广告', ja: '宣伝', ko: '광고' },
  other:         { en: 'Other', 'zh-Hant': '其他', 'zh-Hans': '其他', ja: 'その他', ko: '기타' },
}

/** Refusals by code, from the wall routes. */
const ERR: Record<string, Words> = {
  sign_in:                { en: 'Please sign in first.', 'zh-Hant': '請先登入。', 'zh-Hans': '请先登录。', ja: '先にログインしてください。', ko: '먼저 로그인해 주세요.' },
  wish_empty:             { en: 'Write your wish first.', 'zh-Hant': '先寫下你的心願。', 'zh-Hans': '先写下你的心愿。', ja: '願いごとを書いてください。', ko: '소원을 먼저 적어 주세요.' },
  wish_too_long:          { en: 'At most 60 characters.', 'zh-Hant': '最多 60 個字。', 'zh-Hans': '最多 60 个字。', ja: '60文字までです。', ko: '60자까지예요.' },
  wish_contact:           { en: 'No phone numbers, emails, links or addresses, please. Long numbers count too.', 'zh-Hant': '請不要寫電話、email、連結或地址（長串數字也不行）。', 'zh-Hans': '请不要写电话、email、链接或地址（长串数字也不行）。', ja: '電話番号・メール・リンク・住所は書かないでください（長い数字も不可）。', ko: '전화번호·이메일·링크·주소는 빼 주세요 (긴 숫자도 안 돼요).' },
  wish_personal:          { en: 'It seems to name someone or hold personal details. Remove them, or seal it.', 'zh-Hant': '願文裡好像有人名或個人資料，請拿掉，或封起來再掛。', 'zh-Hans': '愿文里好像有人名或个人资料，请拿掉，或封起来再挂。', ja: '人の名前や個人情報が含まれているようです。消すか、封をして掛けてください。', ko: '이름이나 개인 정보가 있는 것 같아요. 지우거나 봉해서 걸어 주세요.' },
  wish_harm:              { en: 'A wish here cannot wish harm on anyone.', 'zh-Hant': '這裡的心願不能是希望別人不好。', 'zh-Hans': '这里的心愿不能是希望别人不好。', ja: '人の不幸を願う内容は掛けられません。', ko: '남이 잘못되길 바라는 소원은 걸 수 없어요.' },
  wish_ad:                { en: 'No advertising, please.', 'zh-Hant': '請不要放廣告。', 'zh-Hans': '请不要放广告。', ja: '宣伝はご遠慮ください。', ko: '광고는 안 돼요.' },
  wish_refused:           { en: 'This wish cannot be hung. Please rewrite it.', 'zh-Hant': '這個心願不能掛上，請改寫。', 'zh-Hans': '这个心愿不能挂上，请改写。', ja: 'この内容は掛けられません。書き直してください。', ko: '이 소원은 걸 수 없어요. 다시 적어 주세요.' },
  wish_check_unavailable: { en: 'The check could not run just now. Try again, or seal it.', 'zh-Hant': '檢查暫時無法進行，請再試一次，或封起來再掛。', 'zh-Hans': '检查暂时无法进行，请再试一次，或封起来再挂。', ja: '確認が今できません。もう一度試すか、封をして掛けてください。', ko: '지금은 확인할 수 없어요. 다시 시도하거나 봉해서 걸어 주세요.' },
  wish_daily_limit:       { en: 'That is today\'s ten. Come back tomorrow.', 'zh-Hant': '今天已經掛了十個，明天再來。', 'zh-Hans': '今天已经挂了十个，明天再来。', ja: '今日は十枚まで。また明日どうぞ。', ko: '오늘은 열 개까지예요. 내일 다시 와 주세요.' },
  tie_daily_limit:        { en: 'That is enough ties for today.', 'zh-Hant': '今天綁的籤夠多了。', 'zh-Hans': '今天绑的签够多了。', ja: '今日はもう十分結びました。', ko: '오늘은 충분히 묶었어요.' },
  no_credits:             { en: 'Not enough credit for $0.10.', 'zh-Hant': '餘額不足 0.10 美元。', 'zh-Hans': '余额不足 0.10 美元。', ja: 'クレジットが0.10ドルに足りません。', ko: '크레딧이 0.10달러보다 적어요.' },
  report_own:             { en: 'That is your own plaque.', 'zh-Hant': '這是你自己的許願牌。', 'zh-Hans': '这是你自己的许愿牌。', ja: 'ご自分の絵馬です。', ko: '내 소원패예요.' },
  wall_unavailable:       { en: 'The wall is not open yet.', 'zh-Hant': '廟外還沒開放。', 'zh-Hans': '庙外还没开放。', ja: 'まだ準備中です。', ko: '아직 준비 중이에요.' },
  failed:                 { en: 'Something went wrong. Please try again.', 'zh-Hant': '出了點問題，請再試一次。', 'zh-Hans': '出了点问题，请再试一次。', ja: 'うまくいきませんでした。もう一度お試しください。', ko: '문제가 생겼어요. 다시 시도해 주세요.' },
}

/** For the tests: every table, so each key is checked in all five languages. */
export const WALL_COPY = { W, FOR, REASON, ERR } as Record<string, Record<string, Words>>

const asL = (lang: string): L => (['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const).includes(lang as L) ? lang as L : 'zh-Hant'
export type WallKey = keyof typeof W
export const wallWords = (lang: string) => {
  const l = asL(lang)
  return {
    w: (k: WallKey, vars: Record<string, string | number> = {}) => W[k][l].replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? '')),
    forWord: (k: string | null | undefined) => (k && FOR[k] ? FOR[k][l] : ''),
    reason: (k: string) => REASON[k]?.[l] ?? k,
    err: (code: string | undefined) => (ERR[code ?? ''] ?? ERR.failed)[l],
  }
}
