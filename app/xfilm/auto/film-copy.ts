// The film type's words (XCreate's fifth type, Sep 29), five languages. The
// type's name itself is i18n `mode.film`.
import type { Lang } from '@/lib/i18n'
import type { FilmAspect } from '@/lib/film/config'

type Copy = {
  title: string
  subtitle: string
  briefLabel: string
  placeholder: string
  shape: string
  aspects: Record<FilmAspect, string>
  length: string
  seconds: (n: number) => string
  budget: string
  budgetNote: (budget: string) => string
  time: string
  make: (budget: string) => string
  signIn: string
  signInToView: string
  starting: string
  startError: string
  topUp: string
  making: string
  spent: (spent: string, budget: string) => string
  steps: string
  kinds: { image: string; clip: string; voice: string }
  working: string
  refused: string
  callFailed: string
  timeLimit: string
  budgetMoved: string
  done: string
  charged: (charged: string, budget: string, back: string) => string
  download: string
  notes: string
  another: string
  failed: string
  refunded: (budget: string) => string
  retry: string
  loadError: string
  errors: Record<'not_started' | 'not_finished' | 'time_limit' | 'stopped' | 'too_large' | 'no_credit', string>
}

const en: Copy = {
  title: 'Claude makes your film',
  subtitle: "Describe it. Claude Opus 5.5 plans the scenes, has ModelXD's models make the pictures, clips and voice, draws the titles in code and edits it all into one finished film.",
  briefLabel: 'Your film',
  placeholder: 'What it is for, what happens, how it should feel, and any words that must appear. For example: a 30-second opening promo for a bubble tea shop in Hsinchu, paper-cut style, a warm Mandarin voice.',
  shape: 'Shape',
  aspects: { '9:16': 'Vertical 9:16', '16:9': 'Wide 16:9', '1:1': 'Square 1:1' },
  length: 'Length',
  seconds: n => `${n}s`,
  budget: 'Budget',
  budgetNote: b => `Up to ${b}. You pay what it uses at list price and the rest comes back. No film, no charge.`,
  time: 'It takes about 10 to 20 minutes. You can leave: it keeps going and waits in your Library.',
  make: b => `Make the film · up to ${b}`,
  signIn: 'Sign in to make a film',
  signInToView: 'Sign in to see this film',
  starting: 'Starting…',
  startError: 'The film could not start. Nothing was charged.',
  topUp: 'Add credit',
  making: 'Claude is making your film',
  spent: (s, b) => `${s} of ${b} used so far`,
  steps: 'Progress',
  kinds: { image: 'Image', clip: 'Clip', voice: 'Voice' },
  working: 'working',
  refused: 'over budget',
  callFailed: 'failed',
  timeLimit: 'Reached the time limit. Saving what it has.',
  budgetMoved: 'Moved the unused generation budget to Claude so it can finish.',
  done: 'Your film is ready',
  charged: (c, b, r) => `Charged ${c} of the ${b} budget. ${r} went back to your balance.`,
  download: 'Download',
  notes: "Claude's notes",
  another: 'Make another film',
  failed: 'No film this time',
  refunded: b => `Nothing was charged: the ${b} reserve is back in your balance.`,
  retry: 'Try again with this brief',
  loadError: 'This film could not be loaded.',
  errors: {
    not_started: 'The film could not start.',
    not_finished: 'Claude stopped before saving the film.',
    time_limit: 'It reached the time limit before saving the film.',
    stopped: 'The film took too long and was stopped.',
    too_large: 'The film came out larger than 50 MB and could not be kept.',
    no_credit: 'Not enough credit.',
  },
}

const zhHant: Copy = {
  title: 'Claude 幫你做成片',
  subtitle: '說說你想要的影片。Claude Opus 5.5 會規劃分鏡，請 ModelXD 的模型生成畫面、片段和配音，用程式畫出標題與轉場，再剪成一支完整的影片。',
  briefLabel: '你的影片',
  placeholder: '用途、內容、想要的感覺，以及一定要出現的文字。例如：新竹一家手搖飲料店開幕的 30 秒宣傳片，剪紙風格，溫暖的中文女聲旁白。',
  shape: '畫面比例',
  aspects: { '9:16': '直式 9:16', '16:9': '橫式 16:9', '1:1': '方形 1:1' },
  length: '長度',
  seconds: n => `${n} 秒`,
  budget: '預算',
  budgetNote: b => `最多 ${b}。依實際用量以原價計費，沒用完的會退回；沒做出影片不收費。`,
  time: '大約需要 10 到 20 分鐘。你可以先離開，它會繼續做，完成後放在你的作品庫。',
  make: b => `開始製作 · 最多 ${b}`,
  signIn: '登入後製作影片',
  signInToView: '登入後查看這支影片',
  starting: '啟動中…',
  startError: '影片無法開始製作，沒有收費。',
  topUp: '加值',
  making: 'Claude 正在製作你的影片',
  spent: (s, b) => `目前已用 ${s}，預算 ${b}`,
  steps: '進度',
  kinds: { image: '圖片', clip: '片段', voice: '配音' },
  working: '生成中',
  refused: '超出預算',
  callFailed: '失敗',
  timeLimit: '已到時間上限，正在保存已完成的部分。',
  budgetMoved: '把沒用到的生成預算移給 Claude，讓它完成影片。',
  done: '影片完成了',
  charged: (c, b, r) => `預算 ${b}，實際收費 ${c}，${r} 已退回你的餘額。`,
  download: '下載',
  notes: 'Claude 的製作筆記',
  another: '再做一支',
  failed: '這次沒有做出影片',
  refunded: b => `沒有收費：預留的 ${b} 已退回你的餘額。`,
  retry: '用這份描述再試一次',
  loadError: '無法載入這支影片。',
  errors: {
    not_started: '影片無法開始製作。',
    not_finished: 'Claude 在存好影片之前就停下來了。',
    time_limit: '已到時間上限，影片還沒存好。',
    stopped: '製作時間過長，已停止。',
    too_large: '影片超過 50 MB，無法保存。',
    no_credit: '餘額不足。',
  },
}

const zhHans: Copy = {
  title: 'Claude 帮你做成片',
  subtitle: '说说你想要的视频。Claude Opus 5.5 会规划分镜，请 ModelXD 的模型生成画面、片段和配音，用代码画出标题与转场，再剪成一支完整的视频。',
  briefLabel: '你的视频',
  placeholder: '用途、内容、想要的感觉，以及一定要出现的文字。例如：新竹一家奶茶店开业的 30 秒宣传片，剪纸风格，温暖的中文女声旁白。',
  shape: '画面比例',
  aspects: { '9:16': '竖屏 9:16', '16:9': '横屏 16:9', '1:1': '方形 1:1' },
  length: '时长',
  seconds: n => `${n} 秒`,
  budget: '预算',
  budgetNote: b => `最多 ${b}。按实际用量以原价计费，没用完的会退回；没做出视频不收费。`,
  time: '大约需要 10 到 20 分钟。你可以先离开，它会继续做，完成后放在你的作品库。',
  make: b => `开始制作 · 最多 ${b}`,
  signIn: '登录后制作视频',
  signInToView: '登录后查看这支视频',
  starting: '启动中…',
  startError: '视频无法开始制作，没有收费。',
  topUp: '充值',
  making: 'Claude 正在制作你的视频',
  spent: (s, b) => `目前已用 ${s}，预算 ${b}`,
  steps: '进度',
  kinds: { image: '图片', clip: '片段', voice: '配音' },
  working: '生成中',
  refused: '超出预算',
  callFailed: '失败',
  timeLimit: '已到时间上限，正在保存已完成的部分。',
  budgetMoved: '把没用到的生成预算移给 Claude，让它完成视频。',
  done: '视频完成了',
  charged: (c, b, r) => `预算 ${b}，实际收费 ${c}，${r} 已退回你的余额。`,
  download: '下载',
  notes: 'Claude 的制作笔记',
  another: '再做一支',
  failed: '这次没有做出视频',
  refunded: b => `没有收费：预留的 ${b} 已退回你的余额。`,
  retry: '用这份描述再试一次',
  loadError: '无法加载这支视频。',
  errors: {
    not_started: '视频无法开始制作。',
    not_finished: 'Claude 在保存视频之前就停下来了。',
    time_limit: '已到时间上限，视频还没保存。',
    stopped: '制作时间过长，已停止。',
    too_large: '视频超过 50 MB，无法保存。',
    no_credit: '余额不足。',
  },
}

const ja: Copy = {
  title: 'Claude があなたのムービーを作ります',
  subtitle: '作りたい映像を書いてください。Claude Opus 5.5 が構成を考え、ModelXD のモデルで画像・クリップ・ナレーションを作り、タイトルやトランジションをコードで描いて、1本のムービーに編集します。',
  briefLabel: 'ムービーの内容',
  placeholder: '目的、内容、雰囲気、必ず入れたい文字など。例：新竹にオープンするタピオカ店の30秒の告知ムービー、切り絵風、温かい女性の中国語ナレーション。',
  shape: '画面比率',
  aspects: { '9:16': '縦 9:16', '16:9': '横 16:9', '1:1': '正方形 1:1' },
  length: '長さ',
  seconds: n => `${n}秒`,
  budget: '予算',
  budgetNote: b => `上限 ${b}。実際に使った分だけ定価で請求し、残りはお返しします。ムービーができなければ請求しません。`,
  time: '10〜20分ほどかかります。ページを離れても制作は続き、完成したらライブラリに入ります。',
  make: b => `ムービーを作る · 上限 ${b}`,
  signIn: 'ログインしてムービーを作る',
  signInToView: 'ログインしてこのムービーを見る',
  starting: '開始しています…',
  startError: 'ムービーの制作を開始できませんでした。請求はありません。',
  topUp: 'チャージ',
  making: 'Claude がムービーを制作中です',
  spent: (s, b) => `使用済み ${s}（予算 ${b}）`,
  steps: '進行状況',
  kinds: { image: '画像', clip: 'クリップ', voice: 'ナレーション' },
  working: '生成中',
  refused: '予算オーバー',
  callFailed: '失敗',
  timeLimit: '時間の上限に達しました。できた分を保存しています。',
  budgetMoved: '使わなかった生成予算を Claude に回して、仕上げを続けます。',
  done: 'ムービーができました',
  charged: (c, b, r) => `予算 ${b} のうち ${c} を請求しました。${r} は残高に戻りました。`,
  download: 'ダウンロード',
  notes: 'Claude の制作メモ',
  another: 'もう1本作る',
  failed: '今回はムービーを作れませんでした',
  refunded: b => `請求はありません。予約した ${b} は残高に戻りました。`,
  retry: 'この内容でもう一度',
  loadError: 'このムービーを読み込めませんでした。',
  errors: {
    not_started: 'ムービーの制作を開始できませんでした。',
    not_finished: 'Claude がムービーを保存する前に止まりました。',
    time_limit: 'ムービーを保存する前に時間の上限に達しました。',
    stopped: '時間がかかりすぎたため停止しました。',
    too_large: 'ムービーが 50 MB を超えたため保存できませんでした。',
    no_credit: '残高が足りません。',
  },
}

const ko: Copy = {
  title: 'Claude가 영상을 완성해 드려요',
  subtitle: '원하는 영상을 설명해 주세요. Claude Opus 5.5가 장면을 구성하고, ModelXD의 모델로 이미지·클립·내레이션을 만들고, 제목과 전환 효과를 코드로 그려 한 편의 영상으로 편집합니다.',
  briefLabel: '영상 설명',
  placeholder: '용도, 내용, 분위기, 꼭 들어가야 할 문구 등. 예: 신주에 새로 여는 버블티 가게의 30초 오픈 홍보 영상, 종이 공예 스타일, 따뜻한 여성 중국어 내레이션.',
  shape: '화면 비율',
  aspects: { '9:16': '세로 9:16', '16:9': '가로 16:9', '1:1': '정사각형 1:1' },
  length: '길이',
  seconds: n => `${n}초`,
  budget: '예산',
  budgetNote: b => `최대 ${b}. 실제 사용한 만큼 정가로 청구하고 나머지는 돌려드립니다. 영상이 나오지 않으면 청구하지 않습니다.`,
  time: '10~20분 정도 걸립니다. 페이지를 떠나도 계속 만들어지고, 완성되면 라이브러리에 들어갑니다.',
  make: b => `영상 만들기 · 최대 ${b}`,
  signIn: '로그인하고 영상 만들기',
  signInToView: '로그인하고 이 영상 보기',
  starting: '시작하는 중…',
  startError: '영상 제작을 시작하지 못했습니다. 청구되지 않았습니다.',
  topUp: '충전',
  making: 'Claude가 영상을 만드는 중이에요',
  spent: (s, b) => `지금까지 ${s} 사용 (예산 ${b})`,
  steps: '진행 상황',
  kinds: { image: '이미지', clip: '클립', voice: '내레이션' },
  working: '생성 중',
  refused: '예산 초과',
  callFailed: '실패',
  timeLimit: '시간 제한에 도달해 만든 부분을 저장하고 있습니다.',
  budgetMoved: '쓰지 않은 생성 예산을 Claude에게 넘겨 마무리를 이어갑니다.',
  done: '영상이 완성됐어요',
  charged: (c, b, r) => `예산 ${b} 중 ${c}를 청구했고, ${r}는 잔액으로 돌아갔습니다.`,
  download: '다운로드',
  notes: 'Claude의 제작 노트',
  another: '하나 더 만들기',
  failed: '이번에는 영상을 만들지 못했어요',
  refunded: b => `청구되지 않았습니다. 예약된 ${b}는 잔액으로 돌아갔습니다.`,
  retry: '이 설명으로 다시 시도',
  loadError: '이 영상을 불러오지 못했습니다.',
  errors: {
    not_started: '영상 제작을 시작하지 못했습니다.',
    not_finished: 'Claude가 영상을 저장하기 전에 멈췄습니다.',
    time_limit: '영상을 저장하기 전에 시간 제한에 도달했습니다.',
    stopped: '시간이 너무 오래 걸려 중단했습니다.',
    too_large: '영상이 50MB를 넘어 저장할 수 없었습니다.',
    no_credit: '잔액이 부족합니다.',
  },
}

const COPY: Record<Lang, Copy> = { en, 'zh-Hant': zhHant, 'zh-Hans': zhHans, ja, ko }

export function filmCopy(lang: Lang): Copy {
  return COPY[lang] ?? en
}
