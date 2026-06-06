const DEFAULT_DRIVE_ID = '1S6HbVBKvv3iTT6bnA6UiQDsNdPfXTNVt';

const STATE = {
  driveId: DEFAULT_DRIVE_ID,
  standings: [],
  playedMatches: [],
  lastUpdate: null,
  isRefreshing: false
};

// DOM Cache
const DOM = {
  btnSettings: document.getElementById('btn-settings'),
  btnRefresh: document.getElementById('btn-refresh'),
  refreshIcon: document.getElementById('refresh-icon'),
  
  // Tabs & Views
  tabPosiciones: document.getElementById('tab-posiciones'),
  tabPartidos: document.getElementById('tab-partidos'),
  viewPosiciones: document.getElementById('view-posiciones'),
  viewPartidos: document.getElementById('view-partidos'),
  matchesList: document.getElementById('matches-list'),
  
  // Podium
  goldName: document.getElementById('txt-gold-name'),
  goldPoints: document.getElementById('txt-gold-points'),
  silverName: document.getElementById('txt-silver-name'),
  silverPoints: document.getElementById('txt-silver-points'),
  bronzeName: document.getElementById('txt-bronze-name'),
  bronzePoints: document.getElementById('txt-bronze-points'),
  
  // List
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  leaderboardList: document.getElementById('leaderboard-list'),
  txtLastUpdate: document.getElementById('txt-last-update'),
  
  // Modal
  modalSettings: document.getElementById('modal-settings'),
  modalClose: document.getElementById('modal-close'),
  inputDriveId: document.getElementById('input-drive-id'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  
  // PTR
  ptrFeedback: document.getElementById('ptr-feedback'),
  mainContent: document.querySelector('.app-content')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  // 1. Register Service Worker
  registerServiceWorker();
  
  // 2. Load stored settings
  loadSettings();
  
  // 3. Setup event listeners
  setupEventListeners();
  
  // 4. Fetch initial data (only if cooldown has expired or no cache exists)
  if (STATE.driveId) {
    if (checkRefreshCooldown(false)) {
      fetchStandings();
    }
  } else {
    renderEmptyState(true); // First run, no Drive ID configured
  }
});

// --- Settings Management ---
function loadSettings() {
  const storedId = localStorage.getItem('kikes_drive_file_id');
  if (storedId) {
    STATE.driveId = storedId;
  } else {
    STATE.driveId = DEFAULT_DRIVE_ID;
  }
  DOM.inputDriveId.value = STATE.driveId;
  
  // Load cache for positions
  const cachedData = localStorage.getItem('kikes_cached_standings');
  const cachedTime = localStorage.getItem('kikes_cached_time');
  if (cachedData && cachedTime) {
    try {
      STATE.standings = JSON.parse(cachedData);
      STATE.lastUpdate = new Date(cachedTime);
      renderUI(STATE.standings);
    } catch (e) {
      console.error('Error parsing cached data', e);
    }
  }
  
  // Load cache for played matches
  const cachedMatches = localStorage.getItem('kikes_cached_matches');
  if (cachedMatches) {
    try {
      STATE.playedMatches = JSON.parse(cachedMatches);
      renderMatches(STATE.playedMatches);
    } catch (e) {
      console.error('Error parsing cached matches', e);
    }
  }
}

function saveSettings(idOrUrl) {
  let fileId = idOrUrl.trim();
  
  // Extract ID if a full URL was pasted
  if (fileId.includes('drive.google.com') || fileId.includes('docs.google.com')) {
    const matches = fileId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (matches && matches[1]) {
      fileId = matches[1];
    } else {
      const urlParams = new URLSearchParams(new URL(fileId).search);
      if (urlParams.has('id')) {
        fileId = urlParams.get('id');
      }
    }
  }
  
  if (!fileId) {
    alert('ID de archivo no válido. Introduce un ID correcto.');
    return;
  }
  
  STATE.driveId = fileId;
  localStorage.setItem('kikes_drive_file_id', fileId);
  DOM.inputDriveId.value = fileId;
  
  closeModal();
  fetchStandings();
}

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

function checkRefreshCooldown(isManual = false) {
  const cachedData = localStorage.getItem('kikes_cached_standings');
  if (!cachedData) return true; // No cache, force fetch
  
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

// --- Fetch & Parse Data ---
async function fetchStandings() {
  if (STATE.isRefreshing) return;
  setLoadingState(true);
  
  const fileId = STATE.driveId;
  const method1Url = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;
  const method2Url = `https://corsproxy.io/?${encodeURIComponent(`https://drive.google.com/uc?export=download&id=${fileId}`)}`;
  
  // Try Method 1
  try {
    console.log('Fetching standings via Method 1...');
    const response = await fetch(method1Url);
    if (!response.ok) throw new Error('Method 1 download failed');
    const data = await response.arrayBuffer();
    parseExcel(data);
  } catch (err) {
    console.warn('Method 1 failed, falling back to CORS proxy (Method 2)...', err);
    
    // Try Method 2
    try {
      const response = await fetch(method2Url);
      if (!response.ok) throw new Error('Method 2 download failed');
      const data = await response.arrayBuffer();
      parseExcel(data);
    } catch (err2) {
      console.error('All download methods failed.', err2);
      renderErrorState('No se pudo descargar el archivo de Google Drive. Verifica que el archivo sea público ("Cualquier persona con el enlace puede ver").');
    }
  }
  
  setLoadingState(false);
}

function parseExcel(arrayBuffer) {
  try {
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: 'array' });
    
    if (workbook.SheetNames.length === 0) {
      throw new Error('El archivo Excel no tiene hojas.');
    }
    
    // 1. Parse Worksheet "Posiciones" (Sheet 0)
    const sheetPosicionesName = workbook.SheetNames[0];
    const wsPosiciones = workbook.Sheets[sheetPosicionesName];
    const rowsPosiciones = XLSX.utils.sheet_to_json(wsPosiciones, { defval: "" });
    
    const mappedStandings = rowsPosiciones.map(r => {
      return {
        rank: parseInt(r['Puesto'] || r['puesto'] || 0),
        name: String(r['Nombre'] || r['nombre'] || 'Participante Anónimo'),
        matchPoints: parseInt(r['Puntos Partidos'] || r['puntos partidos'] || r['Pts Partidos'] || 0),
        wildcardPoints: parseInt(r['Puntos Comodín'] || r['puntos comodín'] || r['Pts Comodín'] || 0),
        totalPoints: parseInt(r['Puntos Totales'] || r['puntos totales'] || r['Total Puntos'] || r['Total'] || 0)
      };
    });
    
    mappedStandings.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    
    let currentRank = 1;
    for (let i = 0; i < mappedStandings.length; i++) {
      if (i > 0 && mappedStandings[i].totalPoints < mappedStandings[i - 1].totalPoints) {
        currentRank = i + 1;
      }
      mappedStandings[i].rank = currentRank;
    }
    
    STATE.standings = mappedStandings;
    
    // 2. Parse Worksheet "Partidos" (Sheet 1) if it exists
    if (workbook.SheetNames.length > 1) {
      const sheetPartidosName = workbook.SheetNames[1];
      const wsPartidos = workbook.Sheets[sheetPartidosName];
      const rowsPartidos = XLSX.utils.sheet_to_json(wsPartidos, { defval: "" });
      
      const matchesMap = {};
      rowsPartidos.forEach(r => {
        const matchId = parseInt(r['MatchId'] || r['matchId'] || 0);
        if (!matchId) return;
        
        if (!matchesMap[matchId]) {
          matchesMap[matchId] = {
            id: matchId,
            stage: String(r['Fase'] || r['fase'] || ''),
            teams: String(r['Equipos'] || r['equipos'] || ''),
            result: String(r['Resultado'] || r['resultado'] || ''),
            predictions: []
          };
        }
        
        matchesMap[matchId].predictions.push({
          rank: parseInt(r['Puesto'] || r['puesto'] || 0),
          name: String(r['Nombre'] || r['nombre'] || 'Participante'),
          prediction: String(r['Pronostico'] || r['pronostico'] || ''),
          points: parseInt(r['Puntos'] || r['puntos'] || 0)
        });
      });
      
      // Sort matches descending (newest first)
      STATE.playedMatches = Object.values(matchesMap).sort((a, b) => b.id - a.id);
      localStorage.setItem('kikes_cached_matches', JSON.stringify(STATE.playedMatches));
    } else {
      STATE.playedMatches = [];
      localStorage.removeItem('kikes_cached_matches');
    }
    
    STATE.lastUpdate = new Date();
    
    localStorage.setItem('kikes_cached_standings', JSON.stringify(mappedStandings));
    localStorage.setItem('kikes_cached_time', STATE.lastUpdate.toISOString());
    
    renderUI(mappedStandings);
    renderMatches(STATE.playedMatches);
  } catch (ex) {
    console.error('Error parsing Excel file', ex);
    renderErrorState('El archivo de Google Drive no tiene el formato correcto de Kikes Mundial.');
  }
}

// --- UI Rendering ---
function renderUI(standings) {
  renderPodium(standings);
  renderList(standings);
  
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
    renderEmptyState(false);
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

function renderEmptyState(isInitialConfig = false) {
  DOM.leaderboardList.innerHTML = '';
  const emptyEl = document.createElement('div');
  emptyEl.className = 'empty-state';
  
  if (isInitialConfig) {
    emptyEl.innerHTML = `
      <i class="fa-solid fa-cloud-arrow-down" style="color: var(--accent-gold);"></i>
      <h3>Sin Sincronizar</h3>
      <p>Configura el ID de archivo de Google Drive para cargar el podio y la tabla de posiciones.</p>
      <button class="btn-secondary" id="btn-empty-config">Configurar Ahora</button>
    `;
    DOM.leaderboardList.appendChild(emptyEl);
    document.getElementById('btn-empty-config').addEventListener('click', openModal);
  } else {
    emptyEl.innerHTML = `
      <i class="fa-solid fa-magnifying-glass"></i>
      <h3>Sin Resultados</h3>
      <p>No se encontraron participantes que coincidan con la búsqueda.</p>
    `;
    DOM.leaderboardList.appendChild(emptyEl);
  }
}

function renderErrorState(message) {
  DOM.leaderboardList.innerHTML = '';
  const errEl = document.createElement('div');
  errEl.className = 'error-state';
  errEl.innerHTML = `
    <i class="fa-solid fa-triangle-exclamation"></i>
    <h3>Error de Sincronización</h3>
    <p>${message}</p>
    <button class="btn-secondary" id="btn-error-retry">Reintentar</button>
  `;
  DOM.leaderboardList.appendChild(errEl);
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

// --- Navigation & Modal UI ---
function openModal() {
  DOM.modalSettings.classList.remove('hidden');
}

function closeModal() {
  DOM.modalSettings.classList.add('hidden');
}

// --- Event Listeners ---
function setupEventListeners() {
  DOM.btnSettings.addEventListener('click', openModal);
  DOM.modalClose.addEventListener('click', closeModal);
  DOM.modalSettings.addEventListener('click', (e) => {
    if (e.target === DOM.modalSettings) closeModal();
  });
  
  DOM.btnSaveSettings.addEventListener('click', () => {
    saveSettings(DOM.inputDriveId.value);
  });
  
  DOM.btnRefresh.addEventListener('click', () => {
    if (checkRefreshCooldown(true)) {
      fetchStandings();
    }
  });
  
  // Search filter
  DOM.searchInput.addEventListener('input', (e) => {
    const text = e.target.value;
    if (text) {
      DOM.clearSearch.classList.add('show');
    } else {
      DOM.clearSearch.classList.remove('show');
    }
    renderList(STATE.standings, text);
  });
  
  DOM.clearSearch.addEventListener('click', () => {
    DOM.searchInput.value = '';
    DOM.clearSearch.classList.remove('show');
    renderList(STATE.standings, '');
  });
  
  // Pull to refresh swipe gesture (Mobile native feel)
  let touchStart = 0;
  let touchMove = 0;
  
  DOM.mainContent.addEventListener('touchstart', (e) => {
    if (DOM.mainContent.scrollTop === 0) {
      touchStart = e.touches[0].clientY;
    } else {
      touchStart = 0;
    }
  }, { passive: true });
  
  DOM.mainContent.addEventListener('touchmove', (e) => {
    if (touchStart > 0) {
      touchMove = e.touches[0].clientY;
      const pullDist = touchMove - touchStart;
      if (pullDist > 70 && !STATE.isRefreshing) {
        if (checkRefreshCooldown(true)) {
          fetchStandings();
        }
        touchStart = 0; // Prevent duplicate triggers
      }
    }
  }, { passive: true });

  // Tab Switching
  DOM.tabPosiciones.addEventListener('click', () => {
    DOM.tabPosiciones.classList.add('active');
    DOM.tabPartidos.classList.remove('active');
    DOM.viewPosiciones.classList.remove('hidden');
    DOM.viewPartidos.classList.add('hidden');
  });
  
  DOM.tabPartidos.addEventListener('click', () => {
    DOM.tabPartidos.classList.add('active');
    DOM.tabPosiciones.classList.remove('active');
    DOM.viewPartidos.classList.remove('hidden');
    DOM.viewPosiciones.classList.add('hidden');
  });
}

// --- Render Played Matches Tab ---
function renderMatches(playedMatches) {
  DOM.matchesList.innerHTML = '';
  
  if (!playedMatches || playedMatches.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'empty-state';
    emptyEl.innerHTML = `
      <i class="fa-solid fa-circle-play"></i>
      <h3>Sin Partidos</h3>
      <p>No hay partidos finalizados con resultados cargados todavía.</p>
    `;
    DOM.matchesList.appendChild(emptyEl);
    return;
  }
  
  playedMatches.forEach(match => {
    const cardEl = document.createElement('div');
    cardEl.className = 'match-card';
    
    // Split Teams (e.g. "México vs Sudáfrica")
    const teams = match.teams.split(' vs ');
    const local = teams[0] || 'Local';
    const visit = teams[1] || 'Visitante';
    
    cardEl.innerHTML = `
      <div class="match-card-header">${match.stage}</div>
      <div class="match-card-teams">
        <div class="team-info team-local-info">
          <span class="match-team team-local">${local}</span>
          <img src="${getFlagUrl(local)}" class="match-flag flag-local" onerror="this.src='Assets/Flags/placeholder.png'" alt="">
        </div>
        <span class="match-score-pill">${match.result}</span>
        <div class="team-info team-visit-info">
          <img src="${getFlagUrl(visit)}" class="match-flag flag-visit" onerror="this.src='Assets/Flags/placeholder.png'" alt="">
          <span class="match-team team-visit">${visit}</span>
        </div>
      </div>
      <button class="match-toggle-btn" data-match-id="${match.id}">
        <i class="fa-solid fa-chevron-down"></i> Ver Pronósticos Top 10
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
          <tbody>
            ${match.predictions.map(p => {
              let badgeClass = 'zero';
              if (p.points === 5) badgeClass = 'exact';
              else if (p.points === 2) badgeClass = 'outcome';
              
              return `
                <tr>
                  <td class="pred-cell-rank">${p.rank}°</td>
                  <td class="pred-cell-name">${p.name}</td>
                  <td class="pred-cell-val">${p.prediction}</td>
                  <td class="pred-cell-pts">
                    <span class="pred-pts-badge ${badgeClass}">${p.points} pts</span>
                  </td>
                </tr>
              `;
            }).join('')}
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
      const matchId = btn.getAttribute('data-match-id');
      const panel = document.getElementById(`panel-predictions-${matchId}`);
      const isExpanded = panel.classList.contains('show');
      
      if (isExpanded) {
        panel.classList.remove('show');
        btn.classList.remove('expanded');
        btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> Ver Pronósticos Top 10`;
      } else {
        panel.classList.add('show');
        btn.classList.add('expanded');
        btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> Ocultar Pronósticos`;
      }
    });
  });
}

// --- Flag Resolver Helper ---
function getFlagUrl(teamName) {
  if (!teamName) return 'Assets/Flags/placeholder.png';
  
  // Normalize team name: lowercase, replace spaces with underscores, remove accents
  let normalized = teamName.toLowerCase().trim();
  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  normalized = normalized.replace(/\s+/g, '_');
  
  // Custom mappings for specific flag files
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
