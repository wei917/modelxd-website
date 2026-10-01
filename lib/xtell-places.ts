// lib/xtell-places.ts — birth places for the temples that need one.
//
// A Lagna moves a degree every four minutes of sidereal time, so a Jyotish
// chart needs where as well as when — the Chinese temples never did. A
// curated list of cities (not a geocoder) keeps this honest and offline:
// coordinates are the city centre, the zone is IANA so DST resolves itself.
// Client-safe: no I/O.

export type Place = { key: string; label: string; lat: number; lon: number; tz: string }

export const PLACES: Place[] = [
  { key: 'taipei',     label: '台北',     lat: 25.0330, lon: 121.5654, tz: 'Asia/Taipei' },
  { key: 'newtaipei', label: '新北',     lat: 25.0120, lon: 121.4650, tz: 'Asia/Taipei' },
  { key: 'taoyuan',    label: '桃園',     lat: 24.9937, lon: 121.3010, tz: 'Asia/Taipei' },
  { key: 'hsinchu',    label: '新竹',     lat: 24.8138, lon: 120.9675, tz: 'Asia/Taipei' },
  { key: 'taichung',   label: '台中',     lat: 24.1477, lon: 120.6736, tz: 'Asia/Taipei' },
  { key: 'changhua',   label: '彰化',     lat: 24.0518, lon: 120.5161, tz: 'Asia/Taipei' },
  { key: 'chiayi',     label: '嘉義',     lat: 23.4801, lon: 120.4491, tz: 'Asia/Taipei' },
  { key: 'tainan',     label: '台南',     lat: 22.9999, lon: 120.2270, tz: 'Asia/Taipei' },
  { key: 'kaohsiung',  label: '高雄',     lat: 22.6273, lon: 120.3014, tz: 'Asia/Taipei' },
  { key: 'pingtung',   label: '屏東',     lat: 22.6760, lon: 120.4940, tz: 'Asia/Taipei' },
  { key: 'yilan',      label: '宜蘭',     lat: 24.7570, lon: 121.7530, tz: 'Asia/Taipei' },
  { key: 'hualien',    label: '花蓮',     lat: 23.9910, lon: 121.6010, tz: 'Asia/Taipei' },
  { key: 'taitung',    label: '台東',     lat: 22.7583, lon: 121.1444, tz: 'Asia/Taipei' },
  { key: 'penghu',     label: '澎湖',     lat: 23.5700, lon: 119.5800, tz: 'Asia/Taipei' },
  { key: 'kinmen',     label: '金門',     lat: 24.4370, lon: 118.3170, tz: 'Asia/Taipei' },
  { key: 'tokyo',      label: '東京',     lat: 35.6895, lon: 139.6917, tz: 'Asia/Tokyo' },
  { key: 'osaka',      label: '大阪',     lat: 34.6937, lon: 135.5023, tz: 'Asia/Tokyo' },
  { key: 'nagoya',     label: '名古屋',   lat: 35.1815, lon: 136.9066, tz: 'Asia/Tokyo' },
  { key: 'fukuoka',    label: '福岡',     lat: 33.5904, lon: 130.4017, tz: 'Asia/Tokyo' },
  { key: 'sapporo',    label: '札幌',     lat: 43.0618, lon: 141.3545, tz: 'Asia/Tokyo' },
  { key: 'naha',       label: '沖繩那霸', lat: 26.2124, lon: 127.6809, tz: 'Asia/Tokyo' },
  // More of Japan (a test round, Sep 29: six Japanese cities were too few
  // for a Japanese visitor to find one near their birthplace).
  { key: 'yokohama',   label: '橫濱',     lat: 35.4437, lon: 139.6380, tz: 'Asia/Tokyo' },
  { key: 'saitama',    label: '埼玉',     lat: 35.8617, lon: 139.6455, tz: 'Asia/Tokyo' },
  { key: 'chiba',      label: '千葉',     lat: 35.6073, lon: 140.1063, tz: 'Asia/Tokyo' },
  { key: 'kyoto',      label: '京都',     lat: 35.0116, lon: 135.7681, tz: 'Asia/Tokyo' },
  { key: 'kobe',       label: '神戶',     lat: 34.6901, lon: 135.1955, tz: 'Asia/Tokyo' },
  { key: 'sendai',     label: '仙台',     lat: 38.2682, lon: 140.8694, tz: 'Asia/Tokyo' },
  { key: 'niigata',    label: '新潟',     lat: 37.9162, lon: 139.0364, tz: 'Asia/Tokyo' },
  { key: 'kanazawa',   label: '金澤',     lat: 36.5613, lon: 136.6562, tz: 'Asia/Tokyo' },
  { key: 'shizuoka',   label: '靜岡',     lat: 34.9756, lon: 138.3828, tz: 'Asia/Tokyo' },
  { key: 'hiroshima',  label: '廣島',     lat: 34.3853, lon: 132.4553, tz: 'Asia/Tokyo' },
  { key: 'okayama',    label: '岡山',     lat: 34.6551, lon: 133.9195, tz: 'Asia/Tokyo' },
  { key: 'matsuyama',  label: '松山',     lat: 33.8392, lon: 132.7657, tz: 'Asia/Tokyo' },
  { key: 'kumamoto',   label: '熊本',     lat: 32.8031, lon: 130.7079, tz: 'Asia/Tokyo' },
  { key: 'kagoshima',  label: '鹿兒島',   lat: 31.5966, lon: 130.5571, tz: 'Asia/Tokyo' },
  { key: 'seoul',      label: '首爾',     lat: 37.5665, lon: 126.9780, tz: 'Asia/Seoul' },
  { key: 'busan',      label: '釜山',     lat: 35.1796, lon: 129.0756, tz: 'Asia/Seoul' },
  { key: 'incheon',    label: '仁川',     lat: 37.4563, lon: 126.7052, tz: 'Asia/Seoul' },
  { key: 'daegu',      label: '大邱',     lat: 35.8714, lon: 128.6014, tz: 'Asia/Seoul' },
  { key: 'daejeon',    label: '大田',     lat: 36.3504, lon: 127.3845, tz: 'Asia/Seoul' },
  { key: 'gwangju',    label: '光州',     lat: 35.1595, lon: 126.8526, tz: 'Asia/Seoul' },
  { key: 'hongkong',   label: '香港',     lat: 22.3193, lon: 114.1694, tz: 'Asia/Hong_Kong' },
  { key: 'macau',      label: '澳門',     lat: 22.1987, lon: 113.5439, tz: 'Asia/Macau' },
  { key: 'shanghai',   label: '上海',     lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai' },
  { key: 'beijing',    label: '北京',     lat: 39.9042, lon: 116.4074, tz: 'Asia/Shanghai' },
  { key: 'guangzhou',  label: '廣州',     lat: 23.1291, lon: 113.2644, tz: 'Asia/Shanghai' },
  { key: 'shenzhen',   label: '深圳',     lat: 22.5431, lon: 114.0579, tz: 'Asia/Shanghai' },
  { key: 'xiamen',     label: '廈門',     lat: 24.4798, lon: 118.0894, tz: 'Asia/Shanghai' },
  { key: 'fuzhou',     label: '福州',     lat: 26.0745, lon: 119.2965, tz: 'Asia/Shanghai' },
  { key: 'chengdu',    label: '成都',     lat: 30.5728, lon: 104.0668, tz: 'Asia/Shanghai' },
  { key: 'singapore',  label: '新加坡',   lat: 1.3521,  lon: 103.8198, tz: 'Asia/Singapore' },
  { key: 'kl',         label: '吉隆坡',   lat: 3.1390,  lon: 101.6869, tz: 'Asia/Kuala_Lumpur' },
  { key: 'bangkok',    label: '曼谷',     lat: 13.7563, lon: 100.5018, tz: 'Asia/Bangkok' },
  { key: 'hanoi',      label: '河內',     lat: 21.0278, lon: 105.8342, tz: 'Asia/Ho_Chi_Minh' },
  { key: 'hcmc',       label: '胡志明市', lat: 10.8231, lon: 106.6297, tz: 'Asia/Ho_Chi_Minh' },
  { key: 'manila',     label: '馬尼拉',   lat: 14.5995, lon: 120.9842, tz: 'Asia/Manila' },
  { key: 'jakarta',    label: '雅加達',   lat: -6.2088, lon: 106.8456, tz: 'Asia/Jakarta' },
  { key: 'delhi',      label: '新德里',   lat: 28.6139, lon: 77.2090,  tz: 'Asia/Kolkata' },
  { key: 'mumbai',     label: '孟買',     lat: 19.0760, lon: 72.8777,  tz: 'Asia/Kolkata' },
  { key: 'chennai',    label: '清奈',     lat: 13.0827, lon: 80.2707,  tz: 'Asia/Kolkata' },
  { key: 'kolkata',    label: '加爾各答', lat: 22.5726, lon: 88.3639,  tz: 'Asia/Kolkata' },
  { key: 'dubai',      label: '杜拜',     lat: 25.2048, lon: 55.2708,  tz: 'Asia/Dubai' },
  { key: 'london',     label: '倫敦',     lat: 51.5074, lon: -0.1278,  tz: 'Europe/London' },
  { key: 'paris',      label: '巴黎',     lat: 48.8566, lon: 2.3522,   tz: 'Europe/Paris' },
  { key: 'berlin',     label: '柏林',     lat: 52.5200, lon: 13.4050,  tz: 'Europe/Berlin' },
  { key: 'newyork',    label: '紐約',     lat: 40.7128, lon: -74.0060, tz: 'America/New_York' },
  { key: 'chicago',    label: '芝加哥',   lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
  { key: 'la',         label: '洛杉磯',   lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  { key: 'sf',         label: '舊金山',   lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles' },
  { key: 'seattle',    label: '西雅圖',   lat: 47.6062, lon: -122.3321, tz: 'America/Los_Angeles' },
  { key: 'vancouver',  label: '溫哥華',   lat: 49.2827, lon: -123.1207, tz: 'America/Vancouver' },
  { key: 'toronto',    label: '多倫多',   lat: 43.6532, lon: -79.3832, tz: 'America/Toronto' },
  { key: 'sydney',     label: '雪梨',     lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
  { key: 'melbourne',  label: '墨爾本',   lat: -37.8136, lon: 144.9631, tz: 'Australia/Melbourne' },
  { key: 'auckland',   label: '奧克蘭',   lat: -36.8485, lon: 174.7633, tz: 'Pacific/Auckland' },
]

export const placeOf = (key: unknown): Place | null => PLACES.find(p => p.key === key) ?? null

// ── The list in the page's language (Sep 29) ───────────────────────────────
// `label` stays 繁體: it is what the teacher's facts and saved charts name.
// The form shows the visitor's own spelling, their country first, and
// starts on their capital.
const N = (ja: string, ko: string, en: string) => ({ ja, ko, en })
const PLACE_NAMES: Record<string, { ja: string; ko: string; en: string }> = {
  taipei: N('台北', '타이베이', 'Taipei'), newtaipei: N('新北', '신베이', 'New Taipei'), taoyuan: N('桃園', '타오위안', 'Taoyuan'), hsinchu: N('新竹', '신주', 'Hsinchu'),
  taichung: N('台中', '타이중', 'Taichung'), changhua: N('彰化', '장화', 'Changhua'), chiayi: N('嘉義', '자이', 'Chiayi'), tainan: N('台南', '타이난', 'Tainan'),
  kaohsiung: N('高雄', '가오슝', 'Kaohsiung'), pingtung: N('屏東', '핑둥', 'Pingtung'), yilan: N('宜蘭', '이란', 'Yilan'), hualien: N('花蓮', '화롄', 'Hualien'),
  taitung: N('台東', '타이둥', 'Taitung'), penghu: N('澎湖', '펑후', 'Penghu'), kinmen: N('金門', '진먼', 'Kinmen'),
  tokyo: N('東京', '도쿄', 'Tokyo'), osaka: N('大阪', '오사카', 'Osaka'), nagoya: N('名古屋', '나고야', 'Nagoya'), fukuoka: N('福岡', '후쿠오카', 'Fukuoka'),
  sapporo: N('札幌', '삿포로', 'Sapporo'), naha: N('那覇（沖縄）', '나하(오키나와)', 'Naha (Okinawa)'), yokohama: N('横浜', '요코하마', 'Yokohama'), saitama: N('さいたま', '사이타마', 'Saitama'),
  chiba: N('千葉', '지바', 'Chiba'), kyoto: N('京都', '교토', 'Kyoto'), kobe: N('神戸', '고베', 'Kobe'), sendai: N('仙台', '센다이', 'Sendai'), niigata: N('新潟', '니가타', 'Niigata'),
  kanazawa: N('金沢', '가나자와', 'Kanazawa'), shizuoka: N('静岡', '시즈오카', 'Shizuoka'), hiroshima: N('広島', '히로시마', 'Hiroshima'), okayama: N('岡山', '오카야마', 'Okayama'),
  matsuyama: N('松山', '마쓰야마', 'Matsuyama'), kumamoto: N('熊本', '구마모토', 'Kumamoto'), kagoshima: N('鹿児島', '가고시마', 'Kagoshima'),
  seoul: N('ソウル', '서울', 'Seoul'), busan: N('釜山', '부산', 'Busan'), incheon: N('仁川', '인천', 'Incheon'), daegu: N('大邱', '대구', 'Daegu'), daejeon: N('大田', '대전', 'Daejeon'), gwangju: N('光州', '광주', 'Gwangju'),
  hongkong: N('香港', '홍콩', 'Hong Kong'), macau: N('マカオ', '마카오', 'Macau'), shanghai: N('上海', '상하이', 'Shanghai'), beijing: N('北京', '베이징', 'Beijing'),
  guangzhou: N('広州', '광저우', 'Guangzhou'), shenzhen: N('深圳', '선전', 'Shenzhen'), xiamen: N('アモイ', '샤먼', 'Xiamen'), fuzhou: N('福州', '푸저우', 'Fuzhou'), chengdu: N('成都', '청두', 'Chengdu'),
  singapore: N('シンガポール', '싱가포르', 'Singapore'), kl: N('クアラルンプール', '쿠알라룸푸르', 'Kuala Lumpur'), bangkok: N('バンコク', '방콕', 'Bangkok'), hanoi: N('ハノイ', '하노이', 'Hanoi'),
  hcmc: N('ホーチミン', '호찌민', 'Ho Chi Minh City'), manila: N('マニラ', '마닐라', 'Manila'), jakarta: N('ジャカルタ', '자카르타', 'Jakarta'), delhi: N('ニューデリー', '뉴델리', 'New Delhi'),
  mumbai: N('ムンバイ', '뭄바이', 'Mumbai'), chennai: N('チェンナイ', '첸나이', 'Chennai'), kolkata: N('コルカタ', '콜카타', 'Kolkata'), dubai: N('ドバイ', '두바이', 'Dubai'),
  london: N('ロンドン', '런던', 'London'), paris: N('パリ', '파리', 'Paris'), berlin: N('ベルリン', '베를린', 'Berlin'), newyork: N('ニューヨーク', '뉴욕', 'New York'),
  chicago: N('シカゴ', '시카고', 'Chicago'), la: N('ロサンゼルス', '로스앤젤레스', 'Los Angeles'), sf: N('サンフランシスコ', '샌프란시스코', 'San Francisco'), seattle: N('シアトル', '시애틀', 'Seattle'),
  vancouver: N('バンクーバー', '밴쿠버', 'Vancouver'), toronto: N('トロント', '토론토', 'Toronto'), sydney: N('シドニー', '시드니', 'Sydney'), melbourne: N('メルボルン', '멜버른', 'Melbourne'), auckland: N('オークランド', '오클랜드', 'Auckland'),
}
/** A place's name in the page's language (the 繁體 label on Chinese pages). */
export function placeLabel(p: Place | null | undefined, lang: string): string {
  if (!p) return ''
  const n = PLACE_NAMES[p.key]
  return (lang === 'ja' || lang === 'ko' || lang === 'en') && n ? n[lang] : p.label
}
// ── Finding a place (owner, Oct 1) ─────────────────────────────────────────
// A form starts with NO place: it used to start on Taipei (Tokyo, Seoul on
// those pages), and a visitor who never looked had a chart cast for a city
// they were not born in. The visitor types and picks; until they type, the
// cities of the country they are in (Vercel's x-vercel-ip-country) come
// first, else those of the page's language, never Taiwan's by default.

const COUNTRY_OF_TZ: Record<string, string> = {
  'Asia/Taipei': 'TW', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Shanghai': 'CN',
  'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Manila': 'PH', 'Asia/Jakarta': 'ID',
  'Asia/Kolkata': 'IN', 'Asia/Dubai': 'AE', 'Europe/London': 'GB', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Los_Angeles': 'US', 'America/Vancouver': 'CA', 'America/Toronto': 'CA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Pacific/Auckland': 'NZ',
}
/** A place's country (ISO 3166 alpha-2). */
export const countryOfPlace = (p: Place): string => COUNTRY_OF_TZ[p.tz] ?? ''
const LANG_COUNTRY: Record<string, string> = { ja: 'JP', ko: 'KR', 'zh-Hant': 'TW', 'zh-Hans': 'CN' }

/** The list in the order a form offers it: the visitor's country (by IP,
 *  else by the page's language) first, the rest as listed. */
export function placesFor(lang: string, country?: string | null): Place[] {
  const first = (typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : '') || LANG_COUNTRY[lang] || ''
  if (!first || !PLACES.some(p => countryOfPlace(p) === first)) return PLACES
  return [...PLACES.filter(p => countryOfPlace(p) === first), ...PLACES.filter(p => countryOfPlace(p) !== first)]
}

// 繁體 → 简体 for the characters the labels use, so 广州 finds 廣州.
const SIMP: Record<string, string> = {
  廣: '广', 東: '东', 門: '门', 島: '岛', 濱: '滨', 橫: '横', 戶: '户', 澤: '泽', 靜: '静', 兒: '儿', 爾: '尔', 內: '内', 馬: '马', 達: '达',
  買: '买', 倫: '伦', 紐: '纽', 約: '约', 磯: '矶', 舊: '旧', 溫: '温', 華: '华', 奧: '奥', 蘭: '兰', 蓮: '莲', 繩: '绳', 沖: '冲', 廈: '厦',
  臺: '台', 灣: '湾', 義: '义', 圖: '图',
}
// Katakana folds to hiragana, so ソウル and そうる meet.
const kana = (c: string): string => { const n = c.charCodeAt(0); return n >= 0x30a1 && n <= 0x30f6 ? String.fromCharCode(n - 0x60) : c }
const fold = (s: string): string => [...s.normalize('NFKC').toLowerCase().replace(/[\s·・.\-'()（）]/g, '')].map(c => kana(SIMP[c] ?? c)).join('')
const ALIASES: Record<string, string[]> = {
  taipei: ['台北市', '臺北'], newtaipei: ['新北市', '板橋'], sydney: ['悉尼'], hcmc: ['西貢', 'saigon'], kl: ['kualalumpur'],
  newyork: ['nyc'], la: ['losangeles'], sf: ['sanfrancisco'], hongkong: ['hk'], naha: ['沖繩', '沖縄', 'okinawa', 'おきなわ'],
  // Kana readings: a phone keyboard shows かな before the kanji (a live
  // check, Oct 1: さっぽろ found nothing).
  tokyo: ['とうきょう'], osaka: ['おおさか'], nagoya: ['なごや'], fukuoka: ['ふくおか'], sapporo: ['さっぽろ'], yokohama: ['よこはま'],
  saitama: ['さいたま'], chiba: ['ちば'], kyoto: ['きょうと'], kobe: ['こうべ'], sendai: ['せんだい'], niigata: ['にいがた'],
  kanazawa: ['かなざわ'], shizuoka: ['しずおか'], hiroshima: ['ひろしま'], okayama: ['おかやま'], matsuyama: ['まつやま'],
  kumamoto: ['くまもと'], kagoshima: ['かごしま'],
}

/** Places whose name (in any of our languages, or an alias) contains what
 *  was typed, those that start with it first; the visitor's country first
 *  within each. Empty for an empty query. */
export function searchPlaces(query: string, lang: string, country?: string | null, limit = 8): Place[] {
  const q = fold(String(query ?? ''))
  if (!q) return []
  const names = (p: Place) => [p.label, p.key, ...(PLACE_NAMES[p.key] ? Object.values(PLACE_NAMES[p.key]) : []), ...(ALIASES[p.key] ?? [])].map(fold)
  const ordered = placesFor(lang, country)
  const starts = ordered.filter(p => names(p).some(n => n.startsWith(q)))
  const contains = ordered.filter(p => !starts.includes(p) && names(p).some(n => n.includes(q)))
  return [...starts, ...contains].slice(0, limit)
}

// ── The daily fortune's birth zone (owner, Sep 27: no city) ────────────────
// The daily profile stores the zone the visitor was born in as 'tz:<IANA>'.
// Profiles saved before Sep 27 name a city from the list above; its zone
// stands in, and only those still carry coordinates.

export const ZONE_PREFIX = 'tz:'

/** The zone a daily profile's birth was in, or null if it names none. */
export function birthZone(place: unknown): string | null {
  if (typeof place !== 'string') return null
  if (place.startsWith(ZONE_PREFIX)) {
    const z = place.slice(ZONE_PREFIX.length)
    try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z } catch { return null }
  }
  return placeOf(place)?.tz ?? null
}

/** Zones people are most often born in, for the form; any other IANA zone
 *  the browser knows is offered after them. */
export const COMMON_ZONES = [
  'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Macau', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore',
  'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Manila', 'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Dubai',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'Australia/Sydney',
  'Australia/Perth', 'Pacific/Auckland',
]
