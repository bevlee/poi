const STORAGE_KEY = 'poi-app-data';

function createId() {
	return crypto.randomUUID();
}

const DEFAULT_GROUPS = [
	{ id: createId(), name: 'Houses', colour: '#e74c3c', enabled: true },
	{ id: createId(), name: 'Work', colour: '#3498db', enabled: true },
	{ id: createId(), name: 'Sport', colour: '#2ecc71', enabled: true },
	{ id: createId(), name: 'Friends', colour: '#f39c12', enabled: true },
	{ id: createId(), name: 'Restaurants', colour: '#9b59b6', enabled: true }
];

function loadData() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return null;
}

function saveData(data) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {}
}

export function createStore() {
	const saved = loadData();
	let places = $state(saved?.places ?? []);
	let groups = $state(saved?.groups ?? structuredClone(DEFAULT_GROUPS));
	let orsApiKey = $state(saved?.orsApiKey ?? '');

	function persist() {
		saveData({ places, groups, orsApiKey });
	}

	return {
		get places() { return places; },
		get groups() { return groups; },
		get orsApiKey() { return orsApiKey; },
		set orsApiKey(v) { orsApiKey = v; persist(); },

		addPlace(place) {
			places.push({ id: createId(), ...place });
			persist();
		},

		updatePlace(id, updates) {
			const idx = places.findIndex(p => p.id === id);
			if (idx !== -1) {
				places[idx] = { ...places[idx], ...updates };
				persist();
			}
		},

		deletePlace(id) {
			places = places.filter(p => p.id !== id);
			persist();
		},

		addGroup(name, colour) {
			groups.push({ id: createId(), name, colour, enabled: true });
			persist();
		},

		updateGroup(id, updates) {
			const idx = groups.findIndex(g => g.id === id);
			if (idx !== -1) {
				groups[idx] = { ...groups[idx], ...updates };
				persist();
			}
		},

		deleteGroup(id) {
			groups = groups.filter(g => g.id !== id);
			places = places.filter(p => p.groupId !== id);
			persist();
		},

		toggleGroup(id) {
			const idx = groups.findIndex(g => g.id === id);
			if (idx !== -1) {
				groups[idx].enabled = !groups[idx].enabled;
				persist();
			}
		},

		exportData() {
			return JSON.stringify({ places, groups, orsApiKey }, null, 2);
		},

		importData(json) {
			const data = JSON.parse(json);
			if (data.places) places = data.places;
			if (data.groups) groups = data.groups;
			if (data.orsApiKey !== undefined) orsApiKey = data.orsApiKey;
			persist();
		}
	};
}
