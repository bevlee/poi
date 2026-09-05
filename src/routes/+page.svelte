<script>
	import { onMount } from 'svelte';
	import Map from '$lib/components/Map.svelte';
	import { searchAddress } from '$lib/nominatim.js';
	import { fetchMatrix, formatDuration, formatDistance, googleMapsTransitUrl } from '$lib/ors.js';
	import { createStore } from '$lib/store.svelte.js';

	let store;
	let mounted = $state(false);

	onMount(() => {
		store = createStore();
		mounted = true;
	});

	// Search
	let searchQuery = $state('');
	let searchResults = $state([]);
	let searching = $state(false);
	let searchError = $state('');
	let selectedGroupId = $state('');

	async function doSearch() {
		if (!searchQuery.trim()) return;
		searching = true;
		searchError = '';
		searchResults = [];
		try {
			searchResults = await searchAddress(searchQuery);
			if (searchResults.length === 0) searchError = 'No results found.';
		} catch (e) {
			searchError = e.message;
		}
		searching = false;
	}

	function addFromResult(result) {
		const groupId = selectedGroupId || store.groups[0]?.id;
		if (!groupId) { searchError = 'Create a group first.'; return; }
		store.addPlace({
			name: result.displayName.split(',')[0],
			address: result.displayName,
			latitude: result.lat,
			longitude: result.lon,
			groupId
		});
		searchResults = [];
		searchQuery = '';
	}

	// Group management
	let newGroupName = $state('');
	let newGroupColour = $state('#e67e22');

	function addGroup() {
		if (!newGroupName.trim()) return;
		store.addGroup(newGroupName.trim(), newGroupColour);
		newGroupName = '';
	}

	// Place editing
	let editingPlaceId = $state(null);
	let editName = $state('');
	let editGroupId = $state('');

	function startEdit(place) {
		editingPlaceId = place.id;
		editName = place.name;
		editGroupId = place.groupId;
	}

	function saveEdit() {
		store.updatePlace(editingPlaceId, { name: editName, groupId: editGroupId });
		editingPlaceId = null;
	}

	// Matrix
	let matrixProfile = $state('driving-car');
	let matrixLoading = $state(false);
	let matrixError = $state('');
	let matrixResult = $state(null);
	let matrixRowPlaces = $state([]);
	let matrixColPlaces = $state([]);
	let showDistances = $state(false);

	// Row/col group selection for matrix
	let rowGroupIds = $state(new Set());
	let colGroupIds = $state(new Set());

	function toggleRowGroup(id) {
		const next = new Set(rowGroupIds);
		next.has(id) ? next.delete(id) : next.add(id);
		rowGroupIds = next;
	}

	function toggleColGroup(id) {
		const next = new Set(colGroupIds);
		next.has(id) ? next.delete(id) : next.add(id);
		colGroupIds = next;
	}

	async function generateMatrix() {
		if (!store.orsApiKey) { matrixError = 'Set your ORS API key in Settings.'; return; }

		const rows = store.places.filter(p => rowGroupIds.has(p.groupId));
		const cols = store.places.filter(p => colGroupIds.has(p.groupId));
		if (rows.length === 0 || cols.length === 0) {
			matrixError = 'Select at least one row group and one column group.';
			return;
		}

		matrixLoading = true;
		matrixError = '';
		matrixResult = null;

		const allPlaces = [...rows, ...cols];
		const coords = allPlaces.map(p => [p.longitude, p.latitude]);

		const sources = rows.map((_, i) => i);
		const destinations = rows.map((_, i) => i + rows.length).concat().slice(0, cols.length);
		const destIndices = cols.map((_, i) => rows.length + i);

		try {
			const url = `https://api.openrouteservice.org/v2/matrix/${matrixProfile}`;
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': store.orsApiKey,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					locations: coords,
					sources: sources,
					destinations: destIndices,
					metrics: ['duration', 'distance']
				})
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`ORS error ${res.status}: ${text}`);
			}
			matrixResult = await res.json();
			matrixRowPlaces = rows;
			matrixColPlaces = cols;
		} catch (e) {
			matrixError = e.message;
		}
		matrixLoading = false;
	}

	// Export / Import
	let showSettings = $state(false);

	function exportData() {
		const blob = new Blob([store.exportData()], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'poi-data.json';
		a.click();
		URL.revokeObjectURL(url);
	}

	function importData(e) {
		const file = e.target.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				store.importData(reader.result);
			} catch (err) {
				alert('Invalid file: ' + err.message);
			}
		};
		reader.readAsText(file);
	}

	let mapComponent;
</script>

<svelte:head>
	<title>Place Comparison Map</title>
</svelte:head>

{#if !mounted}
	<p>Loading...</p>
{:else}
	<div class="app">
		<header>
			<h1>Place Comparison Map</h1>
			<button class="settings-btn" onclick={() => showSettings = !showSettings}>
				{showSettings ? 'Close Settings' : 'Settings'}
			</button>
		</header>

		{#if showSettings}
			<div class="settings-panel">
				<div class="setting-row">
					<label>
						ORS API Key
						<input type="text" value={store.orsApiKey} oninput={(e) => store.orsApiKey = e.target.value} placeholder="Your OpenRouteService key" />
					</label>
					<small><a href="https://openrouteservice.org/dev/#/signup" target="_blank" rel="noopener">Get a free key</a></small>
				</div>
				<div class="setting-row">
					<button onclick={exportData}>Export Data (JSON)</button>
					<label class="file-label">
						Import Data
						<input type="file" accept=".json" onchange={importData} hidden />
					</label>
				</div>
			</div>
		{/if}

		<div class="search-bar">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search address..."
				onkeydown={(e) => e.key === 'Enter' && doSearch()}
			/>
			<select bind:value={selectedGroupId}>
				{#each store.groups as g}
					<option value={g.id}>{g.name}</option>
				{/each}
			</select>
			<button onclick={doSearch} disabled={searching}>
				{searching ? 'Searching...' : 'Search'}
			</button>
		</div>

		{#if searchError}
			<div class="error">{searchError}</div>
		{/if}

		{#if searchResults.length > 0}
			<div class="search-results">
				{#each searchResults as result}
					<div class="search-result">
						<span class="result-name">{result.displayName}</span>
						<button onclick={() => addFromResult(result)}>Add</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="main-layout">
			<div class="sidebar">
				<div class="panel">
					<h2>Groups</h2>
					{#each store.groups as g}
						<div class="group-row">
							<label class="group-toggle">
								<input type="checkbox" checked={g.enabled} onchange={() => store.toggleGroup(g.id)} />
								<span class="colour-dot" style:background={g.colour}></span>
								{g.name}
							</label>
							<button class="small-btn delete-btn" onclick={() => store.deleteGroup(g.id)} title="Delete group">x</button>
						</div>
					{/each}
					<div class="add-group">
						<input type="text" bind:value={newGroupName} placeholder="New group" onkeydown={(e) => e.key === 'Enter' && addGroup()} />
						<input type="color" bind:value={newGroupColour} />
						<button onclick={addGroup}>+</button>
					</div>
				</div>

				<div class="panel">
					<h2>Places ({store.places.length})</h2>
					{#each store.places as place}
						{@const group = store.groups.find(g => g.id === place.groupId)}
						<div class="place-row">
							{#if editingPlaceId === place.id}
								<input type="text" bind:value={editName} class="edit-input" />
								<select bind:value={editGroupId}>
									{#each store.groups as g}
										<option value={g.id}>{g.name}</option>
									{/each}
								</select>
								<button class="small-btn" onclick={saveEdit}>Save</button>
								<button class="small-btn" onclick={() => editingPlaceId = null}>Cancel</button>
							{:else}
								<span class="colour-dot" style:background={group?.colour ?? '#999'}></span>
								<span class="place-name" title={place.address}>{place.name}</span>
								<button class="small-btn" onclick={() => startEdit(place)}>Edit</button>
								<button class="small-btn delete-btn" onclick={() => store.deletePlace(place.id)}>x</button>
							{/if}
						</div>
					{/each}
					{#if store.places.length === 0}
						<p class="empty">No places yet. Search to add some.</p>
					{/if}
				</div>
			</div>

			<div class="map-area">
				<Map places={store.places} groups={store.groups} bind:this={mapComponent} />
			</div>
		</div>

		<div class="matrix-section">
			<h2>Distance Matrix</h2>
			<div class="matrix-controls">
				<div class="matrix-group-select">
					<div>
						<strong>Row groups:</strong>
						{#each store.groups as g}
							<label>
								<input type="checkbox" checked={rowGroupIds.has(g.id)} onchange={() => toggleRowGroup(g.id)} />
								{g.name}
							</label>
						{/each}
					</div>
					<div>
						<strong>Column groups:</strong>
						{#each store.groups as g}
							<label>
								<input type="checkbox" checked={colGroupIds.has(g.id)} onchange={() => toggleColGroup(g.id)} />
								{g.name}
							</label>
						{/each}
					</div>
				</div>
				<div class="matrix-options">
					<select bind:value={matrixProfile}>
						<option value="driving-car">Driving</option>
						<option value="foot-walking">Walking</option>
						<option value="cycling-regular">Cycling</option>
					</select>
					<label>
						<input type="checkbox" bind:checked={showDistances} />
						Show distances
					</label>
					<button onclick={generateMatrix} disabled={matrixLoading}>
						{matrixLoading ? 'Calculating...' : 'Generate Matrix'}
					</button>
				</div>
			</div>

			{#if matrixError}
				<div class="error">{matrixError}</div>
			{/if}

			{#if matrixResult}
				<div class="matrix-table-wrapper">
					<table class="matrix-table">
						<thead>
							<tr>
								<th></th>
								{#each matrixColPlaces as col}
									<th>{col.name}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each matrixRowPlaces as row, ri}
								<tr>
									<td class="row-label">{row.name}</td>
									{#each matrixColPlaces as col, ci}
										{@const dur = matrixResult.durations?.[ri]?.[ci]}
										{@const dist = matrixResult.distances?.[ri]?.[ci]}
										<td class="matrix-cell">
											<span class="duration">{formatDuration(dur)}</span>
											{#if showDistances}
												<span class="distance">{formatDistance(dist)}</span>
											{/if}
											<a
												class="transit-link"
												href={googleMapsTransitUrl(row.latitude, row.longitude, col.latitude, col.longitude)}
												target="_blank"
												rel="noopener"
												title="Open in Google Maps (transit)"
											>Transit</a>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		background: #f5f5f5;
		color: #333;
	}

	.app {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	h1 {
		margin: 0;
		font-size: 1.4rem;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}

	.settings-btn {
		padding: 0.4rem 1rem;
		cursor: pointer;
	}

	.settings-panel {
		background: white;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 1rem;
		margin-bottom: 1rem;
	}

	.setting-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}

	.setting-row label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.setting-row input[type="text"] {
		width: 300px;
		padding: 0.3rem 0.5rem;
	}

	.file-label {
		padding: 0.4rem 1rem;
		background: #eee;
		border: 1px solid #ccc;
		border-radius: 4px;
		cursor: pointer;
	}

	.search-bar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.search-bar input[type="text"] {
		flex: 1;
		padding: 0.5rem;
		font-size: 1rem;
	}

	.search-bar select {
		padding: 0.5rem;
	}

	.search-bar button {
		padding: 0.5rem 1.5rem;
		cursor: pointer;
	}

	.search-results {
		background: white;
		border: 1px solid #ddd;
		border-radius: 4px;
		margin-bottom: 0.5rem;
		max-height: 200px;
		overflow-y: auto;
	}

	.search-result {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid #eee;
	}

	.search-result:last-child {
		border-bottom: none;
	}

	.result-name {
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		margin-right: 0.5rem;
	}

	.error {
		color: #c0392b;
		padding: 0.4rem;
		margin-bottom: 0.5rem;
	}

	.main-layout {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.sidebar {
		width: 280px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel {
		background: white;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 0.75rem;
	}

	.group-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.2rem 0;
	}

	.group-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
	}

	.colour-dot {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.add-group {
		display: flex;
		gap: 0.3rem;
		margin-top: 0.5rem;
	}

	.add-group input[type="text"] {
		flex: 1;
		padding: 0.3rem;
		min-width: 0;
	}

	.add-group input[type="color"] {
		width: 32px;
		height: 28px;
		padding: 0;
		border: 1px solid #ccc;
		cursor: pointer;
	}

	.place-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0;
		font-size: 0.85rem;
	}

	.place-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.edit-input {
		flex: 1;
		padding: 0.2rem;
		font-size: 0.85rem;
		min-width: 0;
	}

	.small-btn {
		padding: 0.15rem 0.4rem;
		font-size: 0.75rem;
		cursor: pointer;
		background: #eee;
		border: 1px solid #ccc;
		border-radius: 3px;
	}

	.delete-btn {
		color: #c0392b;
	}

	.empty {
		color: #999;
		font-size: 0.85rem;
		margin: 0.5rem 0 0;
	}

	.map-area {
		flex: 1;
		min-height: 500px;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid #ddd;
	}

	.matrix-section {
		background: white;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 1rem;
	}

	.matrix-controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.matrix-group-select {
		display: flex;
		gap: 2rem;
	}

	.matrix-group-select label {
		margin-right: 0.75rem;
		font-size: 0.9rem;
	}

	.matrix-options {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.matrix-options select {
		padding: 0.4rem;
	}

	.matrix-table-wrapper {
		overflow-x: auto;
	}

	.matrix-table {
		border-collapse: collapse;
		width: 100%;
	}

	.matrix-table th,
	.matrix-table td {
		border: 1px solid #ddd;
		padding: 0.5rem 0.75rem;
		text-align: center;
		white-space: nowrap;
	}

	.matrix-table th {
		background: #f9f9f9;
		font-size: 0.85rem;
	}

	.row-label {
		text-align: left;
		font-weight: 600;
		background: #f9f9f9;
	}

	.matrix-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
	}

	.duration {
		font-weight: 600;
	}

	.distance {
		font-size: 0.75rem;
		color: #888;
	}

	.transit-link {
		font-size: 0.7rem;
		color: #3498db;
	}
</style>
