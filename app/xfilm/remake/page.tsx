// app/xfilm/remake/page.tsx — XFilm's 同款 (was X創作's 同款 tab,
// /xcreate?type=remake, ?remake=<id> and ?fan=, until Oct 22). Its API
// routes and stored rows keep their names (/api/xcreate/remake/*, its
// fan/ routes included; xcreates rows with options.remake / options.fan).

import RemakeClient from './client'

export default function XFilmRemakePage() {
  return <RemakeClient />
}
