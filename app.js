/*
 * app.js — Thought Map UI layer: DOM, events, rendering, persistence.
 * All business logic lives in engine.js; this file only wires it to the page.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'thoughtmap-v1';
  const NS = 'http://www.w3.org/2000/svg';

  const $ = (id) => document.getElementById(id);
  const els = {
    svg: $('map'),
    viewport: $('viewport'),
    mapWrap: $('map-wrap'),
    editHost: $('edit-host'),
    capture: $('capture-input'),
    captureHint: $('capture-hint'),
    search: $('search-input'),
    tagList: $('tag-list'),
    stats: $('stats'),
  };

  const state = {
    store: null,
    pos: new Map(),        // last computed layout (map coordinates)
    selectedId: null,
    view: { x: 0, y: 0, z: 1 },
    search: '',
    tagFilter: null,
    editingId: null,
  };

  let justDragged = false;
  let lastTap = { id: null, t: 0 };

  /* ---------- persistence ---------- */

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const res = Engine.deserialize(raw);
      if (res.store) return res.store;
      console.warn('Discarded corrupt saved data:', res.error);
    }
    return Engine.createStore();
  }

  function save() {
    const v = Engine.validateStore(state.store);
    if (!v.ok) {
      console.error('Refusing to save invalid store:', v.errors);
      return;
    }
    localStorage.setItem(STORAGE_KEY, Engine.serialize(state.store));
  }

  /* ---------- view helpers ---------- */

  function applyView() {
    els.viewport.setAttribute('transform',
      `translate(${state.view.x} ${state.view.y}) scale(${state.view.z})`);
  }

  function mapToScreen(p) {
    return { x: state.view.x + p.x * state.view.z, y: state.view.y + p.y * state.view.z };
  }

  function svgPoint(ev) {
    const r = els.svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  /* ---------- rendering ---------- */

  function highlightSet() {
    const hl = new Set();
    const add = (id) => {
      hl.add(id);
      for (const a of Engine.pathToRoot(state.store, id)) hl.add(a);
    };
    if (state.tagFilter) {
      for (const id of Engine.clustersByTag(state.store).get(state.tagFilter) || []) add(id);
    }
    if (state.search.trim()) {
      const r = Engine.searchNodes(state.store, state.search);
      for (const id of r.matches) add(id);
    }
    return hl;
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  }

  function render() {
    const store = state.store;
    state.pos = Engine.computeLayout(store);
    const hl = highlightSet();
    const filtering = Boolean(state.tagFilter || state.search.trim());
    const vg = els.viewport;
    vg.textContent = '';

    for (const [id, p] of state.pos) {
      if (id === store.rootId) continue;
      const pp = state.pos.get(store.nodes[id].parentId);
      if (!pp) continue;
      const mx = (pp.x + p.x) / 2;
      vg.appendChild(svgEl('path', {
        d: `M ${pp.x} ${pp.y} C ${mx} ${pp.y}, ${mx} ${p.y}, ${p.x} ${p.y}`,
        class: 'link' + (filtering && !hl.has(id) ? ' dim' : ''),
      }));
    }

    for (const [id, p] of state.pos) {
      const n = store.nodes[id];
      const isRoot = id === store.rootId;
      const dim = filtering && !hl.has(id);
      const g = svgEl('g', {
        class: 'node' + (isRoot ? ' root' : '') + (dim ? ' dim' : '') +
               (state.selectedId === id ? ' selected' : ''),
        transform: `translate(${p.x} ${p.y})`,
      });
      g.dataset.id = id;

      g.appendChild(svgEl('circle', { r: isRoot ? 14 : 8 }));

      const label = svgEl('text', { y: isRoot ? -24 : -15, 'text-anchor': 'middle' });
      label.textContent = n.text.length > 44 ? n.text.slice(0, 43) + '…' : (n.text || '(untitled)');
      g.appendChild(label);

      const tip = svgEl('title');
      tip.textContent = n.text || '';
      g.appendChild(tip);

      if (n.tags.length) {
        const tg = svgEl('text', { y: 24, 'text-anchor': 'middle', class: 'tagline' });
        n.tags.forEach((t, i) => {
          if (i) tg.appendChild(document.createTextNode(' '));
          const sp = svgEl('tspan', { 'data-tag': t });
          sp.textContent = '#' + t;
          if (state.tagFilter === t) sp.setAttribute('class', 'active');
          tg.appendChild(sp);
        });
        g.appendChild(tg);
      }

      const kids = Engine.childrenOf(store, id);
      if (n.collapsed && kids.length) {
        const b = svgEl('text', { y: 4, 'text-anchor': 'middle', class: 'badge' });
        b.textContent = '+' + kids.length;
        g.appendChild(b);
      }
      vg.appendChild(g);
    }

    applyView();
    renderSidebar();
    updateCaptureHint();
  }

  function renderSidebar() {
    const store = state.store;
    const clusters = Engine.clustersByTag(store);
    els.tagList.textContent = '';

    if (!clusters.size) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No tags yet — add “#tag” when capturing.';
      els.tagList.appendChild(li);
    }
    const sorted = [...clusters.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [tag, ids] of sorted) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      const label = document.createTextNode('#' + tag);
      btn.appendChild(label);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = ids.length;
      btn.appendChild(count);
      if (state.tagFilter === tag) btn.classList.add('active');
      btn.addEventListener('click', () => {
        state.tagFilter = state.tagFilter === tag ? null : tag;
        render();
      });
      li.appendChild(btn);
      els.tagList.appendChild(li);
    }

    const nodeCount = Object.keys(store.nodes).length;
    const branches = Engine.childrenOf(store, store.rootId).length;
    els.stats.textContent =
      `${nodeCount - 1} thoughts · ${clusters.size} tags · ${branches} branches`;
  }

  function updateCaptureHint() {
    const id = state.selectedId && state.store.nodes[state.selectedId]
      ? state.selectedId : state.store.rootId;
    const label = id === state.store.rootId
      ? 'root' : `“${state.store.nodes[id].text}”`;
    els.captureHint.textContent = `into ${label}`;
  }

  /* ---------- capture & edit ---------- */

  function captureTargetId() {
    return state.selectedId && state.store.nodes[state.selectedId]
      ? state.selectedId : state.store.rootId;
  }

  function handleCapture() {
    const { text, tags } = Engine.parseQuickEntry(els.capture.value);
    if (!text && !tags.length) return;
    const parentId = captureTargetId();
    if (state.store.nodes[parentId].collapsed) {
      state.store = Engine.updateNode(state.store, parentId, { collapsed: false });
    }
    state.store = Engine.addNode(state.store, { text, tags, parentId }).store;
    save();
    els.capture.value = '';
    render();
  }

  function currentEditInput() {
    return els.editHost.querySelector('.edit-pop');
  }

  function closeEdit() {
    state.editingId = null;
    const input = currentEditInput();
    if (input) input.remove();
  }

  function commitEdit() {
    const input = currentEditInput();
    const id = state.editingId;
    if (!input || !id) { closeEdit(); return; }
    const { text, tags } = Engine.parseQuickEntry(input.value);
    if (!text && !tags.length) { closeEdit(); return; }
    state.store = Engine.updateNode(state.store, id, { text, tags });
    save();
    closeEdit();
    render();
  }

  function startEdit(id) {
    commitEdit();
    const n = state.store.nodes[id];
    const p = state.pos.get(id);
    if (!n || !p) return;
    state.editingId = id;
    const sp = mapToScreen(p);
    const wrap = els.mapWrap.getBoundingClientRect();
    const input = document.createElement('input');
    input.className = 'edit-pop';
    input.value = n.text + (n.tags.length ? ' ' + n.tags.map((t) => '#' + t).join(' ') : '');
    input.style.left = Math.max(8, Math.min(sp.x - 140, wrap.width - 300)) + 'px';
    input.style.top = (sp.y - 14) + 'px';
    els.editHost.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') closeEdit();
      e.stopPropagation();
    });
    input.addEventListener('blur', () => commitEdit());
  }

  /* ---------- node actions ---------- */

  function deleteSelected() {
    const id = state.selectedId;
    if (!id || id === state.store.rootId) return;
    const parent = state.store.nodes[id].parentId;
    state.store = Engine.deleteNode(state.store, id);
    state.selectedId = parent;
    save();
    render();
  }

  function toggleCollapseSelected() {
    const id = state.selectedId;
    if (!id) return;
    state.store = Engine.toggleCollapse(state.store, id);
    save();
    render();
  }

  /* ---------- events ---------- */

  function bindEvents() {
    els.svg.addEventListener('pointerdown', (e) => {
      if (state.editingId) commitEdit();
      const nodeEl = e.target.closest('.node');
      if (nodeEl) {
        const id = nodeEl.dataset.id;
        const p = state.pos.get(id);
        svgDrag.drag = { id, el: nodeEl, sx: e.clientX, sy: e.clientY, px: p.x, py: p.y, z: state.view.z, moved: false };
        try { els.svg.setPointerCapture(e.pointerId); } catch (_) {}
      } else {
        svgDrag.pan = { sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y, moved: false };
        try { els.svg.setPointerCapture(e.pointerId); } catch (_) {}
      }
    });

    els.svg.addEventListener('pointermove', (e) => {
      const d = svgDrag.drag;
      const p = svgDrag.pan;
      if (d) {
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved) {
          d.el.setAttribute('transform', `translate(${d.px + dx / d.z} ${d.py + dy / d.z})`);
        }
      } else if (p) {
        p.moved = true;
        state.view.x = p.vx + (e.clientX - p.sx);
        state.view.y = p.vy + (e.clientY - p.sy);
        applyView();
      }
    });

    els.svg.addEventListener('pointerup', (e) => {
      const d = svgDrag.drag;
      const p = svgDrag.pan;
      if (d) {
        if (d.moved) {
          const dx = (e.clientX - d.sx) / d.z, dy = (e.clientY - d.sy) / d.z;
          state.store = Engine.updateNode(state.store, d.id, { px: d.px + dx, py: d.py + dy });
          save();
          justDragged = true;
          setTimeout(() => { justDragged = false; }, 400);
        } else {
          state.selectedId = d.id;
          // touch fallback for double-click rename (iOS single-taps, no dblclick)
          if (e.pointerType === 'touch') {
            const now = performance.now();
            if (lastTap.id === d.id && now - lastTap.t < 350) {
              startEdit(d.id);
              lastTap = { id: null, t: 0 };
            } else {
              lastTap = { id: d.id, t: now };
            }
          }
        }
        render();
      } else if (p && !p.moved) {
        state.selectedId = null;
        render();
      }
      svgDrag.drag = null;
      svgDrag.pan = null;
    });

    els.svg.addEventListener('click', (e) => {
      const tagEl = e.target.closest('[data-tag]');
      if (!tagEl) return;
      const t = tagEl.dataset.tag;
      state.tagFilter = state.tagFilter === t ? null : t;
      render();
    });

    els.svg.addEventListener('dblclick', (e) => {
      if (justDragged) return;
      const nodeEl = e.target.closest('.node');
      if (!nodeEl || e.target.closest('[data-tag]')) return;
      startEdit(nodeEl.dataset.id);
    });

    els.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = svgPoint(e);
      const factor = Math.exp(-e.deltaY * 0.0012);
      const z = Math.min(2.5, Math.max(0.25, state.view.z * factor));
      state.view.x = before.x - (before.x - state.view.x) * (z / state.view.z);
      state.view.y = before.y - (before.y - state.view.y) * (z / state.view.z);
      state.view.z = z;
      applyView();
    }, { passive: false });

    // pinch zoom
    let pinch = null;
    els.svg.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        pinch = {
          d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          z: state.view.z,
        };
        svgDrag.drag = null;
        svgDrag.pan = null;
      }
    }, { passive: true });
    els.svg.addEventListener('touchmove', (e) => {
      if (pinch && e.touches.length === 2) {
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        state.view.z = Math.min(2.5, Math.max(0.25, pinch.z * (d / pinch.d)));
        applyView();
      }
    }, { passive: true });
    els.svg.addEventListener('touchend', () => { pinch = null; }, { passive: true });

    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape') {
        if (state.editingId) return;
        state.selectedId = null;
        state.tagFilter = null;
        state.search = '';
        els.search.value = '';
        render();
        return;
      }
      if (typing) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); els.capture.focus(); return; }
      if (e.key === 'Delete') { deleteSelected(); return; }
      if (e.key === ' ') { if (state.selectedId) { e.preventDefault(); toggleCollapseSelected(); } return; }
      if (e.key === 'F2' && state.selectedId) startEdit(state.selectedId);
    });

    $('capture-form').addEventListener('submit', (e) => { e.preventDefault(); handleCapture(); });
    els.search.addEventListener('input', () => { state.search = els.search.value; render(); });

    $('btn-relayout').addEventListener('click', () => {
      const s = Engine.clone(state.store);
      for (const n of Object.values(s.nodes)) { n.px = null; n.py = null; }
      state.store = s;
      save();
      render();
    });

    $('btn-export').addEventListener('click', async () => {
      const raw = Engine.serialize(state.store);
      const name = `thoughts-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([raw], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Thought Map export' }); return; }
        catch (_) { /* cancelled or failed — fall through to download */ }
      }
      const blob = new Blob([raw], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    $('btn-import').addEventListener('click', () => $('file-import').click());
    $('file-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const raw = await file.text();
      const res = Engine.deserialize(raw);
      if (res.error) { alert('Import rejected: ' + res.error); return; }
      state.store = res.store;
      save();
      render();
      e.target.value = '';
    });

    $('btn-reset').addEventListener('click', () => {
      if (!confirm('Delete all thoughts and start fresh?')) return;
      state.store = Engine.createStore();
      state.selectedId = null;
      state.tagFilter = null;
      save();
      render();
    });
  }

  const svgDrag = { drag: null, pan: null };

  /* ---------- init ---------- */

  function init() {
    state.store = load();
    const r = els.svg.getBoundingClientRect();
    state.view = { x: r.width / 2, y: Math.max(120, r.height / 2), z: 1 };
    bindEvents();
    render();
    els.capture.focus();

    // ask WebKit to protect this origin's storage from eviction
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    // offline support (service workers need HTTPS or localhost)
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  init();
})();
