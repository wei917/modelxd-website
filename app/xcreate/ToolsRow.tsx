'use client'
// app/xcreate/ToolsRow.tsx: the 工具 section under Generate on the X創作
// door's Image tab (Oct 3; owner: "blackbox mode that we control, which is
// what Pollo.ai does"). One-tap tools that write their own prompt
// (lib/xcreate-tools.ts); a tap turns the studio's prompt box into the tool
// (client.tsx, tool mode), and the open tool's card is marked.
// Category chips filter one sideways row. Phone first: the row runs to the
// screen edge and scrolls; from 761px it wraps (the .xcs-tool-strip rules).

import { useState } from 'react'
import { useLang } from '@/lib/i18n'
import { XTOOLS, TOOL_CATEGORIES, type ToolCategory, type XTool } from '@/lib/xcreate-tools'

export default function ToolsRow({ activeId, onOpen }: { activeId: string | null; onOpen: (tool: XTool) => void }) {
  const { t } = useLang()
  const [cat, setCat] = useState<ToolCategory | 'all'>('all')
  const [broken, setBroken] = useState<Record<string, true>>({})
  const tools = cat === 'all' ? XTOOLS : XTOOLS.filter(x => x.category === cat)

  return (
    <section className="xcs-sec" aria-label={t('xtools.title')}>
      <div className="xcs-sec-head">
        <h2>{t('xtools.title')}<span className="xtools-beta">{t('xtools.beta')}</span></h2>
      </div>
      <div className="xtools-cats" role="tablist" aria-label={t('xtools.title')}>
        {(['all', ...TOOL_CATEGORIES] as const).map(c => (
          <button key={c} type="button" role="tab" aria-selected={cat === c}
            className={`xtools-cat${cat === c ? ' is-on' : ''}`} onClick={() => setCat(c)}>
            {t('xtools.cat.' + c)}
          </button>
        ))}
      </div>
      <div className="xcs-tool-strip">
        {tools.map(tool => (
          <button type="button" key={tool.id} className={`xcs-tool${tool.id === activeId ? ' is-on' : ''}`}
            aria-current={tool.id === activeId ? 'true' : undefined} onClick={() => onOpen(tool)}>
            <span className="xcs-tool-img">
              {tool.preview && !broken[tool.id]
                ? <img src={tool.preview} alt="" loading="lazy" onError={() => setBroken(b => ({ ...b, [tool.id]: true }))} />
                : <span className="xcs-tool-emoji" aria-hidden>{tool.emoji}</span>}
            </span>
            <span className="xcs-tool-text">
              <b>{t(`xtool.${tool.id}.name`)}</b>
              <small>{t(`xtool.${tool.id}.sub`)}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
