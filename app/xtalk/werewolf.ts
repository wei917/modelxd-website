// app/xtalk/werewolf.ts
// Werewolf on XTalk — rules, role dealing and prompt building.
//
// Two decisions shape everything here:
//
// 1. THE MODERATOR IS CODE, NOT A MODEL. Dealing roles, resolving the night,
//    counting votes and checking the win condition are deterministic. A model
//    asked to moderate will eventually forget who died, and it would cost
//    money on every phase to get that wrong.
//
// 2. THE AUDIENCE SEES EVERYTHING; EACH PLAYER SEES ONLY ITS OWN. XTalk's
//    whole premise is that every speaker reads the same transcript, and this
//    game inverts exactly that. Turns therefore carry `privateTo`, and the
//    filter runs on the CLIENT before a turn is ever sent to a model. The
//    watcher keeps the god view, because a game where you cannot see the
//    wolf lying is not worth watching.
//
//    NOTE: that also means roles live in browser state. Fine while the human
//    is an audience; if a human ever PLAYS, this has to move server-side or
//    they can read the wolf out of React devtools.

// Mirrors lib/werewolf-engine.ts — the prompts and the engine must agree
// on the cast, or a role can exist in the game with no briefing behind it.
export type Role = 'wolf' | 'seer' | 'doctor' | 'villager'

export interface Player {
  modelId:  string
  name:     string   // display name, unique within a game
  provider: string
  role:     Role
  alive:    boolean
}

export interface GameTurn {
  speaker:   string
  text:      string
  /** undefined = public. Otherwise only these players' models may read it.
   *  An ARRAY, not a name: with two wolves the night decision belongs to
   *  both of them, and a single-name field silently blinded the second
   *  wolf to its own team's kill. */
  privateTo?: string[]
  /** The speaker's private thinking. Shown to the WATCHER and never sent to
   *  any model — it is not part of the transcript, which is the entire point
   *  of asking for it separately. */
  reasoning?: string
  /** Moderator announcements — code, not a model, and never billed. */
  system?:   boolean
  cost?:     number
  kind?:     'night' | 'day' | 'vote' | 'result'
}

/**
 * Role table. Below five players the game is a coin flip, so four is the
 * floor and it deals a single wolf: with two wolves in four, the village
 * loses before it speaks.
 */
export function dealRoles(n: number): Role[] {
  // One wolf up to seven. Two wolves at six looks standard but ends most
  // games on day one: after the night kill it is 2 wolves against 3, so a
  // single wrong vote makes it 2-2 and the parity rule fires immediately.
  // Six with one wolf gives the village three chances and the seer two or
  // three checks, which is where the actual play is. Two wolves needs a
  // bigger table to survive its own endgame.
  const wolves = n >= 8 ? 2 : 1
  const roles: Role[] = [
    ...Array(wolves).fill('wolf' as Role),
    'seer' as Role,
    ...Array(n - wolves - 1).fill('villager' as Role),
  ]
  // Fisher-Yates. Dealing in order would put the wolf in seat one every game.
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[roles[i], roles[j]] = [roles[j], roles[i]]
  }
  return roles
}

/** What a given model is allowed to read. */
export function visibleTo(turns: GameTurn[], name: string): GameTurn[] {
  return turns.filter(t => !t.privateTo || t.privateTo.includes(name))
}

export function alive(players: Player[]): Player[] {
  return players.filter(p => p.alive)
}

export function winner(players: Player[]): 'wolves' | 'village' | null {
  const live   = alive(players)
  const wolves = live.filter(p => p.role === 'wolf').length
  const others = live.length - wolves
  if (wolves === 0) return 'village'
  // Parity, not elimination: once wolves equal the rest they cannot be voted
  // out, so the game is already over and playing it out wastes turns.
  if (wolves >= others) return 'wolves'
  return null
}


/**
 * Separating THINKING from SPEAKING.
 *
 * Werewolf Arena (Google, 2024) has every action return two fields —
 * {reasoning, say}, {reasoning, vote} and so on — and that separation is not
 * cosmetic. Without it a model's reasoning IS its public utterance, which
 * means a wolf has nowhere private to scheme: asking it to explain its vote
 * out loud forces it to expose itself, and every speech reads like an inner
 * monologue because that is literally what it is.
 *
 * They enforce it with a provider-side response schema. ModelXD's text path
 * has no schema support across five providers, so we ask for JSON in the
 * prompt and parse it defensively — the regex reader stays as a fallback,
 * because a model that ignores the format must not stall the game.
 */
export function outputContract(field: string, fieldHint: string): string {
  return `Reply with ONE JSON object and nothing else — no markdown fence, no text around it:

{"reasoning": "<your private thinking, which nobody else ever sees>", "${field}": "${fieldHint}"}

"reasoning" is yours alone. Think freely there — including things you intend to hide.
"${field}" is what the table sees. Only this is shown to the other players.`
}

/** Pull the first balanced {...} out of a reply and parse it. */
export function parseJsonReply(text: string): Record<string, string> | null {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        const o = JSON.parse(cleaned.slice(start, i + 1))
        return (o && typeof o === 'object') ? o : null
      } catch { return null }
    }
  }
  return null
}

const RULES = (names: string[]) => `You are playing Werewolf (狼人殺). The players are: ${names.join(', ')}.

Rules: each night the wolves secretly kill one player, the seer secretly learns one player's true role, and the doctor secretly protects one player from the wolves. Each day everyone discusses and then votes; whoever gets the most votes is eliminated and their role is revealed. The village wins by eliminating every wolf. The wolves win once they equal the number of remaining players.

You only know what you have been told. You cannot see anyone's private information.

DECEPTION IS LEGAL FOR EVERYONE. The wolves MUST lie — they cannot win otherwise. The village MAY lie, and strong players often do: claiming to be the seer so the wolves waste their kill on you, hiding that you are the seer until the moment it counts, pretending to know more than you do to make someone crack. A village where everybody answers honestly is a village that loses, because then any inconsistency is proof of a wolf and there is nothing left to work out.`

export function seatPrompt(me: Player, all: Player[], teammates: string[]): string {
  const names = all.map(p => p.name)
  const role = me.role === 'wolf'
    ? `You are a WEREWOLF.${teammates.length ? ` Your fellow wolf is ${teammates.join(', ')}.` : ' You are the only wolf.'} You win by surviving. You must pass as an ordinary villager: never reveal your role, accuse innocent players when it serves you, and consider claiming a special role yourself — a wolf who claims the seer first can get the real seer executed.`
    : me.role === 'seer'
      ? 'You are the SEER. Each night you learn one player\'s true role. Deciding when to reveal what you know is the hardest part of your job: too early and the wolves kill you that night, too late and nobody believes you. Staying quiet and letting someone else draw the fire is also a play.'
    : me.role === 'doctor'
      ? 'You are the DOCTOR. Each night you protect one player; if the wolves attack them, they survive. You may protect yourself. Nobody is told who you saved, only that the night was quiet — so a quiet morning tells the table a doctor exists without saying who. Revealing yourself makes you the next target; staying hidden means nobody defends you either.'
      : 'You are an ordinary VILLAGER. You have no special information — but you are not required to say so. Claiming to be the seer or the doctor is a real village tactic: it pulls the wolves\' knife onto you and away from whoever actually holds the power, and it forces a wolf bluffing the same role to argue with you in front of everyone. Whether you play it straight or bluff is your call.'
  return `${RULES(names)}\n\nYou are ${me.name}. ${role}`
}

export function nightKillPrompt(me: Player, all: Player[], teammates: string[]): string {
  const targets = alive(all).filter(p => p.role !== 'wolf').map(p => p.name)
  return `${seatPrompt(me, all, teammates)}

It is night. Choose who the wolves kill. Living non-wolf players: ${targets.join(', ')}.

${outputContract('kill', 'the exact name of the player to kill')}`
}

export function nightSeerPrompt(me: Player, all: Player[]): string {
  const targets = alive(all).filter(p => p.name !== me.name).map(p => p.name)
  return `${seatPrompt(me, all, [])}

It is night. Choose one player to investigate. Living players: ${targets.join(', ')}.

${outputContract('check', 'the exact name of the player to investigate')}`
}

export function dayPrompt(me: Player, all: Player[], teammates: string[], day: number): string {
  return `${seatPrompt(me, all, teammates)}

It is day ${day}. The discussion is below. Say what you think — accuse someone, defend yourself, share what you know, or press someone on what they said. Do not state your role outright unless you have decided that revealing it is worth it.

${outputContract('say', 'what you actually say aloud, under 90 words, plain prose, no lists, in the language the others are using')}`
}

export function votePrompt(me: Player, all: Player[], teammates: string[], day: number): string {
  const targets = alive(all).filter(p => p.name !== me.name).map(p => p.name)
  return `${seatPrompt(me, all, teammates)}

Day ${day} voting. You may vote for: ${targets.join(', ')}.

${outputContract('vote', 'the exact name of the player you vote to eliminate')}

Your "reasoning" is private. Say aloud nothing here — this turn is the ballot only.`
}

/**
 * Pull a name off a `KILL:/CHECK:/VOTE: <name>` line.
 * Models drift off the format, so fall back to any candidate name mentioned
 * in the reply, and only then to the first candidate — an unparsed answer
 * must never stall the game.
 */
export function parseChoice(text: string, keyword: string, candidates: string[]): string {
  const line = new RegExp(`${keyword}\\s*[:：]\\s*(.+)`, 'i').exec(text)
  if (line) {
    const said = line[1].trim().replace(/[.。*"'\]]+$/, '')
    const exact = candidates.find(c => c.toLowerCase() === said.toLowerCase())
    if (exact) return exact
    const partial = candidates.find(c =>
      said.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(said.toLowerCase()))
    if (partial) return partial
  }
  const mentioned = candidates.filter(c => text.toLowerCase().includes(c.toLowerCase()))
  if (mentioned.length === 1) return mentioned[0]
  // Last mention wins — a reply that names several usually settles on one.
  if (mentioned.length > 1) {
    return mentioned.reduce((best, c) =>
      text.toLowerCase().lastIndexOf(c.toLowerCase()) > text.toLowerCase().lastIndexOf(best.toLowerCase()) ? c : best)
  }
  return candidates[0]
}

/** Most votes wins; a tie eliminates nobody, which is the standard rule and
 *  also stops an arbitrary tiebreak deciding the game. */
export function tally(votes: Record<string, string>): { out: string | null; counts: Record<string, number> } {
  const counts: Record<string, number> = {}
  for (const target of Object.values(votes)) counts[target] = (counts[target] ?? 0) + 1
  let top: string | null = null, topN = 0, tied = false
  for (const [name, n] of Object.entries(counts)) {
    if (n > topN) { top = name; topN = n; tied = false }
    else if (n === topN) tied = true
  }
  return { out: tied ? null : top, counts }
}
