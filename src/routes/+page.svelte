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
		const firstNonCandidate = store.groups.find(g => g.id !== store.candidateGroupId);
		selectedGroupId = firstNonCandidate?.id ?? store.groups[0]?.id ?? '';
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

	// Compare mode
	let compareProfile = $state('driving-car');
	let comparing = $state(false);
	let compareLoading = $state(false);
	let compareError = $state('');
	let candidateRoutes = $state({});
	let activeCandidateId = $state(null);

	function getCandidates() {
		if (!store?.candidateGroupId) return [];
		return store.places.filter(p => p.groupId === store.candidateGroupId);
	}

	function getDestinations() {
		if (!store) return [];
		return store.places.filter(p => {
			if (p.groupId === store.candidateGroupId) return false;
			const g = store.groups.find(g => g.id === p.groupId);
			return g?.enabled;
		});
	}

	async function compareAll() {
		const candidates = getCandidates();
		const destinations = getDestinations();

		if (!store.orsApiKey) { compareError = 'Set your ORS API key in Settings.'; return; }
		if (candidates.length === 0) { compareError = 'No candidates to compare.'; return; }
		if (destinations.length === 0) { compareError = 'No places of interest to compare against.'; return; }

		comparing = true;
		compareLoading = true;
		compareError = '';
		candidateRoutes = {};
		activeCandidateId = candidates[0].id;

		try {
			const results = await Promise.all(
				candidates.map(async (candidate) => {
					const routes = await fetchRoutesFromPlace(store.orsApiKey, candidate, destinations, compareProfile);
					routes.sort((a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity));
					return { candidateId: candidate.id, routes };
				})
			);
			const routeMap = {};
			for (const { candidateId, routes } of results) {
				routeMap[candidateId] = routes;
			}
			candidateRoutes = routeMap;
		} catch (e) {
			compareError = e.message;
		}
		compareLoading = false;
	}

	function exitCompare() {
		comparing = false;
		candidateRoutes = {};
		activeCandidateId = null;
		compareError = '';
	}

	function getActiveRoutes() {
		if (!activeCandidateId) return [];
		return candidateRoutes[activeCandidateId] ?? [];
	}

	function getActiveCandidate() {
		return store?.places.find(p => p.id === activeCandidateId) ?? null;
	}

	// Summary table helpers
	function routeFor(candidateId, destId) {
		return candidateRoutes[candidateId]?.find(r => r.destination.id === destId) ?? null;
	}

	function minDurationForDest(destId) {
		const candidates = getCandidates();
		let min = Infinity;
		for (const c of candidates) {
			const r = routeFor(c.id, destId);
			if (r?.duration != null && r.duration < min) min = r.duration;
		}
		return min === Infinity ? null : min;
	}

	function totalDuration(candidateId) {
		const destinations = getDestinations();
		let total = 0;
		for (const dest of destinations) {
			const r = routeFor(candidateId, dest.id);
			if (r?.duration == null) return null;
			total += r.duration;
		}
		return total;
	}

	function minTotalDuration() {
		const candidates = getCandidates();
		let min = Infinity;
		for (const c of candidates) {
			const t = totalDuration(c.id);
			if (t != null && t < min) min = t;
		}
		return min === Infinity ? null : min;
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

{#snippet placeRow(place)}
	{@const group = store.groups.find(g => g.id === place.groupId)}
	{@const disabled = group && !group.enabled}
	<div class="place-row" class:dimmed={disabled}>
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
			<span class="place-group-label">{group?.name ?? ''}</span>
			<button class="small-btn" onclick={() => startEdit(place)}>Edit</button>
			<button class="small-btn delete-btn" onclick={() => store.deletePlace(place.id)}>x</button>
		{/if}
	</div>
{/snippet}

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
				placeholder="Search for a place..."
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
				<!-- Groups panel -->
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
					<div class="candidate-select">
						<label>
							Candidates:
							<select value={store.candidateGroupId} onchange={(e) => store.setCandidateGroup(e.target.value)}>
								{#each store.groups as g}
									<option value={g.id}>{g.name}</option>
								{/each}
							</select>
						</label>
					</div>
				</div>

				<!-- Places / Compare panel -->
				{#if !comparing}
					{@const candidates = getCandidates()}
					{@const destinations = getDestinations()}
					{@const nonCandidatePlaces = store.places.filter(p => p.groupId !== store.candidateGroupId)}
					{@const candidateGroup = store.groups.find(g => g.id === store.candidateGroupId)}
					<div class="panel">

						<div class="panel-header-row">
							<h2>Places ({store.places.length})</h2>
							<select class="profile-sel" bind:value={compareProfile}>
								<option value="driving-car">Driving</option>
								<option value="foot-walking">Walking</option>
								<option value="cycling-regular">Cycling</option>
							</select>
						</div>

						<!-- Guidance -->
						{#if store.places.length === 0}
							<div class="guidance">
								<div class="step"><span class="step-num">1</span> Search and add places of interest (work, gym, friends)</div>
								<div class="step"><span class="step-num">2</span> Add {candidateGroup?.name?.toLowerCase() ?? 'candidates'} to compare</div>
								<div class="step"><span class="step-num">3</span> Hit Compare to see travel times</div>
							</div>
						{:else if nonCandidatePlaces.length === 0}
							<p class="guidance-hint">Add places of interest (work, gym, etc.) to compare your {candidateGroup?.name?.toLowerCase() ?? 'candidates'} against.</p>
						{:else if candidates.length === 0}
							<p class="guidance-hint">Add some {candidateGroup?.name?.toLowerCase() ?? 'candidates'} to compare against your places of interest.</p>
						{/if}

						<!-- Places of Interest -->
						{#if nonCandidatePlaces.length > 0}
							<h3 class="section-label">Places of Interest</h3>
							{#each nonCandidatePlaces as place}
								{@render placeRow(place)}
							{/each}
						{/if}

						<!-- Candidates -->
						{#if candidates.length > 0}
							<h3 class="section-label">{candidateGroup?.name ?? 'Candidates'}</h3>
							{#each candidates as place}
								{@render placeRow(place)}
							{/each}
						{/if}

						<!-- Compare button -->
						{#if candidates.length > 0 && destinations.length > 0}
							<button class="compare-all-btn" onclick={compareAll} disabled={compareLoading}>
								{compareLoading ? 'Comparing...' : `Compare ${candidates.length} ${candidateGroup?.name ?? 'Candidates'}`}
							</button>
						{/if}
					</div>
				{:else}
					{@const candidates = getCandidates()}
					{@const candidateGroup = store.groups.find(g => g.id === store.candidateGroupId)}
					{@const activeCandidate = getActiveCandidate()}
					{@const activeRoutes = getActiveRoutes()}
					<!-- Compare mode -->
					<div class="panel compare-panel">

						<div class="compare-header">
							<h2>{candidateGroup?.name ?? 'Candidates'}</h2>
							<button class="small-btn exit-btn" onclick={exitCompare}>Exit</button>
						</div>

						<div class="candidate-tabs">
							{#each candidates as c}
								{@const cGroup = store.groups.find(g => g.id === c.groupId)}
								<button
									class="candidate-tab"
									class:active={c.id === activeCandidateId}
									style:border-color={c.id === activeCandidateId ? cGroup?.colour ?? '#e74c3c' : 'transparent'}
									onclick={() => activeCandidateId = c.id}
								>
									{c.name}
								</button>
							{/each}
						</div>

						{#if compareLoading}
							<p class="loading">Fetching routes...</p>
						{:else if activeRoutes.length > 0}
							<div class="route-list">
								{#each activeRoutes as route}
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
										{#if activeCandidate && !route.error}
											<a
												class="transit-link"
												href={googleMapsTransitUrl(activeCandidate.latitude, activeCandidate.longitude, route.destination.latitude, route.destination.longitude)}
												target="_blank"
												rel="noopener"
												title="Google Maps transit"
											>T</a>
										{/if}
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
					routes={comparing ? getActiveRoutes() : []}
					focusPlaceId={comparing ? activeCandidateId : null}
					bind:this={mapComponent}
				/>
			</div>
		</div>

		<!-- Comparison summary table -->
		{#if comparing && !compareLoading && Object.keys(candidateRoutes).length > 0}
			{@const candidates = getCandidates()}
			{@const destinations = getDestinations()}
			{@const candidateGroup = store.groups.find(g => g.id === store.candidateGroupId)}
			{@const minT = minTotalDuration()}

			<div class="summary-section">
				<h2>Comparison Summary</h2>
				<div class="table-scroll">
					<table class="summary-table">
						<thead>
							<tr>
								<th class="dest-col">Destination</th>
								{#each candidates as c}
									<th class:active-col={c.id === activeCandidateId}>{c.name}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each destinations as dest}
								{@const minDur = minDurationForDest(dest.id)}
								{@const destGroup = store.groups.find(g => g.id === dest.groupId)}
								<tr>
									<td class="dest-col">
										<span class="colour-dot" style:background={destGroup?.colour ?? '#999'}></span>
										{dest.name}
									</td>
									{#each candidates as c}
										{@const route = routeFor(c.id, dest.id)}
										{@const dur = route?.duration}
										{@const isBest = dur != null && minDur != null && dur <= minDur}
										<td class:best={isBest} class:active-col={c.id === activeCandidateId}>
											{#if route?.error}
												<span class="route-error">Err</span>
											{:else}
												<div class="cell-time">{formatDuration(dur)}</div>
												<div class="cell-dist">{formatDistance(route?.distance)}</div>
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="total-row">
								<td class="dest-col"><strong>Total</strong></td>
								{#each candidates as c}
									{@const total = totalDuration(c.id)}
									{@const isBestTotal = total != null && minT != null && total <= minT}
									<td class:best={isBestTotal} class:active-col={c.id === activeCandidateId}>
										<strong>{formatDuration(total)}</strong>
									</td>
								{/each}
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
		{/if}

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

	h1 { margin: 0; font-size: 1.4rem; }
	h2 { margin: 0 0 0.5rem; font-size: 1rem; }
	h3 { margin: 0; font-size: 0.85rem; }

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

	/* Search */
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

	.search-bar select { padding: 0.5rem; }
	.search-bar button { padding: 0.5rem 1.5rem; cursor: pointer; }

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

	.search-result:last-child { border-bottom: none; }

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

	/* Layout */
	.main-layout {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.sidebar {
		width: 320px;
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

	.map-area {
		flex: 1;
		min-height: 500px;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid #ddd;
	}

	/* Groups */
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

	.candidate-select {
		margin-top: 0.6rem;
		padding-top: 0.5rem;
		border-top: 1px solid #eee;
	}

	.candidate-select label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #555;
	}

	.candidate-select select {
		flex: 1;
		padding: 0.25rem;
		font-size: 0.85rem;
	}

	/* Places panel */
	.panel-header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.panel-header-row h2 { margin: 0; }

	.profile-sel {
		padding: 0.2rem 0.3rem;
		font-size: 0.8rem;
	}

	.guidance {
		background: #f0f7ff;
		border: 1px solid #c5ddf5;
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		margin-bottom: 0.5rem;
	}

	.step {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: #456;
		padding: 0.2rem 0;
	}

	.step-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #3498db;
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.guidance-hint {
		font-size: 0.85rem;
		color: #666;
		background: #fef9e7;
		border: 1px solid #f0e0a0;
		border-radius: 4px;
		padding: 0.5rem 0.6rem;
		margin: 0 0 0.5rem;
	}

	.section-label {
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		font-size: 0.7rem;
		font-weight: 600;
		margin-top: 0.6rem;
		margin-bottom: 0.3rem;
		padding-bottom: 0.2rem;
		border-bottom: 1px solid #eee;
	}

	/* Place rows */
	.place-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.2rem;
		font-size: 0.85rem;
		border-radius: 4px;
	}

	.place-row.dimmed { opacity: 0.5; }

	.place-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.place-group-label {
		font-size: 0.7rem;
		color: #999;
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

	.delete-btn { color: #c0392b; }

	/* Compare all button */
	.compare-all-btn {
		display: block;
		width: 100%;
		margin-top: 0.75rem;
		padding: 0.6rem 1rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: white;
		background: #2980b9;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.compare-all-btn:hover:not(:disabled) { background: #1a6fa0; }
	.compare-all-btn:disabled { opacity: 0.6; cursor: default; }

	/* Compare panel */
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

	.compare-header h2 { margin: 0; }

	.exit-btn {
		background: #fdecea;
		border-color: #e8a5a0;
		color: #c0392b;
	}

	/* Candidate tabs */
	.candidate-tabs {
		display: flex;
		gap: 0.3rem;
		margin-bottom: 0.6rem;
		flex-wrap: wrap;
	}

	.candidate-tab {
		padding: 0.35rem 0.7rem;
		font-size: 0.82rem;
		font-weight: 500;
		background: white;
		border: 2px solid transparent;
		border-bottom-width: 3px;
		border-radius: 4px 4px 0 0;
		cursor: pointer;
		color: #666;
		transition: all 0.15s;
	}

	.candidate-tab:hover { background: #f0f0f0; }

	.candidate-tab.active {
		color: #333;
		font-weight: 700;
		background: white;
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

	.route-item:last-child { border-bottom: none; }

	.route-dest {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.route-time { font-weight: 700; white-space: nowrap; }
	.route-dist { color: #888; font-size: 0.75rem; white-space: nowrap; }
	.route-error { color: #c0392b; font-size: 0.75rem; }

	.transit-link {
		font-size: 0.7rem;
		color: #3498db;
		text-decoration: none;
		border: 1px solid #b3d4fc;
		border-radius: 3px;
		padding: 0 3px;
	}

	/* Summary table */
	.summary-section {
		background: white;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 1rem;
	}

	.summary-section h2 {
		margin-bottom: 0.6rem;
	}

	.table-scroll {
		overflow-x: auto;
	}

	.summary-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.summary-table th,
	.summary-table td {
		padding: 0.45rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid #eee;
		white-space: nowrap;
	}

	.summary-table thead th {
		background: #f8f9fa;
		font-weight: 600;
		border-bottom: 2px solid #ddd;
	}

	.summary-table .dest-col {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.summary-table td.best {
		background: #e8f8e8;
		font-weight: 600;
	}

	.summary-table td.active-col,
	.summary-table th.active-col {
		background: #eef6ff;
	}

	.summary-table td.best.active-col {
		background: #d4f0d4;
	}

	.total-row td {
		border-top: 2px solid #ccc;
		border-bottom: none;
	}

	.cell-time { font-weight: 600; }
	.cell-dist { color: #999; font-size: 0.75rem; }
</style>
