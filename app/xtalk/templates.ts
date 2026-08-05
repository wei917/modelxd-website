// app/xtalk/templates.ts
// The XTalk template registry.
//
// XTalk is a ROOM ENGINE, not a game. What it provides is the part that is
// the same every time: several models in one place, a transcript, per-speaker
// visibility, turn order, cost tracking. A template is one thing you can run
// in that room — a discussion, a werewolf game, and more to come.
//
// This exists so adding the next one is an entry in a list rather than
// another branch in a growing `mode === '...'` chain. It deliberately stops
// short of inventing a configuration language: the roles, phases and win
// conditions of a game are code, and pretending otherwise after two examples
// would be guessing at an abstraction. When a third template lands, whatever
// genuinely repeats between them moves into the engine.

import type { ComponentType } from 'react'
import DiscussionRoom from './DiscussionRoom'
import WerewolfLive from './WerewolfLive'

export type Speaker = {
  id: string
  display_name: string
  provider: string
  model_pricing?: any
  /** Needed to know what this seat can be CONFIGURED with — which thinking
   *  levels it declares, and whether web search is wired for it. Without it
   *  every seat in XTalk ran on provider defaults with no way to see or
   *  change that, which is the one thing XCreate and XDuel both offered. */
  output_config?: {
    text?: { thinking_levels?: string[]; capabilities?: string[] }
  } | null
}

export interface TemplateProps {
  models: Speaker[]
  /** Leave the template and return to the picker. */
  onExit: () => void
  /** A server-held session to reopen (from /xtalk/<id>). Werewolf only —
   *  discussion rooms live in client state and have nothing to resume. */
  resumeId?: string | null
}

export interface XTalkTemplate {
  id: string
  /** i18n keys, so a template names itself in the reader's language. */
  nameKey:  string
  /** One line, always visible. The blurb only shows on the chosen card. */
  tagKey:   string
  blurbKey: string
  /** Mono caption under the seat strip — the table in words. */
  stripKey: string
  /** Square mark on the card. Generated in XCreate — the same table drawn
   *  twice, so the two formats differ by their seats, not their style. */
  art:      string
  /** Wide banner across the top of the card. Also from XCreate. It carries
   *  the mood the mark cannot: one is a hushed boardroom, the other is a
   *  village at night. */
  banner:   string
  /** Headline shown above the room. */
  titleKey: string
  minPlayers: number
  maxPlayers: number
  /**
   * Does this template need players to know different things? Werewolf does;
   * a discussion does not. Recorded here because it decides whether a
   * template can be run entirely in the browser or needs the server to hold
   * the state — the difference between watching and being able to play.
   */
  hiddenInfo: boolean
  /**
   * Optional "how to play", shown in a sheet behind the card's ? button.
   * A seven-role board needs a few paragraphs to explain, and paragraphs on
   * the card itself would bury the one line that says what the format IS.
   * Templates that are self-evident (a discussion is just a discussion)
   * leave this out and get no ? button. (CC, Aug 5)
   */
  helpTitleKey?: string
  help?: { headKey: string; bodyKey: string }[]
  component: ComponentType<TemplateProps>
}

export const XTALK_TEMPLATES: XTalkTemplate[] = [
  {
    id: 'discussion',
    nameKey:  'xt.tpl.discussion.name',
    tagKey:   'xt.tpl.discussion.tag',
    blurbKey: 'xt.tpl.discussion.blurb',
    stripKey: 'xt.tpl.discussion.strip',
    art:      '/xtalk/discussion.png',
    banner:   '/xtalk/discussion-banner.png',
    titleKey: 'xt.tpl.discussion.title',
    minPlayers: 2,
    // 8, not 4. There is no mechanical reason a discussion caps lower than
    // the werewolf table — every speaker just reads the transcript and adds
    // to it. The old 4 was the number the first version happened to ship
    // with. Cost scales linearly with seats and is shown per turn, so the
    // ceiling can be generous. (CC, Aug 2)
    maxPlayers: 8,
    hiddenInfo: false,
    component: DiscussionRoom,
  },
  {
    id: 'werewolf',
    nameKey:  'xt.tpl.werewolf.name',
    tagKey:   'xt.tpl.werewolf.tag',
    blurbKey: 'xt.tpl.werewolf.blurb',
    stripKey: 'xt.tpl.werewolf.strip',
    art:      '/xtalk/werewolf.png',
    banner:   '/xtalk/werewolf-banner.png',
    titleKey: 'xt.tpl.werewolf.title',
    // 7 is the floor, not 4. Below it the board stops being a game: at six
    // with two wolves a single wrong day-1 vote hits parity and ends it on
    // the spot, and with one wolf the seer finds it among five and there is
    // nothing to deduce. Seven is also the smaller of the two boards the
    // werewolf papers actually run. (CC, Aug 2: 7人局比較合理)
    minPlayers: 7,
    maxPlayers: 7,
    hiddenInfo: true,
    helpTitleKey: 'ww.help.title',
    help: [
      { headKey: 'ww.help.goal.h',  bodyKey: 'ww.help.goal.b'  },
      { headKey: 'ww.help.roles.h', bodyKey: 'ww.help.roles.b' },
      { headKey: 'ww.help.night.h', bodyKey: 'ww.help.night.b' },
      { headKey: 'ww.help.day.h',   bodyKey: 'ww.help.day.b'   },
      { headKey: 'ww.help.win.h',   bodyKey: 'ww.help.win.b'   },
      { headKey: 'ww.help.you.h',   bodyKey: 'ww.help.you.b'   },
    ],
    component: WerewolfLive,
  },
]

export const templateById = (id: string) =>
  XTALK_TEMPLATES.find(t => t.id === id) ?? XTALK_TEMPLATES[0]
