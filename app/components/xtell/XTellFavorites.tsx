'use client'
// app/components/xtell/XTellFavorites.tsx — 我的常用 on the homepage (Oct 3,
// Concept 24): the temples a visitor pins, with their original icons, as
// real links in. Add, remove and reorder (buttons, so a keyboard can do it
// too). Kept on this device in v1 (lib/xtell-favorites.ts): empty to start,
// never pre-filled; blocked storage keeps the list for this visit and says so.

import { useEffect, useId, useState } from 'react'
import { useLang } from '../../../lib/i18n'
import { TempleArtwork, displayTemples, type TempleKey } from './TempleArtwork'
import { TEMPLES } from './TempleStreet'
import { loadFavorites, saveFavorites, deviceStore, addFavorite, removeFavorite, moveFavorite } from '../../../lib/xtell-favorites'

export default function XTellFavorites() {
  const { lang, t } = useLang()
  const titleId = useId()
  // null until mounted: the list lives in this browser, not on the server.
  const [list, setList] = useState<TempleKey[] | null>(null)
  const [stored, setStored] = useState(true)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    const { list, ok } = loadFavorites(deviceStore(), TEMPLES)
    setList(list); setStored(ok)
  }, [])
  const update = (next: TempleKey[]) => {
    setList(next)
    setStored(saveFavorites(deviceStore(), next))
    // Removing the last one ends editing, so 新增 comes back at once.
    if (next.length === 0) setEditing(false)
  }
  const short = (k: TempleKey) => t('xtell.site.focus.' + k + '.short')
  const name = (k: TempleKey) => t('xtell.site.focus.' + k + '.name')
  const fill = (key: string, k: TempleKey) => t(key).replace('{temple}', name(k))
  const unpinned = list ? displayTemples(lang).filter(k => !list.includes(k)) : []

  return (
    <section className="xtell-home-card xtell-fav" aria-labelledby={titleId}>
      <div className="xtell-home-card-head">
        <h2 id={titleId} className="xtell-home-card-title"><span className="xtell-fav-star" aria-hidden="true">★</span>{t('xtell.fav.title')}</h2>
        {list && (list.length > 0 || editing) && (
          <button type="button" className="xtell-home-link" aria-pressed={editing} onClick={() => { setEditing(e => !e); setAdding(false) }}>
            {t(editing ? 'xtell.fav.done' : 'xtell.fav.edit')}
          </button>
        )}
      </div>

      {list === null ? <p className="xtell-dy-small">{t('common.loading')}</p> : <>
        {list.length === 0 && !adding && <p className="xtell-fav-empty">{t('xtell.fav.empty')}</p>}
        <ul className={'xtell-fav-grid' + (editing ? ' is-editing' : '')}>
          {list.map((k, i) => (
            <li key={k}>
              {editing ? (
                <div className="xtell-fav-tile is-editing">
                  <TempleArtwork temple={k} kind="icon" clear className="xtell-fav-icon" />
                  <span className="xtell-fav-name">{short(k)}</span>
                  <span className="xtell-fav-tools">
                    <button type="button" aria-label={fill('xtell.fav.left', k)} disabled={i === 0} onClick={() => update(moveFavorite(list, k, -1))}>‹</button>
                    <button type="button" aria-label={fill('xtell.fav.remove', k)} onClick={() => update(removeFavorite(list, k))}>×</button>
                    <button type="button" aria-label={fill('xtell.fav.right', k)} disabled={i === list.length - 1} onClick={() => update(moveFavorite(list, k, 1))}>›</button>
                  </span>
                </div>
              ) : (
                <a className="xtell-fav-tile" href={'/#' + k} aria-label={name(k)}>
                  <TempleArtwork temple={k} kind="icon" clear className="xtell-fav-icon" />
                  <span className="xtell-fav-name">{short(k)}</span>
                </a>
              )}
            </li>
          ))}
          {!editing && (
            <li>
              <button type="button" className="xtell-fav-tile is-add" aria-expanded={adding} onClick={() => setAdding(a => !a)}>
                <span className="xtell-fav-plus" aria-hidden="true">＋</span>
                <span className="xtell-fav-name">{t('xtell.fav.add')}</span>
              </button>
            </li>
          )}
        </ul>
        {adding && (
          <div className="xtell-fav-add" role="group" aria-label={t('xtell.fav.addTitle')}>
            <p className="xtell-fav-add-title">{t('xtell.fav.addTitle')}</p>
            {unpinned.length === 0 ? <p className="xtell-dy-small">{t('xtell.fav.allPinned')}</p> : (
              <ul className="xtell-fav-pick">
                {unpinned.map(k => (
                  <li key={k}>
                    <button type="button" onClick={() => update(addFavorite(list, k))} aria-label={`${t('xtell.fav.add')} ${name(k)}`}>
                      <TempleArtwork temple={k} kind="icon" clear className="xtell-fav-icon" />
                      <span>{short(k)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="xtell-home-link" onClick={() => setAdding(false)}>{t('xtell.fav.done')}</button>
          </div>
        )}
        <p className="xtell-fav-note">{t(stored ? 'xtell.fav.device' : 'xtell.fav.noStore')}</p>
      </>}
    </section>
  )
}
