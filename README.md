# LangChainF chat UI

Vue 3 + Vite frontend for the Spring Boot chat API.

## Run locally

Start the Spring Boot application on port `8080`, then run:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite. The development server proxies `/chat` and `/chat/img` to `http://localhost:8080`.

## Verify

```powershell
npm test
npm run build
```

For production, serve the generated `dist/` directory and configure the same origin to proxy `/chat` and `/chat/img` to Spring Boot.
