// lib/mlb-colors.ts — each MLB club's colour for its chip on the XSports
// board (owner, Oct 12: the green board read as Boston's; a neutral board
// with each team's own colour instead).
//
// Keyed by MLB team id. Where a club's main colour is a navy that would
// vanish on the dark board, the brighter club colour is used (Rays light
// blue, Brewers gold, Padres gold, White Sox silver); `ink` is the text
// colour that reads on it.

const C: Record<number, { bg: string; ink?: string }> = {
  108: { bg: '#BA0021' },              // Angels
  109: { bg: '#A71930' },              // D-backs
  110: { bg: '#DF4601' },              // Orioles
  111: { bg: '#BD3039' },              // Red Sox
  112: { bg: '#0E3386' },              // Cubs
  113: { bg: '#C6011F' },              // Reds
  114: { bg: '#E50022' },              // Guardians
  115: { bg: '#5A4E9A' },              // Rockies
  116: { bg: '#0C2340' },              // Tigers
  117: { bg: '#EB6E1F' },              // Astros
  118: { bg: '#004687' },              // Royals
  119: { bg: '#005A9C' },              // Dodgers
  120: { bg: '#AB0003' },              // Nationals
  121: { bg: '#FF5910' },              // Mets
  133: { bg: '#006C4E' },              // Athletics
  134: { bg: '#FDB827', ink: '#27251F' }, // Pirates
  135: { bg: '#FFC425', ink: '#2F241D' }, // Padres
  136: { bg: '#005C5C' },              // Mariners
  137: { bg: '#FD5A1E' },              // Giants
  138: { bg: '#C41E3A' },              // Cardinals
  139: { bg: '#8FBCE6', ink: '#092C5C' }, // Rays
  140: { bg: '#003278' },              // Rangers
  141: { bg: '#134A8E' },              // Blue Jays
  142: { bg: '#D31145' },              // Twins
  143: { bg: '#E81828' },              // Phillies
  144: { bg: '#CE1141' },              // Braves
  145: { bg: '#C4CED4', ink: '#27251F' }, // White Sox
  146: { bg: '#00A3E0' },              // Marlins
  147: { bg: '#003087' },              // Yankees
  158: { bg: '#FFC52F', ink: '#12284B' }, // Brewers
}

/** CSS custom properties for a team chip; unknown teams get the board's
 *  own grey. */
export function teamChip(id: number): Record<string, string> {
  const c = C[id]
  return c ? { '--team': c.bg, '--team-ink': c.ink ?? '#ffffff' } : {}
}
