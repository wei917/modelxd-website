// app/api/skills/route.ts
// The skill catalogue, read straight from ./skills in the open Agent Skills
// format. Anything a user could author elsewhere and drop in shows up here
// with no conversion step (CC, July 28).

export const runtime = 'nodejs'

import { listSkills } from '@/lib/skills'
import { assertFeature } from '@/lib/features'

export async function GET() {
  const gate = await assertFeature('xdirector')
  if (gate) return gate

  const skills = await listSkills()
  return Response.json({ skills })
}
