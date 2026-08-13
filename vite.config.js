import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const routesFile = path.resolve(process.cwd(), 'src/data/routes.json')
const wasserwegeFile = path.resolve(process.cwd(), 'src/data/wasserwege.json')

function fileFor(collection) {
  return collection === 'wasserwege' ? wasserwegeFile : routesFile
}

// Dev-only API for editing routes.json / wasserwege.json from the app UI.
// This plugin's configureServer hook only runs under `vite dev` — it is
// never invoked for `vite build`, so there is no server-writing capability
// in any deployed/production build.
function routesEditorApi() {
  return {
    name: 'routes-editor-api',
    configureServer(server) {
      server.middlewares.use('/api/routes', (req, res, next) => {
        if (req.method === 'PUT') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              const { id, route, collection } = JSON.parse(body)
              const targetFile = fileFor(collection)
              const items = JSON.parse(fs.readFileSync(targetFile, 'utf-8'))
              const idx = items.findIndex((r) => r.id === id)
              if (idx === -1) {
                res.statusCode = 404
                res.end(JSON.stringify({ error: `route "${id}" not found in ${path.basename(targetFile)}` }))
                return
              }
              items[idx] = route
              fs.writeFileSync(targetFile, JSON.stringify(items, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: e.message }))
            }
          })
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub project pages are served at github.io/<repo>/, so the built
  // app needs that prefix baked into every asset/route URL. Keep dev at
  // "/" so local testing URLs don't change.
  base: command === 'build' ? '/berlin-maps/' : '/',
  plugins: [react(), routesEditorApi()],
}))
