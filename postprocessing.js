// ============================================================================
//  postprocessing.js — cinematic pipeline
//  RenderPass → SSAO(optional) → UnrealBloom → OutputPass → grade → FXAA
//  Quality: high (SSAO+bloom+grade) / medium (bloom+grade) / low (grade only)
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Cinematic grade: saturation, contrast, teal shadows / warm highlights,
// vignette and fine film grain. Runs in display space (after OutputPass).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSaturation: { value: 1.18 },
    uContrast: { value: 1.08 },
    uVignette: { value: 0.28 },
    uGrain: { value: 0.024 },
    uWarm: { value: 0.5 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uSaturation, uContrast, uVignette, uGrain, uWarm;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // saturation
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSaturation);

      // contrast around mid grey
      c = (c - 0.5) * uContrast + 0.5;

      // split tone: cool shadows, warm highlights
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      c += vec3(-0.012, 0.0, 0.026) * (1.0 - smoothstep(0.0, 0.5, lum)) * uWarm;
      c += vec3(0.022, 0.008, -0.018) * smoothstep(0.5, 1.0, lum) * uWarm;

      // vignette
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.95, 0.28, length(d) * 1.15);
      c *= mix(1.0, v, uVignette);

      // film grain
      float n = hash(vUv * vec2(1024.0, 768.0) + fract(uTime));
      c += (n - 0.5) * uGrain;

      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};

export function createPost(renderer, scene, camera, quality = 'high') {
  const w = window.innerWidth, h = window.innerHeight;
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(w, h);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // SSAO — contact shadows in corners (expensive, optional)
  let ssao = null;
  if (quality === 'high') {
    try {
      ssao = new SSAOPass(scene, camera, w, h);
      ssao.kernelRadius = 10;
      ssao.minDistance = 0.002;
      ssao.maxDistance = 0.12;
      ssao.output = SSAOPass.OUTPUT.Default;
      composer.addPass(ssao);
    } catch (e) { console.warn('SSAO unavailable', e); }
  }

  // Bloom — lantern/moon glow
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.24, 0.55, 0.97);
  bloom.threshold = 0.97;
  bloom.strength = 0.24;
  bloom.radius = 0.55;
  if (quality !== 'low') composer.addPass(bloom);

  // Tone mapping + sRGB
  const output = new OutputPass();
  composer.addPass(output);

  // Cinematic grade
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uVignette.value = 0.32;
  grade.uniforms.uGrain.value = 0.03;
  composer.addPass(grade);

  // FXAA
  const fxaa = new ShaderPass(FXAAShader);
  const pr = renderer.getPixelRatio();
  fxaa.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
  composer.addPass(fxaa);

  return {
    composer,
    bloom,
    ssao,
    grade,
    quality,
    render(dt) {
      grade.uniforms.uTime.value += dt;
      composer.render(dt);
    },
    setSize(nw, nh) {
      composer.setSize(nw, nh);
      bloom.setSize(nw, nh);
      if (ssao) ssao.setSize(nw, nh);
      const p = renderer.getPixelRatio();
      fxaa.material.uniforms['resolution'].value.set(1 / (nw * p), 1 / (nh * p));
    },
    setQuality(q) {
      this.quality = q;
      if (ssao) ssao.enabled = (q === 'high');
      bloom.enabled = (q !== 'low');
    },
    setBloomStrength(s) { bloom.strength = s; },
  };
}
