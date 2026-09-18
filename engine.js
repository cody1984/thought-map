/*
 * engine.js — Thought Map calculation engine
 *
 * Pure, deterministic business logic only.
 * No DOM, localStorage, network, timers, or UI-framework dependencies.
 *
 * Usage:
 *   let store = Engine.createStore();
 *   const result = Engine.addNode(store, { text: 'Book bike service', tags: ['cycling'] });
 *   store = result.store;
 */
const Engine = (() => {
  'use strict';

  const VERSION = 1;
  const ROOT_ID = 'root';

  function createStore(rootText = 'Thoughts') {
    return {
      version: VERSION,
      rootId: ROOT_ID,
      seq: 0,
      nodes: {
        [ROOT_ID]: {
          id: ROOT_ID,
          text: String(rootText),
          parentId: null,
          tags: [],
          collapsed: false,
          px: null,
          py: null,
          order: 0,
        },
      },
    };
  }

  function clone(store) {
    const nodes = {};
    for (const [id, node] of Object.entries(store.nodes)) {
      nodes[id] = { ...node, tags: [...node.tags] };
    }
    return {
      version: store.version,
      rootId: store.rootId,
      seq: store.seq,
      nodes,
    };
  }

  function childrenOf(store, id) {
    if (!store.nodes[id]) throw new Error(`childrenOf: unknown node "${id}"`);
    return Object.values(store.nodes)
      .filter((node) => node.parentId === id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  function pathToRoot(store, id) {
    if (!store.nodes[id]) throw new Error(`pathToRoot: unknown node "${id}"`);

    const path = [];
    const maxHops = Object.keys(store.nodes).length + 1;
    let current = store.nodes[id];
    let hops = 0;

    while (current && hops < maxHops) {
      path.push(current.id);
      if (current.parentId === null) return path;
      current = store.nodes[current.parentId];
      hops += 1;
    }

    throw new Error(`pathToRoot: node "${id}" does not reach root`);
  }

  function isDescendant(store, ancestorId, candidateId) {
    if (!store.nodes[ancestorId]) throw new Error(`isDescendant: unknown ancestor "${ancestorId}"`);
    if (!store.nodes[candidateId]) throw new Error(`isDescendant: unknown candidate "${candidateId}"`);

    const maxHops = Object.keys(store.nodes).length + 1;
    let current = store.nodes[candidateId];
    let hops = 0;

    while (current && current.parentId !== null && hops < maxHops) {
      if (current.parentId === ancestorId) return true;
      current = store.nodes[current.parentId];
      hops += 1;
    }
    return false;
  }

  function normaliseTags(tags) {
    if (!Array.isArray(tags)) throw new Error('tags must be an array of strings');

    const seen = new Set();
    const output = [];

    for (const tag of tags) {
      if (typeof tag !== 'string') throw new Error('tags must be an array of strings');
      const clean = tag.trim().replace(/^#/, '').toLowerCase();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        output.push(clean);
      }
    }
    return output;
  }

  function nextAutomaticId(store, seq) {
    let candidate = seq;
    while (store.nodes[`n${candidate}`]) candidate += 1;
    return { id: `n${candidate}`, seq: candidate };
  }

  function addNode(store, options = {}) {
    const result = clone(store);
    const parentId = options.parentId === undefined ? result.rootId : options.parentId;

    if (!result.nodes[parentId]) {
      throw new Error(`addNode: parent "${parentId}" does not exist`);
    }

    let id = options.id;
    let seq = result.seq + 1;

    if (id === undefined || id === null || id === '') {
      const generated = nextAutomaticId(result, seq);
      id = generated.id;
      seq = generated.seq;
    } else {
      id = String(id);
      if (id === result.rootId) throw new Error('addNode: cannot reuse root id');
      if (result.nodes[id]) throw new Error(`addNode: duplicate id "${id}"`);

      const match = /^n(\d+)$/.exec(id);
      if (match) seq = Math.max(seq, Number(match[1]));
    }

    if (result.nodes[id]) throw new Error(`addNode: duplicate id "${id}"`);

    result.seq = seq;
    result.nodes[id] = {
      id,
      text: typeof options.text === 'string' ? options.text.trim() : '',
      parentId,
      tags: normaliseTags(options.tags ?? []),
      collapsed: false,
      px: null,
      py: null,
      order: seq,
    };

    return { store: result, id };
  }

  function updateNode(store, id, patch = {}) {
    const result = clone(store);
    const node = result.nodes[id];

    if (!node) throw new Error(`updateNode: unknown node "${id}"`);

    const permitted = new Set(['text', 'tags', 'collapsed', 'px', 'py']);
    for (const key of Object.keys(patch)) {
      if (!permitted.has(key)) throw new Error(`updateNode: unknown field "${key}"`);
    }

    if ('text' in patch) {
      if (typeof patch.text !== 'string') throw new Error('updateNode: text must be a string');
      node.text = patch.text.trim();
    }

    if ('tags' in patch) node.tags = normaliseTags(patch.tags);

    if ('collapsed' in patch) {
      if (typeof patch.collapsed !== 'boolean') throw new Error('updateNode: collapsed must be boolean');
      node.collapsed = patch.collapsed;
    }

    if ('px' in patch) {
      if (patch.px !== null && !Number.isFinite(patch.px)) throw new Error('updateNode: px must be a finite number or null');
      node.px = patch.px;
    }

    if ('py' in patch) {
      if (patch.py !== null && !Number.isFinite(patch.py)) throw new Error('updateNode: py must be a finite number or null');
      node.py = patch.py;
    }

    return result;
  }

  function toggleCollapse(store, id) {
    if (!store.nodes[id]) throw new Error(`toggleCollapse: unknown node "${id}"`);
    return updateNode(store, id, { collapsed: !store.nodes[id].collapsed });
  }

  function deleteNode(store, id) {
    if (id === store.rootId) throw new Error('deleteNode: cannot delete root node');
    if (!store.nodes[id]) throw new Error(`deleteNode: unknown node "${id}"`);

    const result = clone(store);
    const deletedParent = result.nodes[id].parentId;

    for (const node of Object.values(result.nodes)) {
      if (node.parentId === id) node.parentId = deletedParent;
    }

    delete result.nodes[id];
    return result;
  }

  function moveNode(store, id, newParentId) {
    if (id === store.rootId) throw new Error('moveNode: cannot move root node');
    if (!store.nodes[id]) throw new Error(`moveNode: unknown node "${id}"`);
    if (!store.nodes[newParentId]) throw new Error(`moveNode: unknown parent "${newParentId}"`);
    if (id === newParentId || isDescendant(store, id, newParentId)) {
      throw new Error('moveNode: move would create a cycle');
    }

    const result = clone(store);
    result.nodes[id].parentId = newParentId;
    return result;
  }

  function parseQuickEntry(raw) {
    const tags = [];
    const text = String(raw ?? '')
      .replace(/#([\w-]+)/g, (_, tag) => {
        tags.push(tag.toLowerCase());
        return ' ';
      })
      .replace(/\s+/g, ' ')
      .trim();

    return { text, tags: normaliseTags(tags) };
  }

  function searchNodes(store, query) {
    const q = String(query ?? '').trim().toLowerCase();
    const matches = new Set();
    const highlighted = new Set();

    if (!q) return { matches, highlighted };

    for (const node of Object.values(store.nodes)) {
      const found = node.text.toLowerCase().includes(q) || node.tags.some((tag) => tag.includes(q));
      if (!found) continue;

      matches.add(node.id);
      for (const ancestorId of pathToRoot(store, node.id)) highlighted.add(ancestorId);
    }

    return { matches, highlighted };
  }

  function clustersByTag(store) {
    const clusters = new Map();

    for (const node of Object.values(store.nodes)) {
      if (node.id === store.rootId) continue;

      for (const tag of node.tags) {
        if (!clusters.has(tag)) clusters.set(tag, []);
        clusters.get(tag).push(node.id);
      }
    }

    return clusters;
  }

  function subtreeLeaves(store, id, memo = {}) {
    if (memo[id] !== undefined) return memo[id];

    const node = store.nodes[id];
    if (!node) throw new Error(`subtreeLeaves: unknown node "${id}"`);

    const children = node.collapsed ? [] : childrenOf(store, id);
    memo[id] = children.length === 0
      ? 1
      : children.reduce((total, child) => total + subtreeLeaves(store, child.id, memo), 0);

    return memo[id];
  }

  function computeLayout(store, options = {}) {
    const cx = options.cx ?? 0;
    const cy = options.cy ?? 0;
    const radiusStep = options.radiusStep ?? 190;
    const positions = new Map([[store.rootId, { x: cx, y: cy }]]);
    const memo = {};

    function placeChildren(parentId, startAngle, endAngle, depth) {
      const parent = store.nodes[parentId];
      const children = parent.collapsed ? [] : childrenOf(store, parentId);
      if (!children.length) return;

      const totalLeaves = children.reduce(
        (total, child) => total + subtreeLeaves(store, child.id, memo),
        0,
      );

      let angle = startAngle;
      const radius = radiusStep * depth;

      for (const child of children) {
        const span = (endAngle - startAngle) * subtreeLeaves(store, child.id, memo) / totalLeaves;
        const middle = angle + span / 2;
        const calculated = {
          x: cx + radius * Math.cos(middle),
          y: cy + radius * Math.sin(middle),
        };

        positions.set(child.id, {
          x: child.px ?? calculated.x,
          y: child.py ?? calculated.y,
        });

        placeChildren(child.id, angle, angle + span, depth + 1);
        angle += span;
      }
    }

    placeChildren(store.rootId, -Math.PI / 2, Math.PI * 1.5, 1);
    return positions;
  }

  function validateStore(store) {
    const errors = [];

    if (!store || typeof store !== 'object') {
      return { ok: false, errors: ['Store is not an object'] };
    }
    if (!store.nodes || typeof store.nodes !== 'object') {
      return { ok: false, errors: ['Store has no nodes object'] };
    }
    if (!store.rootId || !store.nodes[store.rootId]) {
      return { ok: false, errors: ['Root node is missing'] };
    }

    const ids = Object.keys(store.nodes);
    const rootNode = store.nodes[store.rootId];

    if (rootNode.parentId !== null) errors.push('Root node must have parentId null');
    if (!Number.isFinite(store.seq) || store.seq < 0) errors.push('seq must be a non-negative finite number');

    for (const [id, node] of Object.entries(store.nodes)) {
      if (!node || typeof node !== 'object') {
        errors.push(`Node "${id}" is not an object`);
        continue;
      }
      if (node.id !== id) errors.push(`Node "${id}" has an id/key mismatch`);
      if (typeof node.text !== 'string') errors.push(`Node "${id}" has non-string text`);
      if (!Array.isArray(node.tags) || node.tags.some((tag) => typeof tag !== 'string')) {
        errors.push(`Node "${id}" has invalid tags`);
      }
      if (node.parentId === id) errors.push(`Node "${id}" is its own parent`);
      if (node.parentId !== null && !store.nodes[node.parentId]) {
        errors.push(`Node "${id}" has a missing parent`);
      }
      if (node.px !== null && !Number.isFinite(node.px)) errors.push(`Node "${id}" has invalid px`);
      if (node.py !== null && !Number.isFinite(node.py)) errors.push(`Node "${id}" has invalid py`);
    }

    for (const id of ids) {
      if (id === store.rootId) continue;
      let current = store.nodes[id];
      let reachesRoot = false;
      let hops = 0;

      while (current && hops <= ids.length) {
        if (current.id === store.rootId) {
          reachesRoot = true;
          break;
        }
        current = store.nodes[current.parentId];
        hops += 1;
      }

      if (!reachesRoot) errors.push(`Node "${id}" does not reach root (cycle or orphan)`);
    }

    return { ok: errors.length === 0, errors };
  }

  function serialize(store) {
    const validation = validateStore(store);
    if (!validation.ok) throw new Error(`serialize: invalid store — ${validation.errors.join('; ')}`);
    return JSON.stringify(store);
  }

  function deserialize(raw) {
    let store;
    try {
      store = JSON.parse(raw);
    } catch (error) {
      return { error: `Invalid JSON: ${error.message}` };
    }

    if (typeof store.seq !== 'number') store.seq = 0;
    const validation = validateStore(store);
    if (!validation.ok) return { error: validation.errors.join('; ') };

    return { store };
  }

  return {
    VERSION,
    ROOT_ID,
    createStore,
    clone,
    childrenOf,
    pathToRoot,
    isDescendant,
    normaliseTags,
    addNode,
    updateNode,
    toggleCollapse,
    deleteNode,
    moveNode,
    parseQuickEntry,
    searchNodes,
    clustersByTag,
    subtreeLeaves,
    computeLayout,
    validateStore,
    serialize,
    deserialize,
  };
})();
