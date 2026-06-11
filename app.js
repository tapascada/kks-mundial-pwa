const DEFAULT_DRIVE_ID = '1S6HbVBKvv3iTT6bnA6UiQDsNdPfXTNVt';

const STATE = {
  driveId: DEFAULT_DRIVE_ID,
  positions: [],
  matches: [],
  predictions: [],
  lastUpdate: null,
  isRefreshing: false
};

// DOM Cache (lazy getters to avoid element timing issues)
const DOM = {
  get btnRules() { return document.getElementById('btn-rules'); },
  get btnRefresh() { return document.getElementById('btn-refresh'); },
  get refreshIcon() { return document.getElementById('refresh-icon'); },
  
  // Tabs & Views
  get tabPosiciones() { return document.getElementById('tab-posiciones'); },
  get tabParticipantes() { return document.getElementById('tab-participantes'); },
  get tabPartidos() { return document.getElementById('tab-partidos'); },
  get viewPosiciones() { return document.getElementById('view-posiciones'); },
  get viewParticipantes() { return document.getElementById('view-participantes'); },
  get viewPartidos() { return document.getElementById('view-partidos'); },
  
  // Lists
  get leaderboardList() { return document.getElementById('leaderboard-list'); },
  get participantsList() { return document.getElementById('participants-list'); },
  get matchesList() { return document.getElementById('matches-list'); },
  
  // Podium
  get goldName() { return document.getElementById('txt-gold-name'); },
  get goldPoints() { return document.getElementById('txt-gold-points'); },
  get silverName() { return document.getElementById('txt-silver-name'); },
  get silverPoints() { return document.getElementById('txt-silver-points'); },
  get bronzeName() { return document.getElementById('txt-bronze-name'); },
  get bronzePoints() { return document.getElementById('txt-bronze-points'); },
  
  // Search inputs & status
  get searchInput() { return document.getElementById('search-input'); },
  get clearSearch() { return document.getElementById('clear-search'); },
  get participantSearchInput() { return document.getElementById('participant-search-input'); },
  get clearParticipantSearch() { return document.getElementById('clear-participant-search'); },
  get txtLastUpdate() { return document.getElementById('txt-last-update'); },
  
  // Modal Rules
  get modalRules() { return document.getElementById('modal-rules'); },
  get modalRulesClose() { return document.getElementById('rules-modal-close'); },
  
  // Modal Participant Detail
  get modalParticipantDetail() { return document.getElementById('modal-participant-detail'); },
  get participantModalClose() { return document.getElementById('participant-modal-close'); },
  get detailParticipantName() { return document.getElementById('detail-participant-name'); },
  get detailTotalPoints() { return document.getElementById('detail-total-points'); },
  get detailMatchPoints() { return document.getElementById('detail-match-points'); },
  get detailWildcardPoints() { return document.getElementById('detail-wildcard-points'); },
  get detailWcWinner() { return document.getElementById('detail-wc-winner'); },
  get detailWcWinnerPts() { return document.getElementById('detail-wc-winner-pts'); },
  get detailWcSecond() { return document.getElementById('detail-wc-second'); },
  get detailWcSecondPts() { return document.getElementById('detail-wc-second-pts'); },
  get detailWcThird() { return document.getElementById('detail-wc-third'); },
  get detailWcThirdPts() { return document.getElementById('detail-wc-third-pts'); },
  get detailWcScorer() { return document.getElementById('detail-wc-scorer'); },
  get detailWcScorerPts() { return document.getElementById('detail-wc-scorer-pts'); },
  get detailPredictionsList() { return document.getElementById('detail-predictions-list'); },
  
  // PTR
  get ptrFeedback() { return document.getElementById('ptr-feedback'); },
  get mainContent() { return document.querySelector('.app-content'); }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  // 1. Register Service Worker
  registerServiceWorker();
  
  // 2. Load stored settings & cached database
  loadSettings();
  
  // 3. Setup event listeners
  setupEventListeners();
  
  // 4. Fetch initial data if cache empty or cooldown expired
  if (STATE.driveId) {
    const hasCache = localStorage.getItem('kikes_cached_positions');
    if (!navigator.onLine) {
      showToast('Estás sin conexión. Mostrando datos guardados offline.', 'info');
    } else if (!hasCache || checkRefreshCooldown(false)) {
      fetchStandings();
    }
  } else {
    renderEmptyState();
  }
});

// --- Settings Management & Loading ---
function loadSettings() {
  STATE.driveId = DEFAULT_DRIVE_ID;
  
  const cachedPos = localStorage.getItem('kikes_cached_positions');
  const cachedMatches = localStorage.getItem('kikes_cached_matches');
  const cachedPreds = localStorage.getItem('kikes_cached_predictions');
  const cachedTime = localStorage.getItem('kikes_cached_time');
  
  if (cachedPos && cachedMatches && cachedPreds && cachedTime) {
    try {
      STATE.positions = JSON.parse(cachedPos);
      STATE.matches = JSON.parse(cachedMatches);
      STATE.predictions = JSON.parse(cachedPreds);
      STATE.lastUpdate = new Date(cachedTime);
      renderUI();
    } catch (e) {
      console.error('Error parsing cached data', e);
    }
  }
}

const COOLDOWN_MS = 10 * 1000; // 10 seconds cooldown to prevent rapid spam clicks while enabling easy testing

function checkRefreshCooldown(isManual = false) {
  const cachedData = localStorage.getItem('kikes_cached_positions');
  if (!cachedData) return true;
  
  const cachedTimeStr = localStorage.getItem('kikes_cached_time');
  if (!cachedTimeStr) return true;
  
  const lastTime = new Date(cachedTimeStr);
  const now = new Date();
  const elapsed = now.getTime() - lastTime.getTime();
  
  if (elapsed < COOLDOWN_MS) {
    if (isManual) {
      const remainingSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      showToast(`Espera ${remainingSec} segundo(s) antes de volver a actualizar.`, 'info');
    }
    return false;
  }
  return true;
}

// Helper to perform fetch with a timeout using AbortController
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 5000 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// --- Fetch & Load Database ---
async function fetchStandings(force = false) {
  if (STATE.isRefreshing) return;
  
  // Immediately fail if offline
  if (!navigator.onLine) {
    showToast('Sin conexión a internet. No se pueden actualizar los datos.', 'warning');
    return;
  }

  setLoadingState(true);
  
  const fileId = STATE.driveId;
  // Use Google Sheets export URL to get the latest live spreadsheet data as an Excel file
  const downloadUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx&t=${Date.now()}`;
  
  try {
    console.log('Downloading Excel database from Google Sheets...');
    const response = await fetchWithTimeout(downloadUrl, { 
      cache: 'no-store', 
      timeout: 10000,
      credentials: 'omit'
    });
    if (!response.ok) throw new Error('Download from Google Sheets failed');
    
    const data = await response.arrayBuffer();
    
    // Save last modified date from response headers if available (or just store current time)
    const lastModifiedHeader = response.headers.get('Last-Modified') || new Date().toUTCString();
    localStorage.setItem('kikes_db_last_modified', lastModifiedHeader);
    
    await loadExcelDatabase(data);
    
    if (force) {
      showToast('Datos actualizados correctamente.', 'success');
    }
  } catch (err) {
    console.warn('Google Sheets download failed, attempting local fallback...', err);
    try {
      // Also cache-bust the local fallback file fetch request
      const fallbackUrl = `./KikesMundial_Posiciones.xlsm?t=${Date.now()}`;
      const response = await fetchWithTimeout(fallbackUrl, { cache: 'no-store', timeout: 5000 });
      if (!response.ok) throw new Error('Local fallback failed');
      
      const data = await response.arrayBuffer();
      await loadExcelDatabase(data);
      
      if (force) {
        showToast('Usando datos de respaldo local (Sheets no disponible).', 'warning');
      }
    } catch (err2) {
      console.error('All download methods failed.', err2);
      renderErrorState('No se pudo descargar la base de datos de Google Sheets ni cargar el respaldo local.', force);
    }
  } finally {
    setLoadingState(false);
  }
}




async function loadExcelDatabase(arrayBuffer) {
  try {
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: 'array' });
    
    if (!workbook.SheetNames.includes('Posiciones') || 
        !workbook.SheetNames.includes('Partidos') || 
        !workbook.SheetNames.includes('Pronosticos')) {
      throw new Error('El archivo Excel no tiene el formato correcto (faltan hojas).');
    }
    
    // 1. Parse Posiciones
    const sheetPos = workbook.Sheets['Posiciones'];
    const rowsPos = XLSX.utils.sheet_to_json(sheetPos, { defval: "" });
    const positions = rowsPos.map(r => ({
      name: String(r['Nombre'] || '').trim(),
      matchPoints: parseInt(r['Puntos Partidos'] || 0),
      wildcardPoints: parseInt(r['Puntos Comodín'] || 0),
      totalPoints: parseInt(r['Puntos Totales'] || 0),
      predictedWinner: String(r['Campeón'] || '').trim(),
      winnerPoints: parseInt(r['Pts Campeón'] || 0),
      predictedSecond: String(r['Subcampeón'] || '').trim(),
      secondPoints: parseInt(r['Pts Subcampeón'] || 0),
      predictedThird: String(r['Tercer Puesto'] || '').trim(),
      thirdPoints: parseInt(r['Pts Tercer Puesto'] || 0),
      predictedScorer: String(r['Goleador'] || '').trim(),
      scorerPoints: parseInt(r['Pts Goleador'] || 0)
    })).filter(p => p.name !== '');

    // 2. Parse Partidos
    const sheetMatch = workbook.Sheets['Partidos'];
    const rowsMatch = XLSX.utils.sheet_to_json(sheetMatch, { defval: "" });
    const matches = rowsMatch.map(r => ({
      id: parseInt(r['Id'] || 0),
      groupStage: String(r['Fase'] || '').trim(),
      team1: String(r['Equipo Local'] || '').trim(),
      team2: String(r['Equipo Visitante'] || '').trim(),
      realGoals1: r['Goles Local'] === "" || r['Goles Local'] === undefined ? null : parseInt(r['Goles Local']),
      realGoals2: r['Goles Visitante'] === "" || r['Goles Visitante'] === undefined ? null : parseInt(r['Goles Visitante'])
    })).filter(m => m.id > 0);

    // 3. Parse Pronosticos
    const sheetPred = workbook.Sheets['Pronosticos'];
    const rowsPred = XLSX.utils.sheet_to_json(sheetPred, { defval: "" });
    const predictions = rowsPred.map(r => ({
      participantName: String(r['Nombre Participante'] || '').trim(),
      matchId: parseInt(r['ID Partido'] || 0),
      predGoals1: r['Pred Local'] === "" || r['Pred Local'] === undefined ? null : parseInt(r['Pred Local']),
      predGoals2: r['Pred Visitante'] === "" || r['Pred Visitante'] === undefined ? null : parseInt(r['Pred Visitante']),
      points: parseInt(r['Puntos'] || 0)
    })).filter(pr => pr.participantName !== '' && pr.matchId > 0);

    STATE.positions = positions;
    STATE.matches = matches;
    STATE.predictions = predictions;
    STATE.lastUpdate = new Date();

    // Cache as JSON strings
    localStorage.setItem('kikes_cached_positions', JSON.stringify(positions));
    localStorage.setItem('kikes_cached_matches', JSON.stringify(matches));
    localStorage.setItem('kikes_cached_predictions', JSON.stringify(predictions));
    localStorage.setItem('kikes_cached_time', STATE.lastUpdate.toISOString());

    renderUI();
  } catch (ex) {
    console.error('Error loading Excel database', ex);
    renderErrorState('El archivo descargado no es un archivo de Kikes Mundial válido.');
  }
}

// --- UI Rendering ---
function renderUI() {
  if (!STATE.positions || STATE.positions.length === 0) return;
  
  // Sort positions descending by totalPoints, then name ascending
  const sortedPositions = [...STATE.positions].sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
  
  let currentRank = 1;
  const standingsWithRank = sortedPositions.map((s, index) => {
    if (index > 0 && s.totalPoints < sortedPositions[index - 1].totalPoints) {
      currentRank = index + 1;
    }
    return {
      rank: currentRank,
      name: s.name,
      matchPoints: s.matchPoints,
      wildcardPoints: s.wildcardPoints,
      totalPoints: s.totalPoints
    };
  });

  renderPodium(standingsWithRank);
  renderList(standingsWithRank, DOM.searchInput.value);

  // Matches sorted descending by ID
  const sortedMatches = [...STATE.matches].sort((a, b) => b.id - a.id);
  renderMatches(sortedMatches);

  renderParticipantsList(standingsWithRank, DOM.participantSearchInput.value);

  if (STATE.lastUpdate) {
    const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' };
    DOM.txtLastUpdate.innerText = `Última actualización: ${STATE.lastUpdate.toLocaleString('es-ES', options)}`;
  }
}

function renderPodium(standings) {
  DOM.goldName.innerText = '-';
  DOM.goldPoints.innerText = '0 pts';
  DOM.silverName.innerText = '-';
  DOM.silverPoints.innerText = '0 pts';
  DOM.bronzeName.innerText = '-';
  DOM.bronzePoints.innerText = '0 pts';
  
  const first = standings.find(s => s.rank === 1);
  if (first) {
    DOM.goldName.innerText = first.name;
    DOM.goldPoints.innerText = `${first.totalPoints} pts`;
  }
  
  const second = standings.find(s => s.rank === 2) || standings[1];
  if (second && second !== first) {
    DOM.silverName.innerText = second.name;
    DOM.silverPoints.innerText = `${second.totalPoints} pts`;
  }
  
  const third = standings.find(s => s.rank === 3) || standings[2];
  if (third && third !== first && third !== second) {
    DOM.bronzeName.innerText = third.name;
    DOM.bronzePoints.innerText = `${third.totalPoints} pts`;
  }
}

function renderList(standings, filterText = '') {
  DOM.leaderboardList.innerHTML = '';
  
  const filtered = standings.filter(s => 
    s.name.toLowerCase().includes(filterText.toLowerCase())
  );
  
  if (filtered.length === 0) {
    DOM.leaderboardList.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <h3>Sin Resultados</h3>
        <p>No se encontraron participantes.</p>
      </div>
    `;
    return;
  }
  
  filtered.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = `leaderboard-item item-rank-${item.rank}`;
    
    itemEl.innerHTML = `
      <div class="col-rank">
        <span class="rank-badge">${item.rank}</span>
      </div>
      <div class="col-name">
        <span class="item-name">${item.name}</span>
      </div>
      <div class="col-details">
        <div class="item-details">
          <span>Partidos / Comodín</span>
          <div class="pts-breakdown">
            <span class="pts-type">⚽ ${item.matchPoints}</span>
            <span class="pts-type">🏆 ${item.wildcardPoints}</span>
          </div>
        </div>
      </div>
      <div class="col-total">
        <span class="total-badge">${item.totalPoints}</span>
      </div>
    `;
    
    DOM.leaderboardList.appendChild(itemEl);
  });
}

// --- Render Matches Tab ---
function renderMatches(matches) {
  DOM.matchesList.innerHTML = '';
  
  // A match is played/completed if it has real goals assigned in the database
  const playedMatches = matches.filter(m => m.realGoals1 !== null && m.realGoals2 !== null);
  
  if (playedMatches.length === 0) {
    DOM.matchesList.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-circle-play"></i>
        <h3>Sin Partidos</h3>
        <p>No hay partidos finalizados con resultados cargados todavía.</p>
      </div>
    `;
    return;
  }
  
  playedMatches.forEach(match => {
    const cardEl = document.createElement('div');
    cardEl.className = 'match-card';
    
    cardEl.innerHTML = `
      <div class="match-card-header">${match.groupStage}</div>
      <div class="match-card-teams">
        <div class="team-info team-local-info">
          <span class="match-team team-local">${match.team1}</span>
          <img src="${getFlagUrl(match.team1)}" class="match-flag flag-local" onerror="this.src='Assets/Flags/placeholder.png'" alt="">
        </div>
        <span class="match-score-pill">${match.realGoals1} - ${match.realGoals2}</span>
        <div class="team-info team-visit-info">
          <img src="${getFlagUrl(match.team2)}" class="match-flag flag-visit" onerror="this.src='Assets/Flags/placeholder.png'" alt="">
          <span class="match-team team-visit">${match.team2}</span>
        </div>
      </div>
      <button class="match-toggle-btn" data-match-id="${match.id}">
        <i class="fa-solid fa-chevron-down"></i> Ver Pronósticos
      </button>
      <div class="top10-predictions-panel" id="panel-predictions-${match.id}">
        <table class="predictions-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Nombre</th>
              <th>Pronóstico</th>
              <th>Puntos</th>
            </tr>
          </thead>
          <tbody id="predictions-body-${match.id}">
            <tr>
              <td colspan="4" style="text-align: center; padding: 15px; color: var(--text-secondary);">
                <i class="fa-solid fa-circle-notch fa-spin"></i> Cargando pronósticos...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    
    DOM.matchesList.appendChild(cardEl);
  });
  
  // Setup expand/collapse handlers
  const toggles = DOM.matchesList.querySelectorAll('.match-toggle-btn');
  toggles.forEach(btn => {
    btn.addEventListener('click', () => {
      const matchId = parseInt(btn.getAttribute('data-match-id'));
      const panel = document.getElementById(`panel-predictions-${matchId}`);
      const isExpanded = panel.classList.contains('show');
      
      if (isExpanded) {
        panel.classList.remove('show');
        btn.classList.remove('expanded');
        btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> Ver Pronósticos`;
      } else {
        panel.classList.add('show');
        btn.classList.add('expanded');
        btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> Ocultar Pronósticos`;
        
        loadMatchPredictions(matchId);
      }
    });
  });
}


function loadMatchPredictions(matchId) {
  const tbody = document.getElementById(`predictions-body-${matchId}`);
  if (!tbody) return;

  // Filter predictions for this match
  const filteredPreds = STATE.predictions.filter(pr => pr.matchId === matchId);
  
  // Sort descending by points, then name ascending
  filteredPreds.sort((a, b) => b.points - a.points || a.participantName.localeCompare(b.participantName));

  if (filteredPreds.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 12px; color: var(--text-secondary);">
          No hay pronósticos registrados para este partido.
        </td>
      </tr>
    `;
    return;
  }

  let currentRank = 1;
  const rowsHtml = filteredPreds.map((p, idx) => {
    if (idx > 0 && p.points < filteredPreds[idx - 1].points) {
      currentRank = idx + 1;
    }
    
    let badgeClass = 'zero';
    if (p.points === 5) badgeClass = 'exact';
    else if (p.points === 3) badgeClass = 'diff';
    else if (p.points === 2) badgeClass = 'outcome';
    
    const predText = (p.predGoals1 !== null && p.predGoals2 !== null) ? `${p.predGoals1} - ${p.predGoals2}` : "-";
    
    return `
      <tr>
        <td class="pred-cell-rank">${currentRank}°</td>
        <td class="pred-cell-name">${p.participantName}</td>
        <td class="pred-cell-val">${predText}</td>
        <td class="pred-cell-pts">
          <span class="pred-pts-badge ${badgeClass}">${p.points} pts</span>
        </td>
      </tr>
    `;
  }).join('');
  
  tbody.innerHTML = rowsHtml;
}

// --- Render Participants Tab ---
function renderParticipantsList(standings, filterText = '') {
  DOM.participantsList.innerHTML = '';
  
  const filtered = standings.filter(s => 
    s.name.toLowerCase().includes(filterText.toLowerCase())
  );
  
  if (filtered.length === 0) {
    DOM.participantsList.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <h3>Sin Resultados</h3>
        <p>No se encontraron participantes.</p>
      </div>
    `;
    return;
  }
  
  filtered.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'participant-item';
    
    itemEl.innerHTML = `
      <div class="col-rank" style="width: 55px; text-align: center;">
        <span class="rank-badge">${item.rank}</span>
      </div>
      <div class="col-name" style="flex: 1; margin-left: 10px;">
        <span class="item-name">${item.name}</span>
      </div>
      <div class="col-details" style="width: 90px; text-align: center; font-weight: 800; color: var(--accent-gold); font-size: 15px;">
        ${item.totalPoints} pts
      </div>
      <div class="col-total" style="width: 105px; text-align: right;">
        <button class="btn-detail" data-participant-name="${item.name}">
          <i class="fa-solid fa-eye"></i> Ver Pronos
        </button>
      </div>
    `;
    
    DOM.participantsList.appendChild(itemEl);
  });
  
  // Set listeners for details
  const detailBtns = DOM.participantsList.querySelectorAll('.btn-detail');
  detailBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const partName = btn.getAttribute('data-participant-name');
      openParticipantDetailModal(partName);
    });
  });
}

function openParticipantDetailModal(participantName) {
  DOM.detailParticipantName.innerHTML = `<i class="fa-solid fa-user-tie"></i> ${participantName}`;
  
  const part = STATE.positions.find(p => p.name === participantName);
  if (!part) return;
  
  DOM.detailTotalPoints.innerText = `${part.totalPoints} pts`;
  DOM.detailMatchPoints.innerText = `${part.matchPoints} pts`;
  
  const wildcardSum = part.winnerPoints + part.secondPoints + part.thirdPoints + part.scorerPoints;
  DOM.detailWildcardPoints.innerText = `${wildcardSum} pts`;
  
  DOM.detailWcWinner.innerText = part.predictedWinner || '-';
  DOM.detailWcWinnerPts.innerText = `${part.winnerPoints} pts`;
  
  DOM.detailWcSecond.innerText = part.predictedSecond || '-';
  DOM.detailWcSecondPts.innerText = `${part.secondPoints} pts`;
  
  DOM.detailWcThird.innerText = part.predictedThird || '-';
  DOM.detailWcThirdPts.innerText = `${part.thirdPoints} pts`;
  
  DOM.detailWcScorer.innerText = part.predictedScorer || '-';
  DOM.detailWcScorerPts.innerText = `${part.scorerPoints} pts`;
  
  // Filter predictions for this participant
  const partPreds = STATE.predictions.filter(pr => pr.participantName === participantName);
  
  // Order predictions by match ID ascending
  partPreds.sort((a, b) => a.matchId - b.matchId);
  
  DOM.detailPredictionsList.innerHTML = '';
  
  if (partPreds.length === 0) {
    DOM.detailPredictionsList.innerHTML = `
      <div style="text-align: center; padding: 25px; color: var(--text-secondary); font-size: 13px;">
        No hay pronósticos registrados para este participante.
      </div>
    `;
  } else {
    partPreds.forEach(p => {
      const match = STATE.matches.find(m => m.id === p.matchId);
      if (!match) return;
      
      const itemEl = document.createElement('div');
      itemEl.className = 'history-pred-card';
      
      const realText = (match.realGoals1 !== null && match.realGoals2 !== null) ? `${match.realGoals1} - ${match.realGoals2}` : "Pendiente";
      const predText = (p.predGoals1 !== null && p.predGoals2 !== null) ? `${p.predGoals1} - ${p.predGoals2}` : "-";
      
      let badgeClass = 'zero';
      if (p.points === 5) badgeClass = 'exact';
      else if (p.points === 3) badgeClass = 'diff';
      else if (p.points === 2) badgeClass = 'outcome';
      
      itemEl.innerHTML = `
        <div class="history-pred-header">
          <span>${match.groupStage}</span>
          <span class="pred-pts-badge ${badgeClass}">${p.points} pts</span>
        </div>
        <div class="history-pred-body">
          <div class="history-pred-teams">
            <span>${match.team1} vs ${match.team2}</span>
          </div>
          <div class="history-pred-result">
            <div class="history-score-display">
              <div class="history-score-box pred">
                <span class="history-score-box-label">Pred</span>
                <span class="history-score-box-val">${predText}</span>
              </div>
              <div class="history-score-box">
                <span class="history-score-box-label">Real</span>
                <span class="history-score-box-val">${realText}</span>
              </div>
            </div>
          </div>
        </div>
      `;
      
      DOM.detailPredictionsList.appendChild(itemEl);
    });
  }
  
  DOM.modalParticipantDetail.classList.remove('hidden');
}

function closeParticipantDetailModal() {
  DOM.modalParticipantDetail.classList.add('hidden');
}

// --- Empty / Error States ---
function renderEmptyState() {
  DOM.leaderboardList.innerHTML = `
    <div class="empty-state">
      <i class="fa-solid fa-magnifying-glass"></i>
      <h3>Sin Datos</h3>
      <p>No se pudo cargar la base de datos de la polla.</p>
    </div>
  `;
}

// --- Empty / Error States ---
function renderErrorState(message, isManual = false) {
  if (STATE.positions && STATE.positions.length > 0) {
    if (isManual) {
      showToast(message, 'error');
    }
    return;
  }
  
  DOM.leaderboardList.innerHTML = `
    <div class="error-state">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <h3>Error de Sincronización</h3>
      <p>${message}</p>
      <button class="btn-secondary" id="btn-error-retry">Reintentar</button>
    </div>
  `;
  document.getElementById('btn-error-retry').addEventListener('click', () => {
    if (!navigator.onLine) {
      showToast('Sin conexión a internet.', 'warning');
      return;
    }
    fetchStandings(true);
  });
}

function setLoadingState(loading) {
  STATE.isRefreshing = loading;
  if (loading) {
    DOM.refreshIcon.classList.add('fa-spin');
    DOM.ptrFeedback.classList.add('show');
  } else {
    DOM.refreshIcon.classList.remove('fa-spin');
    DOM.ptrFeedback.classList.remove('show');
  }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Modal Rules
  DOM.btnRules.addEventListener('click', () => DOM.modalRules.classList.remove('hidden'));
  DOM.modalRulesClose.addEventListener('click', () => DOM.modalRules.classList.add('hidden'));
  DOM.modalRules.addEventListener('click', (e) => {
    if (e.target === DOM.modalRules) DOM.modalRules.classList.add('hidden');
  });

  // Modal Participant Detail
  DOM.participantModalClose.addEventListener('click', closeParticipantDetailModal);
  DOM.modalParticipantDetail.addEventListener('click', (e) => {
    if (e.target === DOM.modalParticipantDetail) closeParticipantDetailModal();
  });
  
  // Refresh Button
  DOM.btnRefresh.addEventListener('click', () => {
    if (!navigator.onLine) {
      showToast('Sin conexión a internet. No se pueden actualizar los datos.', 'warning');
      return;
    }
    if (checkRefreshCooldown(true)) {
      fetchStandings(true);
    }
  });
  
  // Search Positions
  DOM.searchInput.addEventListener('input', (e) => {
    const text = e.target.value;
    if (text) {
      DOM.clearSearch.classList.add('show');
    } else {
      DOM.clearSearch.classList.remove('show');
    }
    
    if (STATE.positions && STATE.positions.length > 0) {
      const sortedPositions = [...STATE.positions].sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
      let currentRank = 1;
      const standingsWithRank = sortedPositions.map((s, index) => {
        if (index > 0 && s.totalPoints < sortedPositions[index - 1].totalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.name,
          matchPoints: s.matchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.totalPoints
        };
      });
      renderList(standingsWithRank, text);
    }
  });
  
  DOM.clearSearch.addEventListener('click', () => {
    DOM.searchInput.value = '';
    DOM.clearSearch.classList.remove('show');
    if (STATE.positions && STATE.positions.length > 0) {
      const sortedPositions = [...STATE.positions].sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
      let currentRank = 1;
      const standingsWithRank = sortedPositions.map((s, index) => {
        if (index > 0 && s.totalPoints < sortedPositions[index - 1].totalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.name,
          matchPoints: s.matchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.totalPoints
        };
      });
      renderList(standingsWithRank, '');
    }
  });
  
  // Search Participants
  DOM.participantSearchInput.addEventListener('input', (e) => {
    const text = e.target.value;
    if (text) {
      DOM.clearParticipantSearch.classList.add('show');
    } else {
      DOM.clearParticipantSearch.classList.remove('show');
    }
    
    if (STATE.positions && STATE.positions.length > 0) {
      const sortedPositions = [...STATE.positions].sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
      let currentRank = 1;
      const standingsWithRank = sortedPositions.map((s, index) => {
        if (index > 0 && s.totalPoints < sortedPositions[index - 1].totalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.name,
          matchPoints: s.matchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.totalPoints
        };
      });
      renderParticipantsList(standingsWithRank, text);
    }
  });
  
  DOM.clearParticipantSearch.addEventListener('click', () => {
    DOM.participantSearchInput.value = '';
    DOM.clearParticipantSearch.classList.remove('show');
    if (STATE.positions && STATE.positions.length > 0) {
      const sortedPositions = [...STATE.positions].sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
      let currentRank = 1;
      const standingsWithRank = sortedPositions.map((s, index) => {
        if (index > 0 && s.totalPoints < sortedPositions[index - 1].totalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.name,
          matchPoints: s.matchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.totalPoints
        };
      });
      renderParticipantsList(standingsWithRank, '');
    }
  });
  
  // Pull-to-refresh swipe gesture
  let touchStart = 0;
  DOM.mainContent.addEventListener('touchstart', (e) => {
    // Only allow pull-to-refresh if we are at the very top of the window scroll
    const windowAtTop = (window.scrollY || document.documentElement.scrollTop) === 0;
    if (!windowAtTop) {
      touchStart = 0;
      return;
    }

    // Check if the scrollable list inside the active view is also at the top
    const activePanel = document.querySelector('.view-panel:not(.hidden)');
    if (activePanel) {
      const scrollableList = activePanel.querySelector('.leaderboard-list, .participants-list, .matches-list');
      if (scrollableList && scrollableList.scrollTop > 0) {
        touchStart = 0;
        return;
      }
    }
    
    touchStart = e.touches[0].clientY;
  }, { passive: true });
  
  DOM.mainContent.addEventListener('touchmove', (e) => {
    if (touchStart > 0) {
      const pullDist = e.touches[0].clientY - touchStart;
      if (pullDist > 70 && !STATE.isRefreshing) {
        if (!navigator.onLine) {
          showToast('Sin conexión a internet. No se pueden actualizar los datos.', 'warning');
          touchStart = 0;
          return;
        }
        if (checkRefreshCooldown(false)) {
          fetchStandings(true);
        }
        touchStart = 0;
      }
    }
  }, { passive: true });
  
  // Tab Navigation Switching
  DOM.tabPosiciones.addEventListener('click', () => {
    DOM.tabPosiciones.classList.add('active');
    DOM.tabParticipantes.classList.remove('active');
    DOM.tabPartidos.classList.remove('active');
    
    DOM.viewPosiciones.classList.remove('hidden');
    DOM.viewParticipantes.classList.add('hidden');
    DOM.viewPartidos.classList.add('hidden');
  });
  
  DOM.tabParticipantes.addEventListener('click', () => {
    DOM.tabParticipantes.classList.add('active');
    DOM.tabPosiciones.classList.remove('active');
    DOM.tabPartidos.classList.remove('active');
    
    DOM.viewParticipantes.classList.remove('hidden');
    DOM.viewPosiciones.classList.add('hidden');
    DOM.viewPartidos.classList.add('hidden');
  });
  
  DOM.tabPartidos.addEventListener('click', () => {
    DOM.tabPartidos.classList.add('active');
    DOM.tabPosiciones.classList.remove('active');
    DOM.tabParticipantes.classList.remove('active');
    
    DOM.viewPartidos.classList.remove('hidden');
    DOM.viewPosiciones.classList.add('hidden');
    DOM.viewParticipantes.classList.add('hidden');
  });
}

// --- Flag Resolver Helper ---
function getFlagUrl(teamName) {
  if (!teamName) return 'Assets/Flags/placeholder.png';
  
  let normalized = teamName.toLowerCase().trim();
  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  normalized = normalized.replace(/\s+/g, '_');
  
  if (normalized === 'usa' || normalized === 'estados_unidos') normalized = 'estados_unidos';
  if (normalized === 'republica_checa') normalized = 'republica_checa';
  
  return `Assets/Flags/${normalized}.png`;
}

// --- Service Worker Registration ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker Registered successfully! ✓', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));

    // Force automatic reload when the service worker updates and takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
}

// --- Toast Notification System ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconHtml = '';
  if (type === 'success') iconHtml = '<i class="fa-solid fa-circle-check toast-icon"></i>';
  else if (type === 'error') iconHtml = '<i class="fa-solid fa-triangle-exclamation toast-icon"></i>';
  else if (type === 'warning') iconHtml = '<i class="fa-solid fa-circle-exclamation toast-icon"></i>';
  else iconHtml = '<i class="fa-solid fa-circle-info toast-icon"></i>';
  
  toast.innerHTML = `
    ${iconHtml}
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Trigger transition
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Auto remove
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 4000);
}
