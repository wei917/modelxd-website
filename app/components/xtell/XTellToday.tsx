'use client'
// app/components/xtell/XTellToday.tsx — today's Chinese almanac (黃曆), the
// card beside the daily fortune at the top of the street (owner, Sep 27).
// Computed here in the browser from the visitor's own date: free, no
// birthday, no sign-in, no model. (A Panchang card sat beside it for a day
// and was removed by the owner.)
//
// Computed after mount, never during render: the server does not know the
// visitor's date or zone, and a first render that disagreed with the
// browser's would break hydration.

import { useEffect, useState } from 'react'
import { useLang } from '../../../lib/i18n'
import { almanacFor, type Almanac } from '../../../lib/xtell-almanac'
import { detectedZone, localDateIn } from '../../../lib/xtell-time'

const SHOWN = 8

/** Refresh when the tab comes back: a new local day means a new almanac. */
function useToday(): { date: string; tz: string } | null {
  const [today, setToday] = useState<{ date: string; tz: string } | null>(null)
  useEffect(() => {
    const read = () => { const tz = detectedZone(); setToday(t => t && t.date === localDateIn(tz) && t.tz === tz ? t : { date: localDateIn(tz), tz }) }
    read()
    const onShow = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow) }
  }, [])
  return today
}

const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s)

export function AlmanacCard() {
  const { lang, t } = useLang()
  const today = useToday()
  const [data, setData] = useState<Almanac | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => { if (today) setData(almanacFor(today.date, lang)) }, [today?.date, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = (xs: string[]) => all ? xs : xs.slice(0, SHOWN)
  const md = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${m}/${d}` }
  return (
    <section id="xtell-almanac" className="xtell-td" aria-labelledby="xtell-almanac-title">
      <div className="xtell-dy-head">
        <h2 id="xtell-almanac-title" className="xtell-dy-title">{t('xtell.today.almanac')}</h2>
      </div>
      <p className="xtell-dy-sub">{t('xtell.today.almanacSub')}</p>
      {!data ? <p className="xtell-dy-small">{t('common.loading')}</p> : <>
        <p className="xtell-td-date">
          <strong>{new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${data.date}T12:00:00Z`))}</strong>
          <span>{fill(t('xtell.today.lunar'), { date: data.lunarDate })} · {fill(t('xtell.today.yearGz'), { gz: data.yearGz, animal: data.animal })} · {fill(t('xtell.today.dayGz'), { gz: data.dayGz })}</span>
        </p>
        <dl className="xtell-td-yiji">
          <div className="is-yi"><dt>{t('xtell.today.yi')}</dt><dd>{list(data.yi).join('、') || '—'}</dd></div>
          <div className="is-ji"><dt>{t('xtell.today.ji')}</dt><dd>{list(data.ji).join('、') || '—'}</dd></div>
        </dl>
        {(data.yi.length > SHOWN || data.ji.length > SHOWN) && (
          <button type="button" className="xtell-dy-link" onClick={() => setAll(a => !a)} aria-expanded={all}>
            {all ? t('xtell.today.showLess') : fill(t('xtell.today.showAll'), { n: data.yi.length + data.ji.length })}
          </button>
        )}
        <ul className="xtell-td-facts">
          <li>{fill(t('xtell.today.chong'), { animal: data.chong.animal, gz: data.chong.ganzhi, dir: data.sha })}</li>
          <li>{fill(t('xtell.today.zhiXing'), { x: data.zhiXing })}</li>
          <li>{fill(t('xtell.today.jieQi'), { now: data.jieQi.name, nowDate: md(data.jieQi.date), next: data.nextJieQi.name, nextDate: md(data.nextJieQi.date) })}</li>
        </ul>
        <details className="xtell-dy-why">
          <summary>{t('xtell.today.more')}</summary>
          <ul className="xtell-td-facts">
            <li>{fill(t('xtell.today.tianShen'), { x: data.tianShen.name, luck: t(data.tianShen.lucky ? 'xtell.today.lucky' : 'xtell.today.unlucky') })}</li>
            <li>{fill(t('xtell.today.xiu'), { x: data.xiu.name, luck: t(data.xiu.lucky ? 'xtell.today.lucky' : 'xtell.today.unlucky') })}</li>
            {data.jiShen.length > 0 && <li>{t('xtell.today.jiShen')}：{data.jiShen.join('、')}</li>}
            {data.xiongSha.length > 0 && <li>{t('xtell.today.xiongSha')}：{data.xiongSha.join('、')}</li>}
            <li>{t('xtell.today.pengZu')}：{data.pengZu.join('；')}</li>
          </ul>
        </details>
      </>}
    </section>
  )
}
