export async function searchAddress(query) {
	const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
	const res = await fetch(url, {
		headers: { 'User-Agent': 'poi-comparison-map/1.0' }
	});
	if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
	const results = await res.json();
	return results.map(r => ({
		displayName: r.display_name,
		lat: parseFloat(r.lat),
		lon: parseFloat(r.lon)
	}));
}
