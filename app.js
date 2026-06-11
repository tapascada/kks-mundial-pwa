const DEFAULT_DRIVE_ID = '1JvSLdvZcjBVSECB5eAffPA6uEY_Wm-zF';

const STATE = {
  driveId: DEFAULT_DRIVE_ID,
  db: null,
  lastUpdate: null,
  isRefreshing: false
};

// DOM Cache
const DOM = {
  btnRules: document.getElementById('btn-rules'),
  btnRefresh: document.getElementById('btn-refresh'),
  refreshIcon: document.getElementById('refresh-icon'),
  
  // Tabs & Views
  tabPosiciones: document.getElementById('tab-posiciones'),
  tabParticipantes: document.getElementById('tab-participantes'),
  tabPartidos: document.getElementById('tab-partidos'),
  viewPosiciones: document.getElementById('view-posiciones'),
  viewParticipantes: document.getElementById('view-participantes'),
  viewPartidos: document.getElementById('view-partidos'),
  
  // Lists
  leaderboardList: document.getElementById('leaderboard-list'),
  participantsList: document.getElementById('participants-list'),
  matchesList: document.getElementById('matches-list'),
  
  // Podium
  goldName: document.getElementById('txt-gold-name'),
  goldPoints: document.getElementById('txt-gold-points'),
  silverName: document.getElementById('txt-silver-name'),
  silverPoints: document.getElementById('txt-silver-points'),
  bronzeName: document.getElementById('txt-bronze-name'),
  bronzePoints: document.getElementById('txt-bronze-points'),
  
  // Search inputs & status
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  participantSearchInput: document.getElementById('participant-search-input'),
  clearParticipantSearch: document.getElementById('clear-participant-search'),
  txtLastUpdate: document.getElementById('txt-last-update'),
  
  // Modal Rules
  modalRules: document.getElementById('modal-rules'),
  modalRulesClose: document.getElementById('rules-modal-close'),

  // Modal Settings
  btnSettings: document.getElementById('btn-settings'),
  modalSettings: document.getElementById('modal-settings'),
  settingsModalClose: document.getElementById('settings-modal-close'),
  inputDriveId: document.getElementById('input-drive-id'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  
  // Modal Participant Detail
  modalParticipantDetail: document.getElementById('modal-participant-detail'),
  participantModalClose: document.getElementById('participant-modal-close'),
  detailParticipantName: document.getElementById('detail-participant-name'),
  detailTotalPoints: document.getElementById('detail-total-points'),
  detailMatchPoints: document.getElementById('detail-match-points'),
  detailWildcardPoints: document.getElementById('detail-wildcard-points'),
  detailWcWinner: document.getElementById('detail-wc-winner'),
  detailWcWinnerPts: document.getElementById('detail-wc-winner-pts'),
  detailWcSecond: document.getElementById('detail-wc-second'),
  detailWcSecondPts: document.getElementById('detail-wc-second-pts'),
  detailWcThird: document.getElementById('detail-wc-third'),
  detailWcThirdPts: document.getElementById('detail-wc-third-pts'),
  detailWcScorer: document.getElementById('detail-wc-scorer'),
  detailWcScorerPts: document.getElementById('detail-wc-scorer-pts'),
  detailPredictionsList: document.getElementById('detail-predictions-list'),
  
  // PTR
  ptrFeedback: document.getElementById('ptr-feedback'),
  mainContent: document.querySelector('.app-content')
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
    const hasCache = localStorage.getItem('kikes_db_binary');
    if (!hasCache || checkRefreshCooldown(false)) {
      fetchStandings();
    }
  } else {
    renderEmptyState();
  }
});

// --- Settings Management & Loading ---
function uint8ArrayToBase64(uint8Array) {
  let binary = '';
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

function loadSettings() {
  const storedId = localStorage.getItem('kikes_drive_file_id');
  STATE.driveId = storedId || DEFAULT_DRIVE_ID;
  if (DOM.inputDriveId) {
    DOM.inputDriveId.value = STATE.driveId;
  }
  
  const cachedDbBase64 = localStorage.getItem('kikes_db_binary');
  const cachedTime = localStorage.getItem('kikes_cached_time');
  if (cachedDbBase64 && cachedTime) {
    try {
      STATE.lastUpdate = new Date(cachedTime);
      initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` }).then(SQL => {
        const binaryString = atob(cachedDbBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        STATE.db = new SQL.Database(bytes);
        renderUI();
      }).catch(err => {
        console.error('Error initializing SQL from cache', err);
      });
    } catch (e) {
      console.error('Error decoding cached database', e);
    }
  }
}

const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

function checkRefreshCooldown(isManual = false) {
  const cachedData = localStorage.getItem('kikes_db_binary');
  if (!cachedData) return true;
  
  const cachedTimeStr = localStorage.getItem('kikes_cached_time');
  if (!cachedTimeStr) return true;
  
  const lastTime = new Date(cachedTimeStr);
  const now = new Date();
  const elapsed = now.getTime() - lastTime.getTime();
  
  if (elapsed < COOLDOWN_MS) {
    if (isManual) {
      const remainingMs = COOLDOWN_MS - elapsed;
      const remainingMin = Math.ceil(remainingMs / (60 * 1000));
      alert(`Los datos se actualizaron recientemente.\nPara proteger el límite de cuota de Google Drive, puedes volver a solicitar datos en ${remainingMin} minuto(s).`);
    }
    return false;
  }
  return true;
}

// --- Fetch & Load Database ---
async function fetchStandings() {
  if (STATE.isRefreshing) return;
  setLoadingState(true);
  
  const fileId = STATE.driveId;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(downloadUrl)}`;
  
  try {
    console.log('Fetching database from Google Drive...');
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error('Direct download failed');
    const data = await response.arrayBuffer();
    await loadDatabase(data);
  } catch (err) {
    console.warn('Direct download failed, falling back to CORS proxy...', err);
    try {
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('CORS proxy download failed');
      const data = await response.arrayBuffer();
      await loadDatabase(data);
    } catch (err2) {
      console.warn('Google Drive download failed, attempting local fallback for testing...', err2);
      try {
        const response = await fetch('./kikes_mundial.db');
        if (!response.ok) throw new Error('Local fallback failed');
        const data = await response.arrayBuffer();
        await loadDatabase(data);
      } catch (err3) {
        console.error('All download methods failed.', err3);
        renderErrorState('No se pudo descargar la base de datos de Google Drive ni cargar el archivo local. Verifica que el enlace sea público.');
      }
    }
  }
  setLoadingState(false);
}

async function loadDatabase(arrayBuffer) {
  try {
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
    const bytes = new Uint8Array(arrayBuffer);
    STATE.db = new SQL.Database(bytes);
    
    // Save to cache
    const base64 = uint8ArrayToBase64(bytes);
    localStorage.setItem('kikes_db_binary', base64);
    STATE.lastUpdate = new Date();
    localStorage.setItem('kikes_cached_time', STATE.lastUpdate.toISOString());
    
    renderUI();
  } catch (ex) {
    console.error('Error loading SQLite database', ex);
    renderErrorState('El archivo descargado no es una base de datos SQLite válida de Kikes Mundial.');
  }
}

// --- Database Query Helper ---
function dbQuery(sqlStr, params = []) {
  if (!STATE.db) return [];
  const stmt = STATE.db.prepare(sqlStr);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// --- UI Rendering ---
function renderUI() {
  if (!STATE.db) return;
  
  // 1. Query and Rank Standings (Posiciones)
  const standings = dbQuery(`
    SELECT Name, MatchPoints, 
           (WinnerPoints + SecondPoints + ThirdPoints + ScorerPoints) AS wildcardPoints, 
           TotalPoints 
    FROM Participants 
    ORDER BY TotalPoints DESC, Name ASC
  `);
  
  let currentRank = 1;
  const standingsWithRank = standings.map((s, index) => {
    if (index > 0 && s.TotalPoints < standings[index - 1].TotalPoints) {
      currentRank = index + 1;
    }
    return {
      rank: currentRank,
      name: s.Name,
      matchPoints: s.MatchPoints,
      wildcardPoints: s.wildcardPoints,
      totalPoints: s.TotalPoints
    };
  });
  
  renderPodium(standingsWithRank);
  renderList(standingsWithRank, DOM.searchInput.value);
  
  // 2. Render Matches (Partidos)
  const matches = dbQuery(`
    SELECT Id, GroupStage, Team1, Team2, RealGoals1, RealGoals2 
    FROM Matches 
    ORDER BY Id DESC
  `);
  renderMatches(matches);
  
  // 3. Render Participants (Participantes)
  renderParticipantsList(standingsWithRank, DOM.participantSearchInput.value);
  
  // 4. Update Header Time
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
  const playedMatches = matches.filter(m => m.RealGoals1 !== null && m.RealGoals2 !== null);
  
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
      <div class="match-card-header">${match.GroupStage}</div>
      <div class="match-card-teams">
        <div class="team-info team-local-info">
          <span class="match-team team-local">${match.Team1}</span>
          <img src="${getFlagUrl(match.Team1)}" class="match-flag flag-local" onerror="this.src='Assets/Flags/placeholder.png'" alt="">
        </div>
        <span class="match-score-pill">${match.RealGoals1} - ${match.RealGoals2}</span>
        <div class="team-info team-visit-info">
          <img src="${getFlagUrl(match.Team2)}" class="match-flag flag-visit" onerror="this.src='Assets/Flags/placeholder.png'" alt="">
          <span class="match-team team-visit">${match.Team2}</span>
        </div>
      </div>
      <button class="match-toggle-btn" data-match-id="${match.Id}">
        <i class="fa-solid fa-chevron-down"></i> Ver Pronósticos
      </button>
      <div class="top10-predictions-panel" id="panel-predictions-${match.Id}">
        <table class="predictions-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Nombre</th>
              <th>Pronóstico</th>
              <th>Puntos</th>
            </tr>
          </thead>
          <tbody id="predictions-body-${match.Id}">
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
  
  // Query predictions for this match (joined with participant info)
  const predictions = dbQuery(`
    SELECT p.Name, pr.PredGoals1, pr.PredGoals2, pr.Points
    FROM Predictions pr
    JOIN Participants p ON pr.ParticipantId = p.Id
    WHERE pr.MatchId = ?
    ORDER BY pr.Points DESC, p.Name ASC
  `, [matchId]);
  
  if (predictions.length === 0) {
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
  const rowsHtml = predictions.map((p, idx) => {
    if (idx > 0 && p.Points < predictions[idx - 1].Points) {
      currentRank = idx + 1;
    }
    
    let badgeClass = 'zero';
    if (p.Points === 5) badgeClass = 'exact';
    else if (p.Points === 3) badgeClass = 'diff';
    else if (p.Points === 2) badgeClass = 'outcome';
    
    const predText = (p.PredGoals1 !== null && p.PredGoals2 !== null) ? `${p.PredGoals1} - ${p.PredGoals2}` : "-";
    
    return `
      <tr>
        <td class="pred-cell-rank">${currentRank}°</td>
        <td class="pred-cell-name">${p.Name}</td>
        <td class="pred-cell-val">${predText}</td>
        <td class="pred-cell-pts">
          <span class="pred-pts-badge ${badgeClass}">${p.Points} pts</span>
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
    
    // Query ID from DB
    const dbPart = dbQuery("SELECT Id FROM Participants WHERE Name = ?", [item.name])[0];
    const participantId = dbPart ? dbPart.Id : 0;
    
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
        <button class="btn-detail" data-participant-id="${participantId}" data-participant-name="${item.name}">
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
      const partId = parseInt(btn.getAttribute('data-participant-id'));
      const partName = btn.getAttribute('data-participant-name');
      openParticipantDetailModal(partId, partName);
    });
  });
}

function openParticipantDetailModal(participantId, participantName) {
  DOM.detailParticipantName.innerHTML = `<i class="fa-solid fa-user-tie"></i> ${participantName}`;
  
  const part = dbQuery(`
    SELECT Id, Name, PredictedWinner, PredictedSecond, PredictedThird, PredictedScorer,
           WinnerPoints, SecondPoints, ThirdPoints, ScorerPoints, MatchPoints, TotalPoints
    FROM Participants
    WHERE Id = ?
  `, [participantId])[0];
  
  if (!part) return;
  
  DOM.detailTotalPoints.innerText = `${part.TotalPoints} pts`;
  DOM.detailMatchPoints.innerText = `${part.MatchPoints} pts`;
  
  const wildcardSum = part.WinnerPoints + part.SecondPoints + part.ThirdPoints + part.ScorerPoints;
  DOM.detailWildcardPoints.innerText = `${wildcardSum} pts`;
  
  DOM.detailWcWinner.innerText = part.PredictedWinner || '-';
  DOM.detailWcWinnerPts.innerText = `${part.WinnerPoints} pts`;
  
  DOM.detailWcSecond.innerText = part.PredictedSecond || '-';
  DOM.detailWcSecondPts.innerText = `${part.SecondPoints} pts`;
  
  DOM.detailWcThird.innerText = part.PredictedThird || '-';
  DOM.detailWcThirdPts.innerText = `${part.ThirdPoints} pts`;
  
  DOM.detailWcScorer.innerText = part.PredictedScorer || '-';
  DOM.detailWcScorerPts.innerText = `${part.ScorerPoints} pts`;
  
  // Query all predictions for this participant
  const predictions = dbQuery(`
    SELECT pr.MatchId, m.GroupStage, m.Team1, m.Team2, m.RealGoals1, m.RealGoals2, 
           pr.PredGoals1, pr.PredGoals2, pr.Points
    FROM Predictions pr
    JOIN Matches m ON pr.MatchId = m.Id
    WHERE pr.ParticipantId = ?
    ORDER BY m.Id ASC
  `, [participantId]);
  
  DOM.detailPredictionsList.innerHTML = '';
  
  if (predictions.length === 0) {
    DOM.detailPredictionsList.innerHTML = `
      <div style="text-align: center; padding: 25px; color: var(--text-secondary); font-size: 13px;">
        No hay pronósticos registrados para este participante.
      </div>
    `;
  } else {
    predictions.forEach(p => {
      const itemEl = document.createElement('div');
      itemEl.className = 'history-pred-card';
      
      const realText = (p.RealGoals1 !== null && p.RealGoals2 !== null) ? `${p.RealGoals1} - ${p.RealGoals2}` : "Pendiente";
      const predText = (p.PredGoals1 !== null && p.PredGoals2 !== null) ? `${p.PredGoals1} - ${p.PredGoals2}` : "-";
      
      let badgeClass = 'zero';
      if (p.Points === 5) badgeClass = 'exact';
      else if (p.Points === 3) badgeClass = 'diff';
      else if (p.Points === 2) badgeClass = 'outcome';
      
      itemEl.innerHTML = `
        <div class="history-pred-header">
          <span>${p.GroupStage}</span>
          <span class="pred-pts-badge ${badgeClass}">${p.Points} pts</span>
        </div>
        <div class="history-pred-body">
          <div class="history-pred-teams">
            <span>${p.Team1} vs ${p.Team2}</span>
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
      <p>Configura tu ID de Google Drive para iniciar.</p>
    </div>
  `;
}

function renderErrorState(message) {
  DOM.leaderboardList.innerHTML = `
    <div class="error-state">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <h3>Error de Sincronización</h3>
      <p>${message}</p>
      <button class="btn-secondary" id="btn-error-retry">Reintentar</button>
    </div>
  `;
  document.getElementById('btn-error-retry').addEventListener('click', fetchStandings);
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

  // Modal Settings
  if (DOM.btnSettings) {
    DOM.btnSettings.addEventListener('click', () => {
      DOM.inputDriveId.value = STATE.driveId;
      DOM.modalSettings.classList.remove('hidden');
    });
  }
  if (DOM.settingsModalClose) {
    DOM.settingsModalClose.addEventListener('click', () => DOM.modalSettings.classList.add('hidden'));
  }
  if (DOM.modalSettings) {
    DOM.modalSettings.addEventListener('click', (e) => {
      if (e.target === DOM.modalSettings) DOM.modalSettings.classList.add('hidden');
    });
  }
  if (DOM.btnSaveSettings) {
    DOM.btnSaveSettings.addEventListener('click', () => {
      const newId = DOM.inputDriveId.value.trim();
      if (!newId) {
        alert('Por favor ingresa un ID de archivo válido.');
        return;
      }
      localStorage.setItem('kikes_drive_file_id', newId);
      STATE.driveId = newId;
      DOM.modalSettings.classList.add('hidden');
      
      // Force update standings with the new file
      // Clear db binary cache to force redownload
      localStorage.removeItem('kikes_db_binary');
      localStorage.removeItem('kikes_cached_time');
      fetchStandings();
    });
  }
  
  // Modal Participant Detail
  DOM.participantModalClose.addEventListener('click', closeParticipantDetailModal);
  DOM.modalParticipantDetail.addEventListener('click', (e) => {
    if (e.target === DOM.modalParticipantDetail) closeParticipantDetailModal();
  });
  
  // Refresh Button
  DOM.btnRefresh.addEventListener('click', () => {
    if (checkRefreshCooldown(true)) {
      fetchStandings();
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
    if (STATE.db) {
      const standings = dbQuery(`
        SELECT Name, MatchPoints, 
               (WinnerPoints + SecondPoints + ThirdPoints + ScorerPoints) AS wildcardPoints, 
               TotalPoints 
        FROM Participants 
        ORDER BY TotalPoints DESC, Name ASC
      `);
      
      let currentRank = 1;
      const standingsWithRank = standings.map((s, index) => {
        if (index > 0 && s.TotalPoints < standings[index - 1].TotalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.Name,
          matchPoints: s.MatchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.TotalPoints
        };
      });
      renderList(standingsWithRank, text);
    }
  });
  
  DOM.clearSearch.addEventListener('click', () => {
    DOM.searchInput.value = '';
    DOM.clearSearch.classList.remove('show');
    if (STATE.db) {
      const standings = dbQuery(`
        SELECT Name, MatchPoints, 
               (WinnerPoints + SecondPoints + ThirdPoints + ScorerPoints) AS wildcardPoints, 
               TotalPoints 
        FROM Participants 
        ORDER BY TotalPoints DESC, Name ASC
      `);
      
      let currentRank = 1;
      const standingsWithRank = standings.map((s, index) => {
        if (index > 0 && s.TotalPoints < standings[index - 1].TotalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.Name,
          matchPoints: s.MatchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.TotalPoints
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
    if (STATE.db) {
      const standings = dbQuery(`
        SELECT Name, MatchPoints, 
               (WinnerPoints + SecondPoints + ThirdPoints + ScorerPoints) AS wildcardPoints, 
               TotalPoints 
        FROM Participants 
        ORDER BY TotalPoints DESC, Name ASC
      `);
      
      let currentRank = 1;
      const standingsWithRank = standings.map((s, index) => {
        if (index > 0 && s.TotalPoints < standings[index - 1].TotalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.Name,
          matchPoints: s.MatchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.TotalPoints
        };
      });
      renderParticipantsList(standingsWithRank, text);
    }
  });
  
  DOM.clearParticipantSearch.addEventListener('click', () => {
    DOM.participantSearchInput.value = '';
    DOM.clearParticipantSearch.classList.remove('show');
    if (STATE.db) {
      const standings = dbQuery(`
        SELECT Name, MatchPoints, 
               (WinnerPoints + SecondPoints + ThirdPoints + ScorerPoints) AS wildcardPoints, 
               TotalPoints 
        FROM Participants 
        ORDER BY TotalPoints DESC, Name ASC
      `);
      
      let currentRank = 1;
      const standingsWithRank = standings.map((s, index) => {
        if (index > 0 && s.TotalPoints < standings[index - 1].TotalPoints) {
          currentRank = index + 1;
        }
        return {
          rank: currentRank,
          name: s.Name,
          matchPoints: s.MatchPoints,
          wildcardPoints: s.wildcardPoints,
          totalPoints: s.TotalPoints
        };
      });
      renderParticipantsList(standingsWithRank, '');
    }
  });
  
  // Pull-to-refresh swipe gesture
  let touchStart = 0;
  DOM.mainContent.addEventListener('touchstart', (e) => {
    if (DOM.mainContent.scrollTop === 0) {
      touchStart = e.touches[0].clientY;
    } else {
      touchStart = 0;
    }
  }, { passive: true });
  
  DOM.mainContent.addEventListener('touchmove', (e) => {
    if (touchStart > 0) {
      const pullDist = e.touches[0].clientY - touchStart;
      if (pullDist > 70 && !STATE.isRefreshing) {
        if (checkRefreshCooldown(false)) {
          fetchStandings();
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
  }
}
