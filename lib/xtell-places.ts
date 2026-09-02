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
  { key: 'seoul',      label: '首爾',     lat: 37.5665, lon: 126.9780, tz: 'Asia/Seoul' },
  { key: 'busan',      label: '釜山',     lat: 35.1796, lon: 129.0756, tz: 'Asia/Seoul' },
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

export const DEFAULT_PLACE = 'taipei'
export const placeOf = (key: unknown): Place | null => PLACES.find(p => p.key === key) ?? null
