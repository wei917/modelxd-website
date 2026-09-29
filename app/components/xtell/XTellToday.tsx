'use client'
// app/components/xtell/XTellToday.tsx — today's Chinese almanac (黃曆), the
// card beside the daily fortune at the top of the street (owner, Sep 27).
// Free: no birthday, no sign-in, no model. (A Panchang card sat beside it
// for a day and was removed by the owner.)
//
// Computed on the server (lib/xtell-almanac-server.ts, Sep 28), never here:
// the page arrives with the card filled in for the visitor's own day, from
// the time zone their connection reports, so there is no 「載入中…」 and the
// browser never downloads the calendar library. After mount the phone's own
// zone decides: if its date (or the page's language) differs from what the
// server drew, the right day comes from /api/xtell/almanac, and again when a
// tab comes back on a new day.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../../lib/i18n'
import type { Almanac } from '../../../lib/xtell-almanac'
import { detectedZone, localDateIn } from '../../../lib/xtell-time'
import { ShareButton } from './ShareButton'


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
 *  language, or null when the server could not tell the zone. */
export function AlmanacCard({ initial = null }: { initial?: Almanac | null }) {
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
    const get = () => fetch(`/api/xtell/almanac?date=${today}&lang=${encodeURIComponent(lang)}`)
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
  return (
    <section id="xtell-almanac" className="xtell-td" aria-labelledby="xtell-almanac-title">
      <div className="xtell-dy-head">
        <h2 id="xtell-almanac-title" className="xtell-dy-title">{t('xtell.today.almanac')}</h2>
        {data && <ShareButton className="xtell-dy-share" spec={() => ({ icon: null, link: null, title: t('xtell.today.almanac'),
          kicker: `${dateLabel(data.date)} · ${fill(t('xtell.today.lunar'), { date: data.lunarDate })}`,
          body: [`${t('xtell.today.yi')}　${data.yi.join('、') || '—'}`, `${t('xtell.today.ji')}　${data.ji.join('、') || '—'}`,
            fill(t('xtell.today.chong'), { animal: data.chong.animal, gz: data.chong.ganzhi, dir: data.sha })],
          style: 'prose', name: `xtell-almanac-${data.date}` })} />}
      </div>
      <p className="xtell-dy-sub">{t('xtell.today.almanacSub')}</p>
      {!data ? (failed
        ? <p className="xtell-dy-small" role="alert">{t('xtell.today.failed')} <button type="button" onClick={() => setAttempt(n => n + 1)} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--red)', fontWeight: 700, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>{t('xtell.site.retry')}</button></p>
        : <p className="xtell-dy-small">{t('common.loading')}</p>) : <>
        <p className="xtell-td-date">
          <strong>{dateLabel(data.date)}</strong>
          <span>{fill(t('xtell.today.lunar'), { date: data.lunarDate })} · {fill(t('xtell.today.yearGz'), { gz: data.yearGz, animal: data.animal })} · {fill(t('xtell.today.dayGz'), { gz: data.dayGz })}{data.rokuyo ? ` · ${data.rokuyo}` : ''}</span>
        </p>
        {/* Japanese pages: the lucky days a Japanese calendar marks (Sep 29). */}
        {data.luckyDays && data.luckyDays.length > 0 && <p className="xtell-td-lucky">{fill(t('xtell.today.luckyDays'), { days: data.luckyDays.join('・') })}</p>}
        <dl className="xtell-td-yiji">
          <div className="is-yi"><dt>{t('xtell.today.yi')}</dt><dd>{data.yi.join('、') || '—'}</dd></div>
          <div className="is-ji"><dt>{t('xtell.today.ji')}</dt><dd>{data.ji.join('、') || '—'}</dd></div>
        </dl>
        <ul className="xtell-td-facts">
          <li>{fill(t('xtell.today.chong'), { animal: data.chong.animal, gz: data.chong.ganzhi, dir: data.sha })}</li>
          <li>{fill(t('xtell.today.zhiXing'), { x: data.zhiXing })}</li>
          <li>{fill(t('xtell.today.jieQi'), { now: data.jieQi.name, nowDate: md(data.jieQi.date), next: data.nextJieQi.name, nextDate: md(data.nextJieQi.date) })}</li>
          <li>{fill(t('xtell.today.tianShen'), { x: data.tianShen.name, luck: t(data.tianShen.lucky ? 'xtell.today.lucky' : 'xtell.today.unlucky') })}</li>
          <li>{fill(t('xtell.today.xiu'), { x: data.xiu.name, luck: t(data.xiu.lucky ? 'xtell.today.lucky' : 'xtell.today.unlucky') })}</li>
          {data.jiShen.length > 0 && <li>{t('xtell.today.jiShen')}：{data.jiShen.join('、')}</li>}
          {data.xiongSha.length > 0 && <li>{t('xtell.today.xiongSha')}：{data.xiongSha.join('、')}</li>}
          <li>{t('xtell.today.pengZu')}：{data.pengZu.join('；')}</li>
        </ul>
      </>}
    </section>
  )
}
