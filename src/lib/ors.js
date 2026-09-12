export async function fetchMatrix(apiKey, coordinates, profile = 'driving-car') {
	const url = `https://api.openrouteservice.org/v2/matrix/${profile}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': apiKey,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			locations: coordinates,
			metrics: ['duration', 'distance']
		})
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`ORS error ${res.status}: ${text}`);
	}
	return res.json();
}

export async function fetchDirections(apiKey, from, to, profile = 'driving-car') {
	const url = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': apiKey,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			coordinates: [
				[from.longitude, from.latitude],
				[to.longitude, to.latitude]
			]
		})
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`ORS error ${res.status}: ${text}`);
	}
	const data = await res.json();
	const feature = data.features[0];
	return {
		geometry: feature.geometry,
		duration: feature.properties.summary.duration,
		distance: feature.properties.summary.distance
	};
}

export async function fetchRoutesFromPlace(apiKey, origin, destinations, profile = 'driving-car') {
	const results = [];
	for (const dest of destinations) {
		try {
			const route = await fetchDirections(apiKey, origin, dest, profile);
			results.push({ destination: dest, ...route });
		} catch (e) {
			results.push({ destination: dest, error: e.message });
		}
	}
	return results;
}

export function formatDuration(seconds) {
	if (seconds == null) return '—';
	const mins = Math.round(seconds / 60);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatDistance(meters) {
	if (meters == null) return '—';
	if (meters < 1000) return `${Math.round(meters)}m`;
	return `${(meters / 1000).toFixed(1)}km`;
}

export function googleMapsTransitUrl(originLat, originLon, destLat, destLon) {
	return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLon}&destination=${destLat},${destLon}&travelmode=transit`;
}
