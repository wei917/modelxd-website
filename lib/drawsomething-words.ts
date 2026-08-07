// lib/drawsomething-words.ts
// Word banks for Draw & Guess — one bank PER SITE LANGUAGE.
//
// WORD BANKS ARE CONTENT, NOT TRANSLATION (owner, Aug 6): "things everyone
// can draw AND guess" is a cultural fact, so each language mixes universal
// subjects (cat, moon, guitar) with its own culturally-popular ones —
// zh-Hant draws 珍珠奶茶 and 101大樓, ja draws 桜 and 新幹線, ko draws
// 김치 and 한강. Never machine-translate one list into another.
//
// ⚠ DRAFT STATUS: these lists are model-drafted and still need a native
// speaker's review pass per language (the owner reviews zh; find reviewers
// for ja/ko). A wrong subject here is a dead round.
//
// `alt` lists accepted alternative answers IN THE SAME LANGUAGE (spelling
// variants, kana readings for kanji words, common synonyms). Matching is
// script-aware — see lib/drawsomething-engine.ts.

export type DrawWord = { w: string; alt?: string[] }
export type DrawBank = { easy: DrawWord[]; medium: DrawWord[]; hard: DrawWord[] }
export type DrawLang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'

export const DRAW_BANKS: Record<DrawLang, DrawBank> = {
  en: {
    easy: [
      { w: 'cat' }, { w: 'dog' }, { w: 'sun' }, { w: 'moon' }, { w: 'star' },
      { w: 'fish' }, { w: 'apple' }, { w: 'house' }, { w: 'tree' }, { w: 'car' },
      { w: 'bicycle', alt: ['bike'] }, { w: 'pizza' }, { w: 'guitar' },
      { w: 'umbrella' }, { w: 'rainbow' }, { w: 'snowman' }, { w: 'balloon' },
      { w: 'butterfly' },
    ],
    medium: [
      { w: 'lighthouse' }, { w: 'volcano' }, { w: 'penguin' }, { w: 'castle' },
      { w: 'robot' }, { w: 'astronaut', alt: ['spaceman'] }, { w: 'waterfall' },
      { w: 'hamburger', alt: ['burger'] }, { w: 'octopus' }, { w: 'telescope' },
      { w: 'campfire', alt: ['bonfire'] }, { w: 'windmill' }, { w: 'mermaid' },
      { w: 'dinosaur' }, { w: 'submarine' }, { w: 'scarecrow' },
      { w: 'ferris wheel' }, { w: 'hot air balloon', alt: ['hot-air balloon', 'air balloon'] },
      { w: 'skateboard' }, { w: 'jellyfish' },
    ],
    hard: [
      { w: 'gravity' }, { w: 'echo' }, { w: 'nightmare' }, { w: 'traffic jam' },
      { w: 'time machine' }, { w: 'tug of war', alt: ['tug-of-war'] },
      { w: 'daydream' }, { w: 'shadow' }, { w: 'hiccup', alt: ['hiccups'] },
      { w: 'applause', alt: ['clapping'] }, { w: 'insomnia' }, { w: 'deja vu', alt: ['déjà vu'] },
    ],
  },

  'zh-Hant': {
    easy: [
      { w: '貓' }, { w: '狗' }, { w: '太陽' }, { w: '月亮' }, { w: '星星' },
      { w: '魚' }, { w: '蘋果' }, { w: '房子' }, { w: '樹' }, { w: '汽車', alt: ['車'] },
      { w: '腳踏車', alt: ['自行車', '單車'] }, { w: '珍珠奶茶', alt: ['波霸奶茶', '珍奶'] },
      { w: '彩虹' }, { w: '雨傘', alt: ['傘'] }, { w: '氣球' }, { w: '蝴蝶' },
      { w: '西瓜' }, { w: '飯糰' },
    ],
    medium: [
      { w: '101大樓', alt: ['台北101', '101'] }, { w: '夜市' }, { w: '滷肉飯', alt: ['魯肉飯'] },
      { w: '火鍋' }, { w: '燈籠' }, { w: '廟', alt: ['寺廟'] }, { w: '火山' },
      { w: '企鵝' }, { w: '機器人' }, { w: '太空人', alt: ['宇航員'] },
      { w: '瀑布' }, { w: '章魚' }, { w: '恐龍' }, { w: '摩天輪' },
      { w: '熱氣球' }, { w: '高鐵' }, { w: '小籠包' }, { w: '媽祖' },
      { w: '茶壺' }, { w: '稻田' },
    ],
    hard: [
      { w: '塞車', alt: ['堵車'] }, { w: '回音' }, { w: '惡夢', alt: ['噩夢'] },
      { w: '影子' }, { w: '打嗝' }, { w: '鼓掌', alt: ['拍手'] },
      { w: '失眠' }, { w: '拔河' }, { w: '白日夢' }, { w: '地心引力', alt: ['重力'] },
      { w: '時光機', alt: ['時光機器'] }, { w: '排隊' },
    ],
  },

  'zh-Hans': {
    easy: [
      { w: '猫' }, { w: '狗' }, { w: '太阳' }, { w: '月亮' }, { w: '星星' },
      { w: '鱼' }, { w: '苹果' }, { w: '房子' }, { w: '树' }, { w: '汽车', alt: ['车'] },
      { w: '自行车', alt: ['单车'] }, { w: '奶茶', alt: ['珍珠奶茶'] },
      { w: '彩虹' }, { w: '雨伞', alt: ['伞'] }, { w: '气球' }, { w: '蝴蝶' },
      { w: '西瓜' }, { w: '包子' },
    ],
    medium: [
      { w: '长城' }, { w: '熊猫', alt: ['大熊猫'] }, { w: '火锅' }, { w: '灯笼' },
      { w: '高铁' }, { w: '火山' }, { w: '企鹅' }, { w: '机器人' },
      { w: '宇航员', alt: ['太空人'] }, { w: '瀑布' }, { w: '章鱼' }, { w: '恐龙' },
      { w: '摩天轮' }, { w: '热气球' }, { w: '饺子' }, { w: '龙舟' },
      { w: '兵马俑' }, { w: '糖葫芦', alt: ['冰糖葫芦'] }, { w: '茶壶' }, { w: '稻田' },
    ],
    hard: [
      { w: '堵车', alt: ['塞车'] }, { w: '回声' }, { w: '噩梦', alt: ['恶梦'] },
      { w: '影子' }, { w: '打嗝' }, { w: '鼓掌', alt: ['拍手'] },
      { w: '失眠' }, { w: '拔河' }, { w: '白日梦' }, { w: '重力', alt: ['地心引力'] },
      { w: '时光机', alt: ['时光机器'] }, { w: '排队' },
    ],
  },

  ja: {
    easy: [
      { w: 'ねこ', alt: ['猫', 'ネコ'] }, { w: 'いぬ', alt: ['犬', 'イヌ'] },
      { w: 'たいよう', alt: ['太陽'] }, { w: 'つき', alt: ['月'] },
      { w: 'ほし', alt: ['星'] }, { w: 'さかな', alt: ['魚'] },
      { w: 'りんご', alt: ['リンゴ', '林檎'] }, { w: 'いえ', alt: ['家'] },
      { w: 'き', alt: ['木'] }, { w: 'くるま', alt: ['車', '自動車'] },
      { w: 'じてんしゃ', alt: ['自転車'] }, { w: 'おにぎり', alt: ['お握り', 'おむすび'] },
      { w: 'にじ', alt: ['虹'] }, { w: 'かさ', alt: ['傘'] },
      { w: 'ふうせん', alt: ['風船'] }, { w: 'ちょうちょ', alt: ['蝶', 'ちょう'] },
      { w: 'すいか', alt: ['西瓜', 'スイカ'] }, { w: 'すし', alt: ['寿司', '鮨'] },
    ],
    medium: [
      { w: 'さくら', alt: ['桜', 'サクラ'] }, { w: 'しんかんせん', alt: ['新幹線'] },
      { w: 'ふじさん', alt: ['富士山'] }, { w: 'とりい', alt: ['鳥居'] },
      { w: 'まねきねこ', alt: ['招き猫'] }, { w: 'たこやき', alt: ['たこ焼き', 'タコヤキ'] },
      { w: 'かざん', alt: ['火山'] }, { w: 'ぺんぎん', alt: ['ペンギン'] },
      { w: 'ろぼっと', alt: ['ロボット'] }, { w: 'うちゅうひこうし', alt: ['宇宙飛行士'] },
      { w: 'たき', alt: ['滝'] }, { w: 'たこ', alt: ['タコ', '蛸'] },
      { w: 'きょうりゅう', alt: ['恐竜'] }, { w: 'かんらんしゃ', alt: ['観覧車'] },
      { w: 'ききゅう', alt: ['気球', '熱気球'] }, { w: 'おんせん', alt: ['温泉'] },
      { w: 'だるま', alt: ['ダルマ', '達磨'] }, { w: 'こいのぼり', alt: ['鯉のぼり'] },
      { w: 'らーめん', alt: ['ラーメン', 'らめん'] }, { w: 'かかし', alt: ['案山子'] },
    ],
    hard: [
      { w: 'じゅうたい', alt: ['渋滞'] }, { w: 'やまびこ', alt: ['山彦', 'こだま'] },
      { w: 'あくむ', alt: ['悪夢'] }, { w: 'かげ', alt: ['影'] },
      { w: 'しゃっくり' }, { w: 'はくしゅ', alt: ['拍手'] },
      { w: 'ふみん', alt: ['不眠', '不眠症'] }, { w: 'つなひき', alt: ['綱引き'] },
      { w: 'ゆめ', alt: ['夢'] }, { w: 'じゅうりょく', alt: ['重力'] },
      { w:'たいむましん', alt: ['タイムマシン'] }, { w: 'ぎょうれつ', alt: ['行列'] },
    ],
  },

  ko: {
    easy: [
      { w: '고양이' }, { w: '강아지', alt: ['개'] }, { w: '해', alt: ['태양'] },
      { w: '달' }, { w: '별' }, { w: '물고기', alt: ['생선'] },
      { w: '사과' }, { w: '집' }, { w: '나무' }, { w: '자동차', alt: ['차'] },
      { w: '자전거' }, { w: '김밥' }, { w: '무지개' }, { w: '우산' },
      { w: '풍선' }, { w: '나비' }, { w: '수박' }, { w: '김치' },
    ],
    medium: [
      { w: '남산타워', alt: ['N서울타워', '서울타워'] }, { w: '한강' },
      { w: '떡볶이', alt: ['떡볶기'] }, { w: '한복' }, { w: '지하철' },
      { w: '화산' }, { w: '펭귄' }, { w: '로봇' }, { w: '우주인', alt: ['우주비행사'] },
      { w: '폭포' }, { w: '문어' }, { w: '공룡' }, { w: '대관람차', alt: ['관람차'] },
      { w: '열기구' }, { w: '경복궁' }, { w: '치킨', alt: ['프라이드치킨'] },
      { w: '눈사람' }, { w: '호랑이' }, { w: '주전자' }, { w: '허수아비' },
    ],
    hard: [
      { w: '교통체증', alt: ['차막힘'] }, { w: '메아리' }, { w: '악몽' },
      { w: '그림자' }, { w: '딸꾹질' }, { w: '박수' },
      { w: '불면증' }, { w: '줄다리기' }, { w: '백일몽', alt: ['공상'] },
      { w: '중력' }, { w: '타임머신' }, { w: '줄서기', alt: ['대기줄'] },
    ],
  },
}
