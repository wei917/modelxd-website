import type { Lang } from '@/lib/i18n'

const en = {
  subtitle: 'Create with the models you choose. Keep what works for you.',
  creationsTitle: 'Your ideas, in progress.',
  prompt: 'Your prompt',
  compare: 'Compare',
  continue: 'Continue',
  addModel: 'Add a model',
  compareModel: 'Add a model to compare',
  type: 'Type',
  all: 'All',
  loading: 'Loading your library…',
  empty: 'Your projects will appear here.',
  emptyFilter: 'No projects of this type yet.',
  error: 'Your library could not be loaded. Please try again.',
  retry: 'Try again',
  signIn: 'Sign in to open your library',
  previous: 'Previous',
  next: 'Next',
  open: 'Open project',
  untitled: 'Untitled project',
  models: 'models',
  reference: 'Reference',
  newCreation: 'New project',
}

type Copy = typeof en
const copy: Record<Lang, Copy> = {
  en,
  'zh-Hant': {
    subtitle: '用你選擇的模型創作，留下適合你的成果。',
    creationsTitle: '接著完成你的靈感。',
    prompt: '你的提示詞', compare: '比較', continue: '繼續',
    addModel: '新增模型', compareModel: '新增模型一起比較',
    type: '類型', all: '全部', loading: '正在載入作品庫…', empty: '你的專案會出現在這裡。', emptyFilter: '還沒有這種類型的專案。',
    error: '無法載入作品庫，請再試一次。', retry: '重試', signIn: '登入開啟作品庫', previous: '上一頁', next: '下一頁',
    open: '開啟專案', untitled: '未命名專案', models: '個模型', reference: '參考素材',
    newCreation: '新專案',
  },
  'zh-Hans': {
    subtitle: '用你选择的模型创作，留下适合你的成果。',
    creationsTitle: '接着完成你的灵感。',
    prompt: '你的提示词', compare: '比较', continue: '继续',
    addModel: '添加模型', compareModel: '添加模型一起比较',
    type: '类型', all: '全部', loading: '正在加载作品库…', empty: '你的项目会出现在这里。', emptyFilter: '还没有这种类型的项目。',
    error: '无法加载作品库，请重试。', retry: '重试', signIn: '登录打开作品库', previous: '上一页', next: '下一页',
    open: '打开项目', untitled: '未命名项目', models: '个模型', reference: '参考素材',
    newCreation: '新项目',
  },
  ja: {
    subtitle: '選んだモデルでつくり、自分に合う結果を残す。',
    creationsTitle: 'アイデアの続きを。',
    prompt: 'プロンプト', compare: '比較', continue: '続ける',
    addModel: 'モデルを追加', compareModel: '比較するモデルを追加',
    type: '種類', all: 'すべて', loading: 'ライブラリを読み込み中…', empty: 'プロジェクトがここに表示されます。', emptyFilter: 'この種類のプロジェクトはまだありません。',
    error: 'ライブラリを読み込めませんでした。もう一度お試しください。', retry: '再試行', signIn: 'ログインしてライブラリを開く', previous: '前へ', next: '次へ',
    open: 'プロジェクトを開く', untitled: '無題のプロジェクト', models: 'モデル', reference: '参考素材',
    newCreation: '新しいプロジェクト',
  },
  ko: {
    subtitle: '원하는 모델로 만들고, 마음에 드는 결과를 남기세요.',
    creationsTitle: '아이디어를 이어가세요.',
    prompt: '프롬프트', compare: '비교', continue: '계속',
    addModel: '모델 추가', compareModel: '비교할 모델 추가',
    type: '유형', all: '전체', loading: '라이브러리를 불러오는 중…', empty: '프로젝트가 여기에 표시됩니다.', emptyFilter: '이 유형의 프로젝트가 아직 없습니다.',
    error: '라이브러리를 불러오지 못했습니다. 다시 시도하세요.', retry: '다시 시도', signIn: '로그인하여 라이브러리 열기', previous: '이전', next: '다음',
    open: '프로젝트 열기', untitled: '제목 없는 프로젝트', models: '모델', reference: '참고 자료',
    newCreation: '새 프로젝트',
  },
}

export const xcreateStudioCopy = (lang: Lang): Copy => copy[lang]
