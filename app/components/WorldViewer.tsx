'use client'
// app/components/WorldViewer.tsx — walk a World Labs world in the browser.
//
// Spark (@sparkjsdev/spark, MIT, by World Labs — the renderer their own
// Marble viewer runs on) draws the Gaussian splats inside a plain three.js
// scene. Loaded with a dynamic import inside the effect: it is WebGL2 + wasm
// and has no business in the server bundle.
//
// Orientation: Marble's viewer applies a 180° rotation about X to generated
// SPZ (docs.worldlabs.ai/api/rendering-spz) — quaternion (1,0,0,0). Worlds
// are generated around the capture point, so the camera starts at the origin.
// Resolution: 500k splats on desktop, 100k on phones (full-res is 2M+ and
// tens of MB; it is offered as a download, not rendered).

import { useEffect, useRef, useState } from 'react'

export default function WorldViewer({ spz, hint }: {
  spz: { '100k'?: string; '500k'?: string; full_res?: string }
  hint?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let cleanup = () => {}
    ;(async () => {
      try {
        const THREE = await import('three')
        const { SparkRenderer, SplatMesh, SparkControls } = await import('@sparkjsdev/spark')
        if (disposed) return
        const mobile = window.matchMedia('(pointer: coarse)').matches
        const url = (mobile ? spz['100k'] : spz['500k']) ?? spz['100k'] ?? spz['500k'] ?? spz.full_res
        if (!url) throw new Error('no splats')

        const renderer = new THREE.WebGLRenderer({ antialias: false })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(el.clientWidth, el.clientHeight)
        el.appendChild(renderer.domElement)
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(70, el.clientWidth / el.clientHeight, 0.01, 1000)
        scene.add(new SparkRenderer({ renderer }))

        const world = new SplatMesh({ url })
        world.quaternion.set(1, 0, 0, 0)
        scene.add(world)
        world.initialized.then(() => { if (!disposed) setState('ready') }).catch(() => { if (!disposed) setState('error') })

        const controls = new SparkControls({ canvas: renderer.domElement })
        renderer.setAnimationLoop(() => {
          controls.update(camera)
          renderer.render(scene, camera)
        })
        const ro = new ResizeObserver(() => {
          const w = el.clientWidth, h = el.clientHeight
          if (!w || !h) return
          renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
        })
        ro.observe(el)
        cleanup = () => {
          ro.disconnect()
          renderer.setAnimationLoop(null)
          world.dispose?.()
          renderer.dispose()
          renderer.domElement.remove()
        }
      } catch (e) {
        console.error('[WorldViewer]', e)
        if (!disposed) setState('error')
      }
    })()
    return () => { disposed = true; cleanup() }
  }, [spz])

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 10, overflow: 'hidden' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
      {state !== 'ready' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.8)', fontSize: 13, pointerEvents: 'none' }}>
          {state === 'loading' ? 'Loading world…' : 'This browser could not open the world (WebGL2 needed).'}
        </div>
      )}
      {state === 'ready' && hint && (
        <div style={{ position: 'absolute', left: 12, bottom: 10, color: 'rgba(255,255,255,0.75)', fontSize: 11, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.06em', pointerEvents: 'none' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
