import { Fragment, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import bikeRoutes from './data/routes.json'
import wasserwege from './data/wasserwege.json'
import './App.css'

// wasserwege.json uses a richer, water-trip-specific schema (trip/distance/
// water_flow/etc, per the user's own format) instead of the bike-route
// schema. Normalize each entry into the same shape the map/list/detail
// components already know how to render, while keeping the original rich
// data around as `waterTrip` for the water-specific detail sections.
function normalizeWaterTrip(trip) {
  const waypoints = trip.trip.waypoints_order
  return {
    id: trip.id,
    collection: trip.collection,
    color: trip.color,
    name: trip.trip.name,
    confidence: trip.distance.confidence,
    note: trip.trip.route_description,
    streetLabels: waypoints,
    startEnd: [waypoints[0], waypoints[waypoints.length - 1]],
    coordinates: trip.coordinates,
    stops: trip.stops,
    waterTrip: trip,
  }
}

const initialRoutes = [...bikeRoutes, ...wasserwege.map(normalizeWaterTrip)]

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

// Google's directions deep-link (maps.google.com/maps/dir/?api=1&...) needs
// no API key and accepts up to 9 intermediate waypoints. Longer stop lists
// are evenly sampled down to 9 so the overall shape survives instead of
// just truncating the tail of the route.
function googleMapsDirectionsUrl(route) {
  if (!route.stops || route.stops.length < 2) return null
  const origin = route.stops[0].coord
  const destination = route.stops[route.stops.length - 1].coord
  let mid = route.stops.slice(1, -1).map((s) => s.coord)
  if (mid.length > 9) {
    const step = mid.length / 9
    mid = Array.from({ length: 9 }, (_, i) => mid[Math.min(mid.length - 1, Math.floor(i * step))])
  }
  const params = new URLSearchParams({
    api: '1',
    origin: origin.join(','),
    destination: destination.join(','),
    travelmode: route.waterTrip ? 'walking' : 'bicycling',
  })
  if (mid.length) params.set('waypoints', mid.map((w) => w.join(',')).join('|'))
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

function confidenceLabel(route) {
  if (route.confidence !== 'high') return 'Approximate route'
  return route.waterTrip ? 'Verified waterway' : 'Verified street chain'
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
const destinationIcon = L.divIcon({
  className: 'pin pin-destination',
  html: '<div class="pin-dot"></div>',
  iconSize: [11, 11],
})

const BERLIN_CENTER = [52.49, 13.37]

// Separate top-level sections of the site, each with its own URL and its
// own slice of routes.json (filtered by the route's `collection` field).
const COLLECTIONS = {
  'no-turn': {
    pathSuffix: '',
    navLabel: 'No-turn routes',
    title: 'Berlin: no-turn bike routes',
    subtitle: 'Roads you can cycle "straight" across Berlin — the street changes name, but you never turn.',
    empty: 'No routes yet.',
  },
  'nice-rides': {
    pathSuffix: 'nice-bike-rides',
    navLabel: 'Nice Bike Rides',
    title: 'Nice Bike Rides',
    subtitle: 'Pleasant cycling routes around Berlin — no gimmick, just good rides.',
    empty: 'No rides added yet.',
  },
  wasserwege: {
    pathSuffix: 'wasserwanderwege',
    navLabel: 'Wasserwanderwege',
    title: 'Wasserwanderwege',
    subtitle: "Water trails — canoe and kayak routes along Berlin's rivers, canals and lakes.",
    empty: 'No water routes added yet.',
  },
}
const DEFAULT_COLLECTION = 'no-turn'

// import.meta.env.BASE_URL is "/" in dev and "/berlin-maps/" in a
// production build (see vite.config.js) — deriving every route path from
// it keeps local testing and the deployed GitHub Pages site consistent
// without hardcoding the repo name here.
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '')

function collectionPath(key) {
  return `${BASE_PATH}/${COLLECTIONS[key].pathSuffix}`
}

function detailPath(id) {
  return `${BASE_PATH}/routes/${id}`
}

function parseLocation() {
  let path = window.location.pathname
  if (BASE_PATH && path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length)
  if (!path.startsWith('/')) path = `/${path}`

  const detailMatch = path.match(/^\/routes\/([^/]+)/)
  if (detailMatch) {
    const route = initialRoutes.find((r) => r.id === detailMatch[1])
    return { collection: route ? route.collection || DEFAULT_COLLECTION : DEFAULT_COLLECTION, detailId: route ? route.id : null }
  }
  const suffix = path.replace(/^\//, '').replace(/\/$/, '')
  const entry = Object.entries(COLLECTIONS).find(([, c]) => c.pathSuffix === suffix)
  return { collection: entry ? entry[0] : DEFAULT_COLLECTION, detailId: null }
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
function RouteMap({ visibleRoutes, labelsVisible, fitTo, mapEdit, showDestinations }) {
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
        {!active && showDestinations && visibleRoutes.map((route) => (
          (route.destinations || []).map((dest, i) => (
            <Marker key={`${route.id}-dest-${i}`} position={dest.coord} icon={destinationIcon}>
              <Popup>{dest.label}</Popup>
            </Marker>
          ))
        ))}

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
            Editing <strong>{base.name || (base.trip && base.trip.name)}</strong> — {coords.length} points
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

function SiteNav({ current, onNavigate }) {
  return (
    <nav className="site-nav">
      {Object.entries(COLLECTIONS).map(([key, c]) => (
        <button
          key={key}
          className={`site-nav-link ${key === current ? 'active' : ''}`}
          onClick={() => onNavigate(key)}
        >
          {c.navLabel}
        </button>
      ))}
    </nav>
  )
}

function RouteListPage({ collection, routes, activeIds, onToggle, onOpenDetail, onStartEditing, showLabels, onToggleLabels, onNavigate, mapEdit }) {
  const collectionRoutes = useMemo(() => routes.filter((r) => (r.collection || DEFAULT_COLLECTION) === collection), [routes, collection])
  const visibleRoutes = useMemo(() => collectionRoutes.filter((r) => activeIds.has(r.id)), [collectionRoutes, activeIds])
  const meta = COLLECTIONS[collection]

  return (
    <div className="app">
      <aside className="sidebar">
        <SiteNav current={collection} onNavigate={onNavigate} />
        <h1>{meta.title}</h1>
        <p className="subtitle">{meta.subtitle}</p>

        {collectionRoutes.length === 0 && (
          <p className="empty-state">{meta.empty}</p>
        )}

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
          {collectionRoutes.map((route) => {
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
                  {confidenceLabel(route)}
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
  const wt = route.waterTrip
  const gmapsUrl = googleMapsDirectionsUrl(route)
  return (
    <div className="detail-page">
      <header className="detail-header">
        <button className="back-link" onClick={onBack}>← Back to all routes</button>
        <div className="detail-header-actions">
          {gmapsUrl && (
            <a className="edit-icon gmaps-link" href={gmapsUrl} target="_blank" rel="noreferrer" title="Open this route's stops as directions in Google Maps">
              Open in Google Maps ↗
            </a>
          )}
          {import.meta.env.DEV && (
            <button className="edit-icon detail-edit-icon" title="Edit route (local only)" onClick={(e) => onStartEditing(route, e)}>
              ✏️ Edit
            </button>
          )}
        </div>
      </header>

      <div className="detail-body">
        <div className="detail-info">
          <div className="detail-title-row">
            <span className="swatch swatch-lg" style={{ background: route.color }} />
            <h1>{route.name}</h1>
          </div>
          <div className={`confidence confidence-${route.confidence}`}>
            {confidenceLabel(route)}
          </div>

          <section className="detail-section">
            <h2>{wt ? 'Waypoints' : 'Street chain'}</h2>
            <ol className="street-chain street-chain-lg">
              {route.streetLabels.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>

          {wt && (
            <section className="detail-section">
              <h2>Trip details</h2>
              <dl className="trip-details">
                <dt>Waterway</dt>
                <dd>{wt.trip.waterway}</dd>

                <dt>Distance</dt>
                <dd>
                  ~{wt.distance.estimated_km} km ({wt.distance.range_km[0]}–{wt.distance.range_km[1]} km range)
                  <span className="trip-detail-note"> — {wt.distance.note}</span>
                </dd>

                <dt>Water flow</dt>
                <dd>
                  {wt.water_flow.general_direction}, typical current {wt.water_flow.current_strength_kmh.typical}–{wt.water_flow.current_strength_kmh.max} km/h
                  <span className="trip-detail-note"> — {wt.water_flow.note}</span>
                </dd>

                <dt>Paddling assumptions</dt>
                <dd>
                  {wt.paddling_speed_assumptions.craft}, {wt.paddling_speed_assumptions.skill_level} skill, {wt.paddling_speed_assumptions.conditions} —{' '}
                  {wt.paddling_speed_assumptions.speed_kmh.low}–{wt.paddling_speed_assumptions.speed_kmh.high} km/h (typ. {wt.paddling_speed_assumptions.speed_kmh.typical})
                </dd>

                <dt>Time estimate</dt>
                <dd>
                  {wt.time_estimate.total_hours.low}–{wt.time_estimate.total_hours.high} hours (typ. {wt.time_estimate.total_hours.typical}h) —{' '}
                  {wt.time_estimate.feasible_single_day ? 'feasible in a single day' : 'not feasible in a single day'}
                  <span className="trip-detail-note"> — {wt.time_estimate.recommendation}</span>
                </dd>
              </dl>

              {wt.sources && wt.sources.length > 0 && (
                <div className="trip-sources">
                  <h3 className="detail-subheading">Sources</h3>
                  <ul>
                    {wt.sources.map((s, i) => (
                      <li key={i}><a href={s} target="_blank" rel="noreferrer">{s}</a></li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {route.destinations && route.destinations.length > 0 && (
            <section className="detail-section">
              <h2>Destinations along the route</h2>
              <ul className="destination-list">
                {route.destinations.map((d, i) => (
                  <li key={i}>{d.label}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="detail-section detail-section-placeholder">
            <h2>Description, photos &amp; variations</h2>
            <p className="note">Nothing added yet — this space is reserved for extra write-up, photos, and route variations.</p>
          </section>

          {!wt && (
            <section className="detail-section">
              <h3 className="detail-subheading">Technical notes</h3>
              <p className="note">{route.note}</p>
            </section>
          )}
        </div>

        <RouteMap visibleRoutes={[route]} labelsVisible fitTo={route.coordinates} mapEdit={mapEdit} showDestinations />
      </div>
    </div>
  )
}

function App() {
  const [routes, setRoutes] = useState(initialRoutes)
  const [activeIds, setActiveIds] = useState(() => new Set(initialRoutes.map((r) => r.id)))
  const [location, setLocation] = useState(() => parseLocation())
  const [showLabels, setShowLabels] = useState(false)

  useEffect(() => {
    const onPopState = () => setLocation(parseLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const openDetail = (id) => {
    const route = routes.find((r) => r.id === id)
    window.history.pushState({}, '', detailPath(id))
    setLocation({ collection: (route && route.collection) || DEFAULT_COLLECTION, detailId: id })
  }

  const closeDetail = () => {
    window.history.pushState({}, '', collectionPath(location.collection))
    setLocation({ collection: location.collection, detailId: null })
  }

  const navigateToCollection = (key) => {
    window.history.pushState({}, '', collectionPath(key))
    setLocation({ collection: key, detailId: null })
  }

  const [editingId, setEditingId] = useState(null)
  const [editingCollection, setEditingCollection] = useState(null)
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
    setEditingCollection(route.collection)
    // Water trips are edited in their own raw schema (trip/distance/etc,
    // not the normalized route shape), so saving writes back a valid
    // wasserwege.json entry instead of a malformed hybrid.
    setEditText(formatRouteForEditing(route.waterTrip || route))
    setEditError(null)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingCollection(null)
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
        body: JSON.stringify({ id: editingId, route: parsed, collection: editingCollection }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      const normalized = editingCollection === 'wasserwege' ? normalizeWaterTrip(parsed) : parsed
      setRoutes((prev) => prev.map((r) => (r.id === editingId ? normalized : r)))
      setEditingId(null)
      setEditingCollection(null)
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
  const detailRoute = location.detailId ? routes.find((r) => r.id === location.detailId) : null

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
          collection={location.collection}
          routes={routes}
          activeIds={activeIds}
          onToggle={toggle}
          onOpenDetail={openDetail}
          onStartEditing={startEditing}
          showLabels={showLabels}
          onToggleLabels={() => setShowLabels((v) => !v)}
          onNavigate={navigateToCollection}
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
