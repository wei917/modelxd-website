// Editorial theme summaries of the traditional public-domain 稱骨 verses,
// not personal predictions, verse quotations, or a better/worse ranking.
// Internal reference checked 2026-09-27:
// https://www.deeporacle.ai/bazi/tools/chenggu (五十一首称骨歌, original verses).
// We omit fatalistic lifespan/childbearing claims and do not prescribe moving,
// renaming, religious conversion, or other actions from the verse imagery.
// Deliberately independent from the arithmetic table; shared by UI and tutor.
export const CHENGGU_MIN = 21
export const CHENGGU_MAX = 71
const THEMES: Record<number, Record<string, string>> = {
  "21": {
    "en": "hardship and recurring setbacks",
    "zh-Hant": "困頓與反覆波折",
    "zh-Hans": "困顿与反复波折",
    "ja": "困難と重なる挫折",
    "ko": "고난과 거듭되는 시련"
  },
  "22": {
    "en": "a difficult livelihood and constant toil",
    "zh-Hant": "生活艱辛與奔波求生",
    "zh-Hans": "生活艰辛与奔波求生",
    "ja": "厳しい暮らしと日々の苦労",
    "ko": "어려운 살림과 끊임없는 수고"
  },
  "23": {
    "en": "limited family support and independence away from home",
    "zh-Hant": "親友助力有限、離鄉自立",
    "zh-Hans": "亲友助力有限、离乡自立",
    "ja": "身内の支援の少なさと故郷を離れての自立",
    "ko": "적은 가족 지원과 타향에서의 자립"
  },
  "24": {
    "en": "family hardship and seeking a living elsewhere",
    "zh-Hant": "家境困頓、在外謀生",
    "zh-Hans": "家境困顿、在外谋生",
    "ja": "家の困窮と他郷での生計",
    "ko": "어려운 집안 형편과 타향살이"
  },
  "25": {
    "en": "little inheritance and a livelihood built through work",
    "zh-Hant": "祖業有限、靠勤勞維持生活",
    "zh-Hans": "祖业有限、靠勤劳维持生活",
    "ja": "少ない家産と働いて支える暮らし",
    "ko": "적은 유산과 근면으로 꾸리는 생활"
  },
  "26": {
    "en": "early self-reliance and later stability",
    "zh-Hant": "早年獨自打拼、晚景漸穩",
    "zh-Hans": "早年独自打拼、晚景渐稳",
    "ja": "若い頃の独力での努力と晩年の安定",
    "ko": "젊은 시절의 홀로서기와 노년의 안정"
  },
  "27": {
    "en": "little inherited support and solitary effort",
    "zh-Hant": "少有祖蔭、獨力奔忙",
    "zh-Hans": "少有祖荫、独力奔忙",
    "ja": "家の後ろ盾が少なく独力で励む姿",
    "ko": "적은 집안 지원과 홀로 애쓰는 삶"
  },
  "28": {
    "en": "little family wealth and repeated moves",
    "zh-Hant": "家業難靠、生活多有遷移",
    "zh-Hans": "家业难靠、生活多有迁移",
    "ja": "頼れる家産の少なさと度重なる移住",
    "ko": "기댈 가산이 적고 잦은 이주"
  },
  "29": {
    "en": "early obstacles and finding a footing later",
    "zh-Hant": "早年不順、較晚立業",
    "zh-Hans": "早年不顺、较晚立业",
    "ja": "若い頃の苦境と遅めの自立",
    "ko": "초년의 난관과 뒤늦은 기반 마련"
  },
  "30": {
    "en": "thrift and work easing later worries",
    "zh-Hant": "勤儉度日、晚年漸少憂慮",
    "zh-Hans": "勤俭度日、晚年渐少忧虑",
    "ja": "勤勉と節約による晩年の安心",
    "ko": "근면과 절약으로 줄어드는 노년의 걱정"
  },
  "31": {
    "en": "little inheritance and greater stability in midlife",
    "zh-Hant": "祖業助力少、中年生活漸穩",
    "zh-Hans": "祖业助力少、中年生活渐稳",
    "ja": "少ない家産と中年からの安定",
    "ko": "적은 유산과 중년 이후의 안정"
  },
  "32": {
    "en": "early difficulties and gains in midlife",
    "zh-Hant": "早年難行、中年漸有收穫",
    "zh-Hans": "早年难行、中年渐有收获",
    "ja": "若い頃の困難と中年の実り",
    "ko": "초년의 어려움과 중년의 결실"
  },
  "33": {
    "en": "long effort before later rewards",
    "zh-Hant": "前期付出多、後來才見成果",
    "zh-Hans": "前期付出多、后来才见成果",
    "ja": "長い努力の後に訪れる成果",
    "ko": "오랜 노력 끝에 오는 결실"
  },
  "34": {
    "en": "leaving home for a religious life",
    "zh-Hant": "離鄉修行、寄身宗教生活",
    "zh-Hans": "离乡修行、寄身宗教生活",
    "ja": "故郷を離れた修行と宗教生活",
    "ko": "고향을 떠난 수행과 종교 생활"
  },
  "35": {
    "en": "modest beginnings and preserving stability until change",
    "zh-Hant": "根基較薄、守成等待轉機",
    "zh-Hans": "根基较薄、守成等待转机",
    "ja": "薄い基盤を守り転機を待つ姿",
    "ko": "약한 기반을 지키며 전환점을 기다림"
  },
  "36": {
    "en": "building an independent household with relative ease",
    "zh-Hant": "獨立成家、生活較為順遂",
    "zh-Hans": "独立成家、生活较为顺遂",
    "ja": "自ら家庭を築く姿と比較的順調な暮らし",
    "ko": "독립적인 가정과 비교적 순탄한 생활"
  },
  "37": {
    "en": "limited support and unsettled finances",
    "zh-Hant": "親友助力少、財物來去不定",
    "zh-Hans": "亲友助力少、财物来去不定",
    "ja": "少ない身内の支援と不安定な財の出入り",
    "ko": "적은 주변 지원과 불안정한 재물의 흐름"
  },
  "38": {
    "en": "recognition through learning and later advancement",
    "zh-Hant": "求學成名、日後地位提升",
    "zh-Hans": "求学成名、日后地位提升",
    "ja": "学問による評価と後の昇進",
    "ko": "학문을 통한 인정과 이후의 입신"
  },
  "39": {
    "en": "hard work with disappointing results",
    "zh-Hant": "辛勤經營、成果難如所願",
    "zh-Hans": "辛勤经营、成果难如所愿",
    "ja": "懸命な努力と思うように得られない成果",
    "ko": "애써도 기대에 못 미치는 성과"
  },
  "40": {
    "en": "self-direction and calm after hardship",
    "zh-Hant": "自主打拼、歷經風霜後漸安穩",
    "zh-Hans": "自主打拼、历经风霜后渐安稳",
    "ja": "自ら道を選び苦労の後に得る安定",
    "ko": "스스로 개척하고 고생 끝에 얻는 안정"
  },
  "41": {
    "en": "ability opening a path to a better midlife",
    "zh-Hant": "以能力開路、中年境況轉佳",
    "zh-Hans": "以能力开路、中年境况转佳",
    "ja": "能力で道を開き中年に好転する姿",
    "ko": "능력으로 길을 열고 중년에 나아지는 형편"
  },
  "42": {
    "en": "a lighter heart and a possible midlife turning point",
    "zh-Hant": "放寬心懷、中年可能迎來轉機",
    "zh-Hans": "放宽心怀、中年可能迎来转机",
    "ja": "心にゆとりを持つ姿と中年の転機の可能性",
    "ko": "마음의 여유와 중년의 전환 가능성"
  },
  "43": {
    "en": "resourcefulness and support from others",
    "zh-Hant": "聰敏處事、得人相助",
    "zh-Hans": "聪敏处事、得人相助",
    "ja": "聡明な振る舞いと人の助け",
    "ko": "슬기로운 처신과 주변의 도움"
  },
  "44": {
    "en": "early frustration and a calmer later life",
    "zh-Hant": "少壯難如意、晚景較安然",
    "zh-Hans": "少壮难如意、晚景较安然",
    "ja": "若い頃の不遇と穏やかな晩年",
    "ko": "젊은 날의 어려움과 평온한 노년"
  },
  "45": {
    "en": "considerable toil and limited family help",
    "zh-Hant": "奔波較多、親族扶持有限",
    "zh-Hans": "奔波较多、亲族扶持有限",
    "ja": "多い苦労と限られた親族の支援",
    "ko": "많은 수고와 제한적인 친족 지원"
  },
  "46": {
    "en": "opportunity away from home and steady provision",
    "zh-Hant": "外出發展、生活供給較穩",
    "zh-Hans": "外出发展、生活供给较稳",
    "ja": "他郷での発展と安定した暮らし",
    "ko": "타향에서의 발전과 안정된 생활"
  },
  "47": {
    "en": "later prosperity and a flourishing household",
    "zh-Hant": "晚年興旺、家庭與財祿豐足",
    "zh-Hans": "晚年兴旺、家庭与财禄丰足",
    "ja": "晩年の繁栄と豊かな家庭",
    "ko": "노년의 번영과 풍족한 가정"
  },
  "48": {
    "en": "little early support and later self-made success",
    "zh-Hant": "早年少助、晚年靠自己立業",
    "zh-Hans": "早年少助、晚年靠自己立业",
    "ja": "若い頃の支援の少なさと晩年の自力での成功",
    "ko": "초년의 적은 지원과 늦은 자수성가"
  },
  "49": {
    "en": "an independently built household and reputation",
    "zh-Hant": "自立成家、家業與聲望漸成",
    "zh-Hans": "自立成家、家业与声望渐成",
    "ja": "自力で築く家業と評判",
    "ko": "스스로 일군 가업과 명성"
  },
  "50": {
    "en": "work for recognition and wealth with changing fortunes",
    "zh-Hant": "為名利操勞、一生財祿有起伏",
    "zh-Hans": "为名利操劳、一生财禄有起伏",
    "ja": "名利への努力と浮き沈みする財運",
    "ko": "명리를 위한 노력과 재물의 굴곡"
  },
  "51": {
    "en": "household prosperity and family harmony",
    "zh-Hant": "家業有成、親族和順",
    "zh-Hans": "家业有成、亲族和顺",
    "ja": "家業の繁栄と親族の和",
    "ko": "가업의 번영과 친족의 화목"
  },
  "52": {
    "en": "a peaceful life and a thriving household",
    "zh-Hant": "生活安寧、家業豐盛",
    "zh-Hans": "生活安宁、家业丰盛",
    "ja": "穏やかな生活と豊かな家業",
    "ko": "평온한 생활과 풍성한 가업"
  },
  "53": {
    "en": "building a household and accumulating wealth",
    "zh-Hant": "興家立業、積累財富",
    "zh-Hans": "兴家立业、积累财富",
    "ja": "家業を興し財を築く姿",
    "ko": "가업을 일으키고 재물을 쌓음"
  },
  "54": {
    "en": "achievement through learning and a settled life",
    "zh-Hant": "以學識求成、生活安定",
    "zh-Hans": "以学识求成、生活安定",
    "ja": "学識による成就と安定した暮らし",
    "ko": "학식을 통한 성취와 안정된 생활"
  },
  "55": {
    "en": "early effort followed by growing achievement",
    "zh-Hant": "少年費心經營、後來漸有成就",
    "zh-Hans": "少年费心经营、后来渐有成就",
    "ja": "若い頃の苦心と後の成就",
    "ko": "젊은 날의 노력과 이후의 성취"
  },
  "56": {
    "en": "mixed experiences followed by steadier prosperity",
    "zh-Hant": "歷經甘苦、財祿漸趨穩厚",
    "zh-Hans": "历经甘苦、财禄渐趋稳厚",
    "ja": "苦楽を経て安定する豊かさ",
    "ko": "희로애락을 겪은 뒤의 안정된 풍요"
  },
  "57": {
    "en": "abundance, recognition and ease",
    "zh-Hant": "福祿豐足、聲名與安樂",
    "zh-Hans": "福禄丰足、声名与安乐",
    "ja": "豊かさと名声、安らぎ",
    "ko": "풍요와 명성, 안락함"
  },
  "58": {
    "en": "images of examination success, status and wealth",
    "zh-Hant": "科舉登第、名利兼得的意象",
    "zh-Hans": "科举登第、名利兼得的意象",
    "ja": "科挙合格と名利を得るイメージ",
    "ko": "과거 급제와 명리를 얻는 상징"
  },
  "59": {
    "en": "images of learning, character and scholarly recognition",
    "zh-Hant": "才學與禮義、登科顯名的意象",
    "zh-Hans": "才学与礼义、登科显名的意象",
    "ja": "才学と礼義、登科による名声のイメージ",
    "ko": "재능과 예의, 급제를 통한 명성의 상징"
  },
  "60": {
    "en": "images of scholarly distinction and household prosperity",
    "zh-Hant": "金榜題名、家業豐盈的意象",
    "zh-Hans": "金榜题名、家业丰盈的意象",
    "ja": "科挙での栄誉と家業の繁栄のイメージ",
    "ko": "급제의 영예와 풍성한 가업의 상징"
  },
  "61": {
    "en": "images of talent and success in office or commerce",
    "zh-Hant": "才學出眾、仕途或經營有成的意象",
    "zh-Hans": "才学出众、仕途或经营有成的意象",
    "ja": "才学と官職または商いでの成功のイメージ",
    "ko": "학문적 재능과 관직 또는 사업 성공의 상징"
  },
  "62": {
    "en": "images of advancement through study and family honour",
    "zh-Hant": "讀書顯達、光耀家門的意象",
    "zh-Hans": "读书显达、光耀家门的意象",
    "ja": "学問による出世と家門の栄誉のイメージ",
    "ko": "학문을 통한 입신과 가문의 영예의 상징"
  },
  "63": {
    "en": "images of official recognition and lasting prosperity",
    "zh-Hant": "仕途成名、福祿綿長的意象",
    "zh-Hans": "仕途成名、福禄绵长的意象",
    "ja": "官職での名声と長く続く豊かさのイメージ",
    "ko": "관직에서의 명성과 오래가는 풍요의 상징"
  },
  "64": {
    "en": "images of high office and enduring renown",
    "zh-Hant": "位高名顯、聲望流傳的意象",
    "zh-Hans": "位高名显、声望流传的意象",
    "ja": "高い地位と後世に残る名声のイメージ",
    "ko": "높은 지위와 오래 남는 명성의 상징"
  },
  "65": {
    "en": "images of public service and great distinction",
    "zh-Hant": "安邦立功、聲威顯赫的意象",
    "zh-Hans": "安邦立功、声威显赫的意象",
    "ja": "国に尽くす功績と大きな名声のイメージ",
    "ko": "나라에 세운 공과 큰 명성의 상징"
  },
  "66": {
    "en": "images of great wealth and courtly distinction",
    "zh-Hant": "家財豐厚、朝堂顯達的意象",
    "zh-Hans": "家财丰厚、朝堂显达的意象",
    "ja": "豊かな家財と朝廷での栄達のイメージ",
    "ko": "풍부한 가산과 조정에서의 영달의 상징"
  },
  "67": {
    "en": "a thriving household and plentiful provision",
    "zh-Hant": "家業興隆、衣食豐足",
    "zh-Hans": "家业兴隆、衣食丰足",
    "ja": "栄える家業と豊かな衣食",
    "ko": "번성하는 가업과 넉넉한 의식주"
  },
  "68": {
    "en": "a strong inherited foundation and abundance",
    "zh-Hant": "祖業根基厚、生活富足",
    "zh-Hans": "祖业根基厚、生活富足",
    "ja": "厚い家産の基盤と豊かな生活",
    "ko": "튼튼한 가산의 기반과 풍족한 생활"
  },
  "69": {
    "en": "images of abundance and enjoying prosperity",
    "zh-Hant": "衣祿豐厚、安享榮華的意象",
    "zh-Hans": "衣禄丰厚、安享荣华的意象",
    "ja": "豊かな衣食と栄華を享受するイメージ",
    "ko": "풍족한 의식주와 영화를 누리는 상징"
  },
  "70": {
    "en": "ample provision and freedom from material worries",
    "zh-Hant": "福祿充裕、少有衣食之憂",
    "zh-Hans": "福禄充裕、少有衣食之忧",
    "ja": "豊かな暮らしと衣食の心配の少なさ",
    "ko": "풍족한 생활과 적은 생계 걱정"
  },
  "71": {
    "en": "images of high nobility, wealth and distinction",
    "zh-Hant": "公侯卿相、富貴顯達的意象",
    "zh-Hans": "公侯卿相、富贵显达的意象",
    "ja": "公侯や宰相、富貴栄達のイメージ",
    "ko": "고위 귀족과 재상, 부귀영달의 상징"
  }
}
export function chengguTheme(qian: number, lang = 'zh-Hant'): string | null {
  if (!Number.isInteger(qian) || qian < CHENGGU_MIN || qian > CHENGGU_MAX) return null
  return THEMES[qian]?.[lang] ?? THEMES[qian]?.en ?? null
}
