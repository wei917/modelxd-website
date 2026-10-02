// scripts/test-xtell-seats.ts — the teacher seats while an answer is coming
// in (owner, Oct 1: "當一個模型在思考，中途加老師還是不work… 還不如在思考中
// 不讓新加老師"). Static checks on the room: while any teacher is answering
// (a question, or a teacher added to it), no seat can be added, replaced or
// removed, the 追加老師 row waits, and the page says why.
//   npx tsx scripts/test-xtell-seats.ts

import fs from 'node:fs'
import path from 'node:path'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean) => { if (!cond) { fails++; console.log('FAIL', name) } else console.log('ok  ', name) }
const client = fs.readFileSync(path.join(__dirname, '..', 'app/xtell/client.tsx'), 'utf8')
const css = fs.readFileSync(path.join(__dirname, '..', 'app/globals.css'), 'utf8')
const S = STRINGS as any

check('answering covers a question and a teacher added to it', client.includes('const answering = busy || joining.length > 0'))
check('the 追加老師 row waits until every reply is in', client.includes('const canJoin = !!lastUser?.qid && !unverified && !savedProblem && !answering'))
check('再請一位老師 is disabled while answering, and says why', /className="xtell-seat-add" disabled=\{answering\}/.test(client) && client.includes("{answering && <p id=\"xtell-seat-wait\" className=\"xtell-seat-wait\">{t('xtell.addmaster.wait')}</p>}"))
check('a seat cannot be replaced or removed while answering', /className="xtell-seat-main"[^>]*disabled=\{answering\}/.test(client) && /className="xtell-seat-act" title=\{t\('xtell.site.remove'\)\}[^>]*disabled=\{answering\}/.test(client))
check('disabled seat buttons look disabled', css.includes('.xtell-seat-add:disabled, .xtell-seat-main:disabled, .xtell-seat-act:disabled'))
check('the reason in five languages', ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => typeof S['xtell.addmaster.wait']?.[l] === 'string' && S['xtell.addmaster.wait'][l].trim()))

// The address names a visit as soon as it is cast (owner, Oct 1).
check('a fresh cast puts ?reading=<id> in the address, not only a reopened one', client.includes("if (typeof d.readingId === 'string') setReadingParam(d.readingId)") && !client.includes("new URLSearchParams(window.location.search).get('reading')) setReadingParam(d.readingId)"))
console.log(fails ? `\n${fails} FAILED` : '\nall seat checks passed')
if (fails) process.exit(1)
