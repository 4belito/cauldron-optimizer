// Web Worker for "Buscar receta" (started by search.js): runs the depth
// search or the exact one (every recipe) off the page, so it never freezes.

importScripts("solver.js");

self.onmessage = (e) => {
  const { B, V, config, exact, depth } = e.data;
  const solver = new CauldronSolver({ B, V, ...config });
  const start = Date.now();
  let lastPost = 0;
  const result = exact
    ? solver.exact((fraction) => {
        const now = Date.now();
        if (now - lastPost > 100) {
          lastPost = now;
          self.postMessage({ type: "progress", fraction });
        }
      })
    : solver.multistart(depth);
  self.postMessage({ type: "done", recipe: result.recipe, ms: Date.now() - start });
};
