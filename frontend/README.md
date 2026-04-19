# React + TypeScript + Vite (parking UI)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Run with the hackathon backend

1. In **`server/`**: configure **`.env`**, run **`npm run dev`** (default API port **3001** — see `server/README.md`).
2. In **`frontend/`**: **`npm install`** then **`npm run dev`**.
3. The Vite dev server **proxies `/api/*` to `http://127.0.0.1:3001`**, so the UI can call **`/api/parking/summary`** without extra CORS setup. The same proxy applies to **`npm run preview`** so built assets still reach the backend.
4. Optional: copy **`.env.example`** to **`.env`** and set **`VITE_API_BASE_URL`** (e.g. `http://127.0.0.1:3001`) when the UI is not served by Vite. The backend allows **CORS** from `localhost` / `127.0.0.1` so the browser can call the API directly.

The app now uses backend parking endpoints for:
- lot list + summary rendering
- recommendation card logic (lowest live occupancy for selected access type)
- "Ask the AI" requests via `POST /api/parking/ask`

---

## Upstream template notes

The sections below are from the original Vite template.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
