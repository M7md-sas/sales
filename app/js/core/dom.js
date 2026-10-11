/**
 * Small DOM helpers. Deliberately tiny — there is no framework here,
 * and adding one later should not mean unpicking a homemade one.
 */

/** querySelector, scoped. */
export const $ = (sel, root = document) => root.querySelector(sel);
/** querySelectorAll as a real array. */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Create an element:
 *   el('div', { class: 'card' }, 'text' | node | [nodes])
 *   el('tbody', [row, row])            // attributes may be skipped
 *
 * The second form matters: wrappers with no attributes of their own are
 * common, and passing children into the attributes slot would otherwise
 * fail silently — setAttribute stringifies a Node rather than throwing, so
 * the element renders empty and nothing anywhere reports a problem.
 */
export function el(tag, attrs = {}, children = []) {
  if (Array.isArray(attrs) || attrs instanceof Node || typeof attrs === 'string') {
    children = attrs;
    attrs = {};
  }
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function on(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  return () => target.removeEventListener(event, handler, options);
}

/**
 * Event delegation — survives re-renders, so views can replace their
 * innerHTML freely without re-binding.
 */
export function delegate(root, event, selector, handler) {
  return on(root, event, (e) => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  });
}

export function show(node, visible = true) {
  node?.classList.toggle('hidden', !visible);
}

export function setText(node, value) {
  if (node) node.textContent = value;
}

export function setHTML(node, value) {
  if (node) node.innerHTML = value;
}

/** Escape untrusted text before putting it inside an innerHTML template. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Swap the visible .screen inside an app shell. */
export function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
  window.scrollTo({ top: 0 });
}

/** Put a button into a busy state and give back a function that restores it. */
export function busy(button, label) {
  if (!button) return () => {};
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span><span>${esc(label)}</span>`;
  return () => {
    button.disabled = false;
    button.innerHTML = original;
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
