import { Fragment, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import initialRoutes from './data/routes.json'
import './App.css'

// Pretty-print a route's JSON with each [lat, lon] pair collapsed onto a
// single line, instead of JSON.stringify's default 4 lines per point —
// routes can have thousands of coordinate points, so this keeps the
// editable text a manageable length.
function formatRouteForEditing(route) {
  const json = JSON.stringify(route, null, 2)
  return json.replace(
    /\[\n\s+(-?\d+\.?\d*),\n\s+(-?\d+\.?\d*)\n\s+\]/g,
    '[$1, $2]'
  )
}

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
const nodeIcon = L.divIcon({
  className: 'pin pin-node',
  html: '<div class="pin-dot"></div>',
  iconSize: [8, 8],
})

const BERLIN_CENTER = [52.49, 13.37]

function FitBounds({ coords }) {
  const map = useMap()
  useEffect(() => {
    if (coords && coords.length) {
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords])
  return null
}

function App() {
  const [routes, setRoutes] = useState(initialRoutes)
  const [activeIds, setActiveIds] = useState(() => new Set(initialRoutes.map((r) => r.id)))
  const [focusedId, setFocusedId] = useState(null)
  const [showLabels, setShowLabels] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState(null)

  const [mapEditActive, setMapEditActive] = useState(false)
  const [mapEditBase, setMapEditBase] = useState(null) // snapshot of the route at map-edit entry (for fit-bounds + reassembly)
  const [mapEditCoords, setMapEditCoords] = useState([])

  const toggle = (id) => {
    setActiveIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleFocus = (id) => {
    setFocusedId((prev) => (prev === id ? null : id))
  }

  const startEditing = (route, e) => {
    e.stopPropagation()
    setEditingId(route.id)
    setEditText(formatRouteForEditing(route))
    setEditError(null)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditError(null)
    setMapEditActive(false)
  }

  const saveEditing = async () => {
    let parsed
    try {
      parsed = JSON.parse(editText)
    } catch (err) {
      setEditError(`Invalid JSON: ${err.message}`)
      return
    }
    try {
      const res = await fetch('/api/routes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, route: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setRoutes((prev) => prev.map((r) => (r.id === editingId ? parsed : r)))
      setEditingId(null)
      setEditError(null)
    } catch (err) {
      setEditError(`Save failed: ${err.message}. (Editing only works when running the local dev server.)`)
    }
  }

  const enterMapEdit = () => {
    let parsed
    try {
      parsed = JSON.parse(editText)
    } catch (err) {
      setEditError(`Invalid JSON: ${err.message}`)
      return
    }
    setMapEditBase(parsed)
    setMapEditCoords(parsed.coordinates)
    setMapEditActive(true)
    setEditError(null)
  }

  const applyMapEdit = () => {
    const updated = { ...mapEditBase, coordinates: mapEditCoords }
    setEditText(formatRouteForEditing(updated))
    setMapEditActive(false)
  }

  const discardMapEdit = () => {
    setMapEditActive(false)
  }

  const deleteNode = (index) => {
    setMapEditCoords((prev) => prev.filter((_, i) => i !== index))
  }

  const moveNode = (index, lat, lng) => {
    setMapEditCoords((prev) => prev.map((p, i) => (i === index ? [lat, lng] : p)))
  }

  const visibleRoutes = useMemo(() => {
    if (mapEditActive) return []
    if (focusedId) return routes.filter((r) => r.id === focusedId)
    return routes.filter((r) => activeIds.has(r.id))
  }, [routes, activeIds, focusedId, mapEditActive])

  const editingRoute = routes.find((r) => r.id === editingId)
  const focusedRoute = routes.find((r) => r.id === focusedId)
  const labelsVisible = focusedId ? true : showLabels

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Berlin: no-turn bike routes</h1>
        <p className="subtitle">
          Roads you can cycle "straight" across Berlin — the street changes
          name, but you never turn.
        </p>

        {focusedId ? (
          <button className="focus-banner" onClick={() => setFocusedId(null)}>
            Focused on one route — click to show all
          </button>
        ) : (
          <div className="labels-control">
            <button
              className="toggle-switch"
              role="switch"
              aria-checked={showLabels}
              title={showLabels ? 'Hide stop labels' : 'Show stop labels'}
              onClick={() => setShowLabels((v) => !v)}
            >
              <span className="toggle-knob" />
            </button>
            <span>Show stop labels on map</span>
          </div>
        )}

        <div className="route-list">
          {routes.map((route) => {
            const isVisible = focusedId ? route.id === focusedId : activeIds.has(route.id)
            return (
              <div
                key={route.id}
                className={`route-card ${isVisible ? 'active' : 'inactive'} ${focusedId === route.id ? 'focused' : ''}`}
              >
                <div className="route-card-header">
                  <button
                    className="toggle-switch"
                    role="switch"
                    aria-checked={activeIds.has(route.id)}
                    title={activeIds.has(route.id) ? 'Hide route' : 'Show route'}
                    onClick={() => toggle(route.id)}
                  >
                    <span className="toggle-knob" />
                  </button>
                  <span className="swatch" style={{ background: route.color }} />
                  <span className="route-name">{route.name}</span>
                  <button
                    className="focus-icon"
                    title={focusedId === route.id ? 'Exit focus view' : 'Focus: show only this route'}
                    onClick={() => toggleFocus(route.id)}
                  >
                    {focusedId === route.id ? '⦿' : '◎'}
                  </button>
                  {import.meta.env.DEV && (
                    <button
                      className="edit-icon"
                      title="Edit route (local only)"
                      onClick={(e) => startEditing(route, e)}
                    >
                      ✏️
                    </button>
                  )}
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
            )
          })}
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

          {focusedId && focusedRoute && !mapEditActive && <FitBounds coords={focusedRoute.coordinates} />}

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
                      {labelsVisible && (
                        <Tooltip permanent direction="right" offset={[8, 0]} className="stop-label">
                          {stop.label}
                        </Tooltip>
                      )}
                      <Popup>{kind}: {stop.label}</Popup>
                    </Marker>
                  )
                })}
              </Fragment>
            )
          })}

          {mapEditActive && mapEditBase && (
            <>
              <FitBounds coords={mapEditBase.coordinates} />
              <Polyline
                positions={mapEditCoords}
                pathOptions={{ color: mapEditBase.color, weight: 4, opacity: 0.9 }}
              />
              {mapEditCoords.map((pos, i) => (
                <Marker
                  key={i}
                  position={pos}
                  icon={nodeIcon}
                  draggable
                  eventHandlers={{
                    click: () => deleteNode(i),
                    dragend: (e) => {
                      const { lat, lng } = e.target.getLatLng()
                      moveNode(i, lat, lng)
                    },
                  }}
                />
              ))}
            </>
          )}
        </MapContainer>

        {mapEditActive && (
          <div className="map-edit-toolbar">
            <span>
              Editing <strong>{mapEditBase.name}</strong> — {mapEditCoords.length} points
            </span>
            <span className="map-edit-hint">click a dot to delete it · drag to move it</span>
            <div className="map-edit-toolbar-actions">
              <button className="edit-btn edit-btn-cancel" onClick={discardMapEdit}>Discard</button>
              <button className="edit-btn edit-btn-save" onClick={applyMapEdit}>Apply to editor</button>
            </div>
          </div>
        )}
      </main>

      {editingRoute && !mapEditActive && (
        <div className="edit-overlay" onClick={cancelEditing}>
          <div className="edit-panel" onClick={(e) => e.stopPropagation()}>
            <div className="edit-panel-header">
              <h2>Edit: {editingRoute.name}</h2>
              <span className="edit-panel-sub">local only — saves directly to routes.json</span>
            </div>
            <textarea
              className="edit-textarea"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              spellCheck={false}
            />
            {editError && <p className="edit-error">{editError}</p>}
            <div className="edit-panel-actions">
              <button className="edit-btn edit-btn-map" onClick={enterMapEdit}>Edit points on map</button>
              <button className="edit-btn edit-btn-cancel" onClick={cancelEditing}>Cancel</button>
              <button className="edit-btn edit-btn-save" onClick={saveEditing}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
