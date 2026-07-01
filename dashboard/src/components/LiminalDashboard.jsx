/**
 * LiminalDashboard — 3D force-directed mind map of the motor-pool's live system state.
 * Nodes = hub, services, endpoints, sessions. Links = spring-physics edges.
 * Built with Three.js: starfield, glow sprites, OrbitControls, raycasting.
 */
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── Node type config ──────────────────────────────────────────────────────────
const TYPE_CFG = {
  hub:      { radius: 1.35, hex: 0x5b8cff, glowHex: '#5b8cff', emissive: 0x0c1a60, label: 'Hub' },
  service:  { radius: 0.55, hex: 0x89c97f, glowHex: '#89c97f', emissive: 0x0d2d15, label: 'Service' },
  endpoint: { radius: 0.50, hex: 0xc298e0, glowHex: '#c298e0', emissive: 0x2a0d44, label: 'Endpoint' },
  session:  { radius: 0.38, hex: 0xe0a073, glowHex: '#e0a073', emissive: 0x3d1a00, label: 'Session' },
  offline:  { radius: 0.45, hex: 0x2e2e42, glowHex: '#2e2e42', emissive: 0x080810, label: 'Offline' },
};

function hexNumToRgbStr(hex) {
  return `rgb(${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff})`;
}

// Glow texture cache (radial gradient canvas → Three texture)
const _glowCache = new Map();
function getGlowTex(hexStr) {
  if (_glowCache.has(hexStr)) return _glowCache.get(hexStr);
  const sz = 128, half = sz / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = sz;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0,    hexStr + 'dd');
  g.addColorStop(0.2,  hexStr + '88');
  g.addColorStop(0.6,  hexStr + '22');
  g.addColorStop(1,    hexStr + '00');
  c.fillStyle = g;
  c.fillRect(0, 0, sz, sz);
  const tex = new THREE.CanvasTexture(cv);
  _glowCache.set(hexStr, tex);
  return tex;
}

// Golden-ratio sphere distribution for initial node placement
const PHI = Math.PI * (3 - Math.sqrt(5));
function goldenPos(i, total, radius) {
  if (total <= 1) return new THREE.Vector3(radius, 0, 0);
  const y = 1 - (i / (total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(
    Math.cos(PHI * i) * r * radius,
    y * radius,
    Math.sin(PHI * i) * r * radius,
  );
}

function buildGraph({ systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys }) {
  const nodes = [];
  const links = [];

  nodes.push({
    id: 'hub', label: 'motor-pool', type: 'hub', fixed: true,
    pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(),
    meta: { desc: 'Central AI orchestration hub', detail: 'All agents, models and sessions radiate from here.' },
  });

  // Services
  const svcs = Object.entries(systemServices?.services || {});
  svcs.forEach(([key, svc], i) => {
    const p = goldenPos(i, svcs.length, 5.5);
    nodes.push({
      id: `svc_${key}`, label: svc.label || key,
      type: svc.running ? 'service' : 'offline',
      pos: p, vel: new THREE.Vector3(),
      meta: {
        desc: svc.running ? '● running' : '○ stopped',
        backend: svc.backendType || '',
        stats: svc.stats ? `CPU ${svc.stats.cpu}  MEM ${svc.stats.memPerc}` : '',
      },
    });
    links.push({ from: 'hub', to: `svc_${key}` });
  });

  // Endpoints
  const eps = (selectableEndpointKeys || []);
  eps.forEach((key, i) => {
    const ep = (dockerStatus?.endpoints || {})[key] || {};
    const meta = allEndpointMeta?.[key] || {};
    const p = goldenPos(i, eps.length, 7);
    p.x += 3.5;
    nodes.push({
      id: `ep_${key}`, label: meta.label || key,
      type: ep.live ? 'endpoint' : 'offline',
      pos: p, vel: new THREE.Vector3(),
      meta: {
        desc: ep.live ? '● live' : '○ offline',
        model: ep.model || '',
        type: meta.backendBadge || 'custom',
      },
    });
    const parentId = ep.backendType === 'ollama-container' && nodes.some(n => n.id === 'svc_ollama')
      ? 'svc_ollama' : 'hub';
    links.push({ from: parentId, to: `ep_${key}` });
  });

  // Sessions (latest 10)
  const recent = (sessions || []).slice(0, 10);
  recent.forEach((s, i) => {
    const epId = `ep_${s.endpoint}`;
    const parentExists = nodes.some(n => n.id === epId);
    const p = goldenPos(i, recent.length, 9);
    p.x -= 3.5;
    nodes.push({
      id: `sess_${s.id}`, label: s.name || `Session ${i + 1}`,
      type: 'session', sessionId: s.id,
      pos: p, vel: new THREE.Vector3(),
      meta: {
        desc: `${s.messageCount || 0} messages`,
        experience: s.experience || '',
        date: s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '',
      },
    });
    links.push({ from: parentExists ? epId : 'hub', to: `sess_${s.id}` });
  });

  return { nodes, links };
}

// ── Physics step ──────────────────────────────────────────────────────────────
const _tmp = new THREE.Vector3();
function physicsStep(nodes, links, linkMap, dt = 0.016) {
  const K_REP  = 9;
  const K_SPR  = 0.045;
  const REST   = 5.5;
  const DAMP   = 0.90;

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a.fixed) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      _tmp.subVectors(a.pos, b.pos);
      const d = Math.max(_tmp.length(), 0.5);
      const f = K_REP / (d * d);
      _tmp.normalize().multiplyScalar(f);
      a.vel.add(_tmp);
      if (!b.fixed) b.vel.sub(_tmp);
    }
  }

  for (const link of links) {
    const src = linkMap.get(link.from);
    const tgt = linkMap.get(link.to);
    if (!src || !tgt) continue;
    _tmp.subVectors(tgt.pos, src.pos);
    const d = _tmp.length();
    const f = (d - REST) * K_SPR;
    _tmp.normalize().multiplyScalar(f);
    if (!src.fixed) src.vel.add(_tmp);
    if (!tgt.fixed) tgt.vel.sub(_tmp);
  }

  for (const n of nodes) {
    if (n.fixed) continue;
    n.vel.multiplyScalar(DAMP);
    n.pos.addScaledVector(n.vel, dt);
    // Gentle containment
    if (n.pos.length() > 18) n.pos.setLength(18);
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LiminalDashboard({
  systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys,
  runningServices, totalServices, wsConnected,
  onSelectSession, onCreateSession, selectedExperience, EXPERIENCE_META,
}) {
  const mountRef      = useRef(null);
  const sceneRef      = useRef(null);
  const graphDataRef  = useRef(null);
  const [selected, setSelected] = useState(null);
  const [hovered,  setHovered]  = useState(null);

  // Compute topology key: node IDs + link structure — changes only when nodes/links added/removed
  const topologyKey = useMemo(() => {
    const svcKeys = Object.keys(systemServices?.services || {}).sort().join(',');
    const epKeys = (selectableEndpointKeys || []).slice().sort().join(',');
    const epTypes = selectableEndpointKeys
      ? selectableEndpointKeys.map(k => allEndpointMeta?.[k]?.backendType || '').join(',')
      : '';
    const sessIds = (sessions || []).slice(0, 10).map(s => s.id).join(',');
    const sessEps = (sessions || []).slice(0, 10).map(s => s.endpoint || '').join(',');
    return `${svcKeys}|${epKeys}:${epTypes}|${sessIds}:${sessEps}`;
  }, [systemServices, selectableEndpointKeys, allEndpointMeta, sessions]);

  const graphData = useMemo(
    () => buildGraph({ systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys }),
    [systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys],
  );

  // Keep a ref to the latest graphData so the topology effect can read fresh live status
  graphDataRef.current = graphData;

  // Update node materials in-place when only live status changes (no full scene rebuild)
  useEffect(() => {
    const sRef = sceneRef.current;
    if (!sRef?._nodeMap) return;
    const latest = graphDataRef.current;
    if (!latest) return;
    const latestByType = new Map(latest.nodes.map(n => [n.id, n.type]));
    for (const [id, node] of sRef._nodeMap) {
      const newType = latestByType.get(id);
      if (newType && node.type !== newType && node._mat) {
        node.type = newType;
        const cfg = TYPE_CFG[newType] ?? TYPE_CFG.offline;
        node._mat.color.setHex(cfg.hex);
        node._mat.emissive.setHex(cfg.emissive);
        node._mat.opacity = newType === 'offline' ? 0.45 : 0.92;
      }
    }
  }, [graphData]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let W = mount.clientWidth;
    let H = mount.clientHeight;

    // ── Renderer ──────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x08090f, 1);
    mount.appendChild(renderer.domElement);

    // ── Scene ─────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x08090f, 0.016);

    // ── Camera ────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 300);
    camera.position.set(0, 5, 24);

    // ── Controls ──────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.055;
    controls.minDistance    = 4;
    controls.maxDistance    = 70;
    controls.autoRotate     = true;
    controls.autoRotateSpeed = 0.35;

    // ── Lights ────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x111828, 3));
    const keyL = new THREE.PointLight(0x5b8cff, 4, 35);
    keyL.position.set(0, 6, 2);
    scene.add(keyL);
    const fillL = new THREE.PointLight(0xc298e0, 2, 25);
    fillL.position.set(-10, -4, 6);
    scene.add(fillL);
    const rimL = new THREE.PointLight(0x89c97f, 1.5, 20);
    rimL.position.set(8, 2, -8);
    scene.add(rimL);

    // ── Starfield ─────────────────────────────────────────────────
    {
      const N = 3500;
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      const starColors = [
        [0.6, 0.7, 1.0], [0.8, 0.6, 1.0], [0.5, 0.8, 0.9], [1.0, 1.0, 1.0],
      ];
      for (let i = 0; i < N; i++) {
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        const r  = 85 + Math.random() * 55;
        pos[i*3]   = r * Math.sin(ph) * Math.cos(th);
        pos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
        pos[i*3+2] = r * Math.cos(ph);
        const c = starColors[Math.floor(Math.random() * starColors.length)];
        col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size: 0.22, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      scene.add(new THREE.Points(geo, mat));
    }

    // ── Nodes + Sprites ───────────────────────────────────────────
    const { nodes, links } = graphData;
    const nodeMap  = new Map(nodes.map(n => [n.id, n]));
    const allMeshes = [];
    const spriteList = [];
    const sphereGeos = new Map();

    function getGeo(r) {
      const k = r.toFixed(2);
      if (!sphereGeos.has(k)) sphereGeos.set(k, new THREE.SphereGeometry(r, 32, 24));
      return sphereGeos.get(k);
    }

    for (const node of nodes) {
      const cfg = TYPE_CFG[node.type] ?? TYPE_CFG.offline;

      const mat = new THREE.MeshPhongMaterial({
        color: cfg.hex,
        emissive: cfg.emissive,
        emissiveIntensity: node.type === 'hub' ? 1.0 : 0.55,
        shininess: 90,
        transparent: true,
        opacity: node.type === 'offline' ? 0.45 : 0.92,
      });
      const mesh = new THREE.Mesh(getGeo(cfg.radius), mat);
      mesh.position.copy(node.pos);
      mesh.userData.nodeId = node.id;
      scene.add(mesh);
      allMeshes.push(mesh);
      node._mesh = mesh;
      node._mat  = mat;

      // Hub gets an extra wire ring
      if (node.type === 'hub') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(cfg.radius * 1.55, 0.035, 8, 64),
          new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }),
        );
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);
        node._ring = ring;
      }

      // Glow sprite
      const spMat = new THREE.SpriteMaterial({
        map: getGlowTex(cfg.glowHex),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: node.type === 'hub' ? 0.7 : 0.45,
      });
      const sprite = new THREE.Sprite(spMat);
      const sz = cfg.radius * (node.type === 'hub' ? 6.5 : 5.0);
      sprite.scale.set(sz, sz, 1);
      sprite.position.copy(node.pos);
      scene.add(sprite);
      spriteList.push({ sprite, node, spMat });
    }

    // ── Link lines ────────────────────────────────────────────────
    const linkObjects = [];
    for (const link of links) {
      const src = nodeMap.get(link.from);
      const tgt = nodeMap.get(link.to);
      if (!src || !tgt) continue;
      const srcCfg = TYPE_CFG[src.type] ?? TYPE_CFG.offline;
      const pts = [src.pos.clone(), tgt.pos.clone()];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: srcCfg.hex,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      linkObjects.push({ line, geo, src, tgt });
    }

    // ── Label canvas overlay ──────────────────────────────────────
    const labelCv = document.createElement('canvas');
    Object.assign(labelCv.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    labelCv.width  = W;
    labelCv.height = H;
    mount.appendChild(labelCv);
    const lctx = labelCv.getContext('2d');

    // ── Raycaster ─────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer   = new THREE.Vector2();
    let _hovId = null;

    function nodeAtEvent(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(allMeshes);
      return hits.length ? nodeMap.get(hits[0].object.userData.nodeId) ?? null : null;
    }

    function handleClick(e) {
      const n = nodeAtEvent(e);
      setSelected(n ?? null);
      controls.autoRotate = !n;
    }

    function handleMouseMove(e) {
      const n = nodeAtEvent(e);
      const id = n?.id ?? null;
      if (id !== _hovId) {
        _hovId = id;
        setHovered(n ?? null);
        renderer.domElement.style.cursor = n ? 'pointer' : 'default';
      }
    }

    renderer.domElement.addEventListener('click', handleClick);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);

    // ── Resize ────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      W = mount.clientWidth;
      H = mount.clientHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
      labelCv.width  = W;
      labelCv.height = H;
    });
    ro.observe(mount);

    // ── Animation ─────────────────────────────────────────────────
    const projVec = new THREE.Vector3();
    let frame = 0, rafId;

    function animate() {
      rafId = requestAnimationFrame(animate);
      frame++;

      // Physics settles after ~500 frames
      if (frame < 500) physicsStep(nodes, links, nodeMap);

      const t = frame * 0.016;

      // Sync mesh positions
      for (const n of nodes) {
        n._mesh.position.copy(n.pos);
        if (n._ring) {
          n._ring.position.copy(n.pos);
          n._ring.rotation.z = t * 0.4;
          n._ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.3) * 0.15;
        }
        // Hover scale pop
        const isHov = n.id === _hovId;
        const targetScale = isHov ? 1.3 : 1.0;
        n._mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
      }

      // Sync glow sprites
      for (const { sprite, node, spMat } of spriteList) {
        sprite.position.copy(node.pos);
        const pulse = 0.88 + 0.12 * Math.sin(t * 1.8 + node.pos.x * 0.4);
        const baseOp = node.type === 'hub' ? 0.72 : (node.type === 'offline' ? 0.12 : 0.42);
        const hovBoost = node.id === _hovId ? 0.3 : 0;
        spMat.opacity = (baseOp + hovBoost) * pulse;
      }

      // Key light pulse
      keyL.intensity = 3.5 + 0.8 * Math.sin(t * 0.6);

      // Sync link lines
      for (const { geo, src, tgt } of linkObjects) {
        const pos = geo.getAttribute('position');
        pos.setXYZ(0, src.pos.x, src.pos.y, src.pos.z);
        pos.setXYZ(1, tgt.pos.x, tgt.pos.y, tgt.pos.z);
        pos.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);

      // ── Label pass ──────────────────────────────────────────────
      lctx.clearRect(0, 0, W, H);
      for (const n of nodes) {
        projVec.copy(n.pos).project(camera);
        if (projVec.z > 1) continue;
        const px = ( projVec.x * 0.5 + 0.5) * W;
        const py = (-projVec.y * 0.5 + 0.5) * H;
        const cfg = TYPE_CFG[n.type] ?? TYPE_CFG.offline;
        const isHov = n.id === _hovId;
        const off = (cfg.radius + 0.25) * (H / (2 * Math.tan((Math.PI * 58) / 360) * (n.pos.distanceTo(camera.position))));
        const labelY = py + off + 4;

        lctx.font = isHov || n.type === 'hub'
          ? '700 12px "Inter", system-ui, sans-serif'
          : '400 10px "Inter", system-ui, sans-serif';
        lctx.textAlign = 'center';
        lctx.textBaseline = 'top';

        const color = hexNumToRgbStr(cfg.hex);
        lctx.fillStyle = 'rgba(0,0,0,0.65)';
        lctx.fillText(n.label, px + 1, labelY + 1);
        lctx.fillStyle = isHov ? '#fff' : color;
        lctx.fillText(n.label, px, labelY);

        if (isHov && n.meta?.desc) {
          lctx.font = '400 9px "Inter", system-ui, sans-serif';
          lctx.fillStyle = 'rgba(200,210,230,0.75)';
          lctx.fillText(n.meta.desc, px, labelY + 14);
        }
      }
    }

    animate();
    sceneRef.current = { renderer, scene, camera, controls, _nodeMap: nodeMap };

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      controls.dispose();
      for (const [, geo] of sphereGeos) geo.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (mount.contains(labelCv)) mount.removeChild(labelCv);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey]);

  const handleOpenSession = useCallback(() => {
    if (selected?.sessionId) onSelectSession?.(selected.sessionId);
    setSelected(null);
  }, [selected, onSelectSession]);

  const exp = EXPERIENCE_META ?? {};

  return (
    <div className="liminal-root">
      {/* Three.js mount */}
      <div ref={mountRef} className="liminal-canvas-mount" />

      {/* ── Top stats bar ── */}
      <div className="liminal-topbar">
        <span className="liminal-chip">{runningServices ?? 0}/{totalServices ?? 0} services</span>
        <span className="liminal-chip">{(sessions || []).length} sessions</span>
        <span className="liminal-chip liminal-chip-dim">{(selectableEndpointKeys || []).length} endpoints</span>
      </div>

      {/* ── Floating CTA — only when nothing selected ── */}
      {!selected && (
        <div className="liminal-hero">
          <div className="liminal-hero-title">motor-pool</div>
          <div className="liminal-hero-sub">Your AI motor pool · click any node to explore</div>
          <button className="liminal-hero-btn" onClick={onCreateSession}>
            ＋ New Session
          </button>
        </div>
      )}

      {/* ── Experience quick-pick ── */}
      {!selected && Object.keys(exp).length > 0 && (
        <div className="liminal-exp-strip">
          {Object.entries(exp).map(([key, e]) => (
            <button
              key={key}
              className={`liminal-exp-chip ${selectedExperience === key ? 'liminal-exp-chip-active' : ''}`}
              onClick={() => onCreateSession?.(key)}
              title={e.description}
            >
              {e.icon} {e.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Node detail panel ── */}
      {selected && (
        <div className="liminal-panel" onClick={e => e.stopPropagation()}>
          <div className="liminal-panel-top">
            <span className="liminal-panel-badge">{TYPE_CFG[selected.type]?.label ?? selected.type}</span>
            <button className="liminal-panel-close" onClick={() => { setSelected(null); sceneRef.current?.controls && (sceneRef.current.controls.autoRotate = true); }}>✕</button>
          </div>
          <div className="liminal-panel-name">{selected.label}</div>
          <div className="liminal-panel-meta">
            {Object.entries(selected.meta ?? {}).map(([k, v]) =>
              v ? (
                <div key={k} className="liminal-panel-row">
                  <span className="liminal-panel-key">{k}</span>
                  <span className="liminal-panel-val">{String(v)}</span>
                </div>
              ) : null
            )}
          </div>
          {selected.type === 'session' && (
            <button className="liminal-panel-action" onClick={handleOpenSession}>Open Session →</button>
          )}
          {selected.type === 'hub' && (
            <button className="liminal-panel-action" onClick={onCreateSession}>＋ New Session</button>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="liminal-legend">
        {Object.entries(TYPE_CFG).filter(([k]) => k !== 'offline').map(([type, cfg]) => (
          <div key={type} className="liminal-legend-row">
            <span className="liminal-legend-dot" style={{ background: `#${cfg.hex.toString(16).padStart(6,'0')}` }} />
            <span>{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* ── Hint ── */}
      <div className="liminal-hint">drag · scroll · click</div>
    </div>
  );
}
