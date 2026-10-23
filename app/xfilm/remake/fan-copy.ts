// 風扇變裝 (fan outfit change), the template in 同款's tab (Oct 18): the
// page's words in five languages (lib/fan-template).
import type { Lang } from '@/lib/i18n'
import type { FanMusicStyle } from '@/lib/fan-template/recipe'
import type { FanStatus } from '@/lib/fan-template/job'

type Copy = {
  /** The section in 同款's tab under the link: 熱門範本 / Popular Templates (Oct 22). */
  section: string
  sectionNote: string
  name: string
  pitch: string
  about: (price: string) => string
  /** The card's price: the cheapest run (two outfits). */
  from: (price: string) => string
  length: (seconds: number) => string
  use: string
  back: string
  title: string
  subtitle: string
  photosLabel: string
  front: string
  /** One front photo is enough: the side views are drawn (owner, Oct 18). */
  frontNote: string
  consent: string
  outfitsLabel: string
  outfit: (n: number) => string
  outfitPlaceholder: string
  outfitPhoto: string
  outfitPhotoClear: string
  addOutfit: string
  removeOutfit: (n: number) => string
  /** Optional: the fan's blades, the sofa, the carpet and the floor, in words or a photo. */
  sceneLabel: string
  sceneNote: string
  scene: { blade: string; sofa: string; carpet: string; floor: string }
  scenePlaceholder: { blade: string; sofa: string; carpet: string; floor: string }
  scenePhoto: string
  musicLabel: string
  musicChoices: { style: string; mine: string; none: string }
  styles: Record<FanMusicStyle, string>
  audioPick: string
  make: string
  makeNote: (reserve: string) => string
  starting: string
  stages: Record<FanStatus, string>
  steps: (done: number, total: number) => string
  spent: (spent: string, reserved: string) => string
  saved: string
  charged: (c: string) => string
  download: string
  again: string
  failedNote: string
  topUp: string
  signIn: string
  missingRun: string
  errors: Record<'insufficient_credits' | 'refused' | 'moderation_unavailable' | 'missing_photo' | 'consent' | 'missing_outfit' | 'no_track' | 'upload_failed' | 'start_failed', string>
  insufficient: (need: string, have: string) => string
}

const en: Copy = {
  section: 'Popular Templates',
  sectionNote: 'A popular trend, ready to make with your photo.',
  name: 'Fan outfit change',
  pitch: 'Roll off the sofa, press the remote, and every pass of the ceiling fan changes your outfit.',
  about: p => `About ${p}`,
  from: p => `From about ${p}`,
  length: s => `about ${s} s`,
  use: 'Use this template',
  back: 'Back to Remake',
  title: 'Fan outfit change',
  subtitle: 'One front photo, 2 to 5 outfits, one steady fan. Made in about 10 minutes.',
  photosLabel: 'Your photo',
  front: 'Front photo',
  frontNote: 'One front photo is enough: we draw your side views.',
  consent: 'This is me, or I have this person’s permission to use their photo.',
  outfitsLabel: 'Outfits (2 to 5)',
  outfit: n => `Outfit ${n}`,
  outfitPlaceholder: 'Describe the outfit',
  outfitPhoto: 'Add an outfit photo',
  outfitPhotoClear: 'Remove photo',
  addOutfit: 'Add an outfit',
  removeOutfit: n => `Remove outfit ${n}`,
  sceneLabel: 'Scene (optional)',
  sceneNote: 'Describe it or add a reference photo. Left empty: the walnut fan, the palace sofa, the Persian rug and the marble floor.',
  scene: { blade: 'Fan blades', sofa: 'Sofa', carpet: 'Carpet', floor: 'Floor' },
  scenePlaceholder: { blade: 'e.g. walnut wood', sofa: 'e.g. pink velvet sofa', carpet: 'e.g. white shaggy rug', floor: 'e.g. herringbone oak' },
  scenePhoto: 'Add a reference photo',
  musicLabel: 'Music',
  musicChoices: { style: 'New track', mine: 'My track', none: 'No music' },
  styles: { runway: 'Runway', pop: 'Pop', anime: 'Anime opening', kpop: 'K-pop', edm: 'EDM', rock: 'Rock', lofi: 'Lo-fi' },
  audioPick: 'Choose an audio file',
  make: 'Make it',
  makeNote: r => `${r} is reserved when it starts; you pay only what is used, and the rest comes back.`,
  starting: 'Starting…',
  stages: { sheet: 'Drawing you', opening: 'Making the opening', outfits: 'Dressing the outfits', clips: 'Making the clips', finishing: 'Adding the fan and music', done: 'Done', failed: 'It did not finish' },
  steps: (d, t) => `${d} of ${t} steps`,
  spent: (s, r) => `${s} used of ${r} reserved`,
  saved: 'Saved to your Library.',
  charged: c => `Charged ${c}; the rest of the reserve came back.`,
  download: 'Download',
  again: 'Make another',
  failedNote: 'Nothing was charged; the reserve came back.',
  topUp: 'Top up',
  signIn: 'Sign in to make it',
  missingRun: 'This video is not in your account.',
  errors: { insufficient_credits: '', refused: 'Some of the words cannot be used. Please change them.', moderation_unavailable: 'The words could not be checked just now. Please try again.', missing_photo: 'Add your front photo first.', consent: 'Tick the box under your photo first.', missing_outfit: 'Describe every outfit.', no_track: 'Choose your music file first.', upload_failed: 'Your files could not be uploaded. Please try again.', start_failed: 'It could not start. Nothing was charged.' },
  insufficient: (n, h) => `This reserves ${n}, and your balance is ${h}.`,
}

const zhHant: Copy = {
  section: '熱門範本',
  sectionNote: '熱門玩法，放上你的照片就能做。',
  name: '風扇變裝',
  pitch: '從沙發翻下來、按下遙控器，吊扇每轉過一次就換一套衣服。',
  about: p => `約 ${p}`,
  from: p => `約 ${p} 起`,
  length: s => `約 ${s} 秒`,
  use: '用這個範本',
  back: '回到做同款',
  title: '風扇變裝',
  subtitle: '一張正面照、2 到 5 套穿搭、穩定轉動的吊扇。大約 10 分鐘做好。',
  photosLabel: '你的照片',
  front: '正面照',
  frontNote: '只要一張正面照，側面由我們畫。',
  consent: '這是我本人，或我已取得照片中這個人的同意。',
  outfitsLabel: '穿搭（2 到 5 套）',
  outfit: n => `第 ${n} 套`,
  outfitPlaceholder: '描述這套穿搭',
  outfitPhoto: '加穿搭照片',
  outfitPhotoClear: '移除照片',
  addOutfit: '加一套',
  removeOutfit: n => `移除第 ${n} 套`,
  sceneLabel: '場景（可不填）',
  sceneNote: '寫下想要的樣子，或放一張參考照片。不填就用胡桃木吊扇、宮廷沙發、波斯地毯和大理石地板。',
  scene: { blade: '扇葉', sofa: '沙發', carpet: '地毯', floor: '地板' },
  scenePlaceholder: { blade: '例如：胡桃木紋', sofa: '例如：粉紅色絲絨沙發', carpet: '例如：白色長毛地毯', floor: '例如：人字拼橡木地板' },
  scenePhoto: '加參考照片',
  musicLabel: '音樂',
  musicChoices: { style: '新配樂', mine: '我的音樂', none: '不要音樂' },
  styles: { runway: '伸展台', pop: '流行', anime: '動畫片頭', kpop: 'K-pop', edm: '電音', rock: '搖滾', lofi: 'Lo-fi' },
  audioPick: '選擇音訊檔',
  make: '開始製作',
  makeNote: r => `開始時先預留 ${r}；只收實際用掉的，其餘退回。`,
  starting: '開始中…',
  stages: { sheet: '正在畫你', opening: '正在做開場', outfits: '正在換上穿搭', clips: '正在做影片片段', finishing: '正在加上吊扇和音樂', done: '完成', failed: '沒有做完' },
  steps: (d, t) => `第 ${d} / ${t} 步`,
  spent: (s, r) => `已用 ${s}，預留 ${r}`,
  saved: '已存到你的作品庫。',
  charged: c => `收費 ${c}，其餘預留已退回。`,
  download: '下載',
  again: '再做一支',
  failedNote: '沒有收費，預留已退回。',
  topUp: '儲值',
  signIn: '登入後製作',
  missingRun: '這支影片不在你的帳號裡。',
  errors: { insufficient_credits: '', refused: '有些文字不能使用，請修改。', moderation_unavailable: '暫時無法檢查文字，請再試一次。', missing_photo: '請先放上你的正面照。', consent: '請先勾選照片下方的同意。', missing_outfit: '請寫好每一套穿搭。', no_track: '請先選擇你的音樂檔。', upload_failed: '檔案上傳失敗，請再試一次。', start_failed: '無法開始，沒有收費。' },
  insufficient: (n, h) => `製作需預留 ${n}，你的餘額是 ${h}。`,
}

const zhHans: Copy = {
  ...zhHant,
  section: '热门模板',
  sectionNote: '热门玩法，放上你的照片就能做。',
  name: '风扇变装',
  pitch: '从沙发翻下来、按下遥控器，吊扇每转过一次就换一套衣服。',
  about: p => `约 ${p}`,
  from: p => `约 ${p} 起`,
  length: s => `约 ${s} 秒`,
  use: '用这个模板',
  back: '回到做同款',
  title: '风扇变装',
  subtitle: '一张正面照、2 到 5 套穿搭、稳定转动的吊扇。大约 10 分钟做好。',
  photosLabel: '你的照片',
  frontNote: '只要一张正面照，侧面由我们画。',
  consent: '这是我本人，或我已取得照片中这个人的同意。',
  outfitsLabel: '穿搭（2 到 5 套）',
  outfitPlaceholder: '描述这套穿搭',
  outfitPhoto: '加穿搭照片',
  outfitPhotoClear: '移除照片',
  sceneLabel: '场景（可不填）',
  sceneNote: '写下想要的样子，或放一张参考照片。不填就用胡桃木吊扇、宫廷沙发、波斯地毯和大理石地板。',
  scene: { blade: '扇叶', sofa: '沙发', carpet: '地毯', floor: '地板' },
  scenePlaceholder: { blade: '例如：胡桃木纹', sofa: '例如：粉色丝绒沙发', carpet: '例如：白色长毛地毯', floor: '例如：人字拼橡木地板' },
  scenePhoto: '加参考照片',
  musicLabel: '音乐',
  musicChoices: { style: '新配乐', mine: '我的音乐', none: '不要音乐' },
  styles: { runway: 'T台', pop: '流行', anime: '动画片头', kpop: 'K-pop', edm: '电音', rock: '摇滚', lofi: 'Lo-fi' },
  audioPick: '选择音频文件',
  make: '开始制作',
  makeNote: r => `开始时先预留 ${r}；只收实际用掉的，其余退回。`,
  starting: '开始中…',
  stages: { sheet: '正在画你', opening: '正在做开场', outfits: '正在换上穿搭', clips: '正在做视频片段', finishing: '正在加上吊扇和音乐', done: '完成', failed: '没有做完' },
  spent: (s, r) => `已用 ${s}，预留 ${r}`,
  saved: '已存到你的作品库。',
  charged: c => `收费 ${c}，其余预留已退回。`,
  download: '下载',
  failedNote: '没有收费，预留已退回。',
  topUp: '充值',
  signIn: '登录后制作',
  missingRun: '这支视频不在你的账号里。',
  errors: { insufficient_credits: '', refused: '有些文字不能使用，请修改。', moderation_unavailable: '暂时无法检查文字，请再试一次。', missing_photo: '请先放上你的正面照。', consent: '请先勾选照片下方的同意。', missing_outfit: '请写好每一套穿搭。', no_track: '请先选择你的音乐文件。', upload_failed: '文件上传失败，请再试一次。', start_failed: '无法开始，没有收费。' },
  insufficient: (n, h) => `制作需预留 ${n}，你的余额是 ${h}。`,
}

const ja: Copy = {
  section: '人気のテンプレート',
  sectionNote: '人気の型を、あなたの写真でそのまま作れます。',
  name: '扇風機で着替え',
  pitch: 'ソファから転がって、リモコンを押すと、シーリングファンが回るたびに服が変わる。',
  about: p => `約 ${p}`,
  from: p => `約 ${p} から`,
  length: s => `約 ${s} 秒`,
  use: 'このテンプレートを使う',
  back: 'リメイクに戻る',
  title: '扇風機で着替え',
  subtitle: '正面の写真 1 枚、2〜5 つのコーデ、一定の速さで回るファン。10 分ほどで完成。',
  photosLabel: 'あなたの写真',
  front: '正面の写真',
  frontNote: '正面の写真 1 枚で大丈夫です。横向きはこちらで描きます。',
  consent: 'これは本人です。または写真の人の許可を得ています。',
  outfitsLabel: 'コーデ（2〜5 つ）',
  outfit: n => `コーデ ${n}`,
  outfitPlaceholder: 'コーデを説明',
  outfitPhoto: 'コーデ写真を追加',
  outfitPhotoClear: '写真を外す',
  addOutfit: 'コーデを追加',
  removeOutfit: n => `コーデ ${n} を外す`,
  sceneLabel: 'シーン（任意）',
  sceneNote: '言葉で書くか、参考写真を追加してください。空欄ならウォールナットのファン、宮殿風のソファ、ペルシャ絨毯、大理石の床になります。',
  scene: { blade: 'ファンの羽根', sofa: 'ソファ', carpet: 'ラグ', floor: '床' },
  scenePlaceholder: { blade: '例：ウォールナットの木目', sofa: '例：ピンクのベルベットのソファ', carpet: '例：白いシャギーラグ', floor: '例：ヘリンボーンのオーク材' },
  scenePhoto: '参考写真を追加',
  musicLabel: '音楽',
  musicChoices: { style: '新しい曲', mine: '自分の曲', none: '音楽なし' },
  styles: { runway: 'ランウェイ', pop: 'ポップ', anime: 'アニメOP風', kpop: 'K-POP', edm: 'EDM', rock: 'ロック', lofi: 'Lo-fi' },
  audioPick: '音声ファイルを選ぶ',
  make: '作る',
  makeNote: r => `開始時に ${r} を仮押さえします。使った分だけ支払い、残りは戻ります。`,
  starting: '開始しています…',
  stages: { sheet: 'あなたを描いています', opening: 'オープニングを作っています', outfits: 'コーデを着せています', clips: 'クリップを作っています', finishing: 'ファンと音楽を入れています', done: '完成', failed: '完成しませんでした' },
  steps: (d, t) => `${t} 中 ${d} ステップ`,
  spent: (s, r) => `${r} の仮押さえ中 ${s} 使用`,
  saved: 'ライブラリに保存しました。',
  charged: c => `${c} を請求し、残りは戻りました。`,
  download: 'ダウンロード',
  again: 'もう一本作る',
  failedNote: '請求はありません。仮押さえは戻りました。',
  topUp: 'チャージ',
  signIn: 'ログインして作る',
  missingRun: 'この動画はあなたのアカウントにありません。',
  errors: { insufficient_credits: '', refused: '使えない言葉があります。変更してください。', moderation_unavailable: 'いま文字を確認できません。もう一度お試しください。', missing_photo: '先に正面の写真を追加してください。', consent: '写真の下のチェックを入れてください。', missing_outfit: 'すべてのコーデを書いてください。', no_track: '先に音楽ファイルを選んでください。', upload_failed: 'ファイルをアップロードできませんでした。もう一度お試しください。', start_failed: '開始できませんでした。請求はありません。' },
  insufficient: (n, h) => `作るには ${n} の仮押さえが必要です。残高は ${h} です。`,
}

const ko: Copy = {
  section: '인기 템플릿',
  sectionNote: '인기 포맷을 내 사진으로 바로 만들어요.',
  name: '선풍기 코디 체인지',
  pitch: '소파에서 굴러 내려와 리모컨을 누르면, 실링팬이 지나갈 때마다 옷이 바뀝니다.',
  about: p => `약 ${p}`,
  from: p => `약 ${p}부터`,
  length: s => `약 ${s}초`,
  use: '이 템플릿 사용',
  back: '리메이크로 돌아가기',
  title: '선풍기 코디 체인지',
  subtitle: '정면 사진 한 장, 코디 2~5가지, 일정하게 도는 팬. 10분 정도면 완성.',
  photosLabel: '내 사진',
  front: '정면 사진',
  frontNote: '정면 사진 한 장이면 됩니다. 측면은 저희가 그려요.',
  consent: '본인이거나, 사진 속 사람의 동의를 받았습니다.',
  outfitsLabel: '코디 (2~5가지)',
  outfit: n => `코디 ${n}`,
  outfitPlaceholder: '코디를 설명하세요',
  outfitPhoto: '코디 사진 추가',
  outfitPhotoClear: '사진 빼기',
  addOutfit: '코디 추가',
  removeOutfit: n => `코디 ${n} 빼기`,
  sceneLabel: '장면 (선택)',
  sceneNote: '원하는 모습을 적거나 참고 사진을 넣으세요. 비워 두면 월넛 팬, 궁전풍 소파, 페르시안 러그, 대리석 바닥으로 만듭니다.',
  scene: { blade: '팬 날개', sofa: '소파', carpet: '러그', floor: '바닥' },
  scenePlaceholder: { blade: '예: 월넛 원목', sofa: '예: 핑크 벨벳 소파', carpet: '예: 흰색 털 러그', floor: '예: 헤링본 오크 마루' },
  scenePhoto: '참고 사진 추가',
  musicLabel: '음악',
  musicChoices: { style: '새 음악', mine: '내 음악', none: '음악 없음' },
  styles: { runway: '런웨이', pop: '팝', anime: '애니 오프닝', kpop: 'K-pop', edm: 'EDM', rock: '록', lofi: 'Lo-fi' },
  audioPick: '오디오 파일 선택',
  make: '만들기',
  makeNote: r => `시작할 때 ${r}를 예치하고, 쓴 만큼만 결제되며 나머지는 돌려드립니다.`,
  starting: '시작하는 중…',
  stages: { sheet: '당신을 그리는 중', opening: '오프닝 만드는 중', outfits: '코디 입히는 중', clips: '클립 만드는 중', finishing: '팬과 음악 넣는 중', done: '완료', failed: '완성되지 않았습니다' },
  steps: (d, t) => `${t}단계 중 ${d}단계`,
  spent: (s, r) => `예치 ${r} 중 ${s} 사용`,
  saved: '라이브러리에 저장했습니다.',
  charged: c => `${c} 결제, 나머지 예치금은 돌려드렸습니다.`,
  download: '다운로드',
  again: '하나 더 만들기',
  failedNote: '결제되지 않았고 예치금은 돌려드렸습니다.',
  topUp: '충전',
  signIn: '로그인하고 만들기',
  missingRun: '이 영상은 계정에 없습니다.',
  errors: { insufficient_credits: '', refused: '사용할 수 없는 단어가 있습니다. 수정해 주세요.', moderation_unavailable: '지금은 글을 확인할 수 없습니다. 다시 시도해 주세요.', missing_photo: '먼저 정면 사진을 넣어 주세요.', consent: '사진 아래 동의에 체크해 주세요.', missing_outfit: '모든 코디를 적어 주세요.', no_track: '먼저 음악 파일을 선택해 주세요.', upload_failed: '파일을 올리지 못했습니다. 다시 시도해 주세요.', start_failed: '시작하지 못했습니다. 결제되지 않았습니다.' },
  insufficient: (n, h) => `만들려면 ${n} 예치가 필요하고, 잔액은 ${h}입니다.`,
}

const COPY: Record<Lang, Copy> = { en, 'zh-Hant': zhHant, 'zh-Hans': zhHans, ja, ko }
export const fanCopy = (lang: Lang): Copy => COPY[lang] ?? en
