// 同款 (Remake), XCreate's sixth type (Oct 10): the page's words in five
// languages. The type's name itself is i18n `mode.remake`.
import type { Lang } from '@/lib/i18n'
import type { CastChoice, MusicChoice, RemakeLook, ThingChoice, ThingKind, VoiceChoice } from '@/lib/remake/config'

type Copy = {
  title: string
  subtitle: string
  linkLabel: string
  placeholder: string
  read: string
  reading: string
  orUpload: string
  upload: string
  uploading: string
  startAt: string
  startHint: string
  signIn: string
  left: (n: number) => string
  errors: Record<'invalid_link' | 'x_no_video' | 'x_unavailable' | 'read_failed' | 'unavailable' | 'too_large' | 'unsupported_file' | 'not_found', string>
  uploadOnly: (platform: string) => string
  dailyCap: (n: number) => string
  shots: (n: number, seconds: string) => string
  characters: string
  lines: string
  music: string
  musicLine: (mood: string, bpm: number | null, onBeat: boolean) => string
  look: string
  framing: Record<string, string>
  transitions: Record<string, string>
  lengthLabel: string
  whole: (seconds: number) => string
  seconds: (n: number) => string
  about: (price: string) => string
  fromShot: string
  swapHeading: string
  cast: Record<CastChoice, string>
  describePlaceholder: string
  famousPlaceholder: string
  photoPick: string
  photoConsent: string
  theme: string
  themePlaceholder: string
  setting: string
  settingPlaceholder: string
  lookLabel: string
  looks: Record<RemakeLook, string>
  language: string
  product: string
  /** The make bar's button; the price sits beside it. */
  make: string
  makeSoon: string
  another: string
  /** A kept read opening from its link (/xcreate?remake=<id>). */
  opening: string
  /** Its link names no read of this account (deleted, mistyped, someone else's). */
  missingRead: string
  showAll: (n: number) => string
  showLess: string
  otherCast: (n: number) => string
  /** The heading's two strips and the swap cards: the original, then yours. */
  original: string
  yours: string
  paste: string
  clear: string
  inShots: (n: number) => string
  /** 03, the materials the read found (Oct 13). */
  materials: (n: number) => string
  kinds: { people: string; things: string; places: string; sound: string; text: string; overall: string }
  thingKinds: Record<ThingKind, string>
  thingChoices: Record<ThingChoice, string>
  thingPlaceholder: string
  myLogo: string
  logoNote: string
  musicChoices: Record<MusicChoice, string>
  noMusicNote: string
  voiceLabel: string
  voiceChoices: Record<VoiceChoice, string>
  linesCount: (n: number) => string
  audioPick: string
  textsCount: (n: number) => string
  textAuto: string
  showAllTexts: (n: number) => string
  watchHere: string
  /** The "try a popular one" row under the paste box (Oct 13). */
  tryHeading: string
  withPrompt: string
  creatorPrompt: string
}

const en: Copy = {
  title: 'Remake any video',
  subtitle: 'Paste a video you saw, swap the main character, the theme or the setting, and get your own version with the same shots and the same pace.',
  linkLabel: 'Video link',
  placeholder: 'Paste a YouTube or X video link',
  read: 'Read the video',
  reading: 'Watching it frame by frame. A long video takes up to two minutes…',
  orUpload: 'For TikTok, Instagram and others, save the video to your phone and upload it.',
  upload: 'Upload a video file',
  uploading: 'Uploading…',
  startAt: 'Start reading at (seconds)',
  startHint: 'For videos over 3 minutes, 3 minutes are read from here.',
  signIn: 'Sign in to read it',
  left: n => `${n} free reads left today`,
  errors: {
    invalid_link: "That isn't a video link. Paste a YouTube or X video address.",
    x_no_video: 'That post has no video.',
    x_unavailable: "Couldn't read that post. It may be private or deleted.",
    read_failed: "Couldn't read this video. Try another one, or try again later.",
    unavailable: "Reading isn't available right now. Try again later.",
    too_large: 'The file is too large (300 MB at most).',
    unsupported_file: 'Upload an MP4, MOV or WebM video.',
    not_found: "That file wasn't found. Upload it again.",
  },
  uploadOnly: p => `${p} links can't be read directly. Save the video to your phone, then tap "Upload a video file".`,
  dailyCap: n => `You've used today's ${n} free reads. Come back tomorrow.`,
  shots: (n, s) => `${n} shots · ${s}s`,
  characters: 'Characters',
  lines: 'Lines',
  music: 'Music',
  musicLine: (mood, bpm, onBeat) => `${mood}${bpm ? `, about ${bpm} BPM` : ''}${onBeat ? ', cut on the beat' : ''}`,
  look: 'Look',
  framing: { 'extreme close-up': 'Extreme close-up', 'close-up': 'Close-up', 'medium close-up': 'Medium close-up', medium: 'Medium', 'medium wide': 'Medium wide', wide: 'Wide', 'extreme wide': 'Extreme wide', insert: 'Insert' },
  transitions: { cut: 'Cut', dissolve: 'Dissolve', 'fade from black': 'Fade from black', 'fade from white': 'Fade from white', flash: 'Flash', whip: 'Whip', 'match cut': 'Match cut', wipe: 'Wipe' },
  lengthLabel: 'How long',
  whole: s => `All ${s}s`,
  seconds: n => `${n}s`,
  about: p => `about ${p}`,
  fromShot: 'Start from shot',
  swapHeading: 'Materials to swap',
  cast: { keep: 'Keep', photo: 'My photo', describe: 'Describe', famous: 'Famous person' },
  describePlaceholder: 'e.g. a shiba inu in a suit',
  famousPlaceholder: 'e.g. Elon Musk',
  photoPick: 'Choose a photo',
  photoConsent: "This is me, or I have this person's permission.",
  theme: 'Theme',
  themePlaceholder: 'e.g. make it an ad for a bubble tea shop',
  setting: 'Setting',
  settingPlaceholder: 'e.g. a Taipei night market',
  lookLabel: 'Style',
  looks: { keep: 'As the original', anime: 'Anime', realistic: 'Realistic', '3d': '3D' },
  language: 'Language for voices and captions',
  product: 'Your product photo (optional)',
  make: 'Make my version',
  makeSoon: 'Making it comes next. For now you can read a video and choose what to swap.',
  another: 'Try another video',
  opening: 'Opening your read…',
  missingRead: "This read isn't in your Library. It may have been deleted, or belong to another account.",
  showAll: n => `Show all ${n} shots`,
  showLess: 'Show fewer',
  otherCast: n => `${n} more people (on screen briefly)`,
  original: 'Original',
  yours: 'Yours',
  paste: 'Paste',
  clear: 'Clear',
  inShots: n => n === 1 ? 'in 1 shot' : `in ${n} shots`,
  materials: n => `${n} materials found. Tap one to swap it.`,
  kinds: { people: 'People', things: 'Things', places: 'Places', sound: 'Sound', text: 'On-screen text', overall: 'Overall' },
  thingKinds: { product: 'Product', prop: 'Prop', logo: 'Logo' },
  thingChoices: { keep: 'Keep', photo: 'My photo', describe: 'Describe', remove: 'Remove' },
  thingPlaceholder: 'e.g. a cup of bubble tea',
  myLogo: 'My logo',
  logoNote: "The original's logo never appears in your version.",
  musicChoices: { none: 'No music', mine: 'My track' },
  noMusicNote: "The original's music is never reused. Without your track, each shot keeps its own sound.",
  voiceLabel: 'Voice',
  voiceChoices: { ai: 'AI voice', mine: 'My recording', none: 'No voice' },
  linesCount: n => n === 1 ? '1 line' : `${n} lines`,
  audioPick: 'Choose an audio file',
  textsCount: n => n === 1 ? '1 text' : `${n} texts`,
  textAuto: 'Rewritten for your theme',
  showAllTexts: n => `Show all ${n}`,
  watchHere: 'Watch this moment of the original',
  tryHeading: 'Try a popular one',
  withPrompt: 'Prompt shared',
  creatorPrompt: "The creator's prompt",
}

const zhHant: Copy = {
  title: '做同款',
  subtitle: '貼上你看到的影片，換掉主角、主題或背景，做出同樣鏡頭、同樣節奏的你的版本。',
  linkLabel: '影片連結',
  placeholder: '貼上 YouTube 或 X 的影片連結',
  read: '讀取影片',
  reading: '正在一格一格看影片，長影片最多約兩分鐘…',
  orUpload: 'TikTok、Instagram、抖音等的影片，請先存到手機再上傳。',
  upload: '上傳影片檔',
  uploading: '上傳中…',
  startAt: '從第幾秒開始讀',
  startHint: '影片超過 3 分鐘時，從這裡往後讀 3 分鐘。',
  signIn: '登入後讀取',
  left: n => `今天還能免費讀 ${n} 支`,
  errors: {
    invalid_link: '這不是影片連結，請貼上 YouTube 或 X 的影片網址。',
    x_no_video: '這則貼文沒有影片。',
    x_unavailable: '讀不到這則貼文，可能是私人或已刪除。',
    read_failed: '讀不出這支影片，請換一支或稍後再試。',
    unavailable: '暫時無法讀取，請稍後再試。',
    too_large: '檔案太大，上限 300 MB。',
    unsupported_file: '請上傳 MP4、MOV 或 WebM 影片。',
    not_found: '找不到這個檔案，請重新上傳。',
  },
  uploadOnly: p => `${p} 的連結無法直接讀取。請把影片存到手機，再按「上傳影片檔」。`,
  dailyCap: n => `今天的 ${n} 次免費讀取已用完，明天再來。`,
  shots: (n, s) => `${n} 個鏡頭 · ${s} 秒`,
  characters: '角色',
  lines: '台詞',
  music: '音樂',
  musicLine: (mood, bpm, onBeat) => `${mood}${bpm ? `，約 ${bpm} BPM` : ''}${onBeat ? '，跟著節拍剪' : ''}`,
  look: '畫面',
  framing: { 'extreme close-up': '大特寫', 'close-up': '特寫', 'medium close-up': '近景', medium: '中景', 'medium wide': '中遠景', wide: '遠景', 'extreme wide': '大遠景', insert: '插入' },
  transitions: { cut: '切', dissolve: '溶接', 'fade from black': '黑場淡入', 'fade from white': '白場淡入', flash: '閃白', whip: '甩鏡', 'match cut': '匹配剪接', wipe: '劃接' },
  lengthLabel: '要做多長',
  whole: s => `整支 ${s} 秒`,
  seconds: n => `${n} 秒`,
  about: p => `約 ${p}`,
  fromShot: '從哪個鏡頭開始',
  swapHeading: '替換素材',
  cast: { keep: '保留', photo: '我的照片', describe: '描述', famous: '名人' },
  describePlaceholder: '例如：穿西裝的柴犬',
  famousPlaceholder: '例如：馬斯克',
  photoPick: '選照片',
  photoConsent: '這是我本人，或我已取得當事人同意。',
  theme: '主題',
  themePlaceholder: '例如：改成珍珠奶茶店的廣告',
  setting: '背景',
  settingPlaceholder: '例如：夜晚的台北夜市',
  lookLabel: '畫風',
  looks: { keep: '照原片', anime: '動畫', realistic: '寫實', '3d': '3D' },
  language: '配音和字幕的語言',
  product: '你的產品照片（選填）',
  make: '做同款',
  makeSoon: '製作功能下一步上線。現在可以先讀影片、設定要換什麼。',
  another: '換一支影片',
  opening: '正在打開這次的分析…',
  missingRead: '你的作品庫裡沒有這次分析，可能已刪除，或屬於另一個帳號。',
  showAll: n => `看全部 ${n} 個鏡頭`,
  showLess: '收起',
  otherCast: n => `其他 ${n} 個角色（短暫出現）`,
  original: '原片',
  yours: '你的版本',
  paste: '貼上',
  clear: '清除',
  inShots: n => `${n} 個鏡頭`,
  materials: n => `找到 ${n} 個素材，點一下就能換。`,
  kinds: { people: '人物', things: '物件', places: '場景', sound: '聲音', text: '畫面文字', overall: '整體' },
  thingKinds: { product: '商品', prop: '道具', logo: '標誌' },
  thingChoices: { keep: '保留', photo: '我的照片', describe: '描述', remove: '拿掉' },
  thingPlaceholder: '例如：一杯珍珠奶茶',
  myLogo: '我的標誌',
  logoNote: '原片的標誌不會出現在你的版本裡。',
  musicChoices: { none: '不要音樂', mine: '我的音樂' },
  noMusicNote: '原片的音樂不會沿用。沒有你的音樂時，每個鏡頭保留自己的聲音。',
  voiceLabel: '配音',
  voiceChoices: { ai: 'AI 配音', mine: '我的錄音', none: '不要聲音' },
  linesCount: n => `${n} 句`,
  audioPick: '選音檔',
  textsCount: n => `${n} 段文字`,
  textAuto: '自動改寫成你的主題',
  showAllTexts: n => `看全部 ${n} 段`,
  watchHere: '看原片這一刻',
  tryHeading: '試試熱門影片',
  withPrompt: '附提示詞',
  creatorPrompt: '原作者的提示詞',
}

const zhHans: Copy = {
  ...zhHant,
  subtitle: '粘贴你看到的视频，换掉主角、主题或背景，做出同样镜头、同样节奏的你的版本。',
  linkLabel: '视频链接',
  placeholder: '粘贴 YouTube 或 X 的视频链接',
  read: '读取视频',
  reading: '正在逐帧看视频，长视频最多约两分钟…',
  orUpload: 'TikTok、Instagram、抖音等的视频，请先保存到手机再上传。',
  upload: '上传视频文件',
  uploading: '上传中…',
  startAt: '从第几秒开始读',
  startHint: '视频超过 3 分钟时，从这里往后读 3 分钟。',
  signIn: '登录后读取',
  left: n => `今天还能免费读 ${n} 个`,
  errors: {
    invalid_link: '这不是视频链接，请粘贴 YouTube 或 X 的视频网址。',
    x_no_video: '这条帖子没有视频。',
    x_unavailable: '读不到这条帖子，可能是私密或已删除。',
    read_failed: '读不出这个视频，请换一个或稍后再试。',
    unavailable: '暂时无法读取，请稍后再试。',
    too_large: '文件太大，上限 300 MB。',
    unsupported_file: '请上传 MP4、MOV 或 WebM 视频。',
    not_found: '找不到这个文件，请重新上传。',
  },
  uploadOnly: p => `${p} 的链接无法直接读取。请把视频保存到手机，再点「上传视频文件」。`,
  dailyCap: n => `今天的 ${n} 次免费读取已用完，明天再来。`,
  shots: (n, s) => `${n} 个镜头 · ${s} 秒`,
  lines: '台词',
  music: '音乐',
  musicLine: (mood, bpm, onBeat) => `${mood}${bpm ? `，约 ${bpm} BPM` : ''}${onBeat ? '，跟着节拍剪' : ''}`,
  look: '画面',
  framing: { 'extreme close-up': '大特写', 'close-up': '特写', 'medium close-up': '近景', medium: '中景', 'medium wide': '中远景', wide: '远景', 'extreme wide': '大远景', insert: '插入' },
  transitions: { cut: '切', dissolve: '叠化', 'fade from black': '黑场淡入', 'fade from white': '白场淡入', flash: '闪白', whip: '甩镜', 'match cut': '匹配剪辑', wipe: '划接' },
  lengthLabel: '要做多长',
  whole: s => `整个 ${s} 秒`,
  about: p => `约 ${p}`,
  fromShot: '从哪个镜头开始',
  swapHeading: '替换素材',
  describePlaceholder: '例如：穿西装的柴犬',
  famousPlaceholder: '例如：马斯克',
  photoPick: '选照片',
  photoConsent: '这是我本人，或我已取得当事人同意。',
  theme: '主题',
  themePlaceholder: '例如：改成奶茶店的广告',
  settingPlaceholder: '例如：夜晚的上海外滩',
  lookLabel: '画风',
  looks: { keep: '照原片', anime: '动画', realistic: '写实', '3d': '3D' },
  language: '配音和字幕的语言',
  product: '你的产品照片（选填）',
  makeSoon: '制作功能下一步上线。现在可以先读视频、设定要换什么。',
  another: '换一个视频',
  opening: '正在打开这次的分析…',
  missingRead: '你的作品库里没有这次分析，可能已删除，或属于另一个账号。',
  showAll: n => `看全部 ${n} 个镜头`,
  otherCast: n => `其他 ${n} 个角色（短暂出现）`,
  paste: '粘贴',
  inShots: n => `${n} 个镜头`,
  materials: n => `找到 ${n} 个素材，点一下就能换。`,
  kinds: { people: '人物', things: '物件', places: '场景', sound: '声音', text: '画面文字', overall: '整体' },
  thingKinds: { product: '商品', prop: '道具', logo: '标志' },
  thingChoices: { keep: '保留', photo: '我的照片', describe: '描述', remove: '去掉' },
  myLogo: '我的标志',
  logoNote: '原片的标志不会出现在你的版本里。',
  musicChoices: { none: '不要音乐', mine: '我的音乐' },
  noMusicNote: '原片的音乐不会沿用。没有你的音乐时，每个镜头保留自己的声音。',
  voiceChoices: { ai: 'AI 配音', mine: '我的录音', none: '不要声音' },
  audioPick: '选音频文件',
  textAuto: '自动改写成你的主题',
  watchHere: '看原片这一刻',
  tryHeading: '试试热门视频',
  withPrompt: '附提示词',
  creatorPrompt: '原作者的提示词',
}

const ja: Copy = {
  title: '同じ動画を、自分版で',
  subtitle: '見た動画のリンクを貼って、主役・テーマ・背景を入れ替え。同じカット、同じテンポで、あなたのバージョンを作ります。',
  linkLabel: '動画リンク',
  placeholder: 'YouTube か X の動画リンクを貼る',
  read: '動画を読み込む',
  reading: '1コマずつ見ています。長い動画は2分ほどかかります…',
  orUpload: 'TikTok、Instagram などの動画は、端末に保存してからアップロードしてください。',
  upload: '動画ファイルをアップロード',
  uploading: 'アップロード中…',
  startAt: '何秒目から読むか',
  startHint: '3分を超える動画は、ここから3分間を読みます。',
  signIn: 'ログインして読み込む',
  left: n => `今日はあと ${n} 本、無料で読めます`,
  errors: {
    invalid_link: '動画のリンクではありません。YouTube か X の動画URLを貼ってください。',
    x_no_video: 'この投稿には動画がありません。',
    x_unavailable: 'この投稿を読めませんでした。非公開か削除された可能性があります。',
    read_failed: 'この動画を読めませんでした。別の動画で試すか、時間をおいてください。',
    unavailable: '今は読み込めません。時間をおいて試してください。',
    too_large: 'ファイルが大きすぎます（上限 300 MB）。',
    unsupported_file: 'MP4、MOV、WebM の動画をアップロードしてください。',
    not_found: 'ファイルが見つかりません。もう一度アップロードしてください。',
  },
  uploadOnly: p => `${p} のリンクは直接読めません。動画を端末に保存して、「動画ファイルをアップロード」を押してください。`,
  dailyCap: n => `今日の無料読み込み ${n} 本を使い切りました。また明日どうぞ。`,
  shots: (n, s) => `${n} カット・${s} 秒`,
  characters: '登場人物',
  lines: 'セリフ',
  music: '音楽',
  musicLine: (mood, bpm, onBeat) => `${mood}${bpm ? `、約 ${bpm} BPM` : ''}${onBeat ? '、ビートに合わせた編集' : ''}`,
  look: '画',
  framing: { 'extreme close-up': '超アップ', 'close-up': 'アップ', 'medium close-up': 'バストアップ', medium: 'ミディアム', 'medium wide': 'ミディアムロング', wide: 'ロング', 'extreme wide': '超ロング', insert: 'インサート' },
  transitions: { cut: 'カット', dissolve: 'ディゾルブ', 'fade from black': '黒からフェード', 'fade from white': '白からフェード', flash: 'フラッシュ', whip: 'ホイップ', 'match cut': 'マッチカット', wipe: 'ワイプ' },
  lengthLabel: '長さ',
  whole: s => `全部 ${s} 秒`,
  seconds: n => `${n} 秒`,
  about: p => `約 ${p}`,
  fromShot: 'どのカットから',
  swapHeading: '素材を入れ替える',
  cast: { keep: 'そのまま', photo: '自分の写真', describe: '説明する', famous: '有名人' },
  describePlaceholder: '例：スーツを着た柴犬',
  famousPlaceholder: '例：イーロン・マスク',
  photoPick: '写真を選ぶ',
  photoConsent: '本人、または本人の同意を得た写真です。',
  theme: 'テーマ',
  themePlaceholder: '例：タピオカ店の広告にする',
  setting: '背景',
  settingPlaceholder: '例：夜の渋谷',
  lookLabel: '画風',
  looks: { keep: '元のまま', anime: 'アニメ', realistic: 'リアル', '3d': '3D' },
  language: '声と字幕の言語',
  product: '商品の写真（任意）',
  make: '自分版を作る',
  makeSoon: '制作はこの次に公開します。今は動画を読み込んで、入れ替えるものを選べます。',
  another: '別の動画にする',
  opening: 'この分析を開いています…',
  missingRead: 'この分析はライブラリにありません。削除されたか、別のアカウントのものかもしれません。',
  showAll: n => `全 ${n} カットを見る`,
  showLess: '閉じる',
  otherCast: n => `ほか ${n} 人（少しだけ登場）`,
  original: '元の動画',
  yours: '自分版',
  paste: '貼り付け',
  clear: 'クリア',
  inShots: n => `${n} カット`,
  materials: n => `素材が ${n} 点見つかりました。タップして入れ替え。`,
  kinds: { people: '人物', things: 'モノ', places: '場所', sound: '音', text: '画面の文字', overall: '全体' },
  thingKinds: { product: '商品', prop: '小道具', logo: 'ロゴ' },
  thingChoices: { keep: 'そのまま', photo: '自分の写真', describe: '説明する', remove: '消す' },
  thingPlaceholder: '例：タピオカミルクティー',
  myLogo: '自分のロゴ',
  logoNote: '元の動画のロゴは、自分版には使いません。',
  musicChoices: { none: '音楽なし', mine: '自分の曲' },
  noMusicNote: '元の動画の音楽は使いません。自分の曲がなければ、各カットの音だけになります。',
  voiceLabel: '声',
  voiceChoices: { ai: 'AI の声', mine: '自分の録音', none: '声なし' },
  linesCount: n => `セリフ ${n}`,
  audioPick: '音声ファイルを選ぶ',
  textsCount: n => `${n} 件`,
  textAuto: 'テーマに合わせて自動で書き換え',
  showAllTexts: n => `全 ${n} 件を見る`,
  watchHere: '元の動画のこの場面を見る',
  tryHeading: '人気の動画で試す',
  withPrompt: 'プロンプト付き',
  creatorPrompt: '作者のプロンプト',
}

const ko: Copy = {
  title: '같은 영상을 내 버전으로',
  subtitle: '본 영상의 링크를 붙여넣고 주인공, 주제, 배경을 바꾸세요. 같은 컷, 같은 템포로 내 버전을 만들어 드립니다.',
  linkLabel: '영상 링크',
  placeholder: 'YouTube 또는 X 영상 링크 붙여넣기',
  read: '영상 읽기',
  reading: '한 프레임씩 보는 중입니다. 긴 영상은 2분 정도 걸려요…',
  orUpload: 'TikTok, Instagram 등의 영상은 휴대폰에 저장한 뒤 업로드하세요.',
  upload: '영상 파일 업로드',
  uploading: '업로드 중…',
  startAt: '몇 초부터 읽을지',
  startHint: '3분이 넘는 영상은 여기서부터 3분을 읽습니다.',
  signIn: '로그인하고 읽기',
  left: n => `오늘 무료로 ${n}개 더 읽을 수 있어요`,
  errors: {
    invalid_link: '영상 링크가 아닙니다. YouTube 또는 X 영상 주소를 붙여넣으세요.',
    x_no_video: '이 게시물에는 영상이 없습니다.',
    x_unavailable: '이 게시물을 읽을 수 없습니다. 비공개이거나 삭제되었을 수 있어요.',
    read_failed: '이 영상을 읽지 못했습니다. 다른 영상으로 해 보거나 잠시 후 다시 시도하세요.',
    unavailable: '지금은 읽을 수 없습니다. 잠시 후 다시 시도하세요.',
    too_large: '파일이 너무 큽니다 (최대 300 MB).',
    unsupported_file: 'MP4, MOV, WebM 영상을 업로드하세요.',
    not_found: '파일을 찾을 수 없습니다. 다시 업로드하세요.',
  },
  uploadOnly: p => `${p} 링크는 바로 읽을 수 없습니다. 영상을 휴대폰에 저장한 뒤 "영상 파일 업로드"를 누르세요.`,
  dailyCap: n => `오늘 무료 읽기 ${n}회를 모두 썼어요. 내일 다시 오세요.`,
  shots: (n, s) => `컷 ${n}개 · ${s}초`,
  characters: '등장인물',
  lines: '대사',
  music: '음악',
  musicLine: (mood, bpm, onBeat) => `${mood}${bpm ? `, 약 ${bpm} BPM` : ''}${onBeat ? ', 비트에 맞춘 편집' : ''}`,
  look: '화면',
  framing: { 'extreme close-up': '익스트림 클로즈업', 'close-up': '클로즈업', 'medium close-up': '미디엄 클로즈업', medium: '미디엄', 'medium wide': '미디엄 와이드', wide: '와이드', 'extreme wide': '익스트림 와이드', insert: '인서트' },
  transitions: { cut: '컷', dissolve: '디졸브', 'fade from black': '블랙 페이드인', 'fade from white': '화이트 페이드인', flash: '플래시', whip: '휩', 'match cut': '매치 컷', wipe: '와이프' },
  lengthLabel: '길이',
  whole: s => `전체 ${s}초`,
  seconds: n => `${n}초`,
  about: p => `약 ${p}`,
  fromShot: '시작할 컷',
  swapHeading: '소재 바꾸기',
  cast: { keep: '그대로', photo: '내 사진', describe: '설명하기', famous: '유명인' },
  describePlaceholder: '예: 정장을 입은 시바견',
  famousPlaceholder: '예: 일론 머스크',
  photoPick: '사진 고르기',
  photoConsent: '본인이거나, 당사자의 동의를 받은 사진입니다.',
  theme: '주제',
  themePlaceholder: '예: 버블티 가게 광고로 바꾸기',
  setting: '배경',
  settingPlaceholder: '예: 밤의 서울 명동',
  lookLabel: '화풍',
  looks: { keep: '원본대로', anime: '애니메이션', realistic: '실사', '3d': '3D' },
  language: '목소리와 자막 언어',
  product: '내 제품 사진 (선택)',
  make: '내 버전 만들기',
  makeSoon: '제작은 다음 단계에 열립니다. 지금은 영상을 읽고 바꿀 것을 고를 수 있어요.',
  another: '다른 영상으로',
  opening: '이 분석을 여는 중…',
  missingRead: '라이브러리에 이 분석이 없습니다. 삭제되었거나 다른 계정의 것일 수 있습니다.',
  showAll: n => `컷 ${n}개 모두 보기`,
  showLess: '접기',
  otherCast: n => `그 밖의 ${n}명 (잠깐 등장)`,
  original: '원본',
  yours: '내 버전',
  paste: '붙여넣기',
  clear: '지우기',
  inShots: n => `컷 ${n}개`,
  materials: n => `소재 ${n}개를 찾았어요. 눌러서 바꾸세요.`,
  kinds: { people: '인물', things: '사물', places: '장소', sound: '소리', text: '화면 글자', overall: '전체' },
  thingKinds: { product: '제품', prop: '소품', logo: '로고' },
  thingChoices: { keep: '그대로', photo: '내 사진', describe: '설명하기', remove: '없애기' },
  thingPlaceholder: '예: 버블티 한 잔',
  myLogo: '내 로고',
  logoNote: '원본의 로고는 내 버전에 나오지 않아요.',
  musicChoices: { none: '음악 없음', mine: '내 음악' },
  noMusicNote: '원본 음악은 쓰지 않아요. 내 음악이 없으면 각 컷의 소리만 남아요.',
  voiceLabel: '목소리',
  voiceChoices: { ai: 'AI 목소리', mine: '내 녹음', none: '목소리 없음' },
  linesCount: n => `대사 ${n}개`,
  audioPick: '오디오 파일 고르기',
  textsCount: n => `${n}개`,
  textAuto: '주제에 맞게 자동으로 바꿔요',
  showAllTexts: n => `${n}개 모두 보기`,
  watchHere: '원본의 이 장면 보기',
  tryHeading: '인기 영상으로 해 보기',
  withPrompt: '프롬프트 공개',
  creatorPrompt: '원작자의 프롬프트',
}

const COPY: Record<Lang, Copy> = { en, 'zh-Hant': zhHant, 'zh-Hans': zhHans, ja, ko }
export const remakeCopy = (lang: Lang): Copy => COPY[lang] ?? en

/** The voice and caption languages offered, each in its own script. */
export const REMAKE_LANGUAGES: { id: Lang; name: string }[] = [
  { id: 'zh-Hant', name: '繁體中文' }, { id: 'zh-Hans', name: '简体中文' }, { id: 'en', name: 'English' },
  { id: 'ja', name: '日本語' }, { id: 'ko', name: '한국어' },
]
