// app/xfilm/auto/page.tsx — XFilm's 自動成片 (was X創作's 成片 tab,
// /xcreate?type=film and ?film=<id>, until Oct 22). The film's API routes,
// tables and managed agent keep their names (/api/xcreate/film*,
// xcreate_films, "XCreate film director").

import AutoClient from './client'

export default function XFilmAutoPage() {
  return <AutoClient />
}
