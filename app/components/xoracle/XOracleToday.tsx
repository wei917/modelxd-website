'use client'
// app/components/xoracle/XOracleToday.tsx — today's Chinese almanac (黃曆), the
// card beside the daily fortune at the top of the street (owner, Sep 27).
// Free: no birthday, no sign-in, no model. (A Panchang card sat beside it
// for a day and was removed by the owner.)
//
// Computed on the server (lib/xoracle-almanac-server.ts, Sep 28), never here:
// the page arrives with the card filled in for the visitor's own day, from
// the time zone their connection reports, so there is no 「載入中…」 and the
// browser never downloads the calendar library. After mount the phone's own
// zone decides: if its date (or the page's language) differs from what the
// server drew, the right day comes from /api/xoracle/almanac, and again when a
// tab comes back on a new day.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../../lib/i18n'
import type { Almanac } from '../../../lib/xoracle-almanac'
import { detectedZone, localDateIn } from '../../../lib/xoracle-time'
import { ShareButton } from './ShareButton'
import XOracleClamp from './XOracleClamp'


/** The visitor's own date, read after mount and again when the tab comes
 *  back (a new local day means a new almanac). Null before mount. */
function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { const d = localDateIn(detectedZone()); setToday(t => t === d ? t : d) }
    read()
    const onShow = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow) }
  }, [])
  return today
}

const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s)

/** `initial`: the server's almanac for this visitor's day in the page's
 *  language, or null when the server could not tell the zone. `compact`
 *  (the homepage's card row, Oct 3): everything, 宜 / 忌 first, in a box of
 *  four lines with 更多 for the rest (XOracleClamp); nothing dropped. */
export function AlmanacCard({ initial = null, compact = false }: { initial?: Almanac | null; compact?: boolean }) {
  const { lang, t } = useLang()
  const today = useToday()
  const [data, setData] = useState<Almanac | null>(initial)
  // The language `data` is in: the page's, as the server drew it.
  const dataLang = useRef(lang)
  // The day could not be fetched (twice). With the server's day already on
  // screen the card simply keeps it; with nothing, it says so and offers a
  // retry instead of 「載入中…」 forever.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!today || (data && data.date === today && dataLang.current === lang)) return
    let live = true
    const get = () => fetch(`/api/xoracle/almanac?date=${today}&lang=${encodeURIComponent(lang)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!d?.almanac) throw new Error('empty'); return d.almanac as Almanac })
    setFailed(false)
    get()
      .catch(() => new Promise<Almanac>((resolve, reject) => setTimeout(() => get().then(resolve, reject), 1500)))
      .then(a => { if (live) { dataLang.current = lang; setData(a) } })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [today, lang, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  const md = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${m}/${d}` }
  const dateLabel = (ymd: string) => new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`))
  const share = data && <ShareButton className="xoracle-dy-share" spec={() => ({ icon: null, link: null, title: t('xoracle.today.almanac'),
    kicker: `${dateLabel(data.date)} · ${fill(t('xoracle.today.lunar'), { date: data.lunarDate })}`,
    body: [`${t('xoracle.today.yi')}　${data.yi.join('、') || '—'}`, `${t('xoracle.today.ji')}　${data.ji.join('、') || '—'}`,
      fill(t('xoracle.today.chong'), { animal: data.chong.animal, gz: data.chong.ganzhi, dir: data.sha })],
    style: 'prose', name: `xoracle-almanac-${data.date}`, log: { kind: 'almanac' } })} />
  const waiting = failed
    ? <p className="xoracle-dy-small" role="alert">{t('xoracle.today.failed')} <button type="button" className="xoracle-dy-link" onClick={() => setAttempt(n => n + 1)}>{t('xoracle.site.retry')}</button></p>
    : <p className="xoracle-dy-small">{t('common.loading')}</p>
  const yiji = data && (
    <dl className="xoracle-td-yiji">
      <div className="is-yi"><dt>{t('xoracle.today.yi')}</dt><dd>{data.yi.join('、') || '—'}</dd></div>
      <div className="is-ji"><dt>{t('xoracle.today.ji')}</dt><dd>{data.ji.join('、') || '—'}</dd></div>
    </dl>
  )
  const details = data && <>
    <p className="xoracle-td-date">
      <strong>{dateLabel(data.date)}</strong>
      <span>{fill(t('xoracle.today.lunar'), { date: data.lunarDate })} · {fill(t('xoracle.today.yearGz'), { gz: data.yearGz, animal: data.animal })} · {fill(t('xoracle.today.dayGz'), { gz: data.dayGz })}{data.rokuyo ? ` · ${data.rokuyo}` : ''}</span>
    </p>
    {/* Japanese pages: the lucky days a Japanese calendar marks (Sep 29). */}
    {data.luckyDays && data.luckyDays.length > 0 && <p className="xoracle-td-lucky">{fill(t('xoracle.today.luckyDays'), { days: data.luckyDays.join('・') })}</p>}
  </>
  const facts = data && (
    <ul className="xoracle-td-facts">
      <li>{fill(t('xoracle.today.chong'), { animal: data.chong.animal, gz: data.chong.ganzhi, dir: data.sha })}</li>
      <li>{fill(t('xoracle.today.zhiXing'), { x: data.zhiXing })}</li>
      <li>{fill(t('xoracle.today.jieQi'), { now: data.jieQi.name, nowDate: md(data.jieQi.date), next: data.nextJieQi.name, nextDate: md(data.nextJieQi.date) })}</li>
      <li>{fill(t('xoracle.today.tianShen'), { x: data.tianShen.name, luck: t(data.tianShen.lucky ? 'xoracle.today.lucky' : 'xoracle.today.unlucky') })}</li>
      <li>{fill(t('xoracle.today.xiu'), { x: data.xiu.name, luck: t(data.xiu.lucky ? 'xoracle.today.lucky' : 'xoracle.today.unlucky') })}</li>
      {data.jiShen.length > 0 && <li>{t('xoracle.today.jiShen')}：{data.jiShen.join('、')}</li>}
      {data.xiongSha.length > 0 && <li>{t('xoracle.today.xiongSha')}：{data.xiongSha.join('、')}</li>}
      <li>{t('xoracle.today.pengZu')}：{data.pengZu.join('；')}</li>
    </ul>
  )
  // The homepage card (owner, Oct 3): the lunar day on top (農曆八月廿三 ·
  // 丙午年（屬馬） · 庚戌日), then 宜, 忌 and every fact in five lines with 更多
  // for the rest. The Gregorian date is on the daily card beside it.
  const lunarLine = data && `${fill(t('xoracle.today.lunar'), { date: data.lunarDate })} · ${fill(t('xoracle.today.yearGz'), { gz: data.yearGz, animal: data.animal })} · ${fill(t('xoracle.today.dayGz'), { gz: data.dayGz })}${data.rokuyo ? ` · ${data.rokuyo}` : ''}`
  if (compact) return (
    <section id="xoracle-almanac" className="xoracle-td xoracle-home-card" aria-labelledby="xoracle-almanac-title">
      <div className="xoracle-home-card-head">
        <h2 id="xoracle-almanac-title" className="xoracle-home-card-title">{t('xoracle.today.almanac')}</h2>
        {share}
      </div>
      <p className="xoracle-home-date">{lunarLine ?? '\u00a0'}</p>
      <XOracleClamp>{!data ? waiting : <>{yiji}{data.luckyDays && data.luckyDays.length > 0 && <p className="xoracle-td-lucky">{fill(t('xoracle.today.luckyDays'), { days: data.luckyDays.join('・') })}</p>}{facts}</>}</XOracleClamp>
    </section>
  )
  return (
    <section id="xoracle-almanac" className="xoracle-td" aria-labelledby="xoracle-almanac-title">
      <div className="xoracle-dy-head">
        <h2 id="xoracle-almanac-title" className="xoracle-dy-title">{t('xoracle.today.almanac')}</h2>
        {share}
      </div>
      <p className="xoracle-dy-sub">{t('xoracle.today.almanacSub')}</p>
      {!data ? waiting : <>{details}{yiji}{facts}</>}
    </section>
  )
}
