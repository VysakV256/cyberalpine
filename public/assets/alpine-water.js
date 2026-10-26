/* Planar alpine water. No dependencies beyond the supplied local Three instance.
 * update(time) accepts requestAnimationFrame milliseconds, before the main render.
 * The surface stays flat: ripples alter shading, never the navigation field. */
export function createAlpineWater(THREE, renderer, scene, camera, options = {}) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const x = finite(options.x, 0), z = finite(options.z, 0), y = finite(options.y, 0);
  const radius = Math.max(.1, finite(options.radius, 10));
  const reducedMotion = options.reducedMotion === true;
  const resolution = renderer.getPixelRatio() > 1.2 ? 768 : 512;
  const target = new THREE.WebGLRenderTarget(resolution, resolution, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false,
  });
  target.texture.name = 'Cyberalpine planar water reflection';
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.texture.generateMipmaps = false;
  const mirrorCamera = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();
  const biasMatrix = new THREE.Matrix4().set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1);
  const planeNormal = new THREE.Vector3(0,1,0);
  const clipPlane = new THREE.Plane(planeNormal.clone(), -y - .015);
  const worldPosition = new THREE.Vector3(), direction = new THREE.Vector3(), lookAt = new THREE.Vector3();
  const orientation = new THREE.Quaternion(), up = new THREE.Vector3();
  const savedViewport = new THREE.Vector4(), savedScissor = new THREE.Vector4(), savedClearColor = new THREE.Color();
  const lightPosition = new THREE.Vector3(), lightTarget = new THREE.Vector3();
  let sun = null;
  scene.traverse(object => { if (object.isDirectionalLight && (!sun || object.intensity > sun.intensity)) sun = object; });
  const uniforms = {
    reflectionMap: { value: target.texture }, textureMatrix: { value: textureMatrix },
    time: { value: 0 }, reflectionReady: { value: 0 },
    waterCenter: { value: new THREE.Vector2(x,z) }, waterRadius: { value: radius },
    deepColor: { value: new THREE.Color('#123f39') },
    shoreColor: { value: new THREE.Color('#8bc7c5') },
    skyTint: { value: new THREE.Color('#b8dbe4') },
    sunDirection: { value: new THREE.Vector3(-.4,.85,-.3).normalize() },
    sunColor: { value: new THREE.Color('#eaf7eb') },
  };
  const material = new THREE.ShaderMaterial({
    name: 'Cyberalpine reflected alpine water',
    uniforms, transparent: false, depthWrite: true, depthTest: true,
    side: THREE.DoubleSide, toneMapped: true,
    vertexShader: `
      uniform mat4 textureMatrix;
      varying vec3 vWorldPosition;
      varying vec4 vReflectionCoord;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vReflectionCoord = textureMatrix * worldPosition;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D reflectionMap;
      uniform float time;
      uniform float reflectionReady;
      uniform vec2 waterCenter;
      uniform float waterRadius;
      uniform vec3 deepColor;
      uniform vec3 shoreColor;
      uniform vec3 skyTint;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      varying vec3 vWorldPosition;
      varying vec4 vReflectionCoord;
      #include <common>
      vec2 rippleGradient(vec2 p) {
        vec2 a = vec2(.83, .56);
        vec2 b = vec2(-.38, .93);
        vec2 c = vec2(.95, -.31);
        return a * cos(dot(p,a)*2.1 + time*.77) * .033
             + b * cos(dot(p,b)*3.9 - time*.61) * .019
             + c * cos(dot(p,c)*8.2 + time*1.11) * .008;
      }
      void main() {
        vec2 p = vWorldPosition.xz;
        vec2 gradient = rippleGradient(p);
        vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
        float fresnel = .02 + .98 * pow(1.0-facing, 5.0);
        float radial = clamp(length(p-waterCenter)/waterRadius, 0.0, 1.0);
        float depth = pow(max(0.0, 1.0-radial*radial), .65);
        vec3 bodyColor = mix(shoreColor, deepColor, depth);
        float caustic = pow(.5+.5*sin(p.x*3.2+p.y*1.7+time*.45), 7.0)
                      * pow(.5+.5*sin(p.y*4.8-p.x*.8-time*.3), 5.0);
        bodyColor += shoreColor * caustic * (1.0-depth) * .18;
        vec2 reflectionUV = vReflectionCoord.xy / max(vReflectionCoord.w, .0001);
        reflectionUV += gradient * .011 * clamp(1.0-facing, .2, 1.0);
        vec2 safeUV = clamp(reflectionUV, vec2(.002), vec2(.998));
        vec3 reflected = texture2D(reflectionMap, safeUV).rgb;
        float inBounds = step(0.0,reflectionUV.x)*step(reflectionUV.x,1.0)
                       * step(0.0,reflectionUV.y)*step(reflectionUV.y,1.0)
                       * step(0.0,vReflectionCoord.w) * reflectionReady;
        reflected = mix(skyTint, reflected, inBounds);
        float reflectivity = .13 + .84*fresnel;
        vec3 color = mix(bodyColor, reflected, reflectivity);
        vec3 halfDirection = normalize(sunDirection+viewDirection);
        float specular = pow(max(dot(normal, halfDirection),0.0), 190.0);
        float broadSpecular = pow(max(dot(normal, halfDirection),0.0), 34.0);
        color += sunColor * (specular*1.8 + broadSpecular*.07);
        float shoreRim = smoothstep(.965,1.0,radial);
        color = mix(color, shoreColor*.84, shoreRim*.27);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const geometry = new THREE.CircleGeometry(radius, 128);
  geometry.rotateX(-Math.PI/2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Commonwater · reflected planar surface';
  mesh.position.set(x,y,z);
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  let frame = 0, disposed = false, reflecting = false;
  function update(time = 0) {
    if (disposed || reflecting) return;
    uniforms.time.value = reducedMotion ? 0 : finite(time,0)*.001;
    if (sun) {
      sun.getWorldPosition(lightPosition);
      sun.target.getWorldPosition(lightTarget);
      uniforms.sunDirection.value.copy(lightPosition).sub(lightTarget).normalize();
      uniforms.sunColor.value.copy(sun.color).multiplyScalar(Math.min(4,Math.max(0,sun.intensity))*.55);
    }
    // A bounded mirror pass avoids a second full scene render on every frame.
    if (frame++ % 3 !== 0) return;
    camera.updateMatrixWorld();
    camera.getWorldPosition(worldPosition);
    if (worldPosition.y <= y + .015) return;
    camera.getWorldDirection(direction);
    lookAt.copy(worldPosition).add(direction);
    lookAt.y = 2*y-lookAt.y;
    mirrorCamera.position.copy(worldPosition);
    mirrorCamera.position.y = 2*y-worldPosition.y;
    camera.getWorldQuaternion(orientation);
    up.set(0,1,0).applyQuaternion(orientation).reflect(planeNormal);
    mirrorCamera.up.copy(up);
    mirrorCamera.lookAt(lookAt);
    mirrorCamera.near = camera.near; mirrorCamera.far = camera.far;
    mirrorCamera.layers.mask = camera.layers.mask;
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCamera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    mirrorCamera.updateMatrixWorld();
    textureMatrix.copy(biasMatrix).multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace ? renderer.getActiveCubeFace() : 0;
    const previousMipmap = renderer.getActiveMipmapLevel ? renderer.getActiveMipmapLevel() : 0;
    const previousXR = renderer.xr.enabled;
    const previousShadowUpdate = renderer.shadowMap.autoUpdate;
    const previousClipping = renderer.clippingPlanes;
    const previousAutoClear = renderer.autoClear;
    const previousScissorTest = renderer.getScissorTest();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousVisibility = mesh.visible;
    renderer.getViewport(savedViewport); renderer.getScissor(savedScissor); renderer.getClearColor(savedClearColor);
    reflecting = true;
    try {
      mesh.visible = false;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.clippingPlanes = [...previousClipping, clipPlane];
      renderer.autoClear = true;
      renderer.setRenderTarget(target);
      renderer.setViewport(0,0,resolution,resolution);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(scene,mirrorCamera);
      uniforms.reflectionReady.value = 1;
    } finally {
      mesh.visible = previousVisibility;
      renderer.xr.enabled = previousXR;
      renderer.shadowMap.autoUpdate = previousShadowUpdate;
      renderer.clippingPlanes = previousClipping;
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget,previousFace,previousMipmap);
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setClearColor(savedClearColor,previousClearAlpha);
      reflecting = false;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent(); geometry.dispose(); material.dispose(); target.dispose();
  }
  return {mesh,update,dispose};
}
