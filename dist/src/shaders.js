// shaders.js — ボクセル用マテリアルと空のドーム
import * as THREE from '../three.module.js';

export function voxelMaterial(atlas, { transparent = false } = {}) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uAtlas: { value: null },
      uDay: { value: 1 },              // 昼の明るさ 0..1
      uSkyLight: { value: new THREE.Color('#ffffff') },
      uTorchLight: { value: new THREE.Color('#ffb45a') },
      uAmbient: { value: new THREE.Color('#20262e') },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunStrength: { value: 1 },      // 直射日光の強さ（夜は0）
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowOn: { value: 0 },
      uHeldLight: { value: 0 },        // 手に持った松明などの明るさ
      uPlayerPos: { value: new THREE.Vector3() },
      uCamPos: { value: new THREE.Vector3() },
      uWaterLayer: { value: -1 },
    },
  ]);
  uniforms.uAtlas.value = atlas;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms, fog: true, transparent,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute float aLayer;
      attribute vec3 aLight;   // x:空の光 y:光源の光 z:AO×面の陰影
      attribute float aAnim;   // 1 なら水面として揺らす
      attribute vec3 aNormal;
      varying vec2 vUv;
      varying float vLayer;
      varying vec3 vLight;
      varying float vAnim;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec4 vShadow;
      uniform float uTime;
      uniform mat4 uShadowMatrix;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vLayer = aLayer; vLight = aLight; vAnim = aAnim; vNormal = aNormal;
        vec3 transformed = position;
        transformed.y -= aAnim * (0.10 + sin(uTime * 1.6 + position.x * 0.6 + position.z * 0.45) * 0.035);
        vWorld = transformed;
        vShadow = uShadowMatrix * vec4(transformed, 1.0);
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      precision highp sampler2DArray;
      // GLSL3 では three が gl_FragColor を用意しないので自分で出力先を宣言する
      layout(location = 0) out highp vec4 pc_fragColor;
      #define gl_FragColor pc_fragColor
      uniform sampler2DArray uAtlas;
      uniform sampler2D uShadowMap;
      uniform float uDay, uTime, uSunStrength, uShadowOn, uHeldLight, uWaterLayer;
      uniform vec3 uSkyLight, uTorchLight, uAmbient, uSunDir, uPlayerPos, uCamPos;
      varying vec2 vUv;
      varying float vLayer;
      varying vec3 vLight;
      varying float vAnim;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec4 vShadow;
      #include <packing>
      #include <fog_pars_fragment>

      // 影：光源から見た深さと比べる（3x3 でぼかす）
      float shadowTerm() {
        if (uShadowOn < 0.5) return 1.0;
        vec3 s = vShadow.xyz / vShadow.w;
        if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
        float bias = 0.0016;
        float sum = 0.0;
        float texel = 1.0 / 2048.0;
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
          float d = unpackRGBAToDepth(texture(uShadowMap, s.xy + vec2(float(i), float(j)) * texel));
          sum += (s.z - bias > d) ? 0.0 : 1.0;
        }
        return sum / 9.0;
      }

      void main() {
        vec2 uv = vUv + vec2(sin(uTime * .5 + vUv.y * 6.283) * .02, uTime * .03) * vAnim;
        vec4 tex = texture(uAtlas, vec3(uv, vLayer));
        ${transparent ? '' : 'if (tex.a < 0.5) discard;'}

        vec3 n = normalize(vNormal);
        // 太陽の向きで面の明るさが変わる。裏側の面も空の光でうっすら明るい。
        float ndl = max(dot(n, uSunDir), 0.0);
        float shade = shadowTerm();
        float direct = ndl * shade * uSunStrength;
        float skyLevel = pow(vLight.x, 1.35);
        float sky = skyLevel * uDay * (0.62 + 0.55 * direct);

        // 光源の光。手に持った松明の分も足す。
        float torch = pow(vLight.y, 1.6);
        float hd = distance(vWorld, uPlayerPos + vec3(0.0, 1.2, 0.0));
        float held = uHeldLight * pow(max(0.0, 1.0 - hd / 9.0), 2.0) * (0.55 + 0.45 * max(dot(n, normalize(uPlayerPos + vec3(0.0, 1.2, 0.0) - vWorld)), 0.0));
        torch = max(torch, held);

        vec3 lit = uSkyLight * sky + uTorchLight * torch * 1.25 + uAmbient;
        lit = min(lit, vec3(1.45));
        vec3 col = tex.rgb * lit * vLight.z;

        // 水面：見る角度で空を映し、太陽のきらめきを足す
        if (abs(vLayer - uWaterLayer) < 0.5) {
          vec3 v = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - max(dot(v, n), 0.0), 3.0);
          col += uSkyLight * fres * 0.45 * uDay * skyLevel;
          vec3 h = normalize(v + uSunDir);
          float spec = pow(max(dot(n, h), 0.0), 90.0);
          col += uSkyLight * spec * 0.9 * uSunStrength * shade * skyLevel;
          tex.a = mix(tex.a, 0.92, fres);
        }

        gl_FragColor = vec4(col, tex.a);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return mat;
}

// --- 空 ---------------------------------------------------------------------
export function makeSky() {
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#3f7fd0') },
      uMid: { value: new THREE.Color('#9fd0e8') },
      uBottom: { value: new THREE.Color('#cfe4ee') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff2cf') },
      uStars: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uBottom, uSunDir, uSunColor;
      uniform float uStars;
      float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 1.15 + .08, -1.0, 1.0);
        vec3 col = h > 0.0 ? mix(uMid, uTop, pow(h, .65)) : mix(uMid, uBottom, clamp(-h * 3.0, 0.0, 1.0));
        // 太陽・月まわりのにじみ
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(s, 90.0) * 2.2;
        col += uSunColor * pow(s, 7.0) * .16;
        col += uSunColor * pow(s, 2.2) * .05;
        // 星
        if (uStars > 0.001 && d.y > -0.05) {
          vec3 g = floor(d * 190.0);
          float st = hash(g);
          if (st > 0.9965) col += vec3(st) * uStars * (0.6 + 0.4 * sin(hash(g + 3.0) * 40.0));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(400);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
