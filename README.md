# Cauldron Optimizer

<p align="center">
  <img src="docs/index_screenshot.png" alt="Cauldron Optimizer web app screenshot" width="900">
</p>
<p align="center">
  <em>
    Web interface for selecting target effects and constraints before running the recipe optimization.
    After configuration, the optimizer computes and displays the recommended ingredient recipe
    and the corresponding effect probabilities.
  </em>
</p>

**Probabilistic Recipe Optimization for Elvenar**

This repository contains a production web application that helps players choose
ingredient combinations for the Elvenar Cauldron to maximize the expected value
of desired effects.

The application is **deployed and actively used by players**.  
**Live application:** https://cauldron-optimizer.vercel.app

The underlying cauldron mechanics produce probabilistic outcomes: for a fixed
recipe, the realized effect is random. The optimization *objective and scoring
model* are deterministic, while the search procedure may use randomized
initialization to explore the solution space. The final recommendation is chosen
by maximizing a weighted expected-effect objective.

**Deployed:** Vercel (Flask backend) + Neon (PostgreSQL)

Originally deployed on Render, migrated to Vercel to eliminate cold-start latency and improve responsiveness.

**Used by:** active players (accounts stored in the database)  

## What the app does

Given:
- a set of desired effects and their user-defined weights,
- constraints (e.g., ingredient limits, premium ingredients excluded),
- a fixed total ingredient budget,

The optimizer returns a recipe vector $\alpha$ (integer ingredient counts) that maximizes the weighted expected outcome of the desired effects.



## Core model (probability scoring)

Let $d$ be the number of effects considered, and let $\alpha$ be the 12-dimensional vector of ingredient counts. The scoring model used by the optimizer is:

```math
\begin{aligned}
E_i(\alpha)
&= \max\!\left(
\sum_{j=1}^{12} \alpha_j v_{i,j},\, 0
\right)
\cdot 1.1^{\sum_{j=1}^{12} \alpha_j b_{i,j}} \\[6pt]
\hat{E}_i(\alpha)
&= 20\,\frac{E_i(\alpha)}{\sum_{k=1}^{d} E_k(\alpha)}
\sqrt{\sum_{j=1}^{12} \alpha_j} \\[6pt]
F(\alpha)
&= \sum_{i=1}^{d} w_i\,\hat{E}_i(\alpha)
\end{aligned}
```

where:
* $V = (v_{i,j})$ and $B = (b_{i,j})$ are constant matrices (stored in CSV and loaded at runtime),
* $w = (w_i)$ are user-selected weights over effects,
* $\alpha$ is a non-negative integer recipe vector with a hard budget constraint: $\sum_{i=1}^{12}\alpha_i \leq 25$.

The optimizer uses $F(\alpha)$ as the objective and enforces probability caps and ingredient constraints.



## Optimization method

The optimization problem is discrete, constrained, and non-linear (due to the max, exponent, normalization, and square-root terms). The backend solves it using:
* Greedy local search (steepest ascent)
* Optional swap moves to escape local optima
* Multi-start initialization to improve solution quality
* Efficient incremental objective updates using precomputed matrix columns (V[:, j], B[:, j])
* Objective caching for repeated evaluations

See: CauldronOptimizer.greedy() and CauldronOptimizer.multistart().


## Tech stack
* Python + NumPy (core optimization engine)
* Flask (web backend)
* PostgreSQL (Neon)
* Hosted deployment (Render)


## Local setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
4. Set up your PostgreSQL database and update `NEONDB_USER` in `.env`
5. Run the Flask app:
   ```bash
   flask run
   ```

## Browser extension integration

The page exposes a same-origin `postMessage` API so browser extensions do not
need to depend on internal routes or CSRF implementation details.

Select an existing world, or create it with the default avatar when missing:

```js
window.postMessage({
  type: "cauldron:selectWorld",
  name: "EA-Balrogville-en3",
  create: true,
}, location.origin);
```

The page responds with `cauldron:selectWorld:result` containing `ok`,
`created`, `reloading`, `errors`, and the selected `world`. A changed
selection reloads the page; the extension can resume after the next
`cauldron:ready`.

Autofill can optionally save through the same operation as the Save button:

```js
window.postMessage({
  type: "cauldron:autofill",
  n_diploma: 7,
  premium_ingr: [0, 1, 10, 11],
  save: true,
}, location.origin);
```

Premium ingredient exclusions remain temporary and are never persisted, which
matches the Save button's behavior.

Failed results include a stable `code` next to the readable `errors`:

| code | meaning |
|---|---|
| `complement_mode` | "Complete effects" mode is on; nothing was changed (the player must turn it off) |
| `not_found` | no world with that name, and `create` was not `true` |
| `too_many_worlds` | the account already has the maximum number of worlds |
| `invalid_name` | empty name, or longer than the 24-character limit |
| `invalid_data` | wrong fields (details in `errors`) |
| `save_failed`, `network`, `db_error` | the request did not go through |

## Notebook (explanation and examples)

A Jupyter notebook (`optimizer/solver.ipynb`) is included with a step-by-step explanation
of the scoring model and example local usage of the optimizer. The notebook is
intended for documentation and experimentation; the production system runs as a
deployed web application.
