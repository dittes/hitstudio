import {renderSize} from './render-size.js';
import {createAmbientParticles} from './ambient-particles.js';
import * as THREE from 'three'
import { makeAnalysis, sampleAnalysis, scaleAnalysis } from './analysis.js'
import { createPostFx,             } from './postfx.js'
import { PALETTES,                                            } from './scenes/types.js'

/** Own every GPU resource, including partial initialization and context loss. */
export function startWebGLVisualizer(
  canvas                   , root             ,
  scenes                                     , read                      ,
  fadeElement                       , onFailure            ,
)             {
  let renderer
  let fx                = null
  let cur                  = null
  let ro
  let raf = 0,resizeRaf=0,lastSize='',ambient=null;
  const resizeEvents=new AbortController();
  let stopped = false
  const dispose = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf);cancelAnimationFrame(resizeRaf);resizeEvents.abort();ambient?.dispose()
    ro?.disconnect()
    canvas.removeEventListener('webglcontextlost', lost)
    // Disposal must not prevent the compatibility renderer from starting.
    for (const release of [() => cur?.dispose(), () => fx?.dispose(), () => renderer?.dispose()]) {
      try { release() } catch { /* partially initialized GPU resources */ }
    }
  }
  const fail = (error         ) => {
    console.warn('3D visualizer unavailable; using Canvas.', error)
    dispose()
    onFailure()
  }
  const lost = (event       ) => { event.preventDefault(); fail('WebGL context lost') }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'default' })
    const gpu = renderer
    gpu.toneMapping = THREE.ACESFilmicToneMapping
    gpu.toneMappingExposure = 0.85
    gpu.debug.onShaderError = () => fail('Shader compilation failed')
    canvas.addEventListener('webglcontextlost', lost)
    gpu.setClearColor(0x06050b, 1)
    const threeScene = new THREE.Scene()
    threeScene.background = new THREE.Color(0x06050b)
    ambient=createAmbientParticles(threeScene);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400)
    const pal          = { a: new THREE.Color(), b: new THREE.Color(), c: new THREE.Color(), d: new THREE.Color() }
    const palTarget = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()]
    const setPalTarget = (id        ) => PALETTES[id].colors.forEach((c, i) => palTarget[i].set(c))
    setPalTarget(read().palette)
    pal.a.copy(palTarget[0]); pal.b.copy(palTarget[1]); pal.c.copy(palTarget[2]); pal.d.copy(palTarget[3])
    const ctx           = {
      renderer: gpu, scene: threeScene, camera, pal,
      rig: { pos: new THREE.Vector3(0, 4, 14), look: new THREE.Vector3(), fov: 60 },
      px: 1, time: 0,
    }
    camera.position.copy(ctx.rig.pos)
    const curLook = new THREE.Vector3()
    let curIdx = -1
    let firstFrame = true

    const size = () => {
      if (stopped) return
      try {
        const dims=renderSize(root.clientWidth,root.clientHeight,window.devicePixelRatio,read().resolution);if(!dims)return;const {width:w,height:h,pixelRatio:dpr}=dims;
        const key=`${w}:${h}:${dpr}`;if(key===lastSize)return;lastSize=key;
        gpu.setPixelRatio(dpr)
        gpu.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        ctx.px = dpr * Math.max(0.6, h / 900)
        if (!fx) fx = createPostFx(gpu, threeScene, camera, w, h)
        fx.setSize(w, h)
      } catch (error) { fail(error) }
    }
    const queueSize=()=>{cancelAnimationFrame(resizeRaf);resizeRaf=requestAnimationFrame(size)};
    dispose.resize=queueSize;
    for(const event of ['resize','orientationchange','fullscreenchange','visibilitychange'])window.addEventListener(event,queueSize,{signal:resizeEvents.signal});
    ro = new ResizeObserver(queueSize)
    ro.observe(root)
    size()
    if (stopped) return dispose

    const swap = (idx        ) => {
      if (cur) {
        cur.dispose()
        threeScene.fog = null
      }
      cur = scenes[idx].make()
      cur.init(ctx)
      curIdx = idx
    }
    swap(read().want)

    const scaled = makeAnalysis()
    let fade = 0
    let fadeTarget = 0
    let prev = performance.now()
    let palId = read().palette

    const loop = (now        ) => {
      if (stopped) return
      raf = requestAnimationFrame(loop)
      if (document.hidden) { prev = now; return }
      try {
        const dt = Math.min(0.05, Math.max(0.0005, (now - prev) / 1000))
        prev = now
        const L = read()
        const sp = Math.max(0.1, L.speed ?? 1)
        ctx.time += dt * sp
        const raw = sampleAnalysis()
        scaleAnalysis(raw, scaled, L.sens)

        // palette ease
        if (L.palette !== palId) { palId = L.palette; setPalTarget(palId) }
        const pk = 1 - Math.exp(-dt * 3)
        pal.a.lerp(palTarget[0], pk); pal.b.lerp(palTarget[1], pk); pal.c.lerp(palTarget[2], pk); pal.d.lerp(palTarget[3], pk)

        // scene transition (dip to dark, swap, fade back in)
        if (L.want !== curIdx && fadeTarget === 0) fadeTarget = 0.96
        fade += (fadeTarget - fade) * (1 - Math.exp(-dt * 10))
        if (fadeTarget > 0 && fade > 0.93) {
          swap(L.want)
          fadeTarget = 0
        }
        if (fadeElement) fadeElement.style.opacity = fade < 0.004 ? '0' : fade.toFixed(3)

        ambient.update(dt*sp,scaled,ctx,!scenes[curIdx]?.analysis&&L.particles!==false);
        ctx.settings=L;
        cur?.update(dt * sp, scaled, ctx)

        // camera rig easing
        const ck = firstFrame ? 1 : 1 - Math.exp(-dt * 2.4)
        camera.position.lerp(ctx.rig.pos, ck)
        curLook.lerp(ctx.rig.look, ck)
        camera.lookAt(curLook)
        if (Math.abs(camera.fov - ctx.rig.fov) > 0.01) {
          camera.fov += (ctx.rig.fov - camera.fov) * ck
          camera.updateProjectionMatrix()
        }
        firstFrame = false

        if (fx && !scenes[curIdx]?.analysis) {
          const s = Math.min(1.6, L.sens)
          fx.bloom.strength = (0.28 + scaled.energy * 0.25 + scaled.kick * 0.3) * (0.6 + 0.4 * s) * (L.glow ?? 1)
          fx.bloom.radius = 0.55 + scaled.bass * 0.25
          fx.bloom.threshold = 0.55
          fx.render(dt)
        } else gpu.render(threeScene,camera)
      } catch (error) { fail(error) }
    }
    raf = requestAnimationFrame(loop)

  } catch (error) { fail(error) }
  return dispose
}
