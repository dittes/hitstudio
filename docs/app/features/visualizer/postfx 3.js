import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export function createPostFx(renderer                     , scene             , camera              , w        , h        )         {
  const composer = new EffectComposer(renderer)
  let pixelRatio=renderer.getPixelRatio()
  const rp = new RenderPass(scene, camera)
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.55, 0.1)
  const out = new OutputPass()
  composer.addPass(rp)
  composer.addPass(bloom)
  composer.addPass(out)
  composer.setSize(w, h)
  return {
    composer,
    bloom,
    setSize(nw, nh) {
      if(pixelRatio!==renderer.getPixelRatio()){pixelRatio=renderer.getPixelRatio();composer.setPixelRatio(pixelRatio)}
      composer.setSize(nw, nh)
    },
    render(dt) {
      composer.render(dt)
    },
    dispose() {
      rp.dispose()
      bloom.dispose()
      out.dispose()
      composer.dispose()
    },
  }
}
