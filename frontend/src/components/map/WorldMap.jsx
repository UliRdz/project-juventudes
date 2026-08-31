// src/components/map/WorldMap.jsx
// PURPOSE: The interactive world map. Loads country shapes from GeoJSON, styles
// them with the brand palette (light blue on hover, deep blue when selected), and
// reports the clicked country upward. Blocks interaction when logged out.
// INTENDED OUTPUT LINK: this is the main page of the product. A click here is what
// opens the dual popup (scholarships left, users right), so onSelectCountry is the
// hand-off point between the map and the rest of the discovery experience.

import { useEffect, useState } from "react";                  // State for the loaded GeoJSON + which country is active.
import { MapContainer, GeoJSON, TileLayer } from "react-leaflet"; // React wrappers around Leaflet's map, vector layer, and tiles.
import "leaflet/dist/leaflet.css";                            // Leaflet's own stylesheet; without it the map renders broken/greyed.

// Style objects use the exact brand tokens from the design system (Day 1).
// Leaflet needs plain JS values here (it draws to canvas/SVG), so these can't be
// CSS variables — the hex codes are kept in sync with tokens.css by hand.
const IDLE = {                        // Default look for every country.
  fillColor: "#A8C8E6",               // Light Blue fill (accent token).
  weight: 1,                          // Thin border.
  color: "#3A79B4",                   // Medium Blue border (secondary token).
  fillOpacity: 0.4,                   // Mostly transparent so the base map shows through.
};
const HOVER = {                       // Look while the pointer is over a country.
  fillColor: "#A8C8E6",               // Same Light Blue...
  weight: 2,                          // ...but a thicker border...
  color: "#3A79B4",
  fillOpacity: 0.7,                   // ...and more opaque, so hover is clearly visible.
};
const ACTIVE = {                      // Look for the currently selected country.
  fillColor: "#0B4F81",               // Deep Blue fill (primary token) per the spec.
  weight: 2,
  color: "#0B4F81",
  fillOpacity: 0.8,                   // Strong fill so the selection stands out.
};

export default function WorldMap({ isLoggedIn, onSelectCountry }) { // Props: whether to allow clicks, and the click callback.
  const [geo, setGeo] = useState(null);         // The parsed GeoJSON FeatureCollection (null while loading).
  const [active, setActive] = useState(null);   // Name of the selected country, or null if none.
  const [error, setError] = useState("");       // Message if the map data fails to load.

  useEffect(() => {                                            // Load the map data once, when the component mounts.
    // import.meta.env.BASE_URL is Vite's configured base ("/project-juventudes/"),
    // so this path resolves correctly BOTH locally and on GitHub Pages.
    fetch(`${import.meta.env.BASE_URL}geo/world.geojson`)       // Fetch the static file from the public/ folder.
      .then((r) => {                                           // Check the HTTP response before parsing.
        if (!r.ok) throw new Error("No se pudo cargar el mapa"); // Non-200 -> throw so .catch below handles it.
        return r.json();                                       // Parse the JSON body into an object.
      })
      .then(setGeo)                                            // Store the FeatureCollection -> triggers a re-render with the map.
      .catch((e) => setError(e.message));                      // Show a readable message instead of a blank screen.
  }, []);                                                      // [] = run once on mount only.

  // Read a feature's country name. This file uses properties.name; the ADMIN
  // fallback covers other common world-GeoJSON exports (e.g. Natural Earth).
  function nameOf(feature) {                                   // Small helper used by both styling and click handling.
    return feature.properties.name || feature.properties.ADMIN; // Prefer .name, fall back to .ADMIN.
  }

  function styleFor(feature) {                                 // Leaflet calls this per feature to decide its colors.
    return nameOf(feature) === active ? ACTIVE : IDLE;         // Selected country gets Deep Blue; everything else idle.
  }

  function onEach(feature, layer) {                            // Leaflet calls this once per country to attach behavior.
    const name = nameOf(feature);                              // The country this layer represents.

    layer.bindTooltip(name, { sticky: true });                 // Show the country name in a tooltip that follows the cursor.

    layer.on({                                                 // Register mouse handlers on this country shape.
      mouseover: (e) => {                                      // Pointer entered the shape.
        if (name !== active) e.target.setStyle(HOVER);         // Apply hover styling, but never override the active selection.
      },
      mouseout: (e) => {                                       // Pointer left the shape.
        if (name !== active) e.target.setStyle(IDLE);          // Revert to idle, again leaving the active country alone.
      },
      click: () => {                                           // User clicked this country.
        if (!isLoggedIn) {                                     // GATE: the spec forbids country interaction when logged out.
          alert("Inicia sesión para explorar países");         // Tell the user why nothing happened (Spanish-first).
          return;                                              // Stop: do not select, do not fetch.
        }
        setActive(name);                                       // Mark this country active -> re-styles it Deep Blue.
        onSelectCountry(name);                                 // Tell the parent, which opens the dual popup for this country.
      },
    });
  }                                                            // End onEach.

  if (error) return <p style={{ color: "crimson" }}>{error}</p>; // Render the load error if the GeoJSON never arrived.
  if (!geo) return <p>Cargando mapa…</p>;                       // Simple loading state while the fetch is in flight.

  return (                                                      // Render the Leaflet map.
    <MapContainer
      center={[20, 0]}                                          // Initial center [lat, lng]: roughly the whole world.
      zoom={2}                                                  // Zoomed out enough to see every continent.
      style={{ height: "70vh", width: "100%", borderRadius: "var(--radius)" }} // Fill the width; rounded per design tokens.
      worldCopyJump={true}                                      // Keeps panning sane when the user scrolls past the date line.
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" // Base map imagery tiles (streets/landmasses).
        attribution="&copy; OpenStreetMap"                       // Attribution is REQUIRED by the OSM tile usage policy.
      />
      <GeoJSON
        key={active}                                            // Changing the key remounts the layer so styleFor() re-runs for ALL countries.
        data={geo}                                              // The country shapes to draw.
        style={styleFor}                                        // Per-feature color function defined above.
        onEachFeature={onEach}                                  // Per-feature behavior (hover/click/tooltip) defined above.
      />
    </MapContainer>
  );                                                            // End returned JSX.
}                                                               // End WorldMap component.
