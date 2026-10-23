// app/xoracle/guandi-3d/lines.ts — the 3D temple's own words in the five
// languages. Client-safe. 關聖帝君 says nothing here (owner, Oct 23: "remove
// the voice. don't actively talk please!"); what a 籤 means stays with the
// room's 解籤 masters, who hedge (owner's rule: no verdicts).

export type Lang5 = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'

/** The page's own words (kept here, not in lib/i18n.tsx: a prototype). */
export const UI: Record<string, Record<Lang5, string>> = {
  title:     { 'zh-Hant': '關帝廟', 'zh-Hans': '关帝庙', en: 'Guan Di Temple', ja: '関帝廟', ko: '관제묘' },
  proto:     { 'zh-Hant': '3D 原型', 'zh-Hans': '3D 原型', en: '3D prototype', ja: '3D 試作', ko: '3D 프로토타입' },
  back:      { 'zh-Hant': 'X先知', 'zh-Hans': 'X先知', en: 'XOracle', ja: 'X先知', ko: 'X선지' },
  loading:   { 'zh-Hant': '正在打開廟門…', 'zh-Hans': '正在打开庙门…', en: 'Opening the temple doors…', ja: '廟の扉を開けています…', ko: '사당 문을 여는 중…' },
  noWebgl:   { 'zh-Hant': '這個瀏覽器打不開 3D 廟（需要 WebGL2）。', 'zh-Hans': '这个浏览器打不开 3D 庙（需要 WebGL2）。', en: 'This browser cannot open the 3D temple (WebGL2 needed).', ja: 'このブラウザでは 3D の廟を開けません（WebGL2 が必要です）。', ko: '이 브라우저에서는 3D 사당을 열 수 없습니다 (WebGL2 필요).' },
  hint:      { 'zh-Hant': '拖曳畫面看四周，左下角搖桿走路', 'zh-Hans': '拖动画面看四周，左下角摇杆走路', en: 'Drag to look around. Use the stick at bottom left to walk.', ja: '画面をドラッグで見回し、左下のスティックで歩きます', ko: '화면을 끌어 둘러보고, 왼쪽 아래 스틱으로 걸으세요' },
  hintDesk:  { 'zh-Hant': '拖曳畫面看四周，WASD 或方向鍵走路', 'zh-Hans': '拖动画面看四周，WASD 或方向键走路', en: 'Drag to look around. WASD or the arrow keys to walk.', ja: 'ドラッグで見回し、WASD か矢印キーで歩きます', ko: '끌어서 둘러보고, WASD 또는 방향키로 걸으세요' },
  bow:       { 'zh-Hant': '參拜', 'zh-Hans': '参拜', en: 'Pay respects', ja: '参拝する', ko: '참배하기' },
  askPh:     { 'zh-Hant': '心中所問（可不填，會帶去解籤）', 'zh-Hans': '心中所问（可不填，会带去解签）', en: 'Your question (optional, it goes with you to the reading)', ja: '心の問い（任意。解籤に持っていきます）', ko: '마음속 물음 (선택, 해석으로 가져갑니다)' },
  shake:     { 'zh-Hant': '搖籤筒', 'zh-Hans': '摇签筒', en: 'Shake the tube', ja: '籤筒を振る', ko: '첨통 흔들기' },
  throw:     { 'zh-Hant': '擲筊', 'zh-Hans': '掷筊', en: 'Throw the blocks', ja: '筊を投げる', ko: '교배 던지기' },
  again:     { 'zh-Hant': '重新求籤', 'zh-Hans': '重新求签', en: 'Draw again', ja: 'もう一度引く', ko: '다시 뽑기' },
  read:      { 'zh-Hant': '請師父解籤', 'zh-Hans': '请师父解签', en: 'Have it read', ja: '解籤してもらう', ko: '해석 받기' },
  stick:     { 'zh-Hant': '第 {n} 籤', 'zh-Hans': '第 {n} 签', en: 'Stick {n}', ja: '第 {n} 番', ko: '제 {n} 첨' },
  sheng:     { 'zh-Hant': '聖筊', 'zh-Hans': '圣筊', en: 'Holy answer', ja: '聖筊', ko: '성교' },
  xiao:      { 'zh-Hant': '笑筊', 'zh-Hans': '笑筊', en: 'Laughing answer', ja: '笑筊', ko: '소교' },
  yin:       { 'zh-Hant': '陰筊', 'zh-Hans': '阴筊', en: 'Closed answer', ja: '陰筊', ko: '음교' },
  leave:     { 'zh-Hant': '起身走走', 'zh-Hans': '起身走走', en: 'Stand up and walk', ja: '立って歩く', ko: '일어나 걷기' },
  enterStatue: { 'zh-Hant': '進入神像', 'zh-Hans': '进入神像', en: 'Go inside the statue', ja: '像の中へ入る', ko: '신상 안으로' },
  approachStatue: { 'zh-Hant': '走到香爐前參拜，或從神像腳下的門上到頂部', 'zh-Hans': '走到香炉前参拜，或从神像脚下的门上到顶部', en: 'Walk to the incense burner to pay respects, or in at the door at his feet and up to the top', ja: '香炉の前で参拝を。足元の扉からは頂上へ', ko: '향로 앞에서 참배하거나, 발치의 문으로 꼭대기에 오르세요' },
  stairStep: { 'zh-Hant': '第 {n} 階 / {total}', 'zh-Hans': '第 {n} 阶 / {total}', en: 'Step {n} of {total}', ja: '{n} / {total} 段', ko: '{n} / {total} 계단' },
  climbHint: { 'zh-Hant': '往前推搖桿爬上去', 'zh-Hans': '往前推摇杆爬上去', en: 'Push the stick forward to climb', ja: 'スティックを前に倒して登る', ko: '스틱을 앞으로 밀어 오르기' },
  topRoom:   { 'zh-Hant': '神像帽頂 · 360° 觀景台，搖桿走一圈', 'zh-Hans': '神像帽顶 · 360° 观景台，摇杆走一圈', en: 'On top of his hat: a 360° deck. Walk around with the stick', ja: '像の帽子の上 · 360° 展望台、スティックで一周', ko: '신상의 모자 위 · 360° 전망대, 스틱으로 한 바퀴' },
  down:      { 'zh-Hant': '回到地面', 'zh-Hans': '回到地面', en: 'Back down', ja: '地上へ戻る', ko: '지상으로' },
  lobbyRoom: { 'zh-Hant': '神像內', 'zh-Hans': '神像内', en: 'Inside the statue', ja: '像の中', ko: '신상 안' },
  exitStatue: { 'zh-Hant': '離開', 'zh-Hans': '离开', en: 'Leave', ja: '外へ出る', ko: '나가기' },
  goTop:     { 'zh-Hant': '上到頂部', 'zh-Hans': '上到顶部', en: 'Up to the top', ja: '頂上へ', ko: '꼭대기로' },
}
