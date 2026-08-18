// app/api/skills/route.ts
// The skill catalogue, read straight from ./skills in the open Agent Skills
// format. Anything a user could author elsewhere and drop in shows up here
// with no conversion step (CC, July 28).

export const runtime = 'nodejs'

import { listSkills } from '@/lib/skills'

export async function GET() {
  const skills = await listSkills()
  return Response.json({ skills })
}
