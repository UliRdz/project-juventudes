// vite.config.js
// PURPOSE: Configuration for Vite, the tool that runs the dev server and builds
// the static files that get deployed to GitHub Pages.
// INTENDED OUTPUT LINK: the `base` value here is the single most common reason a
// GitHub Pages deploy shows a blank page — it must match the repo name or the
// built HTML will request assets from the wrong path and 404.

import { defineConfig } from "vite";        // Helper that gives type hints/validation for the config object.
import react from "@vitejs/plugin-react";    // Plugin that enables React (JSX transform, Fast Refresh in dev).

export default defineConfig({                 // Export the config object Vite reads at startup/build.
  plugins: [react()],                         // Activate the React plugin so .jsx files compile and hot-reload.
  base: "/project-juventudes/",              // IMPORTANT: must equal your GitHub repo name; makes built asset URLs resolve on Pages.
  server: {                                   // Dev-server options (only used by `npm run dev`, not in the built output).
    port: 5173,                               // Serve the dev site on :5173 (matches FRONTEND_ORIGIN in the backend .env).
  },                                          // End server block.
});                                           // End config: `npm run dev` serves locally; `npm run build` writes static files to dist/.
