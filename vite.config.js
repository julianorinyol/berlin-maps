import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const routesFile = path.resolve(process.cwd(), 'src/data/routes.json')

// Dev-only API for editing routes.json from the app UI. This plugin's
// configureServer hook only runs under `vite dev` — it is never invoked
// for `vite build`, so there is no server-writing capability in any
// deployed/production build.
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
              const { id, route } = JSON.parse(body)
              const routes = JSON.parse(fs.readFileSync(routesFile, 'utf-8'))
              const idx = routes.findIndex((r) => r.id === id)
              if (idx === -1) {
                res.statusCode = 404
                res.end(JSON.stringify({ error: `route "${id}" not found` }))
                return
              }
              routes[idx] = route
              fs.writeFileSync(routesFile, JSON.stringify(routes, null, 2))
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
export default defineConfig({
  plugins: [react(), routesEditorApi()],
})
