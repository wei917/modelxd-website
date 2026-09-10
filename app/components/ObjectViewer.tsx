'use client'
// app/components/ObjectViewer.tsx — turn a GLB around (Tripo photo → 3D).
// three.js GLTFLoader + OrbitControls, dynamically imported like WorldViewer.
// The GLB comes through /api/xworld/[id]/model (same origin), because
// Tripo's own links are signed, expiring and not CORS-readable.

import { useEffect, useRef, useState } from 'react'

export default function ObjectViewer({ url, hint }: { url: string; hint?: string }) {
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
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
        if (disposed) return

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(el.clientWidth, el.clientHeight)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        el.appendChild(renderer.domElement)
        const scene = new THREE.Scene()
        scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2))
        const sun = new THREE.DirectionalLight(0xffffff, 2)
        sun.position.set(3, 5, 4)
        scene.add(sun)
        const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.01, 100)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.autoRotate = true
        controls.autoRotateSpeed = 1.2

        const gltf = await new GLTFLoader().loadAsync(url)
        if (disposed) { renderer.dispose(); return }
        const obj = gltf.scene
        // Frame it: centre on the origin, camera back by the bounding sphere.
        const box = new THREE.Box3().setFromObject(obj)
        const size = box.getSize(new THREE.Vector3()).length() || 1
        obj.position.sub(box.getCenter(new THREE.Vector3()))
        scene.add(obj)
        camera.position.set(0, size * 0.25, size * 1.1)
        controls.target.set(0, 0, 0)
        controls.update()
        setState('ready')

        renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
        const ro = new ResizeObserver(() => {
          const w = el.clientWidth, h = el.clientHeight
          if (!w || !h) return
          renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
        })
        ro.observe(el)
        cleanup = () => {
          ro.disconnect(); controls.dispose(); renderer.setAnimationLoop(null)
          renderer.dispose(); renderer.domElement.remove()
        }
      } catch (e) {
        console.error('[ObjectViewer]', e)
        if (!disposed) setState('error')
      }
    })()
    return () => { disposed = true; cleanup() }
  }, [url])

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: 'var(--surface2)', borderRadius: 10, overflow: 'hidden' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
      {state !== 'ready' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13, pointerEvents: 'none' }}>
          {state === 'loading' ? 'Loading object…' : 'Could not open this object.'}
        </div>
      )}
      {state === 'ready' && hint && (
        <div style={{ position: 'absolute', left: 12, bottom: 10, color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.06em', pointerEvents: 'none' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
