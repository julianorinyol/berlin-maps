import { Fragment, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import routes from './data/routes.json'
import './App.css'

const startIcon = L.divIcon({
  className: 'pin pin-start',
  html: '<div class="pin-dot"></div>',
  iconSize: [16, 16],
})
const endIcon = L.divIcon({
  className: 'pin pin-end',
  html: '<div class="pin-dot"></div>',
  iconSize: [16, 16],
})
const stopIcon = L.divIcon({
  className: 'pin pin-stop',
  html: '<div class="pin-dot"></div>',
  iconSize: [10, 10],
})

const BERLIN_CENTER = [52.49, 13.37]

function App() {
  const [activeIds, setActiveIds] = useState(() => new Set(routes.map((r) => r.id)))

  const toggle = (id) => {
    setActiveIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const visibleRoutes = useMemo(
    () => routes.filter((r) => activeIds.has(r.id)),
    [activeIds]
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Berlin: no-turn bike routes</h1>
        <p className="subtitle">
          Roads you can cycle "straight" across Berlin — the street changes
          name, but you never turn.
        </p>

        <div className="route-list">
          {routes.map((route) => (
            <div
              key={route.id}
              className={`route-card ${activeIds.has(route.id) ? 'active' : 'inactive'}`}
              onClick={() => toggle(route.id)}
            >
              <div className="route-card-header">
                <span className="swatch" style={{ background: route.color }} />
                <span className="route-name">{route.name}</span>
              </div>
              <div className={`confidence confidence-${route.confidence}`}>
                {route.confidence === 'high' ? 'Verified street chain' : 'Approximate route'}
              </div>
              <ol className="street-chain">
                {route.streetLabels.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <p className="note">{route.note}</p>
            </div>
          ))}
        </div>

        <footer className="credits">
          Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors ·
          Routing via OSRM
        </footer>
      </aside>

      <main className="map-wrap">
        <MapContainer center={BERLIN_CENTER} zoom={12} className="map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visibleRoutes.map((route) => (
            <Polyline
              key={route.id}
              positions={route.coordinates}
              pathOptions={{ color: route.color, weight: 5, opacity: 0.85 }}
            >
              <Tooltip sticky>{route.name}</Tooltip>
            </Polyline>
          ))}
          {visibleRoutes.map((route) => {
            const stops = route.stops && route.stops.length ? route.stops : [
              { label: route.startEnd[0], coord: route.coordinates[0] },
              { label: route.startEnd[1], coord: route.coordinates[route.coordinates.length - 1] },
            ]
            return (
              <Fragment key={route.id}>
                {stops.map((stop, i) => {
                  const isFirst = i === 0
                  const isLast = i === stops.length - 1
                  const icon = isFirst ? startIcon : isLast ? endIcon : stopIcon
                  const kind = isFirst ? 'Start' : isLast ? 'End' : 'Stop'
                  return (
                    <Marker key={i} position={stop.coord} icon={icon}>
                      <Popup>{kind}: {stop.label}</Popup>
                    </Marker>
                  )
                })}
              </Fragment>
            )
          })}
        </MapContainer>
      </main>
    </div>
  )
}

export default App
