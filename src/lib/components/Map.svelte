<script>
	import { onMount, onDestroy } from 'svelte';
	import 'leaflet/dist/leaflet.css';

	let { places = [], groups = [], onMapClick = null } = $props();

	let mapContainer;
	let map;
	let markers = [];
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
	});

	onDestroy(() => {
		if (map) map.remove();
	});

	function createIcon(colour) {
		return L.divIcon({
			className: 'custom-marker',
			html: `<div style="background:${colour};width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
			iconSize: [24, 24],
			iconAnchor: [12, 12],
			popupAnchor: [0, -14]
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

			const marker = L.marker([place.latitude, place.longitude], {
				icon: createIcon(group.colour)
			}).addTo(map);

			marker.bindPopup(`<strong>${place.name}</strong><br>${group.name}`);
			markers.push(marker);
		}
	}

	$effect(() => {
		places; groups;
		updateMarkers();
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
</style>
