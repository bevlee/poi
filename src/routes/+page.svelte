<script>
	import { onMount } from 'svelte';
	import Map from '$lib/components/Map.svelte';
	import { searchAddress } from '$lib/nominatim.js';
	import { fetchRoutesFromPlace, formatDuration, formatDistance, googleMapsTransitUrl } from '$lib/ors.js';
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

	// Compare from place
	let compareProfile = $state('driving-car');
	let comparePlaceId = $state(null);
	let compareLoading = $state(false);
	let compareError = $state('');
	let compareRoutes = $state([]);

	function getComparPlace() {
		return store?.places.find(p => p.id === comparePlaceId) ?? null;
	}

	async function compareFrom(place) {
		if (!store.orsApiKey) { compareError = 'Set your ORS API key in Settings.'; return; }

		comparePlaceId = place.id;
		compareLoading = true;
		compareError = '';
		compareRoutes = [];

		const destinations = store.places.filter(p =>
			p.id !== place.id &&
			store.groups.find(g => g.id === p.groupId)?.enabled
		);

		if (destinations.length === 0) {
			compareError = 'No other enabled places to compare against.';
			compareLoading = false;
			return;
		}

		try {
			compareRoutes = await fetchRoutesFromPlace(store.orsApiKey, place, destinations, compareProfile);
			compareRoutes.sort((a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity));
		} catch (e) {
			compareError = e.message;
		}
		compareLoading = false;
	}

	function clearCompare() {
		comparePlaceId = null;
		compareRoutes = [];
		compareError = '';
	}

	async function recompare() {
		const place = getComparPlace();
		if (place) compareFrom(place);
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
					<div class="profile-select">
						<select bind:value={compareProfile}>
							<option value="driving-car">Driving</option>
							<option value="foot-walking">Walking</option>
							<option value="cycling-regular">Cycling</option>
						</select>
					</div>
					{#each store.places as place}
						{@const group = store.groups.find(g => g.id === place.groupId)}
						<div class="place-row" class:place-focused={place.id === comparePlaceId}>
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
								<button
									class="small-btn compare-btn"
									class:active={place.id === comparePlaceId}
									onclick={() => place.id === comparePlaceId ? clearCompare() : compareFrom(place)}
								>
									{place.id === comparePlaceId ? 'Clear' : 'Compare'}
								</button>
								<button class="small-btn" onclick={() => startEdit(place)}>Edit</button>
								<button class="small-btn delete-btn" onclick={() => store.deletePlace(place.id)}>x</button>
							{/if}
						</div>
					{/each}
					{#if store.places.length === 0}
						<p class="empty">No places yet. Search to add some.</p>
					{/if}
				</div>

				{#if comparePlaceId && (compareRoutes.length > 0 || compareLoading)}
					{@const focusPlace = getComparPlace()}
					<div class="panel compare-panel">
						<div class="compare-header">
							<h2>From: {focusPlace?.name ?? '...'}</h2>
							<button class="small-btn" onclick={clearCompare}>Clear</button>
						</div>
						{#if compareLoading}
							<p class="loading">Fetching routes...</p>
						{:else}
							<div class="route-list">
								{#each compareRoutes as route}
									{@const destGroup = store.groups.find(g => g.id === route.destination.groupId)}
									<div class="route-item">
										<span class="colour-dot" style:background={destGroup?.colour ?? '#999'}></span>
										<span class="route-dest">{route.destination.name}</span>
										{#if route.error}
											<span class="route-error">Error</span>
										{:else}
											<span class="route-time">{formatDuration(route.duration)}</span>
											<span class="route-dist">{formatDistance(route.distance)}</span>
										{/if}
										<a
											class="transit-link"
											href={googleMapsTransitUrl(focusPlace.latitude, focusPlace.longitude, route.destination.latitude, route.destination.longitude)}
											target="_blank"
											rel="noopener"
											title="Google Maps transit"
										>T</a>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="map-area">
				<Map
					places={store.places}
					groups={store.groups}
					routes={compareRoutes}
					focusPlaceId={comparePlaceId}
					bind:this={mapComponent}
				/>
			</div>
		</div>

		{#if compareError}
			<div class="error">{compareError}</div>
		{/if}
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
		width: 300px;
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

	.profile-select {
		margin-bottom: 0.5rem;
	}

	.profile-select select {
		width: 100%;
		padding: 0.3rem;
	}

	.place-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.2rem;
		font-size: 0.85rem;
		border-radius: 4px;
	}

	.place-focused {
		background: #eef6ff;
		border: 1px solid #b3d4fc;
		margin: 0 -0.2rem;
		padding: 0.25rem 0.4rem;
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

	.compare-btn {
		background: #e8f4fd;
		border-color: #90c5e8;
		color: #1a6fa0;
	}

	.compare-btn.active {
		background: #1a6fa0;
		color: white;
		border-color: #1a6fa0;
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

	.compare-panel {
		border-color: #b3d4fc;
		background: #f8fbff;
	}

	.compare-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.compare-header h2 {
		margin: 0;
	}

	.loading {
		color: #888;
		font-size: 0.85rem;
		margin: 0;
	}

	.route-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.route-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0;
		font-size: 0.85rem;
		border-bottom: 1px solid #e8eef4;
	}

	.route-item:last-child {
		border-bottom: none;
	}

	.route-dest {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.route-time {
		font-weight: 700;
		white-space: nowrap;
	}

	.route-dist {
		color: #888;
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.route-error {
		color: #c0392b;
		font-size: 0.75rem;
	}

	.transit-link {
		font-size: 0.7rem;
		color: #3498db;
		text-decoration: none;
		border: 1px solid #b3d4fc;
		border-radius: 3px;
		padding: 0 3px;
	}
</style>
