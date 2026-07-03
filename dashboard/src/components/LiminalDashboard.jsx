/**
 * LiminalDashboard — 3D force-directed mind map of the motor-pool's live system state.
 * Nodes = hub, services, endpoints, sessions. Links = spring-physics edges.
 * Built with Three.js: starfield, glow sprites, OrbitControls, raycasting.
 */
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── Experience → session color map ───────────────────────────────────────────
const EXPERIENCE_NODE_COLOR = {
  safechat:   { hex: 0x00e5ff, glow: '#00e5ff', emissive: 0x003344 },
  nemoclaw:   { hex: 0xff4d6d, glow: '#ff4d6d', emissive: 0x440011 },
  creative:   { hex: 0xf472b6, glow: '#f472b6', emissive: 0x440030 },
  research:   { hex: 0x60a5fa, glow: '#60a5fa', emissive: 0x001144 },
  assistant:  { hex: 0xa78bfa, glow: '#a78bfa', emissive: 0x1a0044 },
  code:       { hex: 0x34d399, glow: '#34d399', emissive: 0x003322 },
  default:    { hex: 0xe0a073, glow: '#e0a073', emissive: 0x3d1a00 },
};

// ── Node type config ──────────────────────────────────────────────────────────
// endpoint = green (live connected router/container); model = purple (AI models)
const TYPE_CFG = {
  hub:      { radius: 1.35, hex: 0x5b8cff, glowHex: '#5b8cff', emissive: 0x0c1a60, label: 'Hub' },
  service:  { radius: 0.55, hex: 0x89c97f, glowHex: '#89c97f', emissive: 0x0d2d15, label: 'Service' },
  endpoint: { radius: 0.52, hex: 0x6dcc82, glowHex: '#6dcc82', emissive: 0x0a2e14, label: 'Endpoint' },
  model:    { radius: 0.42, hex: 0xc298e0, glowHex: '#c298e0', emissive: 0x2a0d44, label: 'Model' },
  session:  { radius: 0.38, hex: 0xe0a073, glowHex: '#e0a073', emissive: 0x3d1a00, label: 'Session' },
  offline:  { radius: 0.42, hex: 0x2e2e42, glowHex: '#2e2e42', emissive: 0x080810, label: 'Offline' },
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

// Orbital ring radii
const R_SVC      = 3.5;   // services inner ring
const R_ENDPOINT = 7.0;   // endpoint ring (Ollama ↔ 9router)
const R_MODEL    = 12.0;  // model ring
const R_SESSION  = 17.0;  // session outer ring

// Y positions: active nodes cluster near y=0, inactive drain below (black-hole gravity).
const Y_ACTIVE       =  0;
const Y_OFFLINE_EP   = -8;
const Y_OFFLINE_SVC  = -6;
const Y_OFFLINE_MOD  = -5;

function isOllamaKey(key, ep) {
  return ep.backendType === 'ollama-container' || ep.backendType === 'ollama' || key.includes('ollama');
}
function is9RouterKey(key) {
  return key.includes('9router') || key.includes('local_20128');
}

// Modular model list resolver — extend this as new endpoint types are added.
// Returns [{name, isDefault}] for a given endpoint.
function getEndpointModels(key, ep, knownModels) {
  // Backend-reported model array (highest priority)
  if (Array.isArray(ep.models) && ep.models.length) {
    return ep.models.map(m => ({ name: String(m), isDefault: m === ep.model || m === ep.defaultModel }));
  }
  // 9router: use known combos from knownModels prop, default to ['MAX']
  if (is9RouterKey(key)) {
    const routerModels = (knownModels || [])
      .filter(m => m.epKey === key || m.endpoint === key)
      .map(m => m.id || m.name || String(m));
    const combos = routerModels.length ? routerModels : ['MAX'];
    return combos.map(name => ({ name, isDefault: name === (ep.defaultModel || ep.model || 'MAX') }));
  }
  // Ollama / other single-model endpoints
  if (ep.model) return [{ name: ep.model, isDefault: true }];
  return [];
}

function buildGraph({ systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys, knownModels }) {
  const nodes = [];
  const links = [];

  nodes.push({
    id: 'hub', label: 'motor-pool', type: 'hub', fixed: true, internal: true,
    pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(),
    orbitRadius: 0, orbitAngle: 0, orbitSpeed: 0, targetY: 0,
    meta: { desc: 'Central AI orchestration hub', detail: 'All agents, models and sessions radiate from here.' },
  });

  // ── Services (Ring 0 — innermost, r=3.5) ──────────────────────────────────
  const svcs = Object.entries(systemServices?.services || {});
  svcs.forEach(([key, svc], i) => {
    const angle = (i / Math.max(svcs.length, 1)) * Math.PI * 2;
    const isRunning = svc.running;
    const svcYOffset = isRunning ? (i % 2 === 0 ? 0.8 : -0.8) : 0;
    const targetY = isRunning ? svcYOffset : Y_OFFLINE_SVC;
    nodes.push({
      id: `svc_${key}`, label: svc.label || key,
      type: isRunning ? 'service' : 'offline',
      pos: new THREE.Vector3(Math.cos(angle) * R_SVC, targetY, Math.sin(angle) * R_SVC),
      vel: new THREE.Vector3(),
      orbitRadius: R_SVC, orbitAngle: angle, orbitSpeed: 0.014, targetY,
      internal: true, svcKey: key,
      meta: {
        desc: isRunning ? '● running' : '○ stopped',
        backend: svc.backendType || '',
        ports: svc.ports || '',
        stats: svc.stats ? `CPU ${svc.stats.cpu}  MEM ${svc.stats.memPerc}` : '',
      },
    });
    links.push({ from: 'hub', to: `svc_${key}` });
  });

  // ── Endpoints (Ring 1 — r=7) ───────────────────────────────────────────────
  // Ollama pinned at angle=0, 9router pinned at angle=π, others fill between.
  const eps = (selectableEndpointKeys || []);
  const ollamaKeys  = eps.filter(k => isOllamaKey(k, (dockerStatus?.endpoints || {})[k] || {}));
  const routerKeys  = eps.filter(k => is9RouterKey(k));
  const otherEpKeys = eps.filter(k => !ollamaKeys.includes(k) && !routerKeys.includes(k));

  const epAngles = {};
  ollamaKeys.forEach((k, i) => {
    epAngles[k] = (i / Math.max(ollamaKeys.length, 1)) * 0.6 - 0.3;  // cluster near 0
  });
  routerKeys.forEach((k, i) => {
    epAngles[k] = Math.PI + (i / Math.max(routerKeys.length, 1)) * 0.6 - 0.3;  // cluster near π
  });
  // Other endpoints fill the top/bottom quadrants
  otherEpKeys.forEach((k, i) => {
    epAngles[k] = (Math.PI / 2) + (i / Math.max(otherEpKeys.length, 1)) * Math.PI;
  });

  eps.forEach((key) => {
    const ep = (dockerStatus?.endpoints || {})[key] || {};
    const meta = allEndpointMeta?.[key] || {};
    const isLive = ep.live !== false;
    const angle = epAngles[key] ?? 0;
    const isExternal = ep.backendType === 'custom' || ep.type === 'custom' || is9RouterKey(key);
    const isOllamaChild = ep.backendType === 'ollama-container' && nodes.some(n => n.id === 'svc_ollama');
    const parentId = isOllamaChild ? 'svc_ollama' : 'hub';
    const targetY = isLive ? Y_ACTIVE : Y_OFFLINE_EP;

    nodes.push({
      id: `ep_${key}`, label: meta.label || key,
      type: isLive ? 'endpoint' : 'offline',
      pos: new THREE.Vector3(Math.cos(angle) * R_ENDPOINT, targetY, Math.sin(angle) * R_ENDPOINT),
      vel: new THREE.Vector3(),
      orbitRadius: R_ENDPOINT, orbitAngle: angle, orbitSpeed: 0.007, targetY,
      internal: !isExternal, epKey: key,
      meta: {
        desc: isLive ? '● live' : '○ offline',
        model: ep.model || '',
        type: meta.backendBadge || meta.backendType || 'custom',
        url: ep.resolvedUrl || '',
      },
    });
    links.push({ from: parentId, to: `ep_${key}` });

    // ── Model nodes (Ring 2 — r=12) ─────────────────────────────────────────
    // getEndpointModels is the modular resolver: extend it for new endpoint types.
    const modelList = getEndpointModels(key, ep, knownModels);
    const spread = Math.min(0.55, 1.4 / Math.max(modelList.length, 1));

    modelList.forEach(({ name, isDefault }, mi) => {
      const mAngle = angle + (mi - (modelList.length - 1) / 2) * spread;
      const mTargetY = isDefault ? Y_ACTIVE : Y_OFFLINE_MOD;
      const shortLabel = name.split(':')[0].split('/').pop();
      const modelId = `model_${key}_${mi}`;
      nodes.push({
        id: modelId, label: shortLabel,
        type: isDefault ? 'model' : 'offline',
        pos: new THREE.Vector3(Math.cos(mAngle) * R_MODEL, mTargetY, Math.sin(mAngle) * R_MODEL),
        vel: new THREE.Vector3(),
        orbitRadius: R_MODEL, orbitAngle: mAngle, orbitSpeed: 0.004, targetY: mTargetY,
        modelName: name, isDefaultModel: isDefault,
        meta: { desc: isDefault ? '● active model' : '○ available', model: name },
      });
      links.push({ from: `ep_${key}`, to: modelId });
    });
  });

  // ── Sessions (Ring 3 — outermost, r=17) ───────────────────────────────────
  // Sessions link to their endpoint's default model node when available,
  // so for 9router sessions they orbit around MAX (or whichever combo was used).
  const recent = (sessions || []).slice(0, 10);
  recent.forEach((s, i) => {
    const epId = `ep_${s.endpoint}`;
    const epNode = nodes.find(n => n.id === epId);
    // Prefer linking to the default model node of this session's endpoint
    const defaultModelNode = nodes.find(n =>
      n.id.startsWith(`model_${s.endpoint}_`) && n.isDefaultModel
    );
    const parentId = defaultModelNode?.id ?? (epNode ? epId : 'hub');
    const parentNode = nodes.find(n => n.id === parentId);
    const baseAngle = parentNode ? parentNode.orbitAngle : (i / Math.max(recent.length, 1)) * Math.PI * 2;
    const angle = baseAngle + (i % 3 - 1) * 0.28;
    const expColor = EXPERIENCE_NODE_COLOR[s.experience] ?? EXPERIENCE_NODE_COLOR.default;
    // Slight Y spread per session so they have volumetric depth, not a flat ring
    const sessionY = (i % 3 - 1) * 1.8;
    nodes.push({
      id: `sess_${s.id}`, label: s.name || `Session ${i + 1}`,
      type: 'session', sessionId: s.id,
      pos: new THREE.Vector3(Math.cos(angle) * R_SESSION, sessionY, Math.sin(angle) * R_SESSION),
      vel: new THREE.Vector3(),
      orbitRadius: R_SESSION, orbitAngle: angle, orbitSpeed: 0.002, targetY: sessionY,
      customHex: expColor.hex, customGlow: expColor.glow, customEmissive: expColor.emissive,
      meta: {
        desc: `${s.messageCount || 0} messages`,
        experience: s.experience || '',
        date: s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '',
      },
    });
    links.push({ from: parentId, to: `sess_${s.id}` });
  });

  return { nodes, links };
}

// ── Orbital physics ───────────────────────────────────────────────────────────
// Nodes orbit in the XZ plane (y=0 is the ecliptic).
// Active nodes are pulled strongly to y=0; inactive nodes sink far below.
// Repulsion is XZ-only so it never knocks nodes off the orbital plane.
const _tmp  = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
function physicsStep(nodes, links, linkMap, dt = 0.016) {
  const K_ORBIT      = 0.14;   // XZ spring toward orbital radius
  const K_GRAV_ACT   = 0.40;   // strong pull back to y=0 for active nodes
  const K_GRAV_INACT = 0.28;   // pull inactive nodes downward
  const K_REP        = 5.0;    // XZ-only repulsion (keeps nodes spread on ring)
  const DAMP         = 0.80;

  for (const n of nodes) {
    if (n.fixed) continue;

    // Advance orbital angle slowly (inner rings orbit faster, outer slower)
    n.orbitAngle = (n.orbitAngle ?? 0) + (n.orbitSpeed ?? 0);

    // XZ spring: pull toward current orbital position on the ring
    const tx = Math.cos(n.orbitAngle) * (n.orbitRadius ?? 0);
    const tz = Math.sin(n.orbitAngle) * (n.orbitRadius ?? 0);
    n.vel.x += (tx - n.pos.x) * K_ORBIT;
    n.vel.z += (tz - n.pos.z) * K_ORBIT;

    // Y gravity: active → snap to y=0, inactive → fall below (black hole drain)
    const ty = n.targetY ?? 0;
    const K_G = ty < 0 ? K_GRAV_INACT : K_GRAV_ACT;
    n.vel.y += (ty - n.pos.y) * K_G;
  }

  // XZ-only repulsion — never push nodes off the ecliptic plane
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a.fixed) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      // Only repel nodes on the same ring (same orbitRadius)
      if (Math.abs((a.orbitRadius ?? 0) - (b.orbitRadius ?? 0)) > 1) continue;
      _tmpB.set(a.pos.x - b.pos.x, 0, a.pos.z - b.pos.z);
      const d = Math.max(_tmpB.length(), 0.4);
      if (d > 4) continue;
      const f = K_REP / (d * d);
      _tmpB.normalize().multiplyScalar(f);
      a.vel.x += _tmpB.x; a.vel.z += _tmpB.z;
      if (!b.fixed) { b.vel.x -= _tmpB.x; b.vel.z -= _tmpB.z; }
    }
  }

  for (const n of nodes) {
    if (n.fixed) continue;
    n.vel.multiplyScalar(DAMP);
    n.pos.addScaledVector(n.vel, dt);
    // Clamp inactive nodes so they don't fall forever
    if ((n.targetY ?? 0) < 0) n.pos.y = Math.max(n.pos.y, n.targetY - 3);
  }
}

// ── Service node detail panel content ────────────────────────────────────────
function ServiceDetail({ node, systemServices, dockerStatus, modelPulls, serviceActionsInFlight, onRunServiceAction, onPullModel, knownModels }) {
  const svcKey = node.svcKey;
  const svc = systemServices?.services?.[svcKey];
  const canControl = !!(systemServices?.dockerControlEnabled && svc?.controllable);
  const isRunning = svc?.running ?? false;

  const containerEndpoints = svcKey === 'ollama'
    ? Object.entries(dockerStatus?.endpoints || {}).filter(([, ep]) => ep.backendType === 'ollama-container')
    : svcKey === 'llm_openllm'
    ? Object.entries(dockerStatus?.endpoints || {}).filter(([, ep]) => ep.backendType === 'openllm-container')
    : [];

  return (
    <div style={{ fontSize: '0.72rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span style={{ color: isRunning ? 'var(--green)' : 'var(--text-faint)' }}>
          {isRunning ? '● running' : '○ offline'}
        </span>
        {canControl && (
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {isRunning ? (
              <>
                <button className="btn-service-icon restart-btn" disabled={serviceActionsInFlight?.[`${svcKey}:restart`]} title="Restart" onClick={() => onRunServiceAction?.(svcKey, 'restart')}>{serviceActionsInFlight?.[`${svcKey}:restart`] ? '…' : '↺'}</button>
                <button className="btn-service-icon stop-btn" disabled={serviceActionsInFlight?.[`${svcKey}:stop`]} title="Stop" onClick={() => onRunServiceAction?.(svcKey, 'stop')}>{serviceActionsInFlight?.[`${svcKey}:stop`] ? '…' : '■'}</button>
              </>
            ) : (
              <button className="btn-service-icon start-btn" disabled={serviceActionsInFlight?.[`${svcKey}:start`]} title="Start" onClick={() => onRunServiceAction?.(svcKey, 'start')}>{serviceActionsInFlight?.[`${svcKey}:start`] ? '…' : '▶'}</button>
            )}
          </div>
        )}
      </div>
      {svc?.ports && <div style={{ color: 'var(--text-faint)', marginBottom: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '0.67rem' }}>port {svc.ports}</div>}
      {svc?.stats && isRunning && (
        <div style={{ color: 'var(--text-faint)', fontSize: '0.63rem', fontFamily: 'var(--font-mono)', marginBottom: '0.3rem', display: 'flex', gap: '0.5rem' }}>
          <span>CPU {svc.stats.cpu}</span><span>{svc.stats.mem}</span><span>({svc.stats.memPerc})</span>
        </div>
      )}
      {containerEndpoints.map(([epKey, ep]) => {
        const pullKey = `${epKey}:${ep.model}`;
        const pull = modelPulls?.[pullKey];
        const installed = ep.modelInstalled ?? ep.modelLoaded;
        const pulling = pull?.status === 'pulling';
        return (
          <div key={epKey} style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.67rem' }}>{ep.model || '—'}</span>
            {installed && <span style={{ color: 'var(--green)', fontSize: '0.63rem' }}>✓</span>}
            {!installed && ep.model && <span style={{ color: 'var(--yellow)', fontSize: '0.63rem' }}>not pulled</span>}
            {pull?.status === 'pulling' && <span style={{ color: 'var(--accent)', fontSize: '0.63rem' }}>{pull.percent != null ? `${pull.percent}%` : 'pulling…'}</span>}
            {!installed && ep.model && onPullModel && (
              <button className="btn-docker-action" style={{ fontSize: '0.63rem', padding: '0.1rem 0.3rem' }} disabled={pulling} onClick={() => onPullModel(epKey, ep.model)}>Pull</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LiminalDashboard({
  systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys,
  runningServices, totalServices, wsConnected,
  onSelectSession, onCreateSession, selectedExperience, EXPERIENCE_META,
  onRunServiceAction, serviceActionsInFlight, modelPulls, onPullModel, knownModels,
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
    () => buildGraph({ systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys, knownModels }),
    [systemServices, dockerStatus, sessions, allEndpointMeta, selectableEndpointKeys, knownModels],
  );

  graphDataRef.current = graphData;

  // Update node materials in-place when only live status changes (no full scene rebuild)
  useEffect(() => {
    const sRef = sceneRef.current;
    if (!sRef?._nodeMap) return;
    const latest = graphDataRef.current;
    if (!latest) return;
    const latestById = new Map(latest.nodes.map(n => [n.id, n]));
    for (const [id, node] of sRef._nodeMap) {
      const updated = latestById.get(id);
      if (!updated || !node._mat) continue;
      if (node.type !== updated.type) {
        node.type = updated.type;
        const cfg = TYPE_CFG[updated.type] ?? TYPE_CFG.offline;
        node._mat.color.setHex(updated.customHex ?? cfg.hex);
        node._mat.emissive.setHex(updated.customEmissive ?? cfg.emissive);
        node._mat.opacity = updated.type === 'offline' ? 0.38 : 0.95;
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
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 400);
    camera.position.set(0, 28, 22);  // ~52° elevation — horizontal disk reads clearly

    // ── Controls ──────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.055;
    controls.minDistance    = 4;
    controls.maxDistance    = 100;
    controls.autoRotate     = true;
    controls.autoRotateSpeed = 0.35;

    // ── Lights ────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x111828, 3));
    const keyL = new THREE.PointLight(0x5b8cff, 4, 60);
    keyL.position.set(0, 10, 4);
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

    // No flat planes — nodes exist as a volumetric 3D network in deep space.

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
      // Session nodes use their experience color if available
      const nodeHex      = node.customHex      ?? cfg.hex;
      const nodeEmissive = node.customEmissive ?? cfg.emissive;
      const nodeGlow     = node.customGlow     ?? cfg.glowHex;

      const mat = new THREE.MeshPhongMaterial({
        color: nodeHex,
        emissive: nodeEmissive,
        emissiveIntensity: node.type === 'hub' ? 1.2 : 0.65,
        shininess: 120,
        transparent: true,
        opacity: node.type === 'offline' ? 0.38 : 0.95,
      });
      const mesh = new THREE.Mesh(getGeo(cfg.radius), mat);
      mesh.position.copy(node.pos);
      mesh.userData.nodeId = node.id;
      scene.add(mesh);
      allMeshes.push(mesh);
      node._mesh = mesh;
      node._mat  = mat;

      if (node.type === 'hub') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(cfg.radius * 1.55, 0.035, 8, 64),
          new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }),
        );
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);
        node._ring = ring;
      }

      const spMat = new THREE.SpriteMaterial({
        map: getGlowTex(nodeGlow),
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

      physicsStep(nodes, links, nodeMap);

      const t = frame * 0.016;

      for (const n of nodes) {
        n._mesh.position.copy(n.pos);
        if (n._ring) {
          n._ring.position.copy(n.pos);
          n._ring.rotation.z = t * 0.4;
          n._ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.3) * 0.15;
        }
        const isHov = n.id === _hovId;
        const targetScale = isHov ? 1.3 : 1.0;
        n._mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
      }

      for (const { sprite, node, spMat } of spriteList) {
        sprite.position.copy(node.pos);
        const pulse = 0.88 + 0.12 * Math.sin(t * 1.8 + node.pos.x * 0.4);
        const baseOp = node.type === 'hub' ? 0.72 : (node.type === 'offline' ? 0.12 : 0.42);
        const hovBoost = node.id === _hovId ? 0.3 : 0;
        spMat.opacity = (baseOp + hovBoost) * pulse;
      }

      keyL.intensity = 3.5 + 0.8 * Math.sin(t * 0.6);

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

      {/* ── Legend + hint — upper right ── */}
      <div className="liminal-legend">
        {Object.entries(TYPE_CFG).filter(([k]) => k !== 'offline').map(([type, cfg]) => (
          <div key={type} className="liminal-legend-row">
            <span className="liminal-legend-dot" style={{ background: `#${cfg.hex.toString(16).padStart(6,'0')}` }} />
            <span>{cfg.label}</span>
          </div>
        ))}
        <div className="liminal-hint liminal-hint--inline">drag · scroll · click</div>
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

      {/* ── Experience quick-pick — desktop strip / mobile dropdown ── */}
      {!selected && Object.keys(exp).length > 0 && (
        <>
          {/* Desktop: pill strip */}
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
          {/* Mobile: dropdown */}
          <div className="liminal-exp-select-wrap">
            <select
              className="liminal-exp-select"
              value={selectedExperience || ''}
              onChange={e => onCreateSession?.(e.target.value)}
            >
              {Object.entries(exp).map(([key, e]) => (
                <option key={key} value={key}>{e.icon} {e.name}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* ── Node detail panel ── */}
      {selected && (
        <div className="liminal-panel" onClick={e => e.stopPropagation()}>
          <div className="liminal-panel-top">
            <span className="liminal-panel-badge">{TYPE_CFG[selected.type]?.label ?? selected.type}</span>
            <button className="liminal-panel-close" onClick={() => { setSelected(null); sceneRef.current?.controls && (sceneRef.current.controls.autoRotate = true); }}>✕</button>
          </div>
          <div className="liminal-panel-name">{selected.label}</div>

          {/* Service node: show controls */}
          {(selected.type === 'service' || (selected.type === 'offline' && selected.svcKey)) && (
            <ServiceDetail
              node={selected}
              systemServices={systemServices}
              dockerStatus={dockerStatus}
              modelPulls={modelPulls}
              serviceActionsInFlight={serviceActionsInFlight}
              onRunServiceAction={onRunServiceAction}
              onPullModel={onPullModel}
              knownModels={knownModels}
            />
          )}

          {/* Endpoint / session: show meta rows */}
          {(selected.type !== 'service' && !(selected.type === 'offline' && selected.svcKey)) && (
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
          )}

          {selected.type === 'session' && (
            <button className="liminal-panel-action" onClick={handleOpenSession}>Open Session →</button>
          )}
          {selected.type === 'hub' && (
            <button className="liminal-panel-action" onClick={onCreateSession}>＋ New Session</button>
          )}
        </div>
      )}

      {/* Hint now lives inside the legend block above */}
    </div>
  );
}
