// lib/xtell-almanac-terms.ts — the almanac's Chinese vocabulary in Japanese
// and Korean (and 彭祖百忌 in English), written by ModelXD (Sep 29: a
// Japanese tester found 「祭祀、冠笄、餘事勿取」 and 「丙不修灶必見災殃」
// on the Japanese page with no way to read them).
//
// Keys are the Traditional forms lib/xtell-almanac.ts prints (toHant of the
// library's vocabulary); scripts/test-today.ts holds that every term the
// library can print has an entry. The 宜忌 English is the library's own.
//
// Client-safe.

/** 宜 / 忌 activities (lunar-typescript's YI_JI, 141 terms). */
export const YIJI: Record<string, { ja: string; ko: string }> = {
  祭祀: { ja: '祭祀・お参り', ko: '제사' },
  祈福: { ja: '祈願', ko: '복을 비는 기도' },
  求嗣: { ja: '子宝祈願', ko: '자식 기원' },
  開光: { ja: '神仏像の開眼', ko: '신상 점안' },
  塑繪: { ja: '神仏像の制作', ko: '신상 조각·그림' },
  齊醮: { ja: '祈祷の儀式', ko: '기도 의식' },
  齋醮: { ja: '祈祷の儀式', ko: '기도 의식' },
  沐浴: { ja: '沐浴（身を清める）', ko: '목욕재계' },
  酬神: { ja: '神へのお礼参り', ko: '신께 감사 제사' },
  造廟: { ja: 'お堂の建立', ko: '사당 건립' },
  祀灶: { ja: 'かまど神を祀る', ko: '조왕신 제사' },
  焚香: { ja: '焼香', ko: '분향' },
  謝土: { ja: '土地の神へのお礼', ko: '토지신께 감사 제사' },
  出火: { ja: '神位を一時移す', ko: '신위 옮기기' },
  雕刻: { ja: '彫刻', ko: '조각' },
  嫁娶: { ja: '結婚', ko: '결혼' },
  訂婚: { ja: '婚約', ko: '약혼' },
  納采: { ja: '結納', ko: '납채(예물 보내기)' },
  問名: { ja: '縁談の申し入れ', ko: '혼담' },
  納婿: { ja: '婿を迎える', ko: '데릴사위 맞이' },
  歸寧: { ja: '里帰り', ko: '친정 나들이' },
  安床: { ja: '寝台を据える', ko: '침대 들이기' },
  合帳: { ja: '寝具を整える', ko: '침구 마련' },
  冠笄: { ja: '成人の儀', ko: '성인식' },
  訂盟: { ja: '約束を交わす', ko: '약속 맺기' },
  進人口: { ja: '家族・人を迎える', ko: '식구 들이기' },
  裁衣: { ja: '服の仕立て', ko: '옷 마름질' },
  挽面: { ja: '顔の産毛取り（婚礼前）', ko: '실 면도(혼례 전)' },
  開容: { ja: '身だしなみを整える', ko: '용모 단장' },
  修墳: { ja: '墓の修繕', ko: '묘 수리' },
  啟鑽: { ja: '改葬のため墓を開く', ko: '이장을 위해 묘 열기' },
  破土: { ja: '墓所の土を掘る', ko: '묘 터 파기' },
  安葬: { ja: '埋葬', ko: '안장' },
  立碑: { ja: '墓碑を建てる', ko: '비석 세우기' },
  成服: { ja: '喪服を着る', ko: '상복 입기' },
  除服: { ja: '喪明け', ko: '탈상' },
  開生墳: { ja: '生前墓を作る', ko: '생전 묘 만들기' },
  合壽木: { ja: '棺を用意する', ko: '관 마련' },
  入殮: { ja: '納棺', ko: '입관' },
  移柩: { ja: '棺を移す', ko: '운구' },
  普渡: { ja: '施餓鬼供養', ko: '위령 제사' },
  入宅: { ja: '新居に入る', ko: '입주' },
  安香: { ja: '香炉・神棚を据える', ko: '신단 모시기' },
  安門: { ja: '門・扉の取り付け', ko: '대문 달기' },
  修造: { ja: '修築・リフォーム', ko: '수리·증축' },
  起基: { ja: '基礎工事', ko: '기초 공사' },
  動土: { ja: '着工（土を動かす）', ko: '착공' },
  上梁: { ja: '上棟', ko: '상량' },
  豎柱: { ja: '柱を立てる', ko: '기둥 세우기' },
  開井開池: { ja: '井戸や池を掘る', ko: '우물·연못 파기' },
  作陂放水: { ja: '堤を築き水を引く', ko: '둑 쌓고 물 대기' },
  拆卸: { ja: '解体', ko: '철거' },
  破屋: { ja: '家屋の取り壊し', ko: '집 허물기' },
  壞垣: { ja: '塀の取り壊し', ko: '담 허물기' },
  補垣: { ja: '塀の修繕', ko: '담 보수' },
  伐木做梁: { ja: '伐採して梁を作る', ko: '벌목해 들보 만들기' },
  作灶: { ja: 'かまどを作る', ko: '부뚜막 만들기' },
  解除: { ja: 'お祓い・厄除け', ko: '액막이' },
  開柱眼: { ja: '柱に穴をあける', ko: '기둥 구멍 뚫기' },
  穿屏扇架: { ja: '建具の取り付け', ko: '창호 달기' },
  蓋屋合脊: { ja: '屋根を葺き棟を上げる', ko: '지붕 얹고 용마루 올리기' },
  開廁: { ja: 'トイレを設ける', ko: '화장실 내기' },
  造倉: { ja: '倉を建てる', ko: '창고 짓기' },
  塞穴: { ja: '穴をふさぐ', ko: '구멍 막기' },
  平治道塗: { ja: '道の整備', ko: '길 닦기' },
  造橋: { ja: '橋を架ける', ko: '다리 놓기' },
  作廁: { ja: 'トイレを作る', ko: '화장실 만들기' },
  築堤: { ja: '堤防を築く', ko: '제방 쌓기' },
  開池: { ja: '池を掘る', ko: '연못 파기' },
  伐木: { ja: '伐採', ko: '벌목' },
  開渠: { ja: '水路を開く', ko: '수로 내기' },
  掘井: { ja: '井戸を掘る', ko: '우물 파기' },
  掃舍: { ja: '大掃除', ko: '대청소' },
  放水: { ja: '水を引く', ko: '물 대기' },
  造屋: { ja: '家を建てる', ko: '집 짓기' },
  合脊: { ja: '棟を上げる', ko: '용마루 올리기' },
  造畜稠: { ja: '家畜小屋を作る', ko: '가축우리 짓기' },
  修門: { ja: '門の修理', ko: '대문 수리' },
  定磉: { ja: '礎石を据える', ko: '주춧돌 놓기' },
  作梁: { ja: '梁を作る', ko: '들보 만들기' },
  修飾垣牆: { ja: '塀や壁の修繕・装飾', ko: '담장 손질' },
  架馬: { ja: '木工の作業台を組む', ko: '목공 작업대 설치' },
  開市: { ja: '開店・仕事始め', ko: '개업' },
  掛匾: { ja: '看板を掲げる', ko: '현판 걸기' },
  納財: { ja: '入金・集金', ko: '재물 들이기' },
  求財: { ja: '金運を求める', ko: '재물 구하기' },
  開倉: { ja: '倉を開ける', ko: '창고 열기' },
  買車: { ja: '車の購入', ko: '차 구입' },
  置產: { ja: '不動産の購入', ko: '부동산 구입' },
  雇傭: { ja: '人を雇う', ko: '고용' },
  出貨財: { ja: '出荷・支払い', ko: '출하·지출' },
  安機械: { ja: '機械の据え付け', ko: '기계 설치' },
  造車器: { ja: '車や道具を作る', ko: '수레·기구 제작' },
  經絡: { ja: '機織りの糸掛け', ko: '베틀 날실 걸기' },
  醞釀: { ja: '酒の仕込み', ko: '술 빚기' },
  作染: { ja: '染め物', ko: '염색' },
  鼓鑄: { ja: '鋳造', ko: '주조' },
  造船: { ja: '造船', ko: '배 만들기' },
  割蜜: { ja: '蜂蜜の採取', ko: '꿀 따기' },
  栽種: { ja: '植え付け', ko: '심기' },
  取漁: { ja: '漁', ko: '고기잡이' },
  結網: { ja: '網を編む', ko: '그물 짜기' },
  牧養: { ja: '牧畜', ko: '가축 기르기' },
  安碓磑: { ja: '臼を据える', ko: '방아·맷돌 설치' },
  習藝: { ja: '習い事', ko: '기예 배우기' },
  入學: { ja: '入学', ko: '입학' },
  理髮: { ja: '散髪', ko: '이발' },
  探病: { ja: 'お見舞い', ko: '병문안' },
  見貴: { ja: '目上の人に会う', ko: '귀인 만나기' },
  乘船: { ja: '船に乗る', ko: '배 타기' },
  渡水: { ja: '川を渡る', ko: '물 건너기' },
  針灸: { ja: '鍼灸', ko: '침·뜸' },
  出行: { ja: '旅行・外出', ko: '여행·외출' },
  移徙: { ja: '引っ越し', ko: '이사' },
  分居: { ja: '分家', ko: '분가' },
  剃頭: { ja: '頭を剃る', ko: '머리 깎기' },
  整手足甲: { ja: '爪切り', ko: '손발톱 깎기' },
  納畜: { ja: '家畜を迎える', ko: '가축 들이기' },
  捕捉: { ja: '捕獲', ko: '포획' },
  畋獵: { ja: '狩猟', ko: '사냥' },
  教牛馬: { ja: '牛馬の調教', ko: '소·말 길들이기' },
  會親友: { ja: '親戚や友人と会う', ko: '친지·친구 만남' },
  赴任: { ja: '赴任', ko: '부임' },
  求醫: { ja: '医者にかかる', ko: '의사 찾기' },
  治病: { ja: '治療', ko: '치료' },
  詞訟: { ja: '訴訟', ko: '소송' },
  起基動土: { ja: '基礎工事・着工', ko: '기초 공사·착공' },
  破屋壞垣: { ja: '家屋や塀の取り壊し', ko: '집·담 허물기' },
  蓋屋: { ja: '屋根を葺く', ko: '지붕 이기' },
  造倉庫: { ja: '倉庫を建てる', ko: '창고 짓기' },
  立券交易: { ja: '契約・取引', ko: '계약·거래' },
  交易: { ja: '取引', ko: '거래' },
  立券: { ja: '契約', ko: '계약' },
  安機: { ja: '機械の据え付け', ko: '기계 설치' },
  會友: { ja: '友人と会う', ko: '친구 만남' },
  求醫療病: { ja: '医者にかかり治療する', ko: '진료·치료' },
  諸事不宜: { ja: '万事控える', ko: '모든 일을 삼감' },
  餘事勿取: { ja: 'ほかは控える', ko: '그 밖의 일은 삼감' },
  行喪: { ja: '葬儀', ko: '장례' },
  斷蟻: { ja: '白蟻よけ', ko: '흰개미 막기' },
  歸岫: { ja: '元の場所へ戻る', ko: '제자리로 돌아감' },
}

/** 彭祖百忌: the day stem's line and the day branch's line. Old sayings; the
 *  card labels them so. */
export const PENGZU: Record<string, { ja: string; ko: string; en: string }> = {
  甲不開倉財物耗散: { ja: '甲の日は倉を開けない（財が散る）', ko: '갑일에는 창고를 열지 않는다(재물이 흩어진다)', en: 'A 甲 day: don’t open the storehouse (wealth drains away)' },
  乙不栽植千株不長: { ja: '乙の日は植え付けをしない（育たない）', ko: '을일에는 심지 않는다(자라지 않는다)', en: 'An 乙 day: don’t plant (nothing grows)' },
  丙不修灶必見災殃: { ja: '丙の日はかまどを直さない（災いを招く）', ko: '병일에는 부뚜막을 고치지 않는다(재앙을 부른다)', en: 'A 丙 day: don’t repair the stove (it invites trouble)' },
  丁不剃頭頭必生瘡: { ja: '丁の日は頭を剃らない（できものができる）', ko: '정일에는 머리를 깎지 않는다(종기가 난다)', en: 'A 丁 day: don’t shave the head (sores follow)' },
  戊不受田田主不祥: { ja: '戊の日は田畑を受け取らない（持ち主に不吉）', ko: '무일에는 논밭을 받지 않는다(주인에게 불길하다)', en: 'A 戊 day: don’t take on land (ill luck for its owner)' },
  己不破券二比並亡: { ja: '己の日は契約を破らない（双方が損をする）', ko: '기일에는 계약을 깨지 않는다(양쪽 모두 잃는다)', en: 'A 己 day: don’t break a contract (both sides lose)' },
  庚不經絡織機虛張: { ja: '庚の日は機織りの糸を掛けない（織機が空回りする）', ko: '경일에는 베틀에 날실을 걸지 않는다(베틀이 헛돈다)', en: 'A 庚 day: don’t warp the loom (it runs empty)' },
  辛不合醬主人不嘗: { ja: '辛の日は醤（みそ）を仕込まない（主人が味わえない）', ko: '신일에는 장을 담그지 않는다(주인이 맛보지 못한다)', en: 'A 辛 day: don’t make sauce (the master won’t taste it)' },
  壬不泱水更難提防: { ja: '壬の日は水を引かない（防ぎきれなくなる）', ko: '임일에는 물을 대지 않는다(막기 어려워진다)', en: 'A 壬 day: don’t let water in (it gets hard to hold back)' },
  癸不詞訟理弱敵強: { ja: '癸の日は訴訟をしない（理があっても相手が強い）', ko: '계일에는 소송하지 않는다(이치가 약하고 상대가 강하다)', en: 'A 癸 day: don’t go to law (your case is weak, theirs strong)' },
  子不問卜自惹禍殃: { ja: '子の日は占いを頼まない（自ら災いを招く）', ko: '자일에는 점을 치지 않는다(스스로 화를 부른다)', en: 'A 子 day: don’t consult a diviner (you bring trouble on yourself)' },
  丑不冠帶主不還鄉: { ja: '丑の日は冠や帯を着けない（故郷に帰れなくなる）', ko: '축일에는 관과 띠를 두르지 않는다(고향에 돌아가지 못한다)', en: 'A 丑 day: don’t put on cap and sash (you won’t return home)' },
  寅不祭祀神鬼不嘗: { ja: '寅の日は祭祀をしない（神霊が受け取らない）', ko: '인일에는 제사를 지내지 않는다(신령이 받지 않는다)', en: 'A 寅 day: don’t make offerings (the spirits won’t take them)' },
  卯不穿井水泉不香: { ja: '卯の日は井戸を掘らない（水がおいしくない）', ko: '묘일에는 우물을 파지 않는다(물맛이 좋지 않다)', en: 'A 卯 day: don’t dig a well (the water won’t be sweet)' },
  辰不哭泣必主重喪: { ja: '辰の日は泣かない（不幸が重なる）', ko: '진일에는 울지 않는다(상이 겹친다)', en: 'A 辰 day: don’t weep (mourning comes twice)' },
  巳不遠行財物伏藏: { ja: '巳の日は遠出しない（財が隠れてしまう）', ko: '사일에는 멀리 가지 않는다(재물이 숨어 버린다)', en: 'A 巳 day: don’t travel far (wealth goes into hiding)' },
  午不苫蓋屋主更張: { ja: '午の日は屋根を葺かない（家の主が替わる）', ko: '오일에는 지붕을 이지 않는다(집주인이 바뀐다)', en: 'A 午 day: don’t thatch a roof (the house changes hands)' },
  未不服藥毒氣入腸: { ja: '未の日は薬を飲まない、と言われる（薬は医師の指示どおりに）', ko: '미일에는 약을 먹지 않는다는 옛말(약은 의사의 지시대로)', en: 'A 未 day: the saying is not to take medicine (follow your doctor, not the almanac)' },
  申不安床鬼祟入房: { ja: '申の日は寝台を据えない（魔が寝室に入る）', ko: '신일에는 침대를 들이지 않는다(귀신이 방에 든다)', en: 'A 申 day: don’t set up a bed (spirits get into the room)' },
  酉不會客醉坐顛狂: { ja: '酉の日は客を招かない（酔って騒ぎになる）', ko: '유일에는 손님을 맞지 않는다(취해 소란이 난다)', en: 'A 酉 day: don’t host guests (drink turns wild)' },
  戌不吃犬作怪上床: { ja: '戌の日は犬を食べない（怪異が起こる）', ko: '술일에는 개고기를 먹지 않는다(괴이한 일이 생긴다)', en: 'A 戌 day: don’t eat dog (strange things follow)' },
  亥不嫁娶不利新郎: { ja: '亥の日は結婚しない（新郎に不利）', ko: '해일에는 혼인하지 않는다(신랑에게 불리하다)', en: 'A 亥 day: don’t marry (bad for the groom)' },
}

/** 二十四節気 as a Japanese calendar writes them (three differ from 繁體),
 *  and the 24절기 in Hangul. */
export const JIEQI_JA: Record<string, string> = { 驚蟄: '啓蟄', 小滿: '小満', 處暑: '処暑' }
export const JIEQI_KO: Record<string, string> = {
  立春: '입춘', 雨水: '우수', 驚蟄: '경칩', 春分: '춘분', 清明: '청명', 穀雨: '곡우', 立夏: '입하', 小滿: '소만', 芒種: '망종', 夏至: '하지', 小暑: '소서', 大暑: '대서',
  立秋: '입추', 處暑: '처서', 白露: '백로', 秋分: '추분', 寒露: '한로', 霜降: '상강', 立冬: '입동', 小雪: '소설', 大雪: '대설', 冬至: '동지', 小寒: '소한', 大寒: '대한',
}
/** 十二直 as a Japanese calendar writes them (收 is 納, 滿 is 満); 건제 in Hangul. */
export const ZHIXING_JA: Record<string, string> = { 滿: '満', 收: '納' }
export const ZHIXING_KO: Record<string, string> = { 建: '건', 除: '제', 滿: '만', 平: '평', 定: '정', 執: '집', 破: '파', 危: '위', 成: '성', 收: '수', 開: '개', 閉: '폐' }
/** The 煞 direction in Hangul. */
export const SHA_KO: Record<string, string> = { 東: '동', 西: '서', 南: '남', 北: '북' }

// ── What a Japanese calendar marks (Sep 29, a second reviewer: Japanese
// readers expect 六曜 and days like 一粒万倍日) ───────────────────────────
// The tables are the standard ones; 2026 was checked against published
// Japanese calendars (天赦日 3/5 5/4 5/20 7/19 10/1 12/16; 一粒万倍日 on
// 3/5 5/2 5/5 7/19 10/1 12/16, not 5/4; 大安 on 5/7). 大明日 is left out:
// its table could not be checked the same way.

/** 六曜 as Japan writes it (the library prints the Simplified forms). */
export const ROKUYO_JA: Record<string, string> = { 先胜: '先勝', 友引: '友引', 先负: '先負', 佛灭: '仏滅', 大安: '大安', 赤口: '赤口' }

/** 一粒万倍日: by the solar-term month's branch, the day branches that are one. */
const MANBAI: Record<string, string[]> = {
  寅: ['丑', '午'], 卯: ['酉', '寅'], 辰: ['子', '卯'], 巳: ['卯', '辰'], 午: ['巳', '午'], 未: ['酉', '午'],
  申: ['子', '未'], 酉: ['卯', '申'], 戌: ['酉', '午'], 亥: ['酉', '戌'], 子: ['亥', '子'], 丑: ['卯', '子'],
}
/** 天赦日: by season (solar-term month), the one day 干支 that is it. */
const TENSHA: Record<string, string> = {
  寅: '戊寅', 卯: '戊寅', 辰: '戊寅', 巳: '甲午', 午: '甲午', 未: '甲午',
  申: '戊申', 酉: '戊申', 戌: '戊申', 亥: '甲子', 子: '甲子', 丑: '甲子',
}
/** The lucky days a Japanese calendar would mark on this date, with what each means. */
export function japaneseLuckyDays(monthZhi: string, dayZhi: string, dayGz: string): string[] {
  const days: string[] = []
  if (TENSHA[monthZhi] === dayGz) days.push('天赦日（年に数回しかない最上の吉日）')
  if (MANBAI[monthZhi]?.includes(dayZhi)) days.push('一粒万倍日（始めたことが大きく実るとされる日）')
  return days
}
