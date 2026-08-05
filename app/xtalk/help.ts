// app/xtalk/help.ts
// "How to play / how it works" content, as data.
//
// Deliberately NOT in templates.ts: that file imports the room components,
// and the room components need to render a help link themselves. Importing
// the registry from inside a room would close the loop
// (WerewolfLive → templates → WerewolfLive). Keeping the copy in its own
// module with no React imports breaks that cycle and keeps the rules in one
// place, which matters because they are the only description of the game a
// first-time player ever reads. (CC, Aug 5)

export type HelpSection = { headKey: string; bodyKey: string }

export type TemplateHelp = {
  /** Heading of the sheet. */
  titleKey: string
  /** Label for the inline text link — "How to play" reads wrong for a
   *  discussion, which is not a game. */
  linkKey: string
  sections: HelpSection[]
}

export const TEMPLATE_HELP: Record<string, TemplateHelp> = {
  werewolf: {
    titleKey: 'ww.help.title',
    linkKey:  'xt.help',
    sections: [
      { headKey: 'ww.help.goal.h',  bodyKey: 'ww.help.goal.b'  },
      { headKey: 'ww.help.roles.h', bodyKey: 'ww.help.roles.b' },
      { headKey: 'ww.help.night.h', bodyKey: 'ww.help.night.b' },
      { headKey: 'ww.help.day.h',   bodyKey: 'ww.help.day.b'   },
      { headKey: 'ww.help.win.h',   bodyKey: 'ww.help.win.b'   },
      { headKey: 'ww.help.you.h',   bodyKey: 'ww.help.you.b'   },
    ],
  },
  discussion: {
    titleKey: 'dc.help.title',
    linkKey:  'xt.help.setup',
    sections: [
      { headKey: 'dc.help.what.h',   bodyKey: 'dc.help.what.b'   },
      { headKey: 'dc.help.models.h', bodyKey: 'dc.help.models.b' },
      { headKey: 'dc.help.order.h',  bodyKey: 'dc.help.order.b'  },
      { headKey: 'dc.help.char.h',   bodyKey: 'dc.help.char.b'   },
      { headKey: 'dc.help.join.h',   bodyKey: 'dc.help.join.b'   },
      { headKey: 'dc.help.cost.h',   bodyKey: 'dc.help.cost.b'   },
    ],
  },
}

export const helpFor = (templateId: string): TemplateHelp | null =>
  TEMPLATE_HELP[templateId] ?? null
