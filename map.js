// =======================
// CONFIGURATION
// =======================

// CSV source
const CSV_URL =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vTE9HG_AHPm8MxhHg9zBLutHn1dZY3tZT3Y1q35S0e2GGZiMZpKCygmliGIymr33nbKHR5w-vyJTu_1/pub?gid=2115520549&single=true&output=csv';

let allFeatures = [];
let mapLoaded = false;
let dataLoaded = false;

// =======================
// INITIALISE MAP
// =======================

// Free OpenStreetMap raster tiles (with streets and labels)
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256
            }
        },
        layers: [{
            id: 'osm',
            type: 'raster',
            source: 'osm'
        }]
    },
    center: [-2.5, 54.5], // UK centre
    zoom: 5
});

// Map controls
map.addControl(new maplibregl.NavigationControl());

// =======================
// LOAD PAPAPARSE FOR CSV
// =======================
const papaScript = document.createElement('script');
papaScript.src = 'https://unpkg.com/papaparse@5.4.1/papaparse.min.js';
papaScript.onload = loadCSV;
document.head.appendChild(papaScript);

// =======================
// LOAD CSV DATA
// =======================
function loadCSV() {
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: result => {
            // Convert CSV rows to GeoJSON features
            allFeatures = result.data
                .filter(r => r.Latitude && r.Longitude)
                .map(r => {
                    const owner = r.Owner && r.Owner.trim() !== '' ? r.Owner.trim() : null;
                    return {
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [parseFloat(r.Longitude), parseFloat(r.Latitude)]
                        },
                        properties: {
                            area: r.Area.trim(),
                            owner: owner,
                            assigned: owner ? 'assigned' : 'not-assigned',
                            searchText: (r.Area + ' ' + (owner || 'Not assigned')).toLowerCase()
                        }
                    };
                });

            dataLoaded = true;
            maybeInit();
        }
    });
}

// =======================
// INITIALISE MAP WHEN READY
// =======================
map.on('load', () => {
    mapLoaded = true;
    maybeInit();
});

function maybeInit() {
    if (!mapLoaded || !dataLoaded) return;
    initMap();
}

// =======================
// INITIALISE MAP LAYERS & INTERACTIONS
// =======================
function initMap() {

    // ===== CREATE SVG ICONS =====
    function createPinSVG(color, radius = 4) {
        return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}">
        <path d="M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7z"/>
        <circle cx="12" cy="9" r="${radius}" fill="white"/>
      </svg>
    `;
    }

    // Red marker (not assigned)
    const redImg = new Image();
    redImg.onload = () => map.addImage('not-assigned', redImg);
    redImg.src = 'data:image/svg+xml;base64,' + btoa(createPinSVG('#cc0000', 4));

    // Green marker (assigned)
    const greenImg = new Image();
    greenImg.onload = () => map.addImage('assigned', greenImg);
    greenImg.src = 'data:image/svg+xml;base64,' + btoa(createPinSVG('#00cc44', 4));

    // ===== ADD DATA SOURCE =====
    map.addSource('locations', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: allFeatures
        }
    });

    // ===== ADD RED PIN LAYER (NOT ASSIGNED) =====
    map.addLayer({
        id: 'pins-red',
        type: 'symbol',
        source: 'locations',
        filter: ['==', ['get', 'assigned'], 'not-assigned'],
        layout: {
            'icon-image': 'not-assigned',
            'icon-size': 0.7,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true
        }
    });

    // ===== ADD GREEN PIN LAYER (ASSIGNED, ON TOP) =====
    map.addLayer({
        id: 'pins-green',
        type: 'symbol',
        source: 'locations',
        filter: ['==', ['get', 'assigned'], 'assigned'],
        layout: {
            'icon-image': 'assigned',
            'icon-size': 0.7,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true
        }
    });

    // ===== POPUPS =====
    const popup = new maplibregl.Popup({
        closeOnClick: true,
        closeButton: true,
        anchor: 'bottom',
        offset: [0, -5]
    });

    function addPopup(layer) {
        map.on('click', layer, e => {
            const p = e.features[0].properties;
            const text = p.owner ? `Assigned to: ${p.owner}` : 'Not assigned';
            popup.setLngLat(e.features[0].geometry.coordinates)
                .setHTML(`<strong>${p.area}</strong><br>${text}`)
                .addTo(map);
        });
        map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', layer, () => map.getCanvas().style.cursor = '');
    }

    addPopup('pins-red');
    addPopup('pins-green');

    // ===== SEARCH FUNCTIONALITY =====
    const searchInput = document.getElementById('search');

    searchInput.addEventListener('focus', () => {
        popup.remove();
    });

    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            searchInput.blur();
        }
    });

    searchInput.addEventListener('input', () => {
        const term = searchInput.value.toLowerCase().trim();
        const filtered =
            term === '' ?
            allFeatures :
            allFeatures.filter(f => f.properties.searchText.includes(term));

        // Update map source
        map.getSource('locations').setData({
            type: 'FeatureCollection',
            features: filtered
        });

        // Slight center / zoom adjustment (auto) for search results
        if (filtered.length > 0) {
            const coords = filtered.map(f => f.geometry.coordinates);
            const bounds = coords.reduce((b, c) => b.extend(c),
                new maplibregl.LngLatBounds(coords[0], coords[0])
            );

            const currentZoom = map.getZoom();
            const targetZoom = Math.min(12, currentZoom + 0.5); // small zoom in
            map.fitBounds(bounds, {
                padding: 60,
                maxZoom: targetZoom,
                duration: 500
            });
        }

        // Bigger pins if ≤20 results
        const size = filtered.length <= 20 ? 1.0 : 0.7;
        map.setLayoutProperty('pins-red', 'icon-size', size);
        map.setLayoutProperty('pins-green', 'icon-size', size);

        // Auto popup if single result
        if (filtered.length === 1) {
            const f = filtered[0];
            const text = f.properties.owner ? `Assigned to: ${f.properties.owner}` : 'Not assigned';
            popup.setLngLat(f.geometry.coordinates).setHTML(`<strong>${f.properties.area}</strong><br>${text}`).addTo(map);
        }
    });

    function updateProgress(features) {
        const total = 8405; // hard-coded total
        // Count only features that have an owner
        const assigned = features.filter(f => f.properties.owner && f.properties.owner.trim() !== '').length;
        const percent = (assigned / total) * 100;

        // Update text
        document.getElementById('progress-text').textContent = `${assigned} / ${total} assigned`;

        // Update progress bar fill
        document.getElementById('progress-bar-fill').style.width = percent + '%';
    }

    // Call on initial load
    updateProgress(allFeatures);

    // Also call inside the search/filter listener if you want it to reflect filtered results
    searchInput.addEventListener('input', () => {
        // ...existing search code...

        // Update progress bar based on filtered results
        updateProgress(filtered);
    });

}
