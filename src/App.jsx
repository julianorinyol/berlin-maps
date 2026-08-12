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
const nodeSelectedIcon = L.divIcon({
  className: 'pin pin-node pin-node-selected',
  html: '<div class="pin-dot"></div>',
  iconSize: [10, 10],
})

const BERLIN_CENTER = [52.49, 13.37]

function routeIdFromPath() {
  const match = window.location.pathname.match(/^\/routes\/([^/]+)/)
  const id = match ? match[1] : null
  return id && initialRoutes.some((r) => r.id === id) ? id : null
}

function FitBounds({ coords }) {
  const map = useMap()
  useEffect(() => {
    if (!coords || !coords.length) return
    const bounds = L.latLngBounds(coords)
    const fit = () => {
      map.invalidateSize()
      map.fitBounds(bounds, { padding: [40, 40] })
    }
    // The map container's flex layout can still be settling on the frame
    // this effect runs, so Leaflet may measure a stale (often narrower)
    // size and over-zoom/mis-fit. Retry across a couple of frames plus a
    // short timeout to land after layout has actually finished.
    const raf1 = requestAnimationFrame(() => {
      fit()
      requestAnimationFrame(fit)
    })
    const t = setTimeout(fit, 200)
    return () => {
      cancelAnimationFrame(raf1)
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords])
  return null
}

// Shared map used by both the list page and the detail page. When
// mapEdit.active is true it takes over entirely, showing the editable
// point layer instead of whatever routes were passed in.
function RouteMap({ visibleRoutes, labelsVisible, fitTo, mapEdit }) {
  const { active, base, coords, rangeSelection, rangeBounds, onNodeClick, onNodeDrag, onDeleteRange, onClearRange, onDiscard, onApply } = mapEdit

  return (
    <div className="map-wrap">
      <MapContainer center={BERLIN_CENTER} zoom={12} className="map" boxZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {!active && fitTo && <FitBounds coords={fitTo} />}

        {!active && visibleRoutes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.coordinates}
            pathOptions={{ color: route.color, weight: 5, opacity: 0.85 }}
          >
            <Tooltip sticky>{route.name}</Tooltip>
          </Polyline>
        ))}
        {!active && visibleRoutes.map((route) => {
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

        {active && base && (
          <>
            <FitBounds coords={base.coordinates} />
            <Polyline positions={coords} pathOptions={{ color: base.color, weight: 4, opacity: 0.9 }} />
            {coords.map((pos, i) => {
              const inRange = rangeBounds ? i >= rangeBounds[0] && i <= rangeBounds[1] : rangeSelection.includes(i)
              return (
                <Marker
                  key={i}
                  position={pos}
                  icon={inRange ? nodeSelectedIcon : nodeIcon}
                  draggable
                  eventHandlers={{
                    click: (e) => onNodeClick(i, e),
                    dragend: (e) => {
                      const { lat, lng } = e.target.getLatLng()
                      onNodeDrag(i, lat, lng)
                    },
                  }}
                />
              )
            })}
          </>
        )}
      </MapContainer>

      {active && (
        <div className="map-edit-toolbar">
          <span>
            Editing <strong>{base.name}</strong> — {coords.length} points
          </span>
          <span className="map-edit-hint">
            click a dot to delete it · drag to move it · shift-click two dots to select a range
          </span>
          {rangeBounds && (
            <span className="map-edit-range">
              {rangeBounds[1] - rangeBounds[0] + 1} points selected
            </span>
          )}
          <div className="map-edit-toolbar-actions">
            {rangeSelection.length > 0 && (
              <button className="edit-btn edit-btn-cancel" onClick={onClearRange}>Clear selection</button>
            )}
            {rangeBounds && (
              <button className="edit-btn edit-btn-danger" onClick={onDeleteRange}>Delete range</button>
            )}
            <button className="edit-btn edit-btn-cancel" onClick={onDiscard}>Discard</button>
            <button className="edit-btn edit-btn-save" onClick={onApply}>Apply to editor</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditModal({ route, text, error, onChange, onCancel, onSave, onEnterMapEdit }) {
  if (!route) return null
  return (
    <div className="edit-overlay" onClick={onCancel}>
      <div className="edit-panel" onClick={(e) => e.stopPropagation()}>
        <div className="edit-panel-header">
          <h2>Edit: {route.name}</h2>
          <span className="edit-panel-sub">local only — saves directly to routes.json</span>
        </div>
        <textarea
          className="edit-textarea"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
        {error && <p className="edit-error">{error}</p>}
        <div className="edit-panel-actions">
          <button className="edit-btn edit-btn-map" onClick={onEnterMapEdit}>Edit points on map</button>
          <button className="edit-btn edit-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="edit-btn edit-btn-save" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

function RouteListPage({ routes, activeIds, onToggle, onOpenDetail, onStartEditing, showLabels, onToggleLabels, mapEdit }) {
  const visibleRoutes = useMemo(() => routes.filter((r) => activeIds.has(r.id)), [routes, activeIds])

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Berlin: no-turn bike routes</h1>
        <p className="subtitle">
          Roads you can cycle "straight" across Berlin — the street changes
          name, but you never turn.
        </p>

        <div className="labels-control">
          <button
            className="toggle-switch"
            role="switch"
            aria-checked={showLabels}
            title={showLabels ? 'Hide stop labels' : 'Show stop labels'}
            onClick={onToggleLabels}
          >
            <span className="toggle-knob" />
          </button>
          <span>Show stop labels on map</span>
        </div>

        <div className="route-list">
          {routes.map((route) => {
            const isVisible = activeIds.has(route.id)
            return (
              <div
                key={route.id}
                className={`route-card route-card-clickable ${isVisible ? 'active' : 'inactive'}`}
                onClick={() => onOpenDetail(route.id)}
              >
                <div className="route-card-header">
                  <button
                    className="toggle-switch"
                    role="switch"
                    aria-checked={isVisible}
                    title={isVisible ? 'Hide route' : 'Show route'}
                    onClick={(e) => { e.stopPropagation(); onToggle(route.id) }}
                  >
                    <span className="toggle-knob" />
                  </button>
                  <span className="swatch" style={{ background: route.color }} />
                  <span className="route-name">{route.name}</span>
                  {import.meta.env.DEV && (
                    <button
                      className="edit-icon"
                      title="Edit route (local only)"
                      onClick={(e) => onStartEditing(route, e)}
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

      <RouteMap visibleRoutes={visibleRoutes} labelsVisible={showLabels} fitTo={null} mapEdit={mapEdit} />
    </div>
  )
}

function RouteDetailPage({ route, onBack, onStartEditing, mapEdit }) {
  return (
    <div className="detail-page">
      <header className="detail-header">
        <button className="back-link" onClick={onBack}>← Back to all routes</button>
        {import.meta.env.DEV && (
          <button className="edit-icon detail-edit-icon" title="Edit route (local only)" onClick={(e) => onStartEditing(route, e)}>
            ✏️ Edit
          </button>
        )}
      </header>

      <div className="detail-body">
        <div className="detail-info">
          <div className="detail-title-row">
            <span className="swatch swatch-lg" style={{ background: route.color }} />
            <h1>{route.name}</h1>
          </div>
          <div className={`confidence confidence-${route.confidence}`}>
            {route.confidence === 'high' ? 'Verified street chain' : 'Approximate route'}
          </div>

          <section className="detail-section">
            <h2>Street chain</h2>
            <ol className="street-chain street-chain-lg">
              {route.streetLabels.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>

          <section className="detail-section">
            <h2>Notes</h2>
            <p className="note note-lg">{route.note}</p>
          </section>

          <section className="detail-section detail-section-placeholder">
            <h2>Description, photos &amp; variations</h2>
            <p className="note">Nothing added yet — this space is reserved for extra write-up, photos, and route variations.</p>
          </section>
        </div>

        <RouteMap visibleRoutes={[route]} labelsVisible fitTo={route.coordinates} mapEdit={mapEdit} />
      </div>
    </div>
  )
}

function App() {
  const [routes, setRoutes] = useState(initialRoutes)
  const [activeIds, setActiveIds] = useState(() => new Set(initialRoutes.map((r) => r.id)))
  const [detailId, setDetailIdState] = useState(() => routeIdFromPath())
  const [showLabels, setShowLabels] = useState(false)

  useEffect(() => {
    const onPopState = () => setDetailIdState(routeIdFromPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const openDetail = (id) => {
    const path = `/routes/${id}`
    window.history.pushState({}, '', path)
    setDetailIdState(id)
  }

  const closeDetail = () => {
    window.history.pushState({}, '', '/')
    setDetailIdState(null)
  }

  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState(null)

  const [mapEditActive, setMapEditActive] = useState(false)
  const [mapEditBase, setMapEditBase] = useState(null)
  const [mapEditCoords, setMapEditCoords] = useState([])
  const [rangeSelection, setRangeSelection] = useState([])

  const toggle = (id) => {
    setActiveIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
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
    setRangeSelection([])
    setEditError(null)
  }

  const applyMapEdit = () => {
    const updated = { ...mapEditBase, coordinates: mapEditCoords }
    setEditText(formatRouteForEditing(updated))
    setMapEditActive(false)
    setRangeSelection([])
  }

  const discardMapEdit = () => {
    setMapEditActive(false)
    setRangeSelection([])
  }

  const deleteNode = (index) => {
    setMapEditCoords((prev) => prev.filter((_, i) => i !== index))
  }

  const moveNode = (index, lat, lng) => {
    setMapEditCoords((prev) => prev.map((p, i) => (i === index ? [lat, lng] : p)))
  }

  // Plain click deletes a single point. Shift-click picks a range endpoint —
  // pick two (in either order) and "Delete range" removes everything
  // between them, inclusive.
  const handleNodeClick = (index, e) => {
    const shiftKey = e.originalEvent && e.originalEvent.shiftKey
    if (!shiftKey) {
      setRangeSelection([])
      deleteNode(index)
      return
    }
    setRangeSelection((prev) => {
      if (prev.length >= 2) return [index]
      if (prev.length === 1 && prev[0] === index) return prev
      return [...prev, index]
    })
  }

  const rangeBounds = rangeSelection.length === 2
    ? [Math.min(...rangeSelection), Math.max(...rangeSelection)]
    : null

  const deleteRange = () => {
    if (!rangeBounds) return
    const [lo, hi] = rangeBounds
    setMapEditCoords((prev) => prev.filter((_, i) => i < lo || i > hi))
    setRangeSelection([])
  }

  const clearRangeSelection = () => setRangeSelection([])

  const editingRoute = routes.find((r) => r.id === editingId)
  const detailRoute = routes.find((r) => r.id === detailId)

  const mapEditProps = {
    active: mapEditActive,
    base: mapEditBase,
    coords: mapEditCoords,
    rangeSelection,
    rangeBounds,
    onNodeClick: handleNodeClick,
    onNodeDrag: moveNode,
    onDeleteRange: deleteRange,
    onClearRange: clearRangeSelection,
    onDiscard: discardMapEdit,
    onApply: applyMapEdit,
  }

  return (
    <>
      {detailRoute ? (
        <RouteDetailPage route={detailRoute} onBack={closeDetail} onStartEditing={startEditing} mapEdit={mapEditProps} />
      ) : (
        <RouteListPage
          routes={routes}
          activeIds={activeIds}
          onToggle={toggle}
          onOpenDetail={openDetail}
          onStartEditing={startEditing}
          showLabels={showLabels}
          onToggleLabels={() => setShowLabels((v) => !v)}
          mapEdit={mapEditProps}
        />
      )}

      <EditModal
        route={mapEditActive ? null : editingRoute}
        text={editText}
        error={editError}
        onChange={setEditText}
        onCancel={cancelEditing}
        onSave={saveEditing}
        onEnterMapEdit={enterMapEdit}
      />
    </>
  )
}

export default App
