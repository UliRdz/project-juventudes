// scripts/generate-countries.js
// PURPOSE: Regenerate src/data/countries.js from public/geo/world.geojson so the
// app's country list can never drift from the map's feature names.
// INTENDED OUTPUT LINK: run this after replacing the GeoJSON (e.g. an admin
// uploads a new map on Day 5). If the list and the map disagree, country filters
// silently return nothing — this script is the guard against that.
// USAGE: node scripts/generate-countries.js   (run from the frontend/ folder)

import fs from "fs";     // Read the GeoJSON and write the generated JS module.
import path from "path"; // Build OS-correct paths to the input/output files.

const GEO = path.resolve("public/geo/world.geojson"); // Input: the map data actually shipped to users.
const OUT = path.resolve("src/data/countries.js");    // Output: the JS module the UI imports.

const geo = JSON.parse(fs.readFileSync(GEO, "utf8")); // Parse the FeatureCollection into memory.

const names = [                                        // Build the sorted, de-duplicated list of names:
  ...new Set(geo.features.map((f) => f.properties.name)), // Set removes duplicates if the file has multi-part countries.
].sort((a, b) => a.localeCompare(b));                  // localeCompare sorts accented names correctly (e.g. Å, Ö).

const header = `// src/data/countries.js
// PURPOSE: The single controlled list of country names used across the app.
// GENERATED FILE - do not edit by hand. Run: node scripts/generate-countries.js

export const COUNTRIES = [
`;                                                     // Header text written at the top of the generated file.

const body = names.map((n) => "  " + JSON.stringify(n) + ",").join("\n"); // One quoted name per line, comma-separated.

const footer = `
];

export const COUNTRY_SET = new Set(COUNTRIES); // O(1) membership checks for validation.
`;                                                     // Footer closes the array and adds the lookup Set.

fs.writeFileSync(OUT, header + body + footer);         // Write the finished module to disk.
console.log(`Wrote ${names.length} countries to ${OUT}`); // Report what happened so the run is verifiable.
