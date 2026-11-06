/** Small observable store for native DOM views. No hooks or UI framework. */
export function create(initializer) {
  let state;
  const listeners = new Set();
  const get = () => state;
  const set = (patch, replace = false) => {
    const prev = state;
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (next === state) return;
    state = replace ? next : { ...state, ...next };
    for (const listener of [...listeners]) listener(state, prev);
  };
  const store = (selector = (s) => s) => selector(state);
  store.getState = get;
  store.setState = set;
  store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) };
  state = initializer(set, get, store);
  return store;
}
