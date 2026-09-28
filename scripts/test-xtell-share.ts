// scripts/test-xtell-share.ts — the text half of 分享 (lib/xtell-share.ts):
// the link a share carries, and what of a teacher's reply may go on the picture.
//   npx tsx scripts/test-xtell-share.ts

import { dropDates, maskDates, plainParagraphs, shareExcerpt, shareUrl } from '../lib/xtell-share'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

check('link: the temple, the referral code, the share tag', shareUrl('https://xtell.modelxd.com', 'guandi', 'ABC123') === 'https://xtell.modelxd.com/?t=guandi&ref=ABC123&utm_source=share')
check('link: no temple is the street; a malformed code is left off', shareUrl('http://localhost:3001', null, 'bad code!') === 'http://localhost:3001/?utm_source=share')

const masked = maskDates('你生於1990年5月3日早上3點15分，即1990-05-03 03:15；5月3日。1990년 5월 3일. Born May 3, 1990, or 3 May 1990.')
check('dates and clock times never reach the picture', !/\d/.test(masked), masked)
check('ordinary numbers stay (第23籤, 3 件事)', maskDates('第23籤，留意 3 件事。') === '第23籤，留意 3 件事。')
check('a clause with the birth in it is left out, not masked', dropDates('你的日主為甲木，生於1990年5月3日早上3點15分，春末木氣仍旺。') === '你的日主為甲木，春末木氣仍旺。', dropDates('你的日主為甲木，生於1990年5月3日早上3點15分，春末木氣仍旺。'))
check('a dropped sentence end is handed back', dropDates('今年是好年，你生於1990年5月3日。明年更好。') === '今年是好年。明年更好。', dropDates('今年是好年，你生於1990年5月3日。明年更好。'))
check('a date across a comma is still masked', !/\d{4}/.test(dropDates('Born on May 3, 1990, you are steady.')))

check('markdown is read as words; headings, tables and rules left out',
  JSON.stringify(plainParagraphs('## 總論\n\n**甲木**日主，[參考](http://x)。\n\n| a | b |\n|---|---|\n\n---\n\n- 感情\n- 財運')) === JSON.stringify(['甲木日主，參考。', '・感情\n・財運']))

const long = '今年流年丙午，木火通明。' + '事業上有貴人相助，宜把握機會。'.repeat(20)
const ex = shareExcerpt('你生於1990年5月3日。\n\n' + long, 150)
check('excerpt: a paragraph that was only the birth date is gone; cut at a sentence end within the limit', !ex.join('').includes('生於') && /。$/.test(ex[ex.length - 1]) && ex.join('').length <= 160, JSON.stringify(ex))
check('excerpt: a short reply is kept whole', JSON.stringify(shareExcerpt('好運。\n\n平安。')) === JSON.stringify(['好運。', '平安。']))

console.log(fails ? `\n${fails} FAILED` : '\nall share checks passed')
if (fails) process.exit(1)
