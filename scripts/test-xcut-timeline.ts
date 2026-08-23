// scripts/test-xcut-timeline.ts — unit test for lib/xcut-timeline.ts.   npx tsx scripts/test-xcut-timeline.ts
import {
  timelineFromStoryboard, clipStarts, totalDuration, locate, trimClip, splitAt, moveClip, removeClip,
  cleanTimeline, renderPlan, toSrt, subtitlesFromScenes, emptyTimeline, type StoryboardScene,
} from '../lib/xcut-timeline'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name, extra) }
const src = (p: string, mt = 'video/mp4') => ({ bucket: 'xcreate-ai-videos', path: p, mediaType: mt })

const scenes: StoryboardScene[] = [
  { id: 'cast_a', asset: true, title: 'CAST · A', still_url: 'x' },
  { id: 's1', title: '石猴反天', script: '石猴稱王。', duration_s: 6, row_id: 'r1', model_name: 'Gemini', cost: 0.6 },
  { id: 's2', title: '壓於五行山', script: '被壓五百年。', duration_s: 6, still_row_id: 'r2s', still_model_name: 'GPT Image 2' },
  { id: 's3', title: '取經', script: '', duration_s: 8, continues: true, row_id: 'r3' },
  { id: 's4', title: '無素材', duration_s: 5 },
]
const sources = {
  s1: { video: { ...src('u/s1.mp4'), duration: 8, rowId: 'r1' } },
  s2: { still: { ...src('u/s2.png', 'image/png'), rowId: 'r2s' } },
  s3: { video: { ...src('u/s3.mp4'), duration: 4, rowId: 'r3' } },
}
const tl = timelineFromStoryboard(scenes, sources)
check('rough cut skips assets and unsourced scenes', tl.video.length === 3, `→ ${tl.video.length}`)
check('shot scene trimmed to its card duration', tl.video[0].kind === 'video' && tl.video[0].out === 6 && tl.video[0].srcDuration === 8)
check('unshot scene = still held for its duration', tl.video[1].kind === 'image' && tl.video[1].out === 6)
check('short clip keeps its own length', tl.video[2].out === 4)
check('continuation enters on a cut, new scene on a dissolve', tl.video[1].transition === 'dissolve' && tl.video[2].transition === 'cut')
check('starts are cumulative', JSON.stringify(clipStarts(tl)) === JSON.stringify([0, 6, 12]))
check('total duration', totalDuration(tl) === 16)
check('subtitles from scripts (empty script skipped)', tl.subtitles.length === 2 && tl.subtitles[1].start === 6 && tl.subtitles[1].end === 12)

const at7 = locate(tl, 7)!
check('locate t=7 → clip 2 offset 1', at7.index === 1 && Math.abs(at7.offset - 1) < 1e-9)
check('locate past the end → last clip end', locate(tl, 16)?.index === 2 && locate(tl, 17) === null)

const trimmed = trimClip(tl, tl.video[0].id, { out: 20 })
check('trim clamps to source duration', trimmed.video[0].out === 8)
const tiny = trimClip(tl, tl.video[0].id, { in: 5.95 })
check('trim keeps a minimum length', tiny.video[0].out - tiny.video[0].in >= 0.2)

const split = splitAt(tl, 3)
check('split makes two clips at t=3', split.video.length === 4 && split.video[0].out === 3 && split.video[1].in === 3 && split.video[1].out === 6)
check('split keeps total duration', totalDuration(split) === 16)
check('split at a clip edge is a no-op', splitAt(tl, 6).video.length === 3)

const moved = moveClip(tl, tl.video[2].id, 0)
check('move to front', moved.video[0].sceneId === 's3')
const removed = removeClip(tl, tl.video[1].id)
check('remove', removed.video.length === 2 && totalDuration(removed) === 10)

// validation round-trip + garbage
const cleaned = cleanTimeline(JSON.parse(JSON.stringify(tl)))!
check('cleanTimeline round-trips', cleaned.video.length === 3 && cleaned.subtitles.length === 2 && cleaned.settings.resolution === '1080p')
check('cleanTimeline drops bad sources', cleanTimeline({ video: [{ src: {} }, { src: { bucket: 'b', path: 'p', mediaType: 'video/mp4' }, in: 0, out: 3 }] })!.video.length === 1)
check('cleanTimeline null on garbage', cleanTimeline('nope') === null)

// render plan
const plan = renderPlan({ ...tl, settings: { ...tl.settings, dissolve: 0.5 } })
check('plan 1080p 16:9', plan.width === 1920 && plan.height === 1080)
check('dissolve only on dissolve clips, capped', plan.segments[1].dissolveIn === 0.5 && plan.segments[2].dissolveIn === 0 && plan.segments[0].dissolveIn === 0)
check('images are muted in the plan', plan.segments[1].mute === true)
check('plan duration subtracts dissolves', Math.abs(plan.duration - 15.5) < 1e-9, `→ ${plan.duration}`)
const vert = renderPlan({ ...emptyTimeline('9:16'), settings: { resolution: '720p', muteClips: true, dissolve: 0 } })
check('plan 720p 9:16', vert.width === 720 && vert.height === 1280)

const srt = toSrt(tl.subtitles)
check('SRT format', /^1\n00:00:00,000 --> 00:00:06,000\n石猴稱王。\n/.test(srt))

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
