// scripts/film-agent-sync.ts — push lib/film/agent.ts to Anthropic.
//
// The film director (agent) and its sandbox (environment) are persisted,
// versioned objects on Anthropic's side; lib/film/agent.ts is their source.
// This updates them in place when the file differs (an agent update makes a
// new version; running sessions keep theirs) and prints the FILM_LOCK to put
// back in lib/film/agent.ts. New films use the locked version only.
//
//   npx tsx scripts/film-agent-sync.ts            # dry run: what would change
//   npx tsx scripts/film-agent-sync.ts --apply    # update / create
//
// Never archives anything: archiving is permanent (ask the owner).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv() {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function main() {
  loadEnv()
  const apply = process.argv.includes('--apply')
  const { filmClient, FILM_LOCK, FILM_AGENT_NAME, FILM_ENVIRONMENT_NAME, FILM_MODEL, FILM_EFFORT, FILM_SYSTEM, FILM_TOOLS, filmEnvironmentConfig } = await import('../lib/film/agent')
  const client: any = filmClient()

  // ── Environment: found by name, created once, updated when it differs.
  const wantEnv = filmEnvironmentConfig()
  let env: any = null
  for await (const e of client.beta.environments.list()) {
    if (e.name === FILM_ENVIRONMENT_NAME && !e.archived_at) { env = e; break }
  }
  // The API hands objects back with their keys sorted: compare canonically.
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon((v as any)[k])])) : v
  const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
  const envNow = env ? { networking: env.config?.networking, apt: env.config?.packages?.apt ?? [], pip: env.config?.packages?.pip ?? [] } : null
  const envWant = { networking: wantEnv.networking, apt: wantEnv.packages.apt, pip: wantEnv.packages.pip }
  let environmentId: string = env?.id ?? ''
  if (!env) {
    console.log(`environment "${FILM_ENVIRONMENT_NAME}": create`, JSON.stringify(envWant))
    if (apply) environmentId = (await client.beta.environments.create({ name: FILM_ENVIRONMENT_NAME, config: wantEnv })).id
  } else if (!same({ ...envNow, networking: { type: envNow!.networking?.type, allowed_hosts: envNow!.networking?.allowed_hosts, allow_package_managers: envNow!.networking?.allow_package_managers } }, envWant)) {
    console.log(`environment ${env.id}: update`, JSON.stringify(envWant), '(was', JSON.stringify(envNow), ')')
    if (apply) await client.beta.environments.update(env.id, { config: wantEnv })
  } else {
    console.log(`environment ${env.id}: up to date`)
  }

  // ── Agent: updated in place (same name, same purpose).
  const agent: any = await client.beta.agents.retrieve(FILM_LOCK.agentId)
  const toolsNow = (agent.tools ?? []).filter((t: any) => t.type === 'custom').map((t: any) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  const toolsWant = FILM_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  const modelNow = typeof agent.model === 'string' ? agent.model : agent.model?.id
  const effortNow = typeof agent.model === 'object' ? (agent.model?.effort?.type ?? agent.model?.effort) : null
  const differs = agent.name !== FILM_AGENT_NAME || agent.system !== FILM_SYSTEM || modelNow !== FILM_MODEL
    || effortNow !== FILM_EFFORT || !same(toolsNow, toolsWant)
  let version: number = agent.version
  if (differs) {
    console.log(`agent ${agent.id} v${agent.version}: update (name/system/tools differ)`)
    if (apply) {
      const updated: any = await client.beta.agents.update(agent.id, {
        version: agent.version,
        name: FILM_AGENT_NAME,
        model: { id: FILM_MODEL, effort: FILM_EFFORT },
        system: FILM_SYSTEM,
        tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }, ...FILM_TOOLS],
      })
      version = updated.version
    }
  } else {
    console.log(`agent ${agent.id} v${agent.version}: up to date`)
  }

  const lock = { agentId: agent.id, agentVersion: version, environmentId: environmentId || '(created on --apply)' }
  console.log('\nFILM_LOCK =', JSON.stringify(lock, null, 2))
  if (lock.agentVersion !== FILM_LOCK.agentVersion || lock.environmentId !== FILM_LOCK.environmentId) {
    console.log(apply ? '→ copy this into lib/film/agent.ts' : '→ dry run; rerun with --apply')
  }
}

main().catch(e => { console.error('FAILED', e?.status ?? '', String(e?.message ?? e).slice(0, 500)); process.exit(1) })
