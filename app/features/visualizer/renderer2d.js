import {drawAmbientParticles} from './ambient-particles.js';
import {drawExtraScene,EXTRA_SCENES} from './extra-scenes.js';
import { makeAnalysis, sampleAnalysis, scaleAnalysis,               } from './analysis.js'
import { PALETTES } from './scenes/types.js'

/** GPU-independent scenes: the same audio, palettes and controls as the 3D view. */
export function startCanvasVisualizer(canvas                   , root             , read                      )             {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  let w = 1, h = 1, dpr = 1, raf = 0, last = -Infinity, time = 0
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const extraState={};const resizeEvents=new AbortController();let resizeRaf=0,lastSize='';
  const analysis = makeAnalysis()
  const history                 = Array.from({ length: 32 }, () => new Float32Array(48))
  const resize = () => {
    w = Math.max(1, read().resolution?.width || root.clientWidth)
    h = Math.max(1, read().resolution?.height || root.clientHeight)
    dpr = read().resolution ? 1 : Math.min(1.5, window.devicePixelRatio || 1, Math.sqrt(1_800_000 / (w * h)))
    const key=`${w}:${h}:${dpr}`;if(lastSize===key)return;lastSize=key;
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
  }
  const queueSize=()=>{cancelAnimationFrame(resizeRaf);resizeRaf=requestAnimationFrame(resize)};
  for(const event of ['resize','orientationchange','fullscreenchange','visibilitychange'])window.addEventListener(event,queueSize,{signal:resizeEvents.signal});
  const ro = new ResizeObserver(queueSize)
  ro.observe(root)
  resize()

  const draw = (now        ) => {
    raf = requestAnimationFrame(draw)
    if (document.hidden || now - last < 1000 / 30) return
    const dt = Number.isFinite(last) ? Math.min(0.1, (now - last) / 1000) : 1 / 30
    last = now
    const settings = read()
    scaleAnalysis(sampleAnalysis(), analysis, settings.sens)
    const a = analysis
    if (!reducedMotion.matches) time += dt
    const colors = (PALETTES[settings.palette] ?? PALETTES.bloom).colors
    const color = (i        ) => colors[((i % 4) + 4) % 4]
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.shadowBlur = 0
    ctx.fillStyle = '#06050b'
    ctx.fillRect(0, 0, w, h)
    const cx = w / 2, cy = h * 0.45, unit = Math.min(w, h)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.65)
    glow.addColorStop(0, color(0) + '22')
    glow.addColorStop(0.65, color(1) + '08')
    glow.addColorStop(1, '#06050b')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if(settings.want>=6){drawExtraScene(ctx,EXTRA_SCENES[settings.want-6].id,a,w,h,time,colors,extraState,settings);if(!EXTRA_SCENES[settings.want-6].analysis)drawAmbientParticles(ctx,w,h,time,a,colors);return}
    switch (settings.want) {
      case 0: terrain(ctx, a, history, w, h, colors); break
      case 1: {
        // A breathing, layered orbital waveform with bass-driven radius.
        const radius = unit * (0.16 + a.bass * 0.065)
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(time * 0.075)
        for (let ring = 7; ring >= 0; ring--) {
          ctx.beginPath()
          for (let i = 0; i <= 192; i++) {
            const theta = i / 192 * Math.PI * 2
            const band = a.bands[Math.floor(i % 192 / 192 * 64)]
            const r = radius + ring * unit * 0.013 + Math.sin(theta * 5 + time + ring * 0.5) * (6 + band * 30) + a.wave[Math.floor(i / 192 * 511)] * 15
            const x = Math.cos(theta) * r, y = Math.sin(theta) * r
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.strokeStyle = color(ring)
          ctx.globalAlpha = 0.18 + (7 - ring) * 0.08
          ctx.lineWidth = ring === 0 ? 2.5 : 1.3
          ctx.stroke()
        }
        ctx.restore()
        break
      }
      case 2: {
        // Perspective rings travel towards the camera; treble ripples their edges.
        for (let ring = 0; ring < 22; ring++) {
          const z = ((ring / 22 + time * 0.075) % 1)
          const radius = unit * 0.025 + z * z * Math.max(w, h) * 0.8
          ctx.beginPath()
          for (let i = 0; i <= 80; i++) {
            const theta = i / 80 * Math.PI * 2
            const ripple = 1 + a.bands[i % 64] * 0.09
            const x = cx + Math.cos(theta) * radius * ripple
            const y = cy + Math.sin(theta) * radius * ripple * 0.82
            if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          }
          ctx.strokeStyle = color(ring)
          ctx.lineWidth = 0.5 + z * 2 + a.kick
          ctx.globalAlpha = Math.sin(z * Math.PI) * 0.8
          ctx.stroke()
        }
        break
      }
      case 3: {
        // Dense four-arm galaxy: warm core, rotating star lanes and bright clusters.
        ctx.save();ctx.translate(cx,cy);ctx.rotate(time*.035);
        const halo=ctx.createRadialGradient(0,0,0,0,0,unit*.35);halo.addColorStop(0,'#fff4d9aa');halo.addColorStop(.12,color(2)+'88');halo.addColorStop(.45,color(0)+'30');halo.addColorStop(1,color(0)+'00');ctx.fillStyle=halo;ctx.fillRect(-unit*.4,-unit*.4,unit*.8,unit*.8);
        const hash=n=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x)},count=w<600?3800:8500;
        for(let i=0;i<count;i++){const rn=Math.pow(hash(i+1),1.25),arm=i%4,theta=arm*Math.PI/2+rn*9+(hash(i+800)-.5)*.7+time*.055/(.4+rn),radius=rn*unit*(.54+a.bass*.05),x=Math.cos(theta)*radius,y=Math.sin(theta)*radius*.56+(hash(i+1900)-.5)*unit*.022;ctx.fillStyle=rn<.15?'#fff3d6':color(i);ctx.globalAlpha=.18+hash(i+170)*.65;const size=.45+hash(i+90)*1.2+a.bands[i%64]*.8;ctx.fillRect(x,y,size,size);if(i%109===0){ctx.globalAlpha=.5;ctx.fillRect(x-3,y,size+6,.7);ctx.fillRect(x,y-3,.7,size+6)}}
        ctx.restore()
        break
      }
      case 4: {
        for (let row = 0; row < 15; row++) {
          ctx.beginPath()
          for (let i = 0; i < 256; i++) {
            const x = w * (0.08 + i / 255 * 0.84)
            const wave = a.wave[i * 2]
            const y = cy + (row - 7) * unit * 0.018 + wave * unit * (0.07 + a.energy * 0.1) + Math.sin(i * 0.025 + time + row * 0.18) * unit * 0.028
            if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          }
          ctx.strokeStyle = color(Math.floor(row / 4))
          ctx.globalAlpha = 0.15 + Math.sin(row / 14 * Math.PI) * 0.7
          ctx.lineWidth = row === 7 ? 2.5 : 1.2
          ctx.stroke()
        }
        break
      }
      default: {
        const count = Math.min(64, Math.max(20, Math.floor(w / 15)))
        const gap = w * 0.78 / count, baseline = h * 0.66
        for (let i = 0; i < count; i++) {
          const band = a.bands[Math.floor(i / count * 63)]
          const height = Math.max(3, band * h * 0.48)
          const x = w * 0.11 + i * gap
          const gradient = ctx.createLinearGradient(0, baseline - height, 0, baseline)
          gradient.addColorStop(0, color(1)); gradient.addColorStop(1, color(0))
          ctx.globalAlpha = 0.95
          ctx.fillStyle = gradient
          ctx.fillRect(x, baseline - height, gap * 0.65, height)
          ctx.globalAlpha = 0.12
          ctx.fillRect(x, baseline + 5, gap * 0.65, height * 0.35)
        }
      }
    }
    drawAmbientParticles(ctx,w,h,time,a,colors);
    ctx.globalAlpha = 1
  }
  raf = requestAnimationFrame(draw)
  const dispose=() => { cancelAnimationFrame(raf);cancelAnimationFrame(resizeRaf);resizeEvents.abort();ro.disconnect() };dispose.resize=queueSize;return dispose;
}

function terrain(ctx                          , a          , history                , w        , h        , colors          ) {
  const row = history.pop()
  for (let x = 0; x < row.length; x++) row[x] = a.bands[Math.floor(Math.abs(x - 23.5) / 23.5 * 56)]
  history.unshift(row)
  const project = (x        , z        ) => {
    const depth = 1 - z / history.length
    const perspective = 0.12 + depth * depth * 0.88
    return [w / 2 + (x / 47 - 0.5) * w * 1.4 * perspective,
      h * 0.29 + depth * depth * h * 0.54 - history[z][x] * h * 0.24 * perspective]
  }
  for (let z = history.length - 1; z >= 0; z--) {
    ctx.beginPath()
    for (let x = 0; x < 48; x++) {
      const [px, py] = project(x, z)
      if (!x) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = colors[Math.floor(z / 8) % 4]
    ctx.globalAlpha = 0.15 + (1 - z / history.length) * 0.7
    ctx.lineWidth = 1.1
    ctx.stroke()
  }
  for (let x = 0; x < 48; x += 3) {
    ctx.beginPath()
    for (let z = history.length - 1; z >= 0; z--) {
      const [px, py] = project(x, z)
      if (z === history.length - 1) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = colors[0]
    ctx.globalAlpha = 0.2
    ctx.stroke()
  }
}
