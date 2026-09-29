// lib/film/agent.ts — the film director: a Claude Managed Agents agent
// (Claude Opus 5.5 with a Linux sandbox) and the environment its sandbox is
// built from. Server-only.
//
// Agents and environments are persisted, versioned objects on Anthropic's
// side. This file is their source: scripts/film-agent-sync.ts creates or
// updates them from it and prints the ids and version, which go in FILM_LOCK
// below. Sessions pin the locked version, so editing the prompt here changes
// nothing until the sync runs and the new version is locked in.

import Anthropic from '@anthropic-ai/sdk'

export const FILM_MODEL = 'claude-opus-5-5'
/** The platform's default for the agent, stated so it is visible. The
 *  prototype film (Sep 29) ran at it: $1.20 of Claude for a 30s film. */
export const FILM_EFFORT = 'medium'
export const FILM_AGENT_NAME = 'XCreate film director'
export const FILM_ENVIRONMENT_NAME = 'xcreate-film'

/** The ids and the version new sessions use (written by the sync script). */
export const FILM_LOCK = {
  agentId: 'agent_01BWWNejHR3rJgcpNN4hXyU7',
  agentVersion: 3,
  environmentId: 'env_016Ucz1UnKat9aFHBRnDvT5E',
}

export function filmClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey })
}

/** The session's trace in the Console, for the logs. */
export const filmTraceUrl = (sessionId: string) =>
  `https://platform.claude.com/workspaces/default/sessions/${sessionId}`

export const FILM_SYSTEM = `You are a film director and motion designer working alone in a Linux sandbox. From a viewer's brief you produce one finished short film.

Tools:
- generate_image, generate_video and speak run on ModelXD's models and each return a download URL. Fetch results into /workspace with curl. They are paid from the viewer's budget and each reply says how much is left, so plan before calling and never retry blindly.
- ffmpeg, Python 3 with Pillow and NumPy, and Noto CJK fonts are installed. You can add packages with pip or apt. The sandbox reaches package registries and ModelXD's file storage, nothing else.

Method:
1. Write a short plan (scenes, timings, what is generated and what you draw with code) to /workspace/plan.md.
2. Generate the images, clips and voice. A clip started from a generated image (first_frame) keeps the look consistent between shots.
3. Make the motion graphics yourself in code (titles, animated text, transitions, overlays) and render them.
4. Edit everything with ffmpeg to the brief's length and aspect ratio, with the voice. Drop the clips' own audio unless it helps.
5. Check the result: ffprobe for duration, size and audio; extract a few frames and look at them; fix what is wrong.
6. Save the film as /mnt/session/outputs/film.mp4 (H.264 at about 4 Mbit/s, AAC, 30 fps, -movflags +faststart; it must stay under 40 MB) and /mnt/session/outputs/notes.md: what you made, the models used, what took the time, what failed.

Progress: before each step, write one short sentence saying what you are about to do, in the brief's language. The viewer reads these while waiting.

Rules: work without asking questions; nobody will answer until the film is done. Keep all on-screen text in the brief's language, correctly written. No real brands, logos or real people. Make any music and sound effects yourself in code; never use music, sound, footage or images from anywhere else. If the brief asks for something you cannot make within these rules, make the closest film you can and say why in notes.md.`

/** MiniMax Speech 2.8 Turbo's voices (the catalog row's list, Sep 29). The
 *  tool checks the live row, so a voice removed there is refused cleanly. */
export const FILM_VOICES = [
  'Chinese (Mandarin)_Warm_Bestie', 'Chinese (Mandarin)_Mature_Woman', 'Chinese (Mandarin)_Gentleman',
  'Chinese (Mandarin)_News_Anchor', 'Cantonese_ProfessionalHost（F)', 'Japanese_IntellectualSenior',
  'Japanese_DecisivePrincess', 'Korean_SweetGirl', 'Korean_CalmLady', 'English_expressive_narrator',
  'English_Graceful_Lady',
]

export const FILM_TOOLS = [
  {
    type: 'custom' as const,
    name: 'generate_image',
    description: 'Generate one image with GPT Image 2 (medium quality, about $0.05). Returns a download URL. Use it for keyframes, characters, backgrounds, or first frames for generate_video.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short file-safe name, unique in this film, e.g. "shake_keyframe"' },
        prompt: { type: 'string', description: 'The full image prompt' },
        aspect: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
      },
      required: ['name', 'prompt', 'aspect'],
    },
  },
  {
    type: 'custom' as const,
    name: 'generate_video',
    description: 'Generate one 720p video clip with HappyHorse 1.1, 3 to 10 seconds, $0.14 per second, no sound. With first_frame (the name of an image you made with generate_image) it animates that image; otherwise it works from the prompt alone. Returns a download URL. Takes one to three minutes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short file-safe name, unique in this film' },
        prompt: { type: 'string', description: 'What happens in the shot: subject, action, camera' },
        seconds: { type: 'integer', minimum: 3, maximum: 10 },
        aspect: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
        first_frame: { type: 'string', description: 'Optional: the name of an image made with generate_image in this film' },
      },
      required: ['name', 'prompt', 'seconds', 'aspect'],
    },
  },
  {
    type: 'custom' as const,
    name: 'speak',
    description: 'Turn text into speech with MiniMax Speech 2.8 Turbo (MP3, nearly free). Pick a voice in the language of the text. Returns a download URL and the duration.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short file-safe name, unique in this film' },
        text: { type: 'string', description: 'The line to speak, at most 600 characters' },
        voice: { type: 'string', enum: FILM_VOICES },
      },
      required: ['name', 'text', 'voice'],
    },
  },
]

/** The sandbox: tools preinstalled, network limited to package registries
 *  and our storage host, so nothing from the open web can end up in a film. */
export function filmEnvironmentConfig() {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host
  return {
    type: 'cloud' as const,
    networking: { type: 'limited' as const, allowed_hosts: [host], allow_package_managers: true },
    packages: {
      apt: ['ffmpeg', 'fonts-noto-cjk', 'fonts-noto-cjk-extra', 'fonts-noto-color-emoji'],
      pip: ['pillow', 'numpy'],
    },
  }
}
