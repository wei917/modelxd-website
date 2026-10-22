// scripts/test-xoracle-seats.ts — the teacher seats while an answer is coming
// in (owner, Oct 1: "當一個模型在思考，中途加老師還是不work… 還不如在思考中
// 不讓新加老師"). Static checks on the room: while any teacher is answering
// (a question, or a teacher added to it), no seat can be added, replaced or
// removed, the 追加老師 row waits, and the page says why.
//   npx tsx scripts/test-xoracle-seats.ts

import fs from 'node:fs'
import path from 'node:path'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean) => { if (!cond) { fails++; console.log('FAIL', name) } else console.log('ok  ', name) }
const client = fs.readFileSync(path.join(__dirname, '..', 'app/xoracle/client.tsx'), 'utf8')
const css = fs.readFileSync(path.join(__dirname, '..', 'app/globals.css'), 'utf8')
const S = STRINGS as any

check('answering covers a question and a teacher added to it', client.includes('const answering = busy || joining.length > 0'))
check('the 追加老師 row waits until every reply is in', client.includes('const canJoin = !!lastUser?.qid && !unverified && !savedProblem && !answering'))
check('再請一位老師 is disabled while answering, and says why', /className="xoracle-seat-add" disabled=\{answering\}/.test(client) && client.includes("{answering && <p id=\"xoracle-seat-wait\" className=\"xoracle-seat-wait\">{t('xoracle.addmaster.wait')}</p>}"))
check('a seat cannot be replaced or removed while answering', /className="xoracle-seat-main"[^>]*disabled=\{answering\}/.test(client) && /className="xoracle-seat-act" title=\{t\('xoracle.site.remove'\)\}[^>]*disabled=\{answering\}/.test(client))
check('the seat row starts with a fixed 大師席位 label, outside its sideways scroll (owner, Oct 3)', /<span className="xoracle-row-label xoracle-row-label-seats">\{t\('xoracle\.row\.seats'\)\}<\/span>\s*<div style=\{\{ overflowX: 'auto', paddingBottom: 2, flex: 1, minWidth: 0 \}\}>/.test(client))
check('the 分頁 answer tabs start with a 回答 label, outside the tab list', /<span className="xoracle-row-label xoracle-row-label-tabs">\{t\('xoracle\.row\.answers'\)\}<\/span>\s*<div role="tablist" aria-label=\{t\('xoracle\.row\.answers'\)\}/.test(client))
check('問： uses the same label style and place as the other two rows', /<span className="xoracle-row-label xoracle-row-label-tabs">\{t\('xoracle\.ask\.to'\)\}<\/span>/.test(client) && !/<span style=\{\{ \.\.\.mono, color: 'var\(--muted2\)' \}\}>\{t\('xoracle\.ask\.to'\)\}<\/span>/.test(client))
check('disabled seat buttons look disabled', css.includes('.xoracle-seat-add:disabled, .xoracle-seat-main:disabled, .xoracle-seat-act:disabled'))
check('the reason in five languages', ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => typeof S['xoracle.addmaster.wait']?.[l] === 'string' && S['xoracle.addmaster.wait'][l].trim()))

// The address names a visit as soon as it is cast (owner, Oct 1).
check('a fresh cast puts ?reading=<id> in the address, not only a reopened one', client.includes("if (typeof d.readingId === 'string') setReadingParam(d.readingId)") && !client.includes("new URLSearchParams(window.location.search).get('reading')) setReadingParam(d.readingId)"))
console.log(fails ? `\n${fails} FAILED` : '\nall seat checks passed')
if (fails) process.exit(1)
