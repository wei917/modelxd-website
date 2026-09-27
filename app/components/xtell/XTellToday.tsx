'use client'
// app/components/xtell/XTellToday.tsx — two of the street's three "today"
// cards (owner, Sep 27), beside the daily fortune: today's Chinese almanac
// (黃曆) and today's Indian calendar (Panchang). Both are computed here in
// the browser from the visitor's own date and zone: free, no birthday, no
// sign-in, no model.
//
// The Panchang's sunrise, sunset and Rahu Kalam need a place. There is no
// default city (owner, Sep 27): the card asks, either the browser's own
// location (it asks permission; rounded to about 10 km) or a city from the
// list, and keeps the answer in this browser only. Until then it shows the
// limbs that are the same everywhere.
//
// Computed after mount, never during render: the server does not know the
// visitor's date, zone or place, and a first render that disagreed with the
// browser's would break hydration.

import { useEffect, useState } from 'react'
import { useLang } from '../../../lib/i18n'
import { almanacFor, type Almanac } from '../../../lib/xtell-almanac'
import { panchangAt, sunDay, type PanchangNow, type SunDay } from '../../../lib/panchang'
import { detectedZone, localDateIn } from '../../../lib/xtell-time'
import { PLACES, placeOf } from '../../../lib/xtell-places'

const PLACE_KEY = 'xtell.today.place'
const SHOWN = 8
const RULER = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']

/** Refresh when the tab comes back: a new local day means a new almanac. */
function useToday(): { date: string; tz: string; now: Date } | null {
  const [today, setToday] = useState<{ date: string; tz: string; now: Date } | null>(null)
  useEffect(() => {
    const read = () => { const tz = detectedZone(); setToday({ date: localDateIn(tz), tz, now: new Date() }) }
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

type Where = { k: 'geo'; lat: number; lon: number } | { k: 'city'; key: string }

function readWhere(): Where | null {
  try {
    const w = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null')
    if (w?.k === 'geo' && Number.isFinite(w.lat) && Number.isFinite(w.lon) && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180) return { k: 'geo', lat: w.lat, lon: w.lon }
    if (w?.k === 'city' && placeOf(w.key)) return { k: 'city', key: w.key }
  } catch { /* unreadable or blocked: ask again */ }
  return null
}

export function PanchangCard() {
  const { lang, t } = useLang()
  const today = useToday()
  const [now, setNow] = useState<PanchangNow | null>(null)
  const [where, setWhere] = useState<Where | null>(null)
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState<'idle' | 'locating' | 'failed'>('idle')
  useEffect(() => { setWhere(readWhere()) }, [])
  useEffect(() => { if (today) setNow(panchangAt(today.now)) }, [today])

  const save = (w: Where) => {
    setWhere(w); setAsking(false); setStatus('idle')
    try { localStorage.setItem(PLACE_KEY, JSON.stringify(w)) } catch { /* this visit only */ }
  }
  const locate = () => {
    if (!navigator.geolocation) { setStatus('failed'); return }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      p => save({ k: 'geo', lat: Math.round(p.coords.latitude * 10) / 10, lon: Math.round(p.coords.longitude * 10) / 10 }),
      () => setStatus('failed'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600_000 },
    )
  }

  // A picked city is read in its own zone, every time on the card included;
  // the browser's location, or no place yet, in the browser's zone.
  const city = where?.k === 'city' ? placeOf(where.key) : null
  const zone = city?.tz ?? today?.tz ?? 'UTC'
  const sun: SunDay | null = today && where
    ? (where.k === 'geo' ? sunDay(localDateIn(zone), zone, where.lat, where.lon) : city ? sunDay(localDateIn(zone), zone, city.lat, city.lon) : null)
    : null
  const time = (d: Date, z = zone) => {
    const sameDay = localDateIn(z, d.getTime()) === localDateIn(z)
    return new Intl.DateTimeFormat(lang, { timeZone: z, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(sameDay ? {} : { month: 'numeric', day: 'numeric' }) }).format(d)
  }
  const until = (d: Date) => fill(t('xtell.today.until'), { time: time(d) })
  const zh = lang !== 'en'

  return (
    <section id="xtell-panchang" className="xtell-td" aria-labelledby="xtell-panchang-title">
      <div className="xtell-dy-head">
        <h2 id="xtell-panchang-title" className="xtell-dy-title">{t('xtell.today.panchang')}</h2>
      </div>
      <p className="xtell-dy-sub">{t('xtell.today.panchangSub')}</p>
      {!now ? <p className="xtell-dy-small">{t('common.loading')}</p> : <>
        <dl className="xtell-td-limbs">
          <div><dt>{t('xtell.today.tithi')}</dt><dd>
            {now.tithi.day === 15
              ? `${t(now.tithi.waxing ? 'xtell.today.purnima' : 'xtell.today.amavasya')} · ${now.tithi.name}`
              : `${fill(t('xtell.today.tithiDay'), { paksha: t(now.tithi.waxing ? 'xtell.today.waxing' : 'xtell.today.waning'), n: now.tithi.day })} · ${now.tithi.name}`}
            <small>{until(now.tithi.ends)}</small></dd></div>
          <div><dt>{t('xtell.today.nakshatra')}</dt><dd>{zh ? `${now.nakshatra.zh}宿 · ${now.nakshatra.sa}` : now.nakshatra.sa}<small>{until(now.nakshatra.ends)}</small></dd></div>
          <div><dt>{t('xtell.today.yoga')}</dt><dd>{now.yoga.name}<small>{until(now.yoga.ends)}</small></dd></div>
          <div><dt>{t('xtell.today.karana')}</dt><dd>{now.karana.name}<small>{until(now.karana.ends)}</small></dd></div>
          {today && <div><dt>{t('xtell.today.vara')}</dt><dd>{t('xtell.pl.' + RULER[new Date(`${localDateIn(zone)}T12:00:00Z`).getUTCDay()])}</dd></div>}
        </dl>

        {where && !asking ? (
          <div className="xtell-td-sun">
            <p className="xtell-dy-small">
              {fill(t('xtell.today.at'), { place: city ? city.label : t('xtell.today.myPlace') })}{' '}
              <button type="button" className="xtell-dy-link" onClick={() => setAsking(true)}>{t('xtell.today.change')}</button>
            </p>
            {sun?.rahu && sun.sunrise && sun.sunset ? <>
              <p className="xtell-td-rahu"><strong>{t('xtell.today.rahu')}</strong> {time(sun.rahu[0], zone)}–{time(sun.rahu[1], zone)}<small>{t('xtell.today.rahuNote')}</small></p>
              <p className="xtell-dy-small">{fill(t('xtell.today.sun'), { rise: time(sun.sunrise, zone), set: time(sun.sunset, zone) })}</p>
            </> : <p className="xtell-dy-small">{t('xtell.today.noSun')}</p>}
          </div>
        ) : (
          <div className="xtell-td-where">
            <p>{t('xtell.today.where')}</p>
            <div className="xtell-dy-row">
              <button type="button" className="xtell-dy-secondary" onClick={locate} disabled={status === 'locating'}>{status === 'locating' ? t('xtell.today.locating') : t('xtell.today.useMine')}</button>
              <select className="xtell-dy-select" aria-label={t('xtell.today.pickCity')} value="" onChange={e => { if (e.target.value) save({ k: 'city', key: e.target.value }) }}>
                <option value="">{t('xtell.today.pickCity')}</option>
                {PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            {status === 'failed' && <p className="xtell-dy-warn" role="alert">{t('xtell.today.geoFail')}</p>}
            <p className="xtell-dy-small">{t('xtell.today.localOnly')}</p>
          </div>
        )}
        <a className="xtell-td-link" href="/#navagraha">{t('xtell.today.toTemple')}</a>
      </>}
    </section>
  )
}
