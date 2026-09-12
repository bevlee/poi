<script>
	import { onMount, onDestroy } from 'svelte';
	import 'leaflet/dist/leaflet.css';

	let { places = [], groups = [], routes = [], focusPlaceId = null, onMapClick = null } = $props();

	let mapContainer;
	let map;
	let markers = [];
	let routeLayers = [];
	let L;

	onMount(async () => {
		L = (await import('leaflet')).default;

		map = L.map(mapContainer).setView([-35.28, 149.13], 12);

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
		}).addTo(map);

		if (onMapClick) {
			map.on('click', (e) => onMapClick(e.latlng));
		}

		updateMarkers();
		updateRoutes();
	});

	onDestroy(() => {
		if (map) map.remove();
	});

	function createIcon(colour, isFocused) {
		const size = isFocused ? 32 : 24;
		const border = isFocused ? '4px solid #333' : '3px solid white';
		return L.divIcon({
			className: 'custom-marker',
			html: `<div style="background:${colour};width:${size}px;height:${size}px;border-radius:50%;border:${border};box-shadow:0 2px 6px rgba(0,0,0,${isFocused ? 0.5 : 0.3});"></div>`,
			iconSize: [size, size],
			iconAnchor: [size / 2, size / 2],
			popupAnchor: [0, -size / 2]
		});
	}

	function updateMarkers() {
		if (!map || !L) return;

		markers.forEach(m => m.remove());
		markers = [];

		const groupMap = new Map(groups.map(g => [g.id, g]));

		for (const place of places) {
			const group = groupMap.get(place.groupId);
			if (!group || !group.enabled) continue;

			const isFocused = place.id === focusPlaceId;
			const marker = L.marker([place.latitude, place.longitude], {
				icon: createIcon(group.colour, isFocused),
				zIndexOffset: isFocused ? 1000 : 0
			}).addTo(map);

			marker.bindPopup(`<strong>${place.name}</strong><br>${group.name}`);
			markers.push(marker);
		}
	}

	function updateRoutes() {
		if (!map || !L) return;

		routeLayers.forEach(l => l.remove());
		routeLayers = [];

		const groupMap = new Map(groups.map(g => [g.id, g]));

		for (const route of routes) {
			if (!route.geometry) continue;

			const destGroup = groupMap.get(route.destination.groupId);
			const colour = destGroup?.colour ?? '#666';

			const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

			const shadow = L.polyline(coords, {
				color: '#000',
				weight: 6,
				opacity: 0.15
			}).addTo(map);
			routeLayers.push(shadow);

			const line = L.polyline(coords, {
				color: colour,
				weight: 4,
				opacity: 0.8
			}).addTo(map);
			routeLayers.push(line);

			const mid = coords[Math.floor(coords.length / 2)];
			const mins = Math.round(route.duration / 60);
			const label = L.marker(mid, {
				icon: L.divIcon({
					className: 'route-label',
					html: `<div class="route-label-inner" style="border-color:${colour}">${mins}m</div>`,
					iconSize: [50, 24],
					iconAnchor: [25, 12]
				}),
				interactive: false
			}).addTo(map);
			routeLayers.push(label);

			line.bindPopup(`
				<strong>${route.destination.name}</strong><br>
				${mins} min &middot; ${(route.distance / 1000).toFixed(1)} km
			`);
		}

		if (routes.length > 0) {
			const allCoords = routes
				.filter(r => r.geometry)
				.flatMap(r => r.geometry.coordinates.map(c => [c[1], c[0]]));
			if (allCoords.length > 0) {
				map.fitBounds(L.latLngBounds(allCoords).pad(0.1));
			}
		}
	}

	$effect(() => {
		places; groups; focusPlaceId;
		updateMarkers();
	});

	$effect(() => {
		routes;
		updateRoutes();
	});

	export function fitBounds() {
		if (!map || !L || markers.length === 0) return;
		const group = L.featureGroup(markers);
		map.fitBounds(group.getBounds().pad(0.1));
	}
</script>

<div bind:this={mapContainer} class="map-container"></div>

<style>
	.map-container {
		width: 100%;
		height: 100%;
		min-height: 400px;
	}
	:global(.custom-marker) {
		background: transparent !important;
		border: none !important;
	}
	:global(.route-label) {
		background: transparent !important;
		border: none !important;
	}
	:global(.route-label-inner) {
		background: white;
		border: 2px solid #666;
		border-radius: 10px;
		padding: 1px 6px;
		font-size: 11px;
		font-weight: 700;
		white-space: nowrap;
		text-align: center;
		box-shadow: 0 1px 3px rgba(0,0,0,0.3);
	}
</style>
