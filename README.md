# AgroMarkets BR

## Executar projeto (frontend + backend)

Na raiz do projeto:

```bash
npm run dev:all
```

Se quiser instalar tudo automaticamente e já iniciar frontend + backend:

```bash
npm run dev:setup
```

Esse comando inicia:

- frontend (Vite)
- backend (Node/Express)

Para encerrar os dois, use `Ctrl+C`.

## Deploy (Vercel + Render)

Configuração recomendada para este repositório:

- Frontend (React/Vite) no **Vercel**
- Backend (Node/Express em `backend/`) no **Render**

### 1) Deploy do backend no Render

Opção A (recomendada): usar Blueprint com `render.yaml` já incluído na raiz.

1. No Render, clique em **New +** → **Blueprint**.
2. Conecte seu GitHub e selecione este repositório.
3. Confirme a criação do serviço `agromarkets-br-backend`.
4. Em **Environment**, defina `BRAPI_API_KEY`.

O restante já está pré-configurado:

- `rootDir`: `backend`
- `buildCommand`: `npm install`
- `startCommand`: `npm start`
- `healthCheckPath`: `/api/status`

Após deploy, copie a URL pública do backend (ex.: `https://agromarkets-br-backend.onrender.com`).

### 2) Deploy do frontend no Vercel

1. No Vercel, clique em **Add New...** → **Project**.
2. Importe o mesmo repositório no GitHub.
3. Em **Build and Output Settings**, mantenha:
  - Build Command: `npm run build`
  - Output Directory: `dist`
4. Em **Environment Variables**, adicione:
  - `VITE_API_BASE_URL` = URL do Render copiada acima (sem barra no final).
5. Faça o deploy.

O arquivo `vercel.json` na raiz já define os comandos esperados para este app Vite.

### 3) Ordem correta de configuração

1. Faça deploy do backend no Render e obtenha a URL.
2. Configure `VITE_API_BASE_URL` no Vercel.
3. Redeploy do frontend (ou novo commit) para aplicar a variável.

### 4) Variáveis usadas

Frontend (`.env.example` na raiz):

- `VITE_API_BASE_URL` (ex.: `http://localhost:3001` local / URL do Render em produção)

Backend (`backend/.env.example`):

- `PORT`
- `SYNC_INTERVAL_MINUTES`
- `PROVIDER_TIMEOUT_MS`
- `BRAPI_BASE_URL`
- `BRAPI_API_KEY`

## Configuração do backend (câmbio e curva)

O backend usa:

- **Brapi** como fonte primária do spot `USD/BRL`
- **Yahoo Finance** para curva de dólar futuro e fallback de spot

Variáveis de ambiente suportadas no backend:

- `PORT` (default: `3001`)
- `SYNC_INTERVAL_MINUTES` (default: `15`)
- `PROVIDER_TIMEOUT_MS` (default: `8000`)
- `BRAPI_BASE_URL` (default: `https://brapi.dev`)
- `BRAPI_API_KEY` (opcional, mas recomendada em produção)

Exemplo:

```bash
cd backend
BRAPI_API_KEY=sua_chave_aqui npm run dev
```

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

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
