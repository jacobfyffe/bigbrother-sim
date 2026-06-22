// ══════════════════════════════════════
//  DATA & STATE
// ══════════════════════════════════════

const PRESETS = {
  BB27: ['Ashley','Vince','Morgan','Ava','Keanu','Lauren','Kelley','Will','Rachel','Mickey','Katherine','Rylie','Zach','Jimmy','Adrian','Amy','Zae'],
  BB26: ['Chelsie','Leah','Rubina','Kimo','Quinn','Joseph','Makensy','Cedric','Brooklyn','Lisa','T\'kor','Tucker','Matt','Angela','Kenney','Cam'],
  BB25: ['Cirie','Felicia','Jag','Matt','Bowie Jane','Blue','America','Cory','Izzy','Hisam','Mecole','Reilly','Kirsten','Luke','Jared','Cameron','Red'],
  BB16: ['Derrick','Cody','Victoria','Caleb','Frankie','Christine','Nicole','Zach','Hayden','Jocasta','Amber','Devin','Paola','Joey','Donny','Brittany'],
  random: ['Alex','Blake','Casey','Drew','Ellis','Fiona','Gareth','Harper','Iris','Jordan','Kendall','Logan','Morgan','Nova','Owen','Paige']
};

let cast = [];
let game = null;

// ══════════════════════════════════════
//  SUPABASE CLIENT
// ══════════════════════════════════════

const SUPABASE_URL  = 'https://sfjsawlkhcabejgbwzyu.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmanNhd2xraGNhYmVqZ2J3enl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MTcxOTUsImV4cCI6MjA5MzM5MzE5NX0.KwgLfQS-u9QkWaa2k73q1_12BDSlE5Zb4LgotQjB28s';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ══════════════════════════════════════
//  OWNER CONFIG
//  Paste your GitHub account UID here
//  after logging in once — find it in
//  Supabase → Authentication → Users
// ══════════════════════════════════════

const OWNER_UID = '86ca6be7-f29c-46af-8b65-16663be388af';

// ══════════════════════════════════════
//  USER SETTINGS  (per-device, localStorage)
// ══════════════════════════════════════

const SETTINGS_KEY = 'bb_settings_v1';

// ══════════════════════════════════════
//  IN-PROGRESS GAME SAVE  (per-device, localStorage)
//  Persists the active season so an accidental refresh
//  doesn't lose progress. Only the live `game` object is
//  stored; completed seasons are archived separately to
//  Supabase. Saved state is cleared on finish, on starting
//  a new season, and via manual "Abandon season".
// ══════════════════════════════════════

const SAVE_KEY = 'bb_savegame_v1';

// Persist the current game. Called frequently (see setPhase and
// other state-mutation points). Fails silently if storage is
// unavailable (e.g. private browsing) so gameplay is never blocked.
function saveGameState() {
  try {
    if (!game) return;
    const payload = {
      savedAt: Date.now(),
      week: game.week,
      castNames: game.houseguests.map(h => h.name),
      game,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (e) { /* storage unavailable — ignore */ }
}

// Return the saved payload, or null if none/invalid.
function readSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    // Basic sanity check: must contain a game with houseguests.
    if (!payload || !payload.game || !Array.isArray(payload.game.houseguests)) return null;
    return payload;
  } catch (e) { return null; }
}

function hasSavedGame() { return readSavedGame() !== null; }

// Remove any saved in-progress game.
function clearSavedGame() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

// Restore a saved game into play. Returns true on success.
// Option A: re-enter at the START of the saved phase. Completed weeks,
// relationships, evictions, alliances and all history are restored exactly;
// only the current (unfinished) phase is re-run from its clean entry point,
// so no decision the player already acted on is lost.
function resumeSavedGame() {
  const payload = readSavedGame();
  if (!payload) return false;
  game = payload.game;
  // Runtime-only fields that shouldn't carry over from saved state.
  game.autoPlay = false;
  game.autoPlayDelay = getAutoPlayDelay();

  showScreen('gameScreen');
  renderAll();
  renderAlliancesPanel();

  // Re-enter the phase the player was in, from its clean start point.
  // The _resuming flag tells phase setup to skip once-per-week side
  // effects (social encounters, alliance fractures) that already ran
  // when the week first began.
  game._resuming = true;
  const phase = game.phase;
  if (active().length <= 3 || game.final3Phase) {
    // Was in the Final 3 / endgame — restart that flow.
    startFinal3();
  } else if (phase === 'nom') {
    startNomPhase();
  } else if (phase === 'veto') {
    startVetoPhase();
  } else if (phase === 'evict') {
    startEvictionPhase();
  } else {
    // Default / 'hoh'
    startHOHPhase();
  }
  game._resuming = false;
  return true;
}


const SETTINGS_DEFAULTS = {
  speed:           'normal',  // slow | normal | fast
  encounters:      'few',     // none | few | many
  diary:           'some',    // off  | some | all
  alliances:       'normal',  // rare | normal | common
  juryBitterness:  'mild',    // none | mild | spicy
  twists:          'on',      // off  | on   | chaos
  twistPersistence:'realistic', // oneweek | realistic | longform
  seasonTheme:     'random',  // random | themed | vanilla
  americasFavorite:true,      // show AFP at finale
  twistPreview:    true,      // show banner
  animations:      true,
};

let settings = { ...SETTINGS_DEFAULTS };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) settings = { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
  } catch (e) { settings = { ...SETTINGS_DEFAULTS }; }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
  // Apply live wherever possible
  if (key === 'speed' && game) {
    game.autoPlayDelay = getAutoPlayDelay();
  }
  if (key === 'animations') {
    document.body.classList.toggle('no-anim', !settings.animations);
  }
  renderSettingsBody();
}

function resetSettings() {
  settings = { ...SETTINGS_DEFAULTS };
  saveSettings();
  if (game) game.autoPlayDelay = getAutoPlayDelay();
  document.body.classList.toggle('no-anim', !settings.animations);
  renderSettingsBody();
}

// ── Setting accessors used by the rest of the game ──
function getAutoPlayDelay() {
  return { slow: 1800, normal: 1100, fast: 550 }[settings.speed] || 1100;
}
function getEncounterCap() {
  return { none: 0, few: 5, many: 10 }[settings.encounters] ?? 5;
}
function getDiaryCap() {
  return { off: 0, some: 3, all: Infinity }[settings.diary] ?? 3;
}
function getAllianceFormChance() {
  return { rare: 0.4, normal: 1.0, common: 1.6 }[settings.alliances] || 1.0;
}
function getJuryBitterness() {
  return { none: 0, mild: 0.5, spicy: 1.0 }[settings.juryBitterness] ?? 0.5;
}
function getTwistMode() { return settings.twists || 'on'; }
function getTwistPreview() { return !!settings.twistPreview; }
function getTwistPersistence() { return settings.twistPersistence || 'realistic'; }
function getSeasonTheme() { return settings.seasonTheme || 'random'; }
function getAmericasFavorite() { return !!settings.americasFavorite; }

loadSettings();
document.body && document.body.classList.toggle('no-anim', !settings.animations);

// Fire announcement banner refresh on page load (handles its own errors silently)
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    refreshAnnouncementBanner().catch(() => {});
    maybeShowResumePrompt();
  });
}

// If an in-progress season is saved, offer to resume it on the setup screen.
function maybeShowResumePrompt() {
  const payload = readSavedGame();
  if (!payload) return;

  const host = document.getElementById('setupScreen');
  if (!host) return;

  const when = new Date(payload.savedAt || Date.now());
  const cast = Array.isArray(payload.castNames) ? payload.castNames : [];
  const castPreview = cast.slice(0, 4).join(', ') + (cast.length > 4 ? `, +${cast.length - 4} more` : '');

  const banner = document.createElement('div');
  banner.id = 'resumeBanner';
  banner.className = 'resume-banner';
  banner.innerHTML = `
    <div class="resume-banner-body">
      <div class="resume-banner-title">🏠 Resume your season?</div>
      <div class="resume-banner-detail">
        Week ${payload.week || '?'} &middot; ${cast.length} houseguests${castPreview ? ` (${castPreview})` : ''}
        <br><span class="resume-banner-when">Saved ${when.toLocaleString()}</span>
      </div>
    </div>
    <div class="resume-banner-actions">
      <button class="btn btn-gold" onclick="doResumeSeason()">Resume</button>
      <button class="btn btn-outline" onclick="doDiscardResume()">Start fresh</button>
    </div>
  `;
  // Insert at the top of the setup screen.
  host.insertBefore(banner, host.firstChild);
}

function doResumeSeason() {
  const banner = document.getElementById('resumeBanner');
  if (banner) banner.remove();
  if (!resumeSavedGame()) {
    alert('Sorry — the saved season could not be restored.');
    clearSavedGame();
  }
}

function doDiscardResume() {
  if (!confirm('Discard the saved season and start fresh?')) return;
  clearSavedGame();
  const banner = document.getElementById('resumeBanner');
  if (banner) banner.remove();
}

// ══════════════════════════════════════
//  SETTINGS MODAL
// ══════════════════════════════════════

let _isOwnerCached = false;

async function openSettings() {
  // Cache owner status so renderSettingsBody can stay synchronous
  try { _isOwnerCached = await isOwner(); } catch (e) { _isOwnerCached = false; }
  document.getElementById('settingsModal').classList.add('open');
  renderSettingsBody();
}
function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

const SETTING_DEFS = [
  {
    group: 'Pacing',
    items: [
      { key: 'speed',       label: 'Auto-play speed',        opts: [['slow','Slow'], ['normal','Normal'], ['fast','Fast']] },
      { key: 'encounters',  label: 'Social encounters/week', opts: [['none','None'], ['few','Few'],       ['many','Many']] },
      { key: 'diary',       label: 'Diary room entries',     opts: [['off','Off'],   ['some','Some'],     ['all','All']] },
    ],
  },
  {
    group: 'Difficulty & Vibe',
    items: [
      { key: 'alliances',       label: 'Alliance formation', opts: [['rare','Rare'], ['normal','Normal'], ['common','Common']] },
      { key: 'juryBitterness',  label: 'Jury bitterness',    opts: [['none','None'], ['mild','Mild'],     ['spicy','Spicy']] },
    ],
  },
  {
    group: 'Twists',
    items: [
      { key: 'twists',           label: 'Season twists',     opts: [['off','Off'],     ['on','On'],          ['chaos','Chaos']] },
      { key: 'twistPersistence', label: 'Twist duration',    opts: [['oneweek','1-Week'], ['realistic','Realistic'], ['longform','Long-form']] },
      { key: 'seasonTheme',      label: 'Season structure',  opts: [['random','Random'], ['themed','Themed'], ['vanilla','Vanilla']] },
    ],
  },
];

function renderSettingsBody() {
  const el = document.getElementById('settingsBody');
  if (!el) return;
  el.innerHTML = SETTING_DEFS.map(group => `
    <div class="settings-group">
      <div class="settings-group-title">${group.group}</div>
      ${group.items.map(item => `
        <div class="settings-row">
          <div class="settings-label">${item.label}</div>
          <div class="settings-segmented" data-key="${item.key}">
            ${item.opts.map(([val, lbl]) => `
              <button
                class="settings-seg ${settings[item.key] === val ? 'active' : ''}"
                onclick="setSetting('${item.key}','${val}')">${lbl}</button>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('') + `
    <div class="settings-group">
      <div class="settings-group-title">Display</div>
      <div class="settings-row">
        <div class="settings-label">America's Favorite Player</div>
        <label class="settings-toggle">
          <input type="checkbox" ${settings.americasFavorite ? 'checked' : ''}
                 onchange="setSetting('americasFavorite', this.checked)">
          <span class="settings-toggle-slider"></span>
        </label>
      </div>
      <div class="settings-row">
        <div class="settings-label">Twist preview banners</div>
        <label class="settings-toggle">
          <input type="checkbox" ${settings.twistPreview ? 'checked' : ''}
                 onchange="setSetting('twistPreview', this.checked)">
          <span class="settings-toggle-slider"></span>
        </label>
      </div>
      <div class="settings-row">
        <div class="settings-label">Animations</div>
        <label class="settings-toggle">
          <input type="checkbox" ${settings.animations ? 'checked' : ''}
                 onchange="setSetting('animations', this.checked)">
          <span class="settings-toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="settings-footer">
      <button class="btn btn-outline" onclick="resetSettings()">Reset to defaults</button>
      ${game ? `<button class="btn btn-outline" style="color:var(--red);border-color:var(--red)" onclick="closeSettings();abandonSeason()">🚪 Abandon Season</button>` : ''}
    </div>
    ${_isOwnerCached ? renderOwnerDebugGroup() : ''}
  `;
}

function renderOwnerDebugGroup() {
  const twistOptions = (typeof TWIST_DEFS !== 'undefined')
    ? Object.values(TWIST_DEFS).map(t => `<option value="${t.id}">${t.icon} ${t.label}</option>`).join('')
    : '';
  const inGame = !!(typeof game !== 'undefined' && game);
  return `
    <div class="settings-group settings-group-debug">
      <div class="settings-group-title" style="color:var(--gold)">👑 Debug (Owner-Only)</div>

      <div class="settings-row">
        <div class="settings-label">Reveal hidden state</div>
        <label class="settings-toggle">
          <input type="checkbox" ${document.body.classList.contains('debug-mode') ? 'checked' : ''}
                 onchange="ownerToggleDebugMode(this.checked)">
          <span class="settings-toggle-slider"></span>
        </label>
      </div>
      <div style="font-size:11px;color:var(--muted2);margin:-4px 0 10px;line-height:1.5">
        Surfaces saboteur identity, alliance cohesion %, threat scores in tooltips.
      </div>

      <div class="settings-row" style="display:block">
        <div class="settings-label" style="margin-bottom:6px">Force-fire a twist this week</div>
        <div style="display:flex;gap:6px">
          <select id="ownerTwistSelect" class="auth-input" style="flex:1;padding:7px 10px;font-size:12px">
            <option value="">— choose a twist —</option>
            ${twistOptions}
          </select>
          <button class="btn btn-outline" onclick="ownerForceFireTwist()"
            style="font-size:10px;padding:7px 12px;letter-spacing:1px"
            ${inGame ? '' : 'disabled'}>Fire</button>
        </div>
        ${inGame ? '' : '<div style="font-size:11px;color:var(--muted2);margin-top:6px">Disabled — start a season first.</div>'}
      </div>

      <div class="settings-row">
        <div class="settings-label">Skip to finale</div>
        <button class="btn btn-outline" onclick="ownerSkipToFinale()"
          style="font-size:10px;padding:7px 14px;letter-spacing:1px"
          ${inGame ? '' : 'disabled'}>Run</button>
      </div>
      ${inGame ? '' : '<div style="font-size:11px;color:var(--muted2);margin-top:-6px">Disabled — start a season first.</div>'}
    </div>
  `;
}

// ── Owner debug actions ──
function ownerToggleDebugMode(on) {
  document.body.classList.toggle('debug-mode', !!on);
}

function ownerForceFireTwist() {
  if (!game) { alert('Start a season first.'); return; }
  const sel = document.getElementById('ownerTwistSelect');
  const id = sel && sel.value;
  if (!id) return;
  const def = TWIST_DEFS[id];
  if (!def) return;
  try {
    def.apply(game.week);
    game.twistsApplied = game.twistsApplied || [];
    game.twistsApplied.push({ id, week: game.week, label: def.label, icon: def.icon, forced: true });
    if (typeof renderAll === 'function') renderAll();
    alert(`Twist fired: ${def.icon} ${def.label}`);
  } catch (e) {
    alert('Twist failed: ' + e.message);
  }
}

function ownerSkipToFinale() {
  if (!game) { alert('Start a season first.'); return; }
  if (!confirm('Skip to finale? This auto-plays through HOH/noms/veto/eviction until 3 remain.')) return;
  closeSettings();
  game.autoPlay = true;
  game.autoPlayDelay = 80;  // very fast
  const btn = document.getElementById('autoPlayBtn');
  if (btn) {
    btn.textContent = '⏸ Pause';
    btn.className = 'btn btn-gold';
  }
  if (typeof autoAdvance === 'function') autoAdvance();
}



async function isOwner() {
  const { data } = await sb.auth.getSession();
  return data.session?.user?.id === OWNER_UID;
}

// ══════════════════════════════════════
//  AUTH SYSTEM
// ══════════════════════════════════════

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    const modal = document.getElementById('dashboardModal');
    if (modal && modal.classList.contains('open')) renderDashboard();
    if (window._pendingDashboardOpen) {
      window._pendingDashboardOpen = false;
      openDashboard();
    }
  }
  if (event === 'SIGNED_OUT') {
    closeDashboard();
  }
});

// Handle OAuth return — clean token from URL, open dashboard
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session && window.location.hash.includes('access_token')) {
    history.replaceState(null, '', window.location.pathname);
    window._pendingDashboardOpen = false;
    openDashboard();
  }
})();

async function isLoggedIn() {
  const { data } = await sb.auth.getSession();
  return !!data.session;
}

async function getCurrentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}

async function logout() {
  await sb.auth.signOut();
  closeDashboard();
}

async function openDashboardGate() {
  const loggedIn = await isLoggedIn();
  if (loggedIn) { openDashboard(); return; }
  renderLoginPrompt();
  document.getElementById('authModal').classList.add('open');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('open');
  document.getElementById('authBody').innerHTML = '';
}

function renderLoginPrompt() {
  document.getElementById('authBody').innerHTML = `
    <div class="auth-title">Sign In</div>
    <div class="auth-desc">
      Sign in to save your seasons and access your personal stats dashboard.
      Your data is private — only you can see it.
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:20px">
      <button class="btn btn-red" onclick="signInWith('google')"
        style="font-size:13px;padding:13px 20px;gap:10px;justify-content:center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>
      <button class="btn btn-outline" onclick="signInWith('github')"
        style="font-size:13px;padding:13px 20px;gap:10px;justify-content:center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
        </svg>
        Continue with GitHub
      </button>
    </div>
    <div class="auth-error" id="authError"></div>
  `;
}

async function signInWith(provider) {
  const err = document.getElementById('authError');
  if (err) err.textContent = `Redirecting to ${provider}…`;
  window._pendingDashboardOpen = true;
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) {
    if (err) err.textContent = 'Login failed: ' + error.message;
    window._pendingDashboardOpen = false;
  }
}

// Keep old submitLogin for any existing calls
async function submitLogin() { await signInWith('github'); }

// ══════════════════════════════════════
//  SEASON ARCHIVE (Supabase)
//  Each row is tied to owner_uid so
//  RLS keeps users' data isolated.
// ══════════════════════════════════════

async function archiveCurrentSeason(winner, runnerUp, votes, afp) {
  if (!game) return;
  const user = await getCurrentUser();
  if (!user) { console.warn('Not logged in — season not saved.'); return; }

  const archive = await loadArchive();
  const seasonNum = archive.length + 1;

  const castData = game.houseguests.map(hg => ({
    name:           hg.name,
    emoji:          hg.emoji,
    hohWins:        hg.wins.hoh,
    vetoWins:       hg.wins.veto,
    timesNominated: hg.timesNominated || 0,
    evictedWeek:    game.evicted.find(e => e.name === hg.name)?.week || null,
    inJury:         game.jury.includes(hg.name),
    isWinner:       hg.name === winner,
    isRunnerUp:     hg.name === runnerUp,
    isAFP:          hg.name === afp,
    placement:      getPlacement(hg.name, winner, runnerUp),
  }));

  const { error } = await sb.from('seasons').insert({
    owner_uid:       user.id,
    season_num:      seasonNum,
    date_played:     new Date().toLocaleDateString(),
    total_weeks:     game.week,
    cast_size:       game.houseguests.length,
    winner,
    runner_up:       runnerUp,
    afp,
    winner_votes:    votes[winner],
    runner_up_votes: votes[runnerUp],
    history:         game.history.map(w => ({
      week: w.week, hoh: w.hoh, nominees: w.nominees,
      veto: w.veto, vetoUsed: w.vetoUsed, evicted: w.evicted,
    })),
    alliances: (game.alliances || []).map(a => ({
      name: a.name, members: a.members, status: a.status, formed: a.formed,
    })),
    cast_data: castData,
    twists_applied: (game.twistsApplied || []).map(t => ({
      id: t.id, week: t.week, label: t.label, multi: !!t.multi, duration: t.duration || 1,
    })),
    settings_snapshot: {
      twists:           settings.twists,
      twistPersistence: settings.twistPersistence,
      seasonTheme:      settings.seasonTheme,
      alliances:        settings.alliances,
      juryBitterness:   settings.juryBitterness,
    },
  });

  if (error) console.error('Archive save failed:', error.message);
}

// Load the current user's own seasons
async function loadArchive() {
  const { data, error } = await sb.from('seasons')
    .select('*')
    .order('season_num', { ascending: true });
  if (error) { console.error('Archive load failed:', error.message); return []; }
  return mapRows(data || []);
}

// Owner only — load ALL seasons across all users with user email
async function loadAllSeasons() {
  const { data, error } = await sb
    .from('seasons')
    .select('*, auth_users:owner_uid(email)')
    .order('created_at', { ascending: false });
  if (error) { console.error('Admin load failed:', error.message); return []; }
  return (data || []).map(r => ({
    ...mapRow(r),
    userEmail: r.auth_users?.email || r.owner_uid?.slice(0, 8) + '…',
    ownerUid:  r.owner_uid,
  }));
}

// Owner only — load user list with season counts
async function loadAllUsers() {
  const { data, error } = await sb
    .from('seasons')
    .select('owner_uid');
  if (error) { console.error('User load failed:', error.message); return []; }

  // Get unique UIDs and their season counts
  const counts = {};
  (data || []).forEach(r => {
    counts[r.owner_uid] = (counts[r.owner_uid] || 0) + 1;
  });
  return Object.entries(counts).map(([uid, seasons]) => ({ uid, seasons }));
}

// ── ANNOUNCEMENTS ─────────────────────────
// Server-side messages broadcast to all users above the setup screen.

async function loadActiveAnnouncements() {
  const { data, error } = await sb
    .from('announcements')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error) {
    // Table might not exist yet; fail silently for users
    return [];
  }
  return data || [];
}

async function loadAllAnnouncements() {
  const { data, error } = await sb
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('Announcement load failed:', error.message); return []; }
  return data || [];
}

async function createAnnouncement(message, type) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  const { error } = await sb.from('announcements').insert({
    message, type: type || 'info', active: true, owner_uid: user.id,
  });
  if (error) { alert('Create failed: ' + error.message); return { error }; }
  return { ok: true };
}

async function toggleAnnouncement(id, active) {
  const { error } = await sb.from('announcements').update({ active }).eq('id', id);
  if (error) { alert('Update failed: ' + error.message); return; }
}

async function deleteAnnouncementById(id) {
  if (!confirm('Delete this announcement?')) return;
  const { error } = await sb.from('announcements').delete().eq('id', id);
  if (error) { alert('Delete failed: ' + error.message); return; }
}

// Render the active-announcement banner at the top of the page (all users).
async function refreshAnnouncementBanner() {
  const list = await loadActiveAnnouncements();
  const dismissed = JSON.parse(localStorage.getItem('bb_dismissed_anns') || '[]');
  const visible = list.filter(a => !dismissed.includes(a.id));

  let host = document.getElementById('announcementHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'announcementHost';
    document.body.insertBefore(host, document.body.firstChild);
  }
  host.innerHTML = visible.map(a => `
    <div class="ann-banner ann-${a.type || 'info'}">
      <span class="ann-icon">${a.type === 'warn' ? '⚠️' : a.type === 'critical' ? '🚨' : '📣'}</span>
      <span class="ann-text">${escapeHtml(a.message)}</span>
      <button class="ann-dismiss" onclick="dismissAnnouncement(${a.id})" aria-label="Dismiss">✕</button>
    </div>
  `).join('');
}

function dismissAnnouncement(id) {
  const dismissed = JSON.parse(localStorage.getItem('bb_dismissed_anns') || '[]');
  if (!dismissed.includes(id)) {
    dismissed.push(id);
    localStorage.setItem('bb_dismissed_anns', JSON.stringify(dismissed));
  }
  refreshAnnouncementBanner();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// ── USER NOTES (owner-only, per-uid scratchpad) ──
async function loadUserNotes() {
  const { data, error } = await sb
    .from('user_notes')
    .select('*');
  if (error) return {};
  // Build { uid: { note, updated_at } } map
  const map = {};
  (data || []).forEach(r => { map[r.uid] = { note: r.note || '', updatedAt: r.updated_at }; });
  return map;
}

async function loadUserNote(uid) {
  const { data, error } = await sb
    .from('user_notes')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function saveUserNote(uid, note) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  // Upsert by uid
  const { error } = await sb.from('user_notes').upsert({
    uid, note, owner_uid: user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'uid' });
  if (error) { alert('Note save failed: ' + error.message); return { error }; }
  return { ok: true };
}

async function deleteUserNote(uid) {
  const { error } = await sb.from('user_notes').delete().eq('uid', uid);
  if (error) { alert('Delete failed: ' + error.message); return; }
}

// ── FEEDBACK INBOX ──
async function submitFeedback(message) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not signed in' };
  const trimmed = (message || '').trim();
  if (!trimmed) return { error: 'Message cannot be empty' };
  if (trimmed.length > 1000) return { error: 'Message too long (1000 char max)' };
  const { error } = await sb.from('feedback').insert({
    user_uid: user.id,
    user_email: user.email || null,
    message: trimmed,
    status: 'new',
  });
  if (error) return { error: error.message };
  return { ok: true };
}

async function loadAllFeedback() {
  const { data, error } = await sb
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('Feedback load failed:', error.message); return []; }
  return data || [];
}

async function setFeedbackStatus(id, status) {
  const { error } = await sb.from('feedback').update({ status }).eq('id', id);
  if (error) alert('Update failed: ' + error.message);
}

async function deleteFeedback(id) {
  if (!confirm('Delete this feedback entry permanently?')) return;
  const { error } = await sb.from('feedback').delete().eq('id', id);
  if (error) alert('Delete failed: ' + error.message);
}

function mapRows(rows) { return rows.map(mapRow); }
function mapRow(r) {
  return {
    id:           r.id,
    ownerUid:     r.owner_uid,
    seasonNum:    r.season_num,
    date:         r.date_played,
    createdAt:    r.created_at,
    totalWeeks:   r.total_weeks,
    castSize:     r.cast_size,
    winner:       r.winner,
    runnerUp:     r.runner_up,
    afp:          r.afp,
    winnerVotes:  r.winner_votes,
    runnerUpVotes:r.runner_up_votes,
    history:      r.history   || [],
    alliances:    r.alliances || [],
    cast:         r.cast_data || [],
    twistsApplied: r.twists_applied || [],
    settingsSnapshot: r.settings_snapshot || null,
  };
}

async function clearArchive() {
  if (!confirm('Delete ALL your saved seasons? This cannot be undone.')) return;
  const { error } = await sb.from('seasons').delete().neq('id', 0);
  if (error) { alert('Delete failed: ' + error.message); return; }
  renderDashboard();
}

async function deleteSeason(id) {
  if (!confirm('Delete this season?')) return;
  const { error } = await sb.from('seasons').delete().eq('id', id);
  if (error) { alert('Delete failed: ' + error.message); return; }
  renderDashboard();
}

// Owner only — delete any user's season
async function adminDeleteSeason(id) {
  if (!confirm('Delete this season? (Admin action)')) return;
  // Bypass RLS by using the service role — requires server. As workaround,
  // we use a Postgres function with SECURITY DEFINER (see SQL setup notes).
  const { error } = await sb.rpc('admin_delete_season', { season_id: id });
  if (error) { alert('Delete failed: ' + error.message); return; }
  renderDashboard();
}

// ══════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════

let dashTab = 'overview';

async function openDashboard() {
  dashTab = 'overview';
  document.getElementById('dashboardModal').classList.add('open');
  await renderDashboard();
}

function closeDashboard() {
  document.getElementById('dashboardModal').classList.remove('open');
}

function switchDashTab(tab) {
  dashTab = tab;
  renderDashboard();
}

async function renderDashboard() {
  const el = document.getElementById('dashboardBody');
  if (!el) return;

  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted2);
    font-family:'Oswald',sans-serif;letter-spacing:2px;font-size:11px">LOADING…</div>`;

  const [archive, owner, user] = await Promise.all([
    loadArchive(),
    isOwner(),
    getCurrentUser(),
  ]);

  const userDisplay = user?.user_metadata?.full_name
    || user?.user_metadata?.user_name
    || user?.email
    || 'You';

  // Tabs — owner gets extra admin tabs
  const tabs = [
    { id: 'overview', label: '📊 Overview'  },
    { id: 'seasons',  label: '📅 Seasons'   },
    { id: 'players',  label: '🏆 Players'   },
    ...(owner ? [
      { id: 'admin-activity',     label: '📈 Activity',     owner: true },
      { id: 'admin-announce',     label: '📣 Announce',     owner: true },
      { id: 'admin-feedback',     label: '✉️ Feedback',      owner: true },
      { id: 'admin-users',        label: '👥 Users',         owner: true },
      { id: 'admin-seasons',      label: '🗂️ All Seasons',   owner: true },
      { id: 'admin-stats',        label: '🌍 Global Stats',  owner: true },
      { id: 'admin-export',       label: '📤 Export',        owner: true },
    ] : []),
  ];

  el.innerHTML = `
    <div class="dash-tabs">
      ${tabs.map(t => `
        <button class="dash-tab ${dashTab === t.id ? 'active' : ''} ${t.owner ? 'dash-tab-owner' : ''}"
          onclick="switchDashTab('${t.id}')">${t.label}</button>
      `).join('')}
      <div class="dash-tab-spacer"></div>
      <span style="font-size:10px;color:var(--muted2);font-family:'Oswald',sans-serif;
        letter-spacing:.5px;align-self:center;margin-right:6px">${userDisplay}</span>
      ${!owner ? `<button class="btn btn-outline" onclick="openFeedbackModal()"
        style="font-size:9px;padding:5px 10px;letter-spacing:1px">✉️ Feedback</button>` : ''}
      <button class="btn btn-outline" onclick="logout()"
        style="font-size:9px;padding:5px 10px;letter-spacing:1px">Sign Out</button>
    </div>
    <div id="dashContent">
      ${await renderDashContent(dashTab, archive, owner)}
    </div>
  `;
}

async function renderDashContent(tab, archive, owner) {
  switch (tab) {
    case 'overview': return archive.length === 0 ? renderDashEmpty() : renderDashOverview(archive);
    case 'seasons':  return archive.length === 0 ? renderDashEmpty() : renderDashSeasons(archive);
    case 'players':  return archive.length === 0 ? renderDashEmpty() : renderDashPlayers(archive);
    case 'admin-activity': return owner ? await renderAdminActivity() : '';
    case 'admin-announce': return owner ? await renderAdminAnnounce() : '';
    case 'admin-feedback': return owner ? await renderAdminFeedback() : '';
    case 'admin-users':    return owner ? await renderAdminUsers()    : '';
    case 'admin-seasons':  return owner ? await renderAdminSeasons()  : '';
    case 'admin-stats':    return owner ? await renderAdminStats()    : '';
    case 'admin-export':   return owner ? await renderAdminExport()   : '';
    default: return renderDashEmpty();
  }
}

// ── USER DASHBOARD TABS ──────────────

function renderDashEmpty() {
  return `
    <div style="text-align:center;padding:48px 20px;color:var(--muted2)">
      <div style="font-size:40px;margin-bottom:12px">📭</div>
      <div style="font-family:'Oswald',sans-serif;font-size:14px;letter-spacing:2px;
        text-transform:uppercase;margin-bottom:8px">No Seasons Recorded</div>
      <div style="font-size:12px;line-height:1.6">Complete a season to start building your archive.<br>
        Stats are saved automatically when a winner is crowned.</div>
    </div>`;
}

function renderDashOverview(archive) {
  const totalSeasons = archive.length;
  const totalWeeks   = archive.reduce((s,a) => s + a.totalWeeks, 0);
  const avgCast      = Math.round(archive.reduce((s,a) => s + a.castSize, 0) / totalSeasons);
  const avgWeeks     = Math.round(totalWeeks / totalSeasons);

  const winC={}, nomC={}, hohC={}, vetC={};
  archive.forEach(s => (s.cast||[]).forEach(p => {
    winC[p.name] = (winC[p.name]||0) + (p.isWinner?1:0);
    nomC[p.name] = (nomC[p.name]||0) + p.timesNominated;
    hohC[p.name] = (hohC[p.name]||0) + p.hohWins;
    vetC[p.name] = (vetC[p.name]||0) + p.vetoWins;
  }));

  const top = map => {
    const e = Object.entries(map).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
    return e.length ? { name:e[0][0], val:e[0][1] } : null;
  };

  const recentSeasons = [...archive].reverse().slice(0,3);

  return `
    <div class="dash-overview-grid">
      <div class="dash-stat-card"><div class="dash-stat-val">${totalSeasons}</div><div class="dash-stat-lbl">Seasons Played</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${totalWeeks}</div><div class="dash-stat-lbl">Total Weeks</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${avgCast}</div><div class="dash-stat-lbl">Avg Cast Size</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${avgWeeks}</div><div class="dash-stat-lbl">Avg Season Length</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${uniquePlayers(archive).length}</div><div class="dash-stat-lbl">Unique Players</div></div>
    </div>

    <div class="dash-section-title">All-Time Records</div>
    <div class="dash-records-grid">
      ${[
        [top(winC),  '🏆 Most Wins',       v => `${v} win${v>1?'s':''}`],
        [top(hohC),  '👑 Most HOH Wins',    v => `${v} HOHs`],
        [top(vetC),  '⚡ Most Veto Wins',   v => `${v} vetos`],
        [top(nomC),  '🎯 Most Nominated',   v => `${v} times`],
      ].filter(([t])=>t).map(([t,lbl,fmt]) => `
        <div class="dash-record">
          <div class="dash-record-label">${lbl}</div>
          <div class="dash-record-name">${t.name}</div>
          <div class="dash-record-val">${fmt(t.val)}</div>
        </div>
      `).join('')}
    </div>

    <div class="dash-section-title">Recent Seasons</div>
    ${recentSeasons.map(s => `
      <div class="dash-season-row" onclick="switchDashTab('seasons')">
        <div class="dash-season-num">S${s.seasonNum}</div>
        <div class="dash-season-info">
          <div class="dash-season-winner">🏆 ${s.winner}</div>
          <div class="dash-season-meta">${s.date} · ${s.castSize} cast · ${s.totalWeeks} weeks · ${s.winnerVotes}–${s.runnerUpVotes} jury vote</div>
        </div>
      </div>
    `).join('')}

    <div style="margin-top:14px;text-align:right">
      <button class="btn btn-outline" onclick="clearArchive()"
        style="font-size:9px;padding:5px 10px;color:var(--red)">Delete All My Seasons</button>
    </div>`;
}

function renderDashSeasons(archive) {
  return [...archive].reverse().map(s => `
    <div class="dash-season-card">
      <div class="dash-season-card-header">
        <div>
          <div class="dash-season-card-title">Season ${s.seasonNum}</div>
          <div class="dash-season-card-meta">${s.date} · ${s.castSize} houseguests · ${s.totalWeeks} weeks</div>
        </div>
        <div class="dash-season-card-winner">
          <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted2);margin-bottom:2px">Winner</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;color:var(--gold)">${s.winner}</div>
          <div style="font-size:10px;color:var(--muted2)">${s.winnerVotes}–${s.runnerUpVotes} jury vote</div>
        </div>
      </div>
      <div class="dash-finalists-row">
        <div class="dash-finalist">🥈 Runner-Up: <b>${s.runnerUp}</b></div>
        ${s.afp ? `<div class="dash-finalist">❤️ AFP: <b>${s.afp}</b></div>` : ''}
        <button class="btn btn-outline" onclick="deleteSeason(${s.id})"
          style="margin-left:auto;font-size:9px;padding:3px 9px;color:var(--red)">Delete</button>
      </div>
      <div class="dash-section-title" style="margin-top:10px">Cast Performance</div>
      <div class="dash-cast-table">
        <div class="dash-cast-header"><span>Houseguest</span><span>Placement</span><span>👑</span><span>⚡</span><span>🎯</span></div>
        ${[...(s.cast||[])].sort((a,b)=>(a.placement||99)-(b.placement||99)).map(p=>`
          <div class="dash-cast-row ${p.isWinner?'cast-winner':p.isRunnerUp?'cast-runner':''}">
            <span>${p.emoji} ${p.name}${p.isAFP?' ❤️':''}</span>
            <span>${p.isWinner?'🏆 1st':p.isRunnerUp?'🥈 2nd':p.placement?`${p.placement}${ordinal(p.placement)}`:'—'}</span>
            <span>${p.hohWins}</span><span>${p.vetoWins}</span><span>${p.timesNominated}</span>
          </div>`).join('')}
      </div>
      <div class="dash-section-title" style="margin-top:10px">Week-by-Week</div>
      <div class="dash-weekly-table">
        <div class="dash-weekly-header"><span>Wk</span><span>HOH</span><span>Evicted</span><span>Veto</span></div>
        ${(s.history||[]).map(w=>`
          <div class="dash-weekly-row">
            <span>${w.week}</span><span>${w.hoh}</span>
            <span style="color:var(--red)">${w.evicted}</span>
            <span style="color:var(--accent)">${w.veto}${w.vetoUsed?' ✓':''}</span>
          </div>`).join('')}
      </div>
      ${s.alliances?.length ? `
        <div class="dash-section-title" style="margin-top:10px">Alliances</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
          ${s.alliances.map(a=>`
            <div style="font-size:10px;padding:3px 9px;border-radius:20px;font-family:'Oswald',sans-serif;
              border:1px solid ${a.status==='active'?'rgba(240,180,41,.4)':a.status==='fractured'?'rgba(232,0,29,.3)':'var(--border)'};
              color:${a.status==='active'?'var(--gold)':a.status==='fractured'?'var(--red)':'var(--muted2)'}">
              ${a.name} <span style="opacity:.5;font-size:8px">${a.status}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`).join('');
}

function renderDashPlayers(archive) {
  const players = buildPlayerStats(archive);
  if (!players.length) return renderDashEmpty();
  players.sort((a,b) => b.wins-a.wins || b.hohWins-a.hohWins);
  const maxComp = Math.max(...players.map(p => p.hohWins+p.vetoWins), 1);

  return `
    <div class="dash-section-title">Career Stats — ${players.length} Players</div>
    <div class="dash-players-table">
      <div class="dash-players-header">
        <span>Player</span><span>Ssns</span><span>🏆</span><span>👑</span><span>⚡</span><span>🎯</span><span>Best</span><span>Avg</span>
      </div>
      ${players.map(p=>`
        <div class="dash-players-row ${p.wins>0?'player-winner-row':''}">
          <span class="dash-player-name">${p.emoji} ${p.name}${p.wins>1?`<span class="dash-multi-win">×${p.wins}</span>`:''}</span>
          <span>${p.seasons}</span>
          <span style="color:${p.wins>0?'var(--gold)':'var(--muted2)'}">${p.wins||'—'}</span>
          <span>${p.hohWins||'—'}</span><span>${p.vetoWins||'—'}</span><span>${p.timesNominated||'—'}</span>
          <span style="color:${p.bestPlacement===1?'var(--gold)':'var(--muted2)'}">
            ${p.bestPlacement?`${p.bestPlacement}${ordinal(p.bestPlacement)}`:'—'}</span>
          <span>${p.avgPlacement?p.avgPlacement.toFixed(1):'—'}</span>
        </div>`).join('')}
    </div>
    <div class="dash-section-title" style="margin-top:18px">Career Comp Wins</div>
    <div style="display:flex;flex-direction:column;gap:5px;margin-top:8px">
      ${[...players].sort((a,b)=>(b.hohWins+b.vetoWins)-(a.hohWins+a.vetoWins)).slice(0,8).map(p=>{
        const total = p.hohWins+p.vetoWins;
        const pct = Math.round((total/maxComp)*100);
        return `<div style="display:flex;align-items:center;gap:8px;font-size:11px">
          <span style="width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
            font-family:'Oswald',sans-serif;font-weight:600">${p.name}</span>
          <div style="flex:1;height:4px;background:var(--surface3);border-radius:2px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:var(--gold);border-radius:2px"></div>
          </div>
          <span style="color:var(--muted2);width:28px;text-align:right">${total}</span>
        </div>`;
      }).join('')}
    </div>`;
}

// ── OWNER / ADMIN TABS ───────────────

// ── ADMIN: ACTIVITY TAB ───────────────
// Combines: recent activity feed, 30-day growth chart, twist + settings analytics.
// Owner-only. Pulls from loadAllSeasons() so it sees every user's data.

async function renderAdminActivity() {
  const all = await loadAllSeasons();
  if (!all.length) {
    return `<div style="color:var(--muted2);padding:30px;text-align:center;font-size:13px">
      No activity yet. Activity data appears once users start finishing seasons.
    </div>`;
  }

  // ── Compute timestamps. Fall back to date_played for older rows. ──
  const withTime = all.map(s => {
    const ts = s.createdAt ? new Date(s.createdAt) : (s.date ? new Date(s.date) : null);
    return { ...s, _ts: ts };
  }).filter(s => s._ts && !isNaN(s._ts.getTime()));

  // Sort newest first
  withTime.sort((a, b) => b._ts - a._ts);

  // ── Top KPI cards: 7-day, 30-day, all-time ──
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const last7  = withTime.filter(s => now - s._ts.getTime() < 7  * day).length;
  const last30 = withTime.filter(s => now - s._ts.getTime() < 30 * day).length;
  const uniqueUsers7 = new Set(withTime.filter(s => now - s._ts.getTime() < 7 * day).map(s => s.ownerUid)).size;

  // ── Growth chart data: bucketize into 30 days ──
  const buckets = new Array(30).fill(0);
  withTime.forEach(s => {
    const ageDays = Math.floor((now - s._ts.getTime()) / day);
    if (ageDays >= 0 && ageDays < 30) buckets[29 - ageDays]++;  // index 29 = today
  });
  const maxBucket = Math.max(1, ...buckets);

  // 7-day rolling average for the trend line
  const rolling = buckets.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = buckets.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const maxRolling = Math.max(0.01, ...rolling);

  // SVG dimensions
  const chartW = 640, chartH = 140, padL = 32, padR = 12, padT = 14, padB = 22;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const barW = plotW / 30;

  const bars = buckets.map((v, i) => {
    const h = (v / maxBucket) * plotH;
    const x = padL + i * barW + 1;
    const y = padT + (plotH - h);
    return `<rect x="${x}" y="${y}" width="${Math.max(2, barW - 2)}" height="${h}" rx="1" fill="var(--gold)" opacity="0.55"/>`;
  }).join('');

  const lineCoords = rolling.map((v, i) => {
    const x = padL + i * barW + barW / 2;
    const y = padT + (plotH - (v / maxBucket) * plotH);
    return `${x},${y}`;
  }).join(' ');

  // X-axis labels: today, -7d, -14d, -21d, -29d
  const labels = [29, 22, 15, 8, 0].map(i => {
    const d = new Date(now - (29 - i) * day);
    const x = padL + i * barW + barW / 2;
    const text = i === 29 ? 'today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<text x="${x}" y="${chartH - 6}" text-anchor="middle" font-size="9"
      fill="var(--muted2)" font-family="Oswald,sans-serif">${text}</text>`;
  }).join('');

  // Y-axis: 0 and max
  const yAxis = `
    <text x="${padL - 6}" y="${padT + plotH + 3}" text-anchor="end" font-size="9"
      fill="var(--muted2)" font-family="Oswald,sans-serif">0</text>
    <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" font-size="9"
      fill="var(--muted2)" font-family="Oswald,sans-serif">${maxBucket}</text>
  `;

  // ── Activity feed: last 14 events ──
  const feedEntries = withTime.slice(0, 14).map(s => {
    const rel = relativeTime(s._ts);
    const userTag = s.userEmail || (s.ownerUid?.slice(0, 8) + '…');
    const isOwnerRow = s.ownerUid === OWNER_UID;
    return `
      <div class="activity-row">
        <div class="activity-time">${rel}</div>
        <div class="activity-detail">
          <span class="activity-user">${isOwnerRow ? '👑 ' : ''}${userTag}</span>
          finished a season won by <b>${s.winner}</b>
          <span class="activity-meta">· ${s.castSize} cast · ${s.totalWeeks} wks</span>
        </div>
      </div>`;
  }).join('');

  // ── Twist analytics: aggregate twists across all seasons ──
  const twistCounts = {};
  let seasonsWithTwistData = 0;
  withTime.forEach(s => {
    if (s.twistsApplied && s.twistsApplied.length) {
      seasonsWithTwistData++;
      s.twistsApplied.forEach(t => {
        twistCounts[t.id] = (twistCounts[t.id] || 0) + 1;
      });
    }
  });
  const sortedTwists = Object.entries(twistCounts).sort((a, b) => b[1] - a[1]);
  const totalTwistFires = sortedTwists.reduce((sum, [, n]) => sum + n, 0);

  const twistRows = sortedTwists.length
    ? sortedTwists.map(([id, count]) => {
        const def = (typeof TWIST_DEFS !== 'undefined' && TWIST_DEFS[id]) || null;
        const label = def ? `${def.icon} ${def.label}` : id;
        const pct = Math.round((count / totalTwistFires) * 100);
        return `
          <div class="insight-row">
            <span class="insight-label">${label}</span>
            <div class="insight-bar-wrap">
              <div class="insight-bar" style="width:${pct}%"></div>
            </div>
            <span class="insight-count">${count}</span>
          </div>`;
      }).join('')
    : `<div style="color:var(--muted2);font-size:12px;padding:14px 0">
        No twist data yet. New seasons archive their twist activity automatically.
      </div>`;

  // ── Settings analytics ──
  const settingTallies = {
    seasonTheme: {}, twistPersistence: {}, twists: {}, alliances: {}, juryBitterness: {},
  };
  let seasonsWithSettings = 0;
  withTime.forEach(s => {
    if (s.settingsSnapshot) {
      seasonsWithSettings++;
      Object.keys(settingTallies).forEach(key => {
        const v = s.settingsSnapshot[key];
        if (v != null) settingTallies[key][v] = (settingTallies[key][v] || 0) + 1;
      });
    }
  });

  const settingsBlock = seasonsWithSettings
    ? renderSettingsTallies(settingTallies, seasonsWithSettings)
    : `<div style="color:var(--muted2);font-size:12px;padding:14px 0">
        No settings data yet. New seasons archive their settings automatically.
      </div>`;

  // ── Anomaly detection ──
  const anomalies = detectAnomalies(withTime, now);
  const anomalyBlock = anomalies.length ? `
    <div class="anomaly-block">
      ${anomalies.map(a => `
        <div class="anomaly-row anomaly-${a.severity}">
          <span class="anomaly-icon">${a.icon}</span>
          <div class="anomaly-body">
            <div class="anomaly-title">${a.title}</div>
            <div class="anomaly-detail">${a.detail}</div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    ${anomalyBlock}
    <div class="dash-overview-grid" style="margin-bottom:20px">
      <div class="dash-stat-card">
        <div class="dash-stat-val">${last7}</div>
        <div class="dash-stat-lbl">Seasons (7d)</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-val">${last30}</div>
        <div class="dash-stat-lbl">Seasons (30d)</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-val">${uniqueUsers7}</div>
        <div class="dash-stat-lbl">Active Users (7d)</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-val">${withTime.length}</div>
        <div class="dash-stat-lbl">All-Time</div>
      </div>
    </div>

    <div class="dash-section-title">30-Day Growth</div>
    <div class="growth-chart-wrap">
      <svg viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="xMidYMid meet"
        style="width:100%;height:auto;display:block">
        ${yAxis}
        ${bars}
        <polyline points="${lineCoords}" fill="none"
          stroke="var(--red)" stroke-width="1.5" opacity="0.85"/>
        ${labels}
      </svg>
      <div class="growth-legend">
        <span><span class="legend-swatch gold"></span> seasons/day</span>
        <span><span class="legend-swatch red"></span> 7-day rolling avg</span>
      </div>
    </div>

    <div class="dash-section-title" style="margin-top:24px">Recent Activity</div>
    <div class="activity-feed">
      ${feedEntries || '<div style="color:var(--muted2);padding:14px;font-size:12px">No recent activity.</div>'}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px">
      <div>
        <div class="dash-section-title">Twist Popularity
          <span style="font-size:9px;color:var(--muted2);font-weight:400;letter-spacing:0;text-transform:none">
            (${seasonsWithTwistData}/${withTime.length} seasons)
          </span>
        </div>
        ${twistRows}
      </div>
      <div>
        <div class="dash-section-title">Setting Choices
          <span style="font-size:9px;color:var(--muted2);font-weight:400;letter-spacing:0;text-transform:none">
            (${seasonsWithSettings}/${withTime.length} seasons)
          </span>
        </div>
        ${settingsBlock}
      </div>
    </div>
  `;
}

function renderSettingsTallies(tallies, total) {
  const labelMap = {
    seasonTheme:      'Season Structure',
    twistPersistence: 'Twist Duration',
    twists:           'Twists Mode',
    alliances:        'Alliance Frequency',
    juryBitterness:   'Jury Bitterness',
  };
  return Object.entries(tallies).map(([key, vals]) => {
    const entries = Object.entries(vals).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '';
    return `
      <div class="setting-tally-block">
        <div class="setting-tally-name">${labelMap[key] || key}</div>
        ${entries.map(([val, n]) => {
          const pct = Math.round((n / total) * 100);
          return `
            <div class="insight-row" style="font-size:11px">
              <span class="insight-label" style="text-transform:capitalize">${val}</span>
              <div class="insight-bar-wrap">
                <div class="insight-bar" style="width:${pct}%;background:var(--accent)"></div>
              </div>
              <span class="insight-count">${pct}%</span>
            </div>`;
        }).join('')}
      </div>`;
  }).join('');
}

function relativeTime(date) {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60)    return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60)    return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr < 24)     return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7)    return `${days}d ago`;
  if (days < 30)   return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Anomaly detection over season data ──
// Returns an array of { severity, icon, title, detail } objects.
// Severities: 'info' | 'warn' | 'critical'.
function detectAnomalies(seasons, now) {
  const out = [];
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;

  // ── 1. Burst pattern: any user finished >5 seasons in 1 hour ──
  const byUser = {};
  seasons.forEach(s => {
    if (!byUser[s.ownerUid]) byUser[s.ownerUid] = [];
    byUser[s.ownerUid].push(s._ts.getTime());
  });
  for (const [uid, times] of Object.entries(byUser)) {
    if (times.length < 6) continue;
    times.sort((a, b) => a - b);
    // Sliding window: any 6 consecutive within 1 hour?
    for (let i = 0; i + 5 < times.length; i++) {
      if (times[i + 5] - times[i] < hour) {
        const sample = seasons.find(s => s.ownerUid === uid);
        const userTag = sample?.userEmail || (uid?.slice(0, 8) + '…');
        out.push({
          severity: 'warn',
          icon: '⚡',
          title: `Burst activity from ${userTag}`,
          detail: `Finished 6+ seasons within an hour. Possible automation or stress test.`,
        });
        break;
      }
    }
  }

  // ── 2. Suspiciously short seasons: avg total_weeks < 4 across multiple seasons by same user ──
  for (const [uid, times] of Object.entries(byUser)) {
    const userSeasons = seasons.filter(s => s.ownerUid === uid);
    if (userSeasons.length < 3) continue;
    const avgWeeks = userSeasons.reduce((s, x) => s + (x.totalWeeks || 0), 0) / userSeasons.length;
    if (avgWeeks < 4 && userSeasons.length >= 3) {
      const userTag = userSeasons[0].userEmail || (uid?.slice(0, 8) + '…');
      out.push({
        severity: 'info',
        icon: '🐛',
        title: `Unusually short seasons from ${userTag}`,
        detail: `${userSeasons.length} seasons averaging ${avgWeeks.toFixed(1)} weeks. May indicate small casts or an early-exit bug.`,
      });
    }
  }

  // ── 3. Stagnation: zero new seasons in 7 days (and seasons exist) ──
  if (seasons.length > 0) {
    const newest = seasons[0]._ts.getTime();
    const ageDays = (now - newest) / day;
    if (ageDays > 7) {
      out.push({
        severity: 'info',
        icon: '🌙',
        title: 'No new seasons in 7+ days',
        detail: `Last season was ${Math.floor(ageDays)} days ago. Site may need engagement (new twist? announcement?).`,
      });
    }
  }

  // ── 4. Crash signal: settings_snapshot is null on recent seasons (only happens if save partially failed) ──
  const recent = seasons.filter(s => now - s._ts.getTime() < 14 * day);
  const recentWithSnap = recent.filter(s => s.settingsSnapshot);
  if (recent.length >= 5 && recentWithSnap.length === 0) {
    out.push({
      severity: 'critical',
      icon: '🚨',
      title: 'Settings snapshots missing on all recent seasons',
      detail: `Last ${recent.length} seasons archived without settings data. The Supabase migration for settings_snapshot may not have been applied.`,
    });
  }

  return out;
}

// ── ADMIN: ANNOUNCEMENTS TAB ──────────────
async function renderAdminAnnounce() {
  const all = await loadAllAnnouncements();
  const activeCount = all.filter(a => a.active).length;

  return `
    <div class="dash-section-title">Compose New Announcement</div>
    <div class="ann-compose">
      <textarea id="annInput" placeholder="Write a message to broadcast to all users…"
        rows="2" maxlength="240" class="auth-input"
        style="resize:vertical;font-family:'Barlow',sans-serif;line-height:1.4"></textarea>
      <div class="ann-compose-row">
        <div class="ann-type-select" id="annTypeSelect">
          <button class="ann-type-btn active" data-type="info"     onclick="annPickType('info')">📣 Info</button>
          <button class="ann-type-btn"        data-type="warn"     onclick="annPickType('warn')">⚠️ Warn</button>
          <button class="ann-type-btn"        data-type="critical" onclick="annPickType('critical')">🚨 Critical</button>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-gold" onclick="annPublish()" style="font-size:11px;padding:8px 16px">Publish</button>
      </div>
    </div>

    <div class="dash-section-title" style="margin-top:24px">
      Existing Announcements
      <span style="font-size:9px;color:var(--muted2);font-weight:400;letter-spacing:0;text-transform:none">
        (${activeCount} active · ${all.length} total)
      </span>
    </div>
    ${all.length === 0
      ? `<div style="color:var(--muted2);padding:18px 0;font-size:12px">No announcements yet.</div>`
      : all.map(a => `
        <div class="ann-list-row ann-${a.type || 'info'}">
          <div class="ann-list-body">
            <div class="ann-list-head">
              <span class="ann-list-icon">${a.type === 'warn' ? '⚠️' : a.type === 'critical' ? '🚨' : '📣'}</span>
              <span class="ann-list-meta">
                ${a.type || 'info'} · ${new Date(a.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                · ${a.active ? '<b style="color:var(--safe)">ACTIVE</b>' : '<span style="color:var(--muted)">paused</span>'}
              </span>
            </div>
            <div class="ann-list-text">${escapeHtml(a.message)}</div>
          </div>
          <div class="ann-list-actions">
            <button class="btn btn-outline" onclick="annToggle(${a.id}, ${!a.active})"
              style="font-size:9px;padding:4px 9px">${a.active ? 'Pause' : 'Activate'}</button>
            <button class="btn btn-outline" onclick="annDelete(${a.id})"
              style="font-size:9px;padding:4px 9px;color:var(--red)">Delete</button>
          </div>
        </div>
      `).join('')}

    <div style="margin-top:18px;padding:12px 14px;background:var(--surface2);
      border:1px solid var(--border);border-radius:var(--r2);
      font-size:11px;color:var(--muted2);line-height:1.6">
      <b style="color:var(--text)">Note:</b> Announcements appear at the top of the page for all users.
      Users can dismiss them, and dismissals persist on their device.
      Critical announcements are styled prominently and harder to ignore.
    </div>
  `;
}

let _annPickedType = 'info';
function annPickType(type) {
  _annPickedType = type;
  document.querySelectorAll('#annTypeSelect .ann-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
}
async function annPublish() {
  const input = document.getElementById('annInput');
  const msg = (input.value || '').trim();
  if (!msg) { alert('Message cannot be empty.'); return; }
  if (msg.length > 240) { alert('Message too long (240 char max).'); return; }
  const result = await createAnnouncement(msg, _annPickedType);
  if (result.ok) {
    input.value = '';
    _annPickedType = 'info';
    await renderDashboard();
    refreshAnnouncementBanner();
  }
}
async function annToggle(id, active) {
  await toggleAnnouncement(id, active);
  await renderDashboard();
  refreshAnnouncementBanner();
}
async function annDelete(id) {
  await deleteAnnouncementById(id);
  await renderDashboard();
  refreshAnnouncementBanner();
}

// ── ADMIN: FEEDBACK INBOX ──────────────
let _feedbackFilter = 'all';   // all | new | read | archived

function setFeedbackFilter(f) {
  _feedbackFilter = f;
  renderDashboard();
}

async function renderAdminFeedback() {
  const all = await loadAllFeedback();
  const counts = {
    all:      all.length,
    new:      all.filter(f => f.status === 'new').length,
    read:     all.filter(f => f.status === 'read').length,
    archived: all.filter(f => f.status === 'archived').length,
  };

  const filtered = _feedbackFilter === 'all'
    ? all
    : all.filter(f => f.status === _feedbackFilter);

  const filterButtons = ['all', 'new', 'read', 'archived'].map(f => `
    <button class="ann-type-btn ${_feedbackFilter === f ? 'active' : ''}"
      onclick="setFeedbackFilter('${f}')">
      ${f.charAt(0).toUpperCase() + f.slice(1)} <span style="opacity:0.7">(${counts[f]})</span>
    </button>
  `).join('');

  return `
    <div class="dash-section-title">
      Feedback Inbox
      <span style="font-size:9px;color:var(--muted2);font-weight:400;letter-spacing:0;text-transform:none">
        — user-submitted messages
      </span>
    </div>

    <div class="ann-type-select" style="margin-bottom:14px">
      ${filterButtons}
    </div>

    ${filtered.length === 0
      ? `<div style="color:var(--muted2);padding:24px 0;font-size:12px;text-align:center">
          No feedback in this filter.
        </div>`
      : filtered.map(f => {
        const userTag = f.user_email || (f.user_uid?.slice(0, 8) + '…');
        const isOwnerSender = f.user_uid === OWNER_UID;
        const ts = new Date(f.created_at);
        return `
          <div class="feedback-row feedback-${f.status}">
            <div class="feedback-meta-row">
              <span class="feedback-user">${isOwnerSender ? '👑 ' : ''}${escapeHtml(userTag)}</span>
              <span class="feedback-status feedback-status-${f.status}">${f.status}</span>
              <span class="feedback-ts">${relativeTime(ts)}</span>
            </div>
            <div class="feedback-message">${escapeHtml(f.message)}</div>
            <div class="feedback-actions">
              ${f.status !== 'read'     ? `<button class="btn btn-outline" style="font-size:9px;padding:3px 8px" onclick="fbSetStatus(${f.id},'read')">Mark read</button>` : ''}
              ${f.status !== 'archived' ? `<button class="btn btn-outline" style="font-size:9px;padding:3px 8px" onclick="fbSetStatus(${f.id},'archived')">Archive</button>` : ''}
              ${f.status !== 'new'      ? `<button class="btn btn-outline" style="font-size:9px;padding:3px 8px" onclick="fbSetStatus(${f.id},'new')">Mark new</button>` : ''}
              <button class="btn btn-outline" style="font-size:9px;padding:3px 8px;color:var(--red)" onclick="fbDelete(${f.id})">Delete</button>
            </div>
          </div>
        `;
      }).join('')
    }
  `;
}

async function fbSetStatus(id, status) {
  await setFeedbackStatus(id, status);
  await renderDashboard();
}
async function fbDelete(id) {
  await deleteFeedback(id);
  await renderDashboard();
}

// ── User-side feedback submission ──
function openFeedbackModal() {
  const body = document.getElementById('feedbackModalBody');
  body.innerHTML = `
    <div class="auth-title">✉️ Send Feedback</div>
    <div class="auth-desc">
      Have a bug to report, idea to suggest, or just want to say what's working?
      Your message goes straight to the site owner.
    </div>
    <div class="auth-field">
      <textarea id="feedbackInput" rows="5" maxlength="1000"
        class="auth-input"
        style="resize:vertical;font-family:'Barlow',sans-serif;line-height:1.5"
        placeholder="Type your message…"></textarea>
    </div>
    <div id="feedbackStatus" class="auth-error"></div>
    <div class="auth-buttons">
      <button class="btn btn-outline" onclick="closeFeedbackModal()">Cancel</button>
      <button class="btn btn-red" onclick="submitFeedbackFromModal()">Send</button>
    </div>
  `;
  document.getElementById('feedbackModal').classList.add('open');
}
function closeFeedbackModal() {
  document.getElementById('feedbackModal').classList.remove('open');
}
async function submitFeedbackFromModal() {
  const input  = document.getElementById('feedbackInput');
  const status = document.getElementById('feedbackStatus');
  status.style.color = 'var(--red)';
  status.textContent = '';
  const result = await submitFeedback(input.value);
  if (result.error) {
    status.textContent = result.error;
    return;
  }
  status.style.color = 'var(--safe)';
  status.textContent = 'Thanks — message sent.';
  input.value = '';
  setTimeout(() => closeFeedbackModal(), 1200);
}

async function renderAdminUsers() {
  const [users, notes] = await Promise.all([loadAllUsers(), loadUserNotes()]);
  const total = users.reduce((s,u) => s+u.seasons, 0);
  const withNotes = users.filter(u => notes[u.uid] && notes[u.uid].note).length;

  return `
    <div class="dash-overview-grid" style="margin-bottom:16px">
      <div class="dash-stat-card"><div class="dash-stat-val">${users.length}</div><div class="dash-stat-lbl">Total Users</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${total}</div><div class="dash-stat-lbl">Total Seasons</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${total ? (total/users.length).toFixed(1) : 0}</div><div class="dash-stat-lbl">Avg Seasons/User</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${withNotes}</div><div class="dash-stat-lbl">With Notes</div></div>
    </div>
    <div class="dash-section-title">Registered Users</div>
    <div class="dash-players-table">
      <div class="dash-players-header" style="grid-template-columns:1fr 70px 80px 60px">
        <span>User ID</span><span>Seasons</span><span>Action</span><span>Note</span>
      </div>
      ${users.map(u => {
        const noteData = notes[u.uid];
        const hasNote = noteData && noteData.note;
        return `
        <div class="dash-players-row dash-user-row-with-note" style="grid-template-columns:1fr 70px 80px 60px"
             data-uid="${u.uid}">
          <span class="dash-player-name" style="font-size:10px;font-family:monospace;letter-spacing:0">
            ${u.uid === OWNER_UID ? '👑 ' : ''}${u.uid.slice(0,20)}…
          </span>
          <span style="text-align:center">${u.seasons}</span>
          <span style="text-align:center">
            <button class="btn btn-outline" onclick="adminViewUserSeasons('${u.uid}')"
              style="font-size:8px;padding:2px 7px">View</button>
          </span>
          <span style="text-align:center">
            <button class="btn btn-outline ${hasNote ? 'has-note' : ''}"
              onclick="toggleUserNote('${u.uid}')"
              style="font-size:8px;padding:2px 7px">${hasNote ? '📝' : '＋'}</button>
          </span>
        </div>
        <div class="user-note-editor" id="note-editor-${u.uid}" style="display:none">
          <textarea class="auth-input" id="note-input-${u.uid}"
            rows="3" maxlength="500"
            placeholder="Notes only you can see — e.g. 'this is my friend Greg'"
            style="resize:vertical;font-family:'Barlow',sans-serif;line-height:1.45;font-size:12px">${escapeHtml(noteData?.note || '')}</textarea>
          <div class="user-note-meta">
            ${noteData?.updatedAt ? `<span class="user-note-ts">Updated ${relativeTime(new Date(noteData.updatedAt))}</span>` : ''}
            <div style="flex:1"></div>
            ${hasNote ? `<button class="btn btn-outline" onclick="removeUserNote('${u.uid}')" style="font-size:9px;padding:3px 8px;color:var(--red)">Delete</button>` : ''}
            <button class="btn btn-outline" onclick="toggleUserNote('${u.uid}')" style="font-size:9px;padding:3px 8px">Cancel</button>
            <button class="btn btn-gold" onclick="commitUserNote('${u.uid}')" style="font-size:9px;padding:3px 10px">Save</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function toggleUserNote(uid) {
  const el = document.getElementById('note-editor-' + uid);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
  if (el.style.display !== 'none') {
    const input = document.getElementById('note-input-' + uid);
    if (input) input.focus();
  }
}
async function commitUserNote(uid) {
  const input = document.getElementById('note-input-' + uid);
  if (!input) return;
  const result = await saveUserNote(uid, input.value || '');
  if (result.ok) await renderDashboard();
}
async function removeUserNote(uid) {
  if (!confirm('Delete this note?')) return;
  await deleteUserNote(uid);
  await renderDashboard();
}

async function adminViewUserSeasons(uid) {
  // Switch to all-seasons tab filtered to this user
  window._adminFilterUid = uid;
  dashTab = 'admin-seasons';
  await renderDashboard();
}

async function renderAdminSeasons() {
  const all = await loadAllSeasons();
  // Stash the full season objects for the Replay modal to look them up by id
  window._adminSeasonsCache = all;

  const filtered = window._adminFilterUid
    ? all.filter(s => s.ownerUid === window._adminFilterUid)
    : all;

  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div class="dash-section-title" style="margin-bottom:0">
        All Seasons ${window._adminFilterUid ? `<span style="color:var(--accent);font-size:9px">— filtered</span>` : `(${all.length} total)`}
      </div>
      ${window._adminFilterUid ? `
        <button class="btn btn-outline" onclick="window._adminFilterUid=null;switchDashTab('admin-seasons')"
          style="font-size:9px;padding:3px 8px">Clear Filter</button>` : ''}
    </div>
    ${filtered.length === 0 ? `<div style="color:var(--muted2);font-size:12px;padding:20px">No seasons found.</div>` : ''}
    ${filtered.map(s => `
      <div class="dash-season-card" style="margin-bottom:10px">
        <div class="dash-season-card-header">
          <div>
            <div class="dash-season-card-title">Season ${s.seasonNum}</div>
            <div class="dash-season-card-meta">
              ${s.date} · ${s.castSize} cast · ${s.totalWeeks} weeks
              <span style="color:var(--accent);font-size:9px;margin-left:6px;font-family:monospace">
                ${s.userEmail || s.ownerUid?.slice(0,12)+'…'}
              </span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--gold)">🏆 ${s.winner}</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-outline" onclick="openSeasonReplay(${s.id})"
                style="font-size:9px;padding:3px 9px">▶ Replay</button>
              <button class="btn btn-outline" onclick="adminDeleteSeason(${s.id})"
                style="font-size:9px;padding:3px 9px;color:var(--red)">Delete</button>
            </div>
          </div>
        </div>
      </div>`).join('')}`;
}

// ── SEASON REPLAY ─────────────────────────
// Pure-render: walks through an archived season's history week-by-week.
// Doesn't touch live game state; just displays what was saved.

const _replay = {
  season: null,
  weekIdx: 0,    // 0-indexed into season.history
  playing: false,
  speed: 1,      // 1 | 2 | 4 | 999 (instant)
  timer: null,
};

function openSeasonReplay(seasonId) {
  const cache = window._adminSeasonsCache || [];
  const season = cache.find(s => s.id === seasonId);
  if (!season) { alert('Season data not loaded.'); return; }
  if (!season.history || !season.history.length) {
    alert('This season has no replay data.');
    return;
  }

  _replay.season = season;
  _replay.weekIdx = 0;
  _replay.playing = false;
  _replay.speed = 1;
  if (_replay.timer) { clearTimeout(_replay.timer); _replay.timer = null; }

  // Reuse twistInfoModal as a generic shell? No — better to use a dedicated container.
  // We'll repurpose the dashboard modal's overlay style by adding our own.
  let host = document.getElementById('replayModal');
  if (!host) {
    host = document.createElement('div');
    host.id = 'replayModal';
    host.className = 'hg-modal-overlay';
    host.onclick = function(e){ if (e.target === this) closeSeasonReplay(); };
    host.innerHTML = `
      <div class="hg-modal" style="max-width:560px">
        <button class="modal-close" onclick="closeSeasonReplay()">✕</button>
        <div id="replayBody"></div>
      </div>
    `;
    document.body.appendChild(host);
  }
  host.classList.add('open');
  renderReplay();
}

function closeSeasonReplay() {
  if (_replay.timer) { clearTimeout(_replay.timer); _replay.timer = null; }
  _replay.playing = false;
  const host = document.getElementById('replayModal');
  if (host) host.classList.remove('open');
}

function renderReplay() {
  const s = _replay.season;
  if (!s) return;
  const body = document.getElementById('replayBody');
  if (!body) return;

  const weeks = s.history;
  const idx = Math.min(_replay.weekIdx, weeks.length - 1);
  const w = weeks[idx];

  // Build the cumulative evicted list up to this point
  const evictedSoFar = weeks.slice(0, idx + 1)
    .map(x => x.evicted)
    .filter(Boolean);

  // Cast snapshot at this point
  const castNames = (s.cast || []).map(c => c.name);
  const remaining = castNames.filter(n => !evictedSoFar.includes(n));

  // Twists fired during/before this week
  const twistsThisWeek = (s.twistsApplied || []).filter(t => t.week === w.week);

  body.innerHTML = `
    <div class="replay-header">
      <div>
        <div class="replay-title">Season ${s.seasonNum} Replay</div>
        <div class="replay-subtitle">Won by ${s.winner} · ${s.castSize} cast · ${weeks.length} weeks</div>
      </div>
      <div class="replay-week-pill">
        <div class="replay-week-num">${w.week}</div>
        <div class="replay-week-total">of ${weeks.length}</div>
      </div>
    </div>

    ${twistsThisWeek.length ? `
      <div class="replay-twist-strip">
        ${twistsThisWeek.map(t => `<span class="replay-twist-chip">${TWIST_DEFS[t.id]?.icon || '🌀'} ${t.label}</span>`).join('')}
      </div>` : ''}

    <div class="replay-events">
      <div class="replay-event">
        <span class="replay-event-icon">👑</span>
        <span class="replay-event-label">HOH</span>
        <span class="replay-event-value">${escapeHtml(w.hoh || '—')}</span>
      </div>
      <div class="replay-event">
        <span class="replay-event-icon">🎯</span>
        <span class="replay-event-label">Nominees</span>
        <span class="replay-event-value">${(w.nominees || []).map(escapeHtml).join(', ') || '—'}</span>
      </div>
      <div class="replay-event">
        <span class="replay-event-icon">⚡</span>
        <span class="replay-event-label">Veto</span>
        <span class="replay-event-value">${escapeHtml(w.veto || '—')} ${w.vetoUsed ? '<i style="color:var(--accent);font-size:11px">(used)</i>' : '<i style="color:var(--muted);font-size:11px">(not used)</i>'}</span>
      </div>
      <div class="replay-event replay-event-evict">
        <span class="replay-event-icon">🚪</span>
        <span class="replay-event-label">Evicted</span>
        <span class="replay-event-value"><b>${escapeHtml(w.evicted || '—')}</b></span>
      </div>
    </div>

    <div class="replay-progress-bar">
      <div class="replay-progress-fill" style="width:${((idx + 1) / weeks.length) * 100}%"></div>
    </div>
    <div class="replay-status-line">
      ${remaining.length} remaining · ${evictedSoFar.length} evicted
    </div>

    <div class="replay-controls">
      <button class="btn btn-outline" onclick="replayStep(-1)" ${idx === 0 ? 'disabled' : ''}>⏮ Prev</button>
      <button class="btn ${_replay.playing ? 'btn-gold' : 'btn-red'}" onclick="replayTogglePlay()">
        ${_replay.playing ? '⏸ Pause' : '▶ Play'}
      </button>
      <button class="btn btn-outline" onclick="replayStep(1)" ${idx === weeks.length - 1 ? 'disabled' : ''}>Next ⏭</button>
      <div style="flex:1"></div>
      <div class="replay-speed">
        ${[1, 2, 4, 999].map(sp => `
          <button class="ann-type-btn ${_replay.speed === sp ? 'active' : ''}"
            onclick="replaySetSpeed(${sp})">${sp === 999 ? '⚡' : sp + '×'}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function replayStep(delta) {
  const s = _replay.season;
  if (!s) return;
  const next = _replay.weekIdx + delta;
  if (next < 0 || next >= s.history.length) return;
  _replay.weekIdx = next;
  renderReplay();
}

function replayTogglePlay() {
  if (_replay.playing) {
    _replay.playing = false;
    if (_replay.timer) clearTimeout(_replay.timer);
    _replay.timer = null;
    renderReplay();
    return;
  }
  // If at end, restart
  if (_replay.weekIdx >= _replay.season.history.length - 1) {
    _replay.weekIdx = 0;
  }
  _replay.playing = true;
  renderReplay();
  replayTick();
}

function replayTick() {
  if (!_replay.playing) return;
  const s = _replay.season;
  if (!s) return;

  if (_replay.speed === 999) {
    // Instant: jump to end
    _replay.weekIdx = s.history.length - 1;
    _replay.playing = false;
    renderReplay();
    return;
  }

  if (_replay.weekIdx >= s.history.length - 1) {
    _replay.playing = false;
    renderReplay();
    return;
  }
  _replay.weekIdx++;
  renderReplay();

  const baseDelay = 1500;
  const delay = baseDelay / _replay.speed;
  _replay.timer = setTimeout(replayTick, delay);
}

function replaySetSpeed(sp) {
  _replay.speed = sp;
  if (_replay.playing) {
    if (_replay.timer) clearTimeout(_replay.timer);
    if (sp === 999) {
      replayTick();
    } else {
      _replay.timer = setTimeout(replayTick, 1500 / sp);
    }
  }
  renderReplay();
}

async function renderAdminStats() {
  const all = await loadAllSeasons();
  if (!all.length) return `<div style="color:var(--muted2);padding:30px;text-align:center">No data yet.</div>`;

  // Aggregate across all users
  const totalSeasons = all.length;
  const totalWeeks   = all.reduce((s,a) => s+a.totalWeeks, 0);
  const avgCast      = (all.reduce((s,a) => s+a.castSize, 0) / totalSeasons).toFixed(1);
  const avgWeeks     = (totalWeeks / totalSeasons).toFixed(1);

  // Most common winners
  const winCount = {};
  const hohCount = {};
  all.forEach(s => {
    winCount[s.winner] = (winCount[s.winner]||0)+1;
    (s.cast||[]).forEach(p => {
      hohCount[p.name] = (hohCount[p.name]||0)+p.hohWins;
    });
  });
  const topWinners = Object.entries(winCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topHOHs    = Object.entries(hohCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // Unique users
  const uids = new Set(all.map(s => s.ownerUid));

  return `
    <div class="dash-overview-grid">
      <div class="dash-stat-card"><div class="dash-stat-val">${totalSeasons}</div><div class="dash-stat-lbl">Total Seasons</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${uids.size}</div><div class="dash-stat-lbl">Total Users</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${totalWeeks}</div><div class="dash-stat-lbl">Total Weeks Played</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${avgCast}</div><div class="dash-stat-lbl">Avg Cast Size</div></div>
      <div class="dash-stat-card"><div class="dash-stat-val">${avgWeeks}</div><div class="dash-stat-lbl">Avg Season Length</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:4px">
      <div>
        <div class="dash-section-title">Most Crowned Winners (Global)</div>
        ${topWinners.map(([name,count],i) => `
          <div style="display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:6px">
            <span style="width:16px;color:var(--muted2);text-align:right">${i+1}.</span>
            <span style="flex:1;font-family:'Oswald',sans-serif;font-weight:600">${name}</span>
            <span style="color:var(--gold)">${count}×</span>
          </div>`).join('')}
      </div>
      <div>
        <div class="dash-section-title">Most HOH Wins (Global)</div>
        ${topHOHs.map(([name,count],i) => `
          <div style="display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:6px">
            <span style="width:16px;color:var(--muted2);text-align:right">${i+1}.</span>
            <span style="flex:1;font-family:'Oswald',sans-serif;font-weight:600">${name}</span>
            <span style="color:var(--gold)">${count}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

async function renderAdminExport() {
  const all = await loadAllSeasons();
  const json = JSON.stringify(all, null, 2);
  const size  = (new Blob([json]).size / 1024).toFixed(1);

  return `
    <div class="dash-section-title">Export Full Archive</div>
    <div style="font-size:12px;color:var(--muted2);margin-bottom:16px;line-height:1.6">
      Downloads all seasons across all users as a JSON file.
      ${all.length} seasons · ${size} KB
    </div>
    <button class="btn btn-gold" onclick="downloadExport()"
      style="font-size:12px;padding:11px 22px">⬇ Download Full Archive JSON</button>
    <div style="margin-top:20px">
      <div class="dash-section-title">Preview (first 3 seasons)</div>
      <pre style="font-size:10px;color:var(--muted2);background:var(--surface2);
        border:1px solid var(--border);border-radius:var(--r);padding:12px;
        overflow-x:auto;max-height:300px;overflow-y:auto;line-height:1.5">
${JSON.stringify(all.slice(0,3).map(s => ({
  seasonNum: s.seasonNum, date: s.date, winner: s.winner,
  castSize: s.castSize, totalWeeks: s.totalWeeks
})), null, 2)}</pre>
    </div>`;
}

async function downloadExport() {
  const all  = await loadAllSeasons();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `bb-simulator-archive-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── SHARED HELPERS ───────────────────

function buildPlayerStats(archive) {
  const map = {};
  archive.forEach(season => {
    (season.cast||[]).forEach(p => {
      if (!map[p.name]) map[p.name] = {
        name:p.name, emoji:p.emoji,
        seasons:0, wins:0, hohWins:0, vetoWins:0,
        timesNominated:0, placements:[], bestPlacement:null, avgPlacement:null,
      };
      const m = map[p.name];
      m.seasons++;
      if (p.isWinner) m.wins++;
      m.hohWins        += p.hohWins;
      m.vetoWins       += p.vetoWins;
      m.timesNominated += p.timesNominated;
      if (p.placement) {
        m.placements.push(p.placement);
        if (!m.bestPlacement || p.placement < m.bestPlacement) m.bestPlacement = p.placement;
      }
    });
  });
  Object.values(map).forEach(p => {
    if (p.placements.length)
      p.avgPlacement = p.placements.reduce((a,b)=>a+b,0)/p.placements.length;
  });
  return Object.values(map);
}

function uniquePlayers(archive) {
  const names = new Set();
  archive.forEach(s => (s.cast||[]).forEach(p => names.add(p.name)));
  return [...names];
}

function getPlacement(name, winner, runnerUp) {
  if (name === winner)   return 1;
  if (name === runnerUp) return 2;
  const evIdx = game.evicted.findIndex(e => e.name === name);
  if (evIdx === -1) return null;
  return game.houseguests.length - evIdx;
}

function ordinal(n) {
  if (n===1) return 'st'; if (n===2) return 'nd'; if (n===3) return 'rd'; return 'th';
}

const EMOJIS = ['🌟','🔥','💎','⚡','🎯','🌊','🦁','🐺','🦊','🐯','🌙','☀️','🍀','🎪','🌺','🦋'];

function getEmoji(name) {
  let h = 0;
  for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xFFFF;
  return EMOJIS[h % EMOJIS.length];
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ══════════════════════════════════════
//  SETUP
// ══════════════════════════════════════

function addCastMember(name) {
  name = (name || document.getElementById('castNameInput').value).trim();
  // Collapse internal whitespace so names like "Jo  hn" don't break initials/keys
  name = name.replace(/\s+/g, ' ');
  if (!name) return;
  // Reject characters that have no business in a houseguest name and that would
  // let typed input break out of HTML/attribute contexts when rendered.
  if (/[<>&"'`\\]/.test(name)) {
    alert('Names can only contain letters, numbers, spaces, hyphens and periods.');
    return;
  }
  if (name.length > 30) { alert('Name is too long (30 characters max).'); return; }
  if (cast.includes(name)) { alert(`${name} is already in the cast!`); return; }
  cast.push(name);
  document.getElementById('castNameInput').value = '';
  renderCastList();
}

function clearCast() { cast = []; renderCastList(); }

function loadPreset(key) {
  cast = [...PRESETS[key]];
  renderCastList();
}

function renderCastList() {
  const el = document.getElementById('castList');
  const countEl = document.getElementById('castCountNum');
  const startBtn = document.getElementById('startBtn');

  countEl.textContent = cast.length;
  startBtn.disabled = cast.length < 6;
  el.innerHTML = cast.map((n, i) => `
    <div class="cast-tag">
      ${getEmoji(n)} ${escapeHtml(n)}
      <button data-cast-index="${i}" aria-label="Remove ${escapeHtml(n)}">✕</button>
    </div>
  `).join('');
}

// Event delegation: remove by index rather than interpolating the name into
// an inline onclick (which breaks on apostrophes and is an injection vector).
document.getElementById('castList').addEventListener('click', e => {
  const btn = e.target.closest('button[data-cast-index]');
  if (!btn) return;
  const idx = parseInt(btn.getAttribute('data-cast-index'), 10);
  if (!Number.isNaN(idx)) {
    cast.splice(idx, 1);
    renderCastList();
  }
});

document.getElementById('castNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') addCastMember();
});

// ══════════════════════════════════════
//  GAME STATE INIT
// ══════════════════════════════════════

function startGame() {
  if (cast.length < 6) return;

  // Starting a brand-new season clears any prior saved progress.
  clearSavedGame();

  const JURY_SIZE = cast.length <= 8 ? 5 : cast.length <= 12 ? 7 : 9;

  game = {
    week: 1,
    phase: 'hoh',
    houseguests: cast.map(name => ({
      name,
      emoji: getEmoji(name),
      status: 'active',
      wins: { hoh: 0, veto: 0 },
      votes: 0,
      relationships: {},
      grudges: {},
      nominatedBy: [],
      publicEnemies: [],
      allies: [],
      enemies: [],
      timesNominated: 0,
    })),
    hoh: null,
    nominees: [],
    vetoHolder: null,
    vetoUsed: false,
    vetoSaved: null,
    evicted: [],
    jury: [],
    jurySize: JURY_SIZE,
    history: [],
    currentWeekHistory: [],
    stats: { hohWins: {}, vetoWins: {}, votesEvicted: {} },
    final3Phase: null,
    f3Players: [],
    f3HOH1Winner: null,
    f3HOH2Winner: null,
    f3FinalHOH: null,
    f3Cut: null,
    f3Finalists: [],
    juryVotes: {},
    selections: [],
    pendingVetoDecision: false,
    alliances: [],
    diaryRoom: [],
    prevHOH: null,
    autoPlay: false,
    autoPlayDelay: getAutoPlayDelay(),
  };

  game.houseguests.forEach(hg => {
    game.houseguests.forEach(other => {
      if (other.name !== hg.name) {
        hg.relationships[other.name] = Math.random() * 100;
        hg.grudges[other.name] = 0;
      }
    });
  });

  showScreen('gameScreen');
  planTwists();
  onWeekStart(1);
  startHOHPhase();
}

// ══════════════════════════════════════
//  TWISTS SYSTEM
//  Self-contained: registry → planner → hooks
// ══════════════════════════════════════

const TWIST_DEFS = {
  // ─── FORMAT TWISTS ───
  doubleEviction: {
    id: 'doubleEviction',
    label: 'Double Eviction',
    icon: '⚡⚡',
    season: 'BB6+',
    info: 'Two houseguests evicted in a single week — a full HOH→Veto→Vote cycle runs twice. A staple since BB6 and the most explosive standard twist in the show.',
    desc: 'Two evictions back-to-back this week. HOH, noms, veto and vote all run twice.',
    minPlayers: 6,
    weeks: 'mid',
    mode: 'oneshot',
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.evictionsRemaining = 2;
      log(`⚡⚡ TWIST: Double Eviction! Two houseguests will go home this week.`, 'evict');
    },
  },
  tripleEviction: {
    id: 'tripleEviction',
    label: 'Triple Eviction',
    icon: '⚡⚡⚡',
    season: 'BB22',
    info: 'Three evictions in a single week. First introduced on Big Brother 22 (All-Stars). Mayhem.',
    desc: 'Three evictions in one week.',
    minPlayers: 8,
    weeks: 'mid',
    mode: 'oneshot',
    rare: true,
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.evictionsRemaining = 3;
      log(`⚡⚡⚡ TWIST: Triple Eviction! Three houseguests will be evicted.`, 'evict');
    },
  },
  battleOfTheBlock: {
    id: 'battleOfTheBlock',
    label: 'Battle of the Block',
    icon: '🥊',
    season: 'BB16/17',
    info: 'Two HOHs are crowned each week and each nominates a pair. The two pairs face off — the winning pair comes off the block AND the HOH who nominated them is dethroned. Defined Big Brother 16 (ran 8 weeks) and BB17 (5 weeks).',
    desc: 'Two HOHs each week. Two nominees compete for safety; the losing pair stays on the block.',
    minPlayers: 8,
    weeks: 'early',
    mode: 'multi-week',
    realDuration: { min: 5, max: 8 },
    seasonAnchor: true,
    apply(week) { /* season-mode setup, ticks handle weekly behavior */ },
    weeklyTick(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.battleOfTheBlock = true;
    },
    onEnd(week) {
      log(`🥊 The Battle of the Block twist has ended. Single HOH from now on.`, 'safe');
    },
  },
  aiArena: {
    id: 'aiArena',
    label: 'AI Arena (Blockbuster)',
    icon: '🤖',
    season: 'BB26/27',
    info: 'HOH names a third nominee. After the Veto, the remaining nominees compete in the AI Arena/BB Blockbuster — the winner is removed from the block. Ran 7 weeks on BB26, returned BB27 as the BB Blockbuster.',
    desc: 'A third nominee is added each week. After veto, remaining noms compete; the winner is saved.',
    minPlayers: 8,
    weeks: 'early',
    mode: 'multi-week',
    realDuration: { min: 5, max: 8 },
    seasonAnchor: true,
    apply(week) {},
    weeklyTick(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.aiArena = true;
    },
    onEnd(week) {
      log(`🤖 The AI Arena has been retired. Two nominees per week from now on.`, 'safe');
    },
  },

  // ─── NOMINATION / RESET TWISTS ───
  battleBack: {
    id: 'battleBack',
    label: 'Battle Back',
    icon: '🔁',
    season: 'BB16/22/25',
    info: 'Evicted houseguests get a chance to re-enter the game through a competition. Has appeared as Battle Back (BB16), the BB22 Returning Houseguest, and the BB25 "Resurrection" zombie twist.',
    desc: 'The first juror gets one chance to compete back into the house.',
    minPlayers: 7,
    weeks: 'mid',
    mode: 'oneshot',
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.battleBackArmed = true;
      log(`🔁 TWIST: Battle Back is in play. The first juror evicted may return.`, 'safe');
    },
  },
  rewind: {
    id: 'rewind',
    label: 'BB Rewind',
    icon: '⏪',
    season: 'BB16',
    info: 'Pressing the button erases the entire week — same HOH, same nominees, same veto holder, but the eviction is undone and the week starts over. From Big Brother 16 (Derrick\'s season).',
    desc: 'The week is undone. Same HOH stays, but nominations and the veto reset.',
    minPlayers: 7,
    weeks: 'mid',
    mode: 'oneshot',
    rare: true,
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.rewindActive = true;
      game.prevHOH = null;
      log(`⏪ TWIST: BB REWIND! The previous HOH lockout is voided this week.`, 'safe');
    },
  },

  // ─── POWER TWISTS ───
  pandorasBox: {
    id: 'pandorasBox',
    label: "Pandora's Box",
    icon: '📦',
    season: 'BB10+',
    info: 'A Faustian bargain: HOH opens the box for a personal reward, but unleashes a curse on the rest of the house. Introduced BB10 and recurring through the 2010s.',
    desc: 'HOH gets a relationship boost — but the house pays the price.',
    minPlayers: 5,
    weeks: 'any',
    mode: 'oneshot',
    apply(week) {
      const hoh = byName(game.hoh);
      if (!hoh) return;
      const others = active().filter(h => h.name !== game.hoh);
      if (!others.length) return;
      const buffTarget = rand(others);
      hoh.relationships[buffTarget.name] = Math.min(100, (hoh.relationships[buffTarget.name] || 50) + 15);
      buffTarget.relationships[hoh.name]  = Math.min(100, (buffTarget.relationships[hoh.name]  || 50) + 15);
      for (let i = 0; i < 2; i++) {
        const pair = shuffle(others).slice(0, 2);
        if (pair.length === 2) {
          pair[0].relationships[pair[1].name] = Math.max(0, (pair[0].relationships[pair[1].name] || 50) - 10);
          pair[1].relationships[pair[0].name] = Math.max(0, (pair[1].relationships[pair[0].name] || 50) - 10);
        }
      }
      log(`📦 TWIST: Pandora's Box — ${game.hoh} gained an ally, but tempers are flaring elsewhere.`, 'social');
    },
  },
  diamondVeto: {
    id: 'diamondVeto',
    label: 'Diamond Power of Veto',
    icon: '💎',
    season: 'BB10',
    info: "An upgraded Veto: the holder removes a nominee AND names the replacement, bypassing the HOH entirely. Iconic from Dan Gheesling's BB10 win.",
    desc: "This week's Veto holder picks the replacement nominee, not the HOH.",
    minPlayers: 6,
    weeks: 'any',
    mode: 'oneshot',
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.diamondVeto = true;
      log(`💎 TWIST: Diamond Power of Veto! The Veto holder will pick the replacement.`, 'veto');
    },
  },
  coup: {
    id: 'coup',
    label: "Coup d'État",
    icon: '🗡️',
    season: 'BB11/19',
    info: "A secret power held by a houseguest. On eviction night, the holder can replace BOTH of the HOH's nominees with anyone else. Originated BB11 (Jeff Schroeder); returned BB19 as the 'Halting Hex' family.",
    desc: "A houseguest holds the power to secretly replace both nominees on eviction night.",
    minPlayers: 7,
    weeks: 'mid',
    mode: 'oneshot',
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      const candidates = active().filter(h => h.name !== game.hoh);
      if (!candidates.length) return;
      const wielder = rand(candidates);
      game.weekFlags.coupWielder = wielder.name;
      log(`🗡️ TWIST: Someone in the house holds a Coup d'État power this week.`, 'nom');
    },
  },
  mvp: {
    id: 'mvp',
    label: 'MVP',
    icon: '⭐',
    season: 'BB15',
    info: 'America votes for an MVP each week. The MVP secretly puts up a third nominee. From the divisive BB15 season; ran roughly 5 weeks before the twist was retired.',
    desc: 'A third nominee is added each week — the most-disliked active houseguest.',
    minPlayers: 7,
    weeks: 'early',
    mode: 'multi-week',
    realDuration: { min: 4, max: 6 },
    seasonAnchor: true,
    apply(week) {},
    weeklyTick(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.mvpThirdNom = true;
    },
    onEnd(week) {
      log(`⭐ The MVP twist has ended. Standard nominations from now on.`, 'safe');
    },
  },

  // ─── HIDDEN / SOCIAL ───
  saboteur: {
    id: 'saboteur',
    label: 'The Saboteur',
    icon: '🃏',
    season: 'BB12 (returns BB26/27)',
    info: 'A secret houseguest carries out viewer-suggested acts of sabotage. Famously imploded on BB12 when Annie was evicted in week 1. Reborn as the AI Instigator (BB26) and Secret Accomplice (BB27). Designed to last 5 weeks.',
    desc: 'A random houseguest is the secret Saboteur — sowing chaos in relationships each week, until they are evicted.',
    minPlayers: 6,
    weeks: 'early',
    mode: 'multi-week',
    realDuration: { min: 3, max: 5 },
    seasonAnchor: true,
    apply(week) {
      // Pick the saboteur once, at start
      const hgs = active();
      if (!hgs.length) return;
      const sab = rand(hgs);
      game.seasonState = game.seasonState || {};
      game.seasonState.saboteurName = sab.name;
    },
    weeklyTick(week) {
      const sabName = game.seasonState && game.seasonState.saboteurName;
      const sab = sabName ? byName(sabName) : null;
      // If saboteur is evicted, twist self-terminates (handled by planner)
      if (!sab || sab.status === 'evicted') return;
      const hgs = active().filter(h => h.name !== sabName);
      if (hgs.length < 2) return;
      for (let i = 0; i < Math.min(3, Math.floor(hgs.length / 2)); i++) {
        const [a, b] = shuffle(hgs).slice(0, 2);
        if (!a || !b || a.name === b.name) continue;
        a.relationships[b.name] = Math.max(0, (a.relationships[b.name] || 50) - 12);
        b.relationships[a.name] = Math.max(0, (b.relationships[a.name] || 50) - 12);
      }
      log(`🃏 The Saboteur strikes again. Paranoia spreads through the house.`, 'social');
    },
    onEnd(week) {
      const sabName = game.seasonState && game.seasonState.saboteurName;
      if (sabName) {
        log(`🃏 The Saboteur was ${sabName}. Their identity is revealed.`, 'social');
      }
    },
  },
  // FUTURE WORK: deepen the Coaches twist. Currently it's a light-touch
  // multi-week mechanic (small relationship boosts among "veterans" + alliance
  // fracture on mutiny). The real BB14 setup involved actual team assignments,
  // a proper coach->houseguest power dynamic, and a player-vote mutiny moment.
  // Worth revisiting alongside All-Stars / themed-cast features later.
  coachesMutiny: {
    id: 'coachesMutiny',
    label: 'Coaches',
    icon: '🎓',
    season: 'BB14',
    info: 'BB14 began with four returning players acting as coaches to four teams of newbies. After ~4 weeks the coaches were given an option to mutiny and play as houseguests themselves. Three of the four took the deal.',
    desc: 'A returning-player dynamic shapes the early game; mid-season, dominant alliances fracture.',
    minPlayers: 8,
    weeks: 'early',
    mode: 'multi-week',
    realDuration: { min: 3, max: 5 },
    seasonAnchor: true,
    apply(week) {
      // Identify "coaches": top 1/4 of cast picked at random as veterans-style block.
      const hgs = active();
      const numCoaches = Math.max(2, Math.min(4, Math.floor(hgs.length / 4)));
      const coaches = shuffle(hgs).slice(0, numCoaches).map(h => h.name);
      game.seasonState = game.seasonState || {};
      game.seasonState.coaches = coaches;
      log(`🎓 The Coaches twist begins: ${coaches.join(', ')} are the season's veterans.`, 'social');
    },
    weeklyTick(week) {
      // Coaches build small relationship boosts amongst themselves
      const coaches = (game.seasonState && game.seasonState.coaches) || [];
      coaches.forEach(c1 => {
        coaches.forEach(c2 => {
          if (c1 === c2) return;
          const a = byName(c1); const b = byName(c2);
          if (!a || !b || a.status === 'evicted' || b.status === 'evicted') return;
          a.relationships[b.name] = Math.min(100, (a.relationships[b.name] || 50) + 3);
        });
      });
    },
    onEnd(week) {
      // Mutiny: largest active alliance fractures
      const alliances = (game.alliances || []).filter(a => a.status === 'active');
      if (alliances.length) {
        const biggest = alliances.sort((a, b) => b.members.length - a.members.length)[0];
        biggest.cohesion = Math.max(20, biggest.cohesion - 35);
        if (biggest.cohesion < 35) biggest.status = 'fractured';
        log(`🎓 The Coaches Mutiny fractures ${biggest.name}!`, 'social');
      } else {
        log(`🎓 The Coaches Mutiny shakes up the house. The veterans are now full players.`, 'social');
      }
    },
  },
  secretPower: {
    id: 'secretPower',
    label: 'Secret Power',
    icon: '🔮',
    season: 'BB22+',
    info: 'A pre-game secret power gifted to one houseguest, usable once at their discretion. A modern recurring trope.',
    desc: 'A houseguest holds a secret one-shot safety power, usable at this week\'s eviction.',
    minPlayers: 6,
    weeks: 'any',
    mode: 'oneshot',
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      const candidates = active().filter(h => h.name !== game.hoh && !game.nominees.includes(h.name));
      if (!candidates.length) return;
      const wielder = rand(candidates);
      game.weekFlags.bbComicsHolder = wielder.name;
      log(`🔮 TWIST: A houseguest has played a secret pre-game power. They are safe this week.`, 'safe');
    },
  },

  // ─── VOTE TWISTS ───
  americasVote: {
    id: 'americasVote',
    label: "America's Vote",
    icon: '🇺🇸',
    season: "BB8 (America's Player)",
    info: "Inspired by Big Brother 8's America's Player and recurring viewer-vote elements. America casts an extra weighted vote at eviction.",
    desc: "America casts an extra vote at this week's eviction, weighted toward the least-liked nominee.",
    minPlayers: 6,
    weeks: 'any',
    mode: 'oneshot',
    apply(week) {
      game.weekFlags = game.weekFlags || {};
      game.weekFlags.americasVote = true;
      log(`🇺🇸 TWIST: America gets an extra vote at this week's eviction.`, 'evict');
    },
  },
};

// ── Planner: pick a small schedule of twists for the season ──
function planTwists() {
  game.twistSchedule = {};   // week -> [twistId]  (one-shots only)
  game.seasonTwists = [];    // active multi-week twists with weeksRemaining
  game.seasonState  = {};    // arbitrary per-twist persistent data
  game.twistsApplied = [];   // history of all twist firings

  const mode = getTwistMode();
  if (mode === 'off') return;

  const persistence = getTwistPersistence();
  const theme = getSeasonTheme();
  const totalCap = mode === 'chaos' ? 4 : 2;

  const cast = game.houseguests.length;
  const eligible = Object.values(TWIST_DEFS).filter(t => cast >= t.minPlayers);

  const totalWeeks = Math.max(2, cast - 3);
  const startWeek  = 2;
  const endWeek    = Math.max(startWeek, totalWeeks - 1);

  // Helpers
  const oneshotPool = () => shuffle(eligible.filter(t => t.mode === 'oneshot'));
  const anchorPool  = () => shuffle(eligible.filter(t => t.seasonAnchor));
  const collapseToOneshot = persistence === 'oneweek';

  // ── Themed mode: pick one anchor and run it ──
  if (theme === 'themed') {
    const anchors = anchorPool();
    if (anchors.length) {
      const anchor = anchors[0];
      if (anchor.mode === 'multi-week' && !collapseToOneshot) {
        scheduleMultiWeek(anchor, 1, persistence, totalWeeks);
      } else {
        // collapse: schedule as a single mid-season firing
        const w = Math.max(startWeek, Math.min(endWeek, Math.floor((startWeek + endWeek) / 2)));
        if (!game.twistSchedule[w]) game.twistSchedule[w] = [];
        game.twistSchedule[w].push(anchor.id);
      }
      // Sprinkle one optional one-shot later in the season
      if (mode === 'chaos' || Math.random() < 0.5) {
        const sp = oneshotPool().filter(t => t.id !== anchor.id);
        const safeStart = Math.max(startWeek, anchor.mode === 'multi-week' ? Math.floor(totalWeeks / 2) : startWeek);
        if (sp.length) scheduleOneshot(sp[0], safeStart, endWeek);
      }
    }
    return;
  }

  // ── Vanilla mode: only one-shot powers, no anchors ──
  if (theme === 'vanilla') {
    const sp = oneshotPool();
    let count = 0;
    while (count < totalCap && sp.length) {
      const t = sp.shift();
      if (t.rare && Math.random() > 0.5) continue;
      if (scheduleOneshot(t, startWeek, endWeek)) count++;
    }
    return;
  }

  // ── Random mode (default): mix of anchors + one-shots, totalCap honored ──
  const usedAnchor = collapseToOneshot ? null : (Math.random() < (mode === 'chaos' ? 0.7 : 0.4) ? anchorPool()[0] : null);
  let remaining = totalCap;

  if (usedAnchor) {
    scheduleMultiWeek(usedAnchor, 1, persistence, totalWeeks);
    remaining--;  // counts toward cap
  }

  // Fill remaining with one-shots
  const sp = oneshotPool().filter(t => !usedAnchor || t.id !== usedAnchor.id);
  let attempts = 0;
  while (remaining > 0 && attempts < 25 && sp.length) {
    attempts++;
    const t = sp.shift();
    if (!t) break;
    if (t.rare && Math.random() > 0.5) continue;
    if (scheduleOneshot(t, startWeek, endWeek)) remaining--;
  }

  // Multi-week random: occasionally pick a non-anchor multi-week as a sprinkle
  if (!usedAnchor && !collapseToOneshot && remaining > 0 && Math.random() < 0.3) {
    const mw = shuffle(eligible.filter(t => t.mode === 'multi-week' && !t.seasonAnchor));
    if (mw.length) scheduleMultiWeek(mw[0], Math.max(2, Math.floor(totalWeeks / 3)), persistence, totalWeeks);
  }
}

// ── Schedule a one-shot at a random eligible week, biased by 'weeks' tag ──
function scheduleOneshot(twist, startWeek, endWeek) {
  const totalWeeks = endWeek - startWeek + 1 + 2; // approximate full season
  const choices = [];
  for (let w = startWeek; w <= endWeek; w++) {
    const midpoint = (startWeek + endWeek) / 2;
    if (twist.weeks === 'mid'  && Math.abs(w - midpoint) > totalWeeks * 0.35) continue;
    if (twist.weeks === 'late' && w < midpoint) continue;
    if (twist.weeks === 'early' && w > midpoint) continue;
    if (game.twistSchedule[w] && game.twistSchedule[w].length >= 2) continue;
    choices.push(w);
  }
  if (!choices.length) return false;
  const w = rand(choices);
  if (!game.twistSchedule[w]) game.twistSchedule[w] = [];
  game.twistSchedule[w].push(twist.id);
  return true;
}

// ── Schedule a multi-week twist starting at startWeek ──
function scheduleMultiWeek(twist, startWeek, persistence, seasonLength) {
  const dur = twist.realDuration || { min: 3, max: 5 };
  let duration;
  if (persistence === 'longform') {
    duration = dur.max;
  } else {
    // realistic: random within range, but never longer than season minus 2 weeks
    duration = dur.min + Math.floor(Math.random() * (dur.max - dur.min + 1));
  }
  duration = Math.min(duration, Math.max(2, seasonLength - 2));
  game.seasonTwists.push({
    id: twist.id,
    startWeek,
    duration,
    weeksRemaining: duration,
  });
  // Run the twist's apply() once, at start (for anchor setup)
  try { twist.apply(startWeek); } catch (e) { console.error('Anchor apply failed:', twist.id, e); }
  game.twistsApplied.push({ id: twist.id, week: startWeek, label: twist.label, icon: twist.icon, multi: true, duration });
}

// ── Hooks ──
function onWeekStart(week) {
  // 1. Tick active multi-week twists
  if (game.seasonTwists && game.seasonTwists.length) {
    const stillActive = [];
    for (const st of game.seasonTwists) {
      const def = TWIST_DEFS[st.id];
      if (!def) continue;

      // Saboteur self-terminates if their HG was evicted
      if (st.id === 'saboteur' && game.seasonState && game.seasonState.saboteurName) {
        const sab = byName(game.seasonState.saboteurName);
        if (sab && sab.status === 'evicted') {
          try { def.onEnd && def.onEnd(week); } catch (e) {}
          continue;
        }
      }

      try { def.weeklyTick && def.weeklyTick(week); } catch (e) { console.error('Tick failed:', st.id, e); }

      st.weeksRemaining--;
      if (st.weeksRemaining > 0) {
        stillActive.push(st);
      } else {
        try { def.onEnd && def.onEnd(week); } catch (e) {}
      }
    }
    game.seasonTwists = stillActive;
  }

  // 2. Fire any one-shot twists scheduled for this week
  if (game.twistSchedule) {
    const ids = game.twistSchedule[week] || [];
    ids.forEach(id => {
      const def = TWIST_DEFS[id];
      if (!def) return;
      try { def.apply(week); } catch (e) { console.error('Twist failed:', id, e); }
      game.twistsApplied = game.twistsApplied || [];
      game.twistsApplied.push({ id, week, label: def.label, icon: def.icon });
      game.currentWeekHistory = game.currentWeekHistory || [];
      game.currentWeekHistory.push(`${def.icon} ${def.label}`);
    });
  }
}

// Used by top-bar UI — shows active multi-week twists AND this week's one-shots
function getActiveTwistBanner() {
  if (!game || !getTwistPreview()) return null;
  const parts = [];
  if (game.seasonTwists) {
    for (const st of game.seasonTwists) {
      const def = TWIST_DEFS[st.id];
      if (!def) continue;
      const wkNum = st.duration - st.weeksRemaining + 1;
      parts.push(`${def.icon} ${def.label} · Wk ${wkNum}/${st.duration}`);
    }
  }
  if (game.twistSchedule) {
    const ids = game.twistSchedule[game.week] || [];
    ids.forEach(id => {
      const def = TWIST_DEFS[id];
      if (def) parts.push(`${def.icon} ${def.label}`);
    });
  }
  return parts.length ? parts.join(' • ') : null;
}

// Returns array of currently-active twist defs (for the info modal)
function getActiveTwistDefs() {
  const out = [];
  if (game && game.seasonTwists) {
    for (const st of game.seasonTwists) {
      const def = TWIST_DEFS[st.id];
      if (def) out.push({ def, weeksRemaining: st.weeksRemaining, duration: st.duration });
    }
  }
  if (game && game.twistSchedule) {
    const ids = game.twistSchedule[game.week] || [];
    ids.forEach(id => {
      const def = TWIST_DEFS[id];
      if (def) out.push({ def });
    });
  }
  return out;
}

// ── Twist info modal: opened by clicking the banner ──
function openTwistInfo() {
  if (!game) return;
  const actives = getActiveTwistDefs();
  if (!actives.length) return;

  const body = document.getElementById('twistInfoBody');
  body.innerHTML = actives.map(({ def, weeksRemaining, duration }) => {
    const durationLine = (weeksRemaining != null)
      ? `<div class="twist-info-duration">Week ${duration - weeksRemaining + 1} of ${duration} · ${weeksRemaining} ${weeksRemaining === 1 ? 'week' : 'weeks'} remaining</div>`
      : '';
    return `
      <div class="twist-info-card">
        <div class="twist-info-header">
          <span class="twist-info-icon">${def.icon}</span>
          <div>
            <div class="twist-info-name">${def.label}</div>
            <div class="twist-info-season">${def.season || '—'}</div>
            ${durationLine}
          </div>
        </div>
        <div class="twist-info-section">
          <div class="twist-info-section-label">Origin</div>
          <div class="twist-info-text">${def.info || '—'}</div>
        </div>
        <div class="twist-info-section">
          <div class="twist-info-section-label">In your season</div>
          <div class="twist-info-text">${def.desc || '—'}</div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('twistInfoModal').classList.add('open');
}

function closeTwistInfo() {
  document.getElementById('twistInfoModal').classList.remove('open');
}

// ── AI Arena / MVP resolution: third nominee competes and is saved ──
function resolveAIArena() {
  const wf = game.weekFlags || {};
  const isArena = wf.aiArena || wf.mvpThirdNom;
  if (!isArena) return;
  if (game.nominees.length < 3) return;
  const noms = game.nominees.map(n => byName(n)).filter(Boolean);
  const winner = noms.sort((a, b) =>
    ((b.wins.hoh + b.wins.veto) * 10 + Math.random()) -
    ((a.wins.hoh + a.wins.veto) * 10)
  )[0];
  if (!winner) return;
  game.nominees = game.nominees.filter(n => n !== winner.name);
  log(`🤖 ${winner.name} won the ${wf.aiArena ? 'AI Arena' : 'MVP showdown'} and is safe from eviction!`, 'safe');
  delete wf.aiArena;
  delete wf.mvpThirdNom;
}

// ── Safety power: a power-holder, if on the block, gets pulled ──
function consumeSafetyPower() {
  const wf = game.weekFlags || {};
  if (!wf.bbComicsHolder) return;
  const holder = wf.bbComicsHolder;
  if (game.nominees.includes(holder)) {
    game.nominees = game.nominees.filter(n => n !== holder);
    log(`🦸 ${holder} reveals a secret power and is safe from this week's eviction!`, 'safe');
    if (game.nominees.length === 1) {
      const pool = active().filter(h =>
        h.name !== game.hoh && !game.nominees.includes(h.name) && h.name !== holder
      );
      if (pool.length) {
        const hoh = byName(game.hoh);
        const replacement = pool.map(h => ({ hg: h, score: threatScore(hoh, h) }))
                                .sort((a, b) => b.score - a.score)[0].hg;
        game.nominees.push(replacement.name);
        replacement.timesNominated = (replacement.timesNominated || 0) + 1;
        log(`🎯 ${replacement.name} has been named as a replacement nominee.`, 'nom');
      }
    }
  }
  delete wf.bbComicsHolder;
}

// ── Coup hook: called from eviction; replaces nominees if armed ──
function maybeFireCoup() {
  if (!game.weekFlags || !game.weekFlags.coupWielder) return;
  const wielder = byName(game.weekFlags.coupWielder);
  if (!wielder || wielder.status === 'evicted') {
    delete game.weekFlags.coupWielder;
    return;
  }
  // Pick two new nominees (not wielder, not HOH, not currently nominated)
  const pool = active().filter(h =>
    h.name !== wielder.name &&
    h.name !== game.hoh &&
    !game.nominees.includes(h.name)
  );
  if (pool.length < 2) { delete game.weekFlags.coupWielder; return; }
  const [n1, n2] = shuffle(pool).slice(0, 2);
  log(`🗡️ ${wielder.name} reveals a Coup d'État! New nominees: ${n1.name} and ${n2.name}.`, 'nom');
  game.nominees = [n1.name, n2.name];
  n1.timesNominated = (n1.timesNominated || 0) + 1;
  n2.timesNominated = (n2.timesNominated || 0) + 1;
  delete game.weekFlags.coupWielder;
}

// ── Battle Back hook: called when first juror is sent home ──
function maybeFireBattleBack(evictedName) {
  if (!game.weekFlags || !game.weekFlags.battleBackArmed) return;
  // Only triggers when this is the first juror being sent.
  const isFirstJuror = game.jury.length === 1 && game.jury[0] === evictedName;
  if (!isFirstJuror) return;
  delete game.weekFlags.battleBackArmed;

  // 50% chance the battle back succeeds
  if (Math.random() < 0.5) {
    const hg = byName(evictedName);
    if (!hg) return;
    hg.status = 'active';
    game.evicted = game.evicted.filter(e => e.name !== evictedName);
    game.jury = game.jury.filter(n => n !== evictedName);
    // Slight cooling on relationships — they were gone for a beat
    Object.keys(hg.relationships).forEach(k => {
      hg.relationships[k] = (hg.relationships[k] + 50) / 2;
    });
    log(`🔁 ${evictedName} won the Battle Back and has returned to the house!`, 'safe');
  } else {
    log(`🔁 The Battle Back competition has concluded — ${evictedName} did not return.`, 'evict');
  }
}


function active() { return game.houseguests.filter(h => h.status !== 'evicted'); }
function byName(name) { return game.houseguests.find(h => h.name === name); }

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedRand(arr, weights) {
  let total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function log(msg, type = '') {
  const el = document.getElementById('eventLog');
  const li = document.createElement('li');
  li.className = `log-entry ${type}`;
  li.textContent = msg;
  el.prepend(li);
  game.currentWeekHistory.push(msg);
}

function setPhase(phase) {
  game.phase = phase;
  ['hoh', 'nom', 'veto', 'evict'].forEach(p => {
    document.getElementById(`phase-${p}`)?.classList.remove('active', 'done');
  });
  const order = ['hoh', 'nom', 'veto', 'evict'];
  const idx = order.indexOf(phase);
  order.forEach((p, i) => {
    const el = document.getElementById(`phase-${p}`);
    if (!el) return;
    if (i < idx) el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });
  // Persist progress at every phase boundary (skip during resume re-entry,
  // which would just rewrite the same state we're loading).
  if (!game._resuming) saveGameState();
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderHGGrid() {
  const grid = document.getElementById('hgGrid');
  grid.innerHTML = game.houseguests.map(hg => {
    if (hg.status === 'evicted') return '';
    let cls = '';
    let statusText = '';
    if (hg.name === game.hoh) { cls = 'hoh'; statusText = '👑 HoH'; }
    else if (game.nominees.includes(hg.name)) { cls = 'nominated'; statusText = '🎯 Nom'; }
    else if (hg.name === game.vetoHolder) { cls = 'veto-holder'; statusText = '⚡ Veto'; }

    const allyCount = (hg.allies || []).length;
    const enemyCount = (hg.enemies || []).length;
    let relBadge = '';
    if (allyCount > 0 && enemyCount === 0) relBadge = `<div class="hg-rel-badge" style="color:var(--safe)">🤝${allyCount}</div>`;
    else if (enemyCount > 0 && allyCount === 0) relBadge = `<div class="hg-rel-badge" style="color:var(--red)">⚔️${enemyCount}</div>`;
    else if (allyCount > 0 && enemyCount > 0) relBadge = `<div class="hg-rel-badge" style="color:var(--gold)">🤝${allyCount}/⚔️${enemyCount}</div>`;

    const inAlliance = game.alliances && game.alliances.some(a =>
      a.status === 'active' && a.members.includes(hg.name)
    );

    return `<div class="hg-card ${cls} ${inAlliance ? 'in-alliance' : ''}" onclick="openHGModal('${hg.name.replace(/'/g, "\\'")}')">
      ${relBadge}
      <div class="hg-avatar">${getInitials(hg.name)}</div>
      <div class="hg-name">${hg.name}</div>
      <div class="hg-status">${statusText || '—'}</div>
      <div class="hg-stats">
        <span class="hg-stat-chip hoh-stat ${(hg.wins.hoh||0)===0?'zero':''}" title="HOH wins">👑 ${hg.wins.hoh||0}</span>
        <span class="hg-stat-chip veto-stat ${(hg.wins.veto||0)===0?'zero':''}" title="Veto wins">⚡ ${hg.wins.veto||0}</span>
        <span class="hg-stat-chip nom-stat ${(hg.timesNominated||0)===0?'zero':''}" title="Times nominated">🎯 ${hg.timesNominated||0}</span>
      </div>
    </div>`;
  }).join('');
}

function renderEvicted() {
  const el = document.getElementById('evictedList');
  el.innerHTML = game.evicted.map(e => `
    <div class="evicted-chip ${e.jury ? 'jury' : ''}">
      ${e.jury ? '⚖️' : '🚪'} ${e.name}
    </div>
  `).join('') || '<span style="font-size:13px;color:var(--muted)">None yet</span>';
}

function renderStats() {
  const el = document.getElementById('statsPanel');
  const actives = active();
  el.innerHTML = `
    <div>Remaining: <b>${actives.length}</b></div>
    <div>Jury size: <b>${game.jurySize}</b></div>
    <div>Jury members: <b>${game.jury.length}</b></div>
  `;
}

function renderAll() {
  document.getElementById('hohDisplay').textContent = game.hoh || '—';
  document.getElementById('weekDisplay').textContent = game.week;
  const banner = document.getElementById('twistBanner');
  if (banner) {
    const txt = getActiveTwistBanner();
    if (txt) {
      banner.textContent = `🌀 ${txt}`;
      banner.style.display = '';
    } else {
      banner.style.display = 'none';
    }
  }
  renderHGGrid();
  renderEvicted();
  renderStats();
  // Frequent autosave: renderAll runs after most state changes
  // (HOH chosen, noms confirmed, eviction processed, etc.).
  if (game && !game._resuming) saveGameState();
}

// ══════════════════════════════════════
//  GRUDGE / MEMORY SYSTEM
// ══════════════════════════════════════

function addGrudge(targetName, aggressorName, severity) {
  const target = byName(targetName);
  const aggressor = byName(aggressorName);
  if (!target || !aggressor) return;

  const penalties = { nom: 28, renom: 38, vote: 12, publicTarget: 8 };
  const penalty = penalties[severity] || 10;

  target.relationships[aggressorName] = Math.max(0, (target.relationships[aggressorName] || 50) - penalty);
  target.grudges[aggressorName] = (target.grudges[aggressorName] || 0) + penalty;

  if (severity === 'nom' || severity === 'renom') {
    if (!target.nominatedBy.includes(aggressorName)) {
      target.nominatedBy.push(aggressorName);
    }
  }
}

function threatScore(hoh, candidate) {
  const rel = hoh.relationships[candidate.name] || 50;
  const dislike = 100 - rel;
  const theirGrudgeAgainstMe = candidate.grudges[hoh.name] || 0;
  const compThreat = (candidate.wins.hoh + candidate.wins.veto) * 4;
  return dislike + theirGrudgeAgainstMe * 0.5 + compThreat + allianceNomProtection(hoh, candidate) + (Math.random() * 15);
}

// ══════════════════════════════════════
//  SOCIAL ENCOUNTERS ENGINE
// ══════════════════════════════════════

const ENCOUNTER_TEMPLATES = {
  positive: [
    { icon:'☕', text:'{A} and {B} stayed up late talking — they feel understood.', delta:12 },
    { icon:'🤝', text:'{A} stuck up for {B} during a house argument. Major trust built.', delta:18 },
    { icon:'😂', text:'{A} and {B} bonded over mocking the same houseguest. Classic BB.', delta:10 },
    { icon:'🏋️', text:'{A} and {B} worked out together and made a final-2 deal.', delta:20 },
    { icon:'🎮', text:'{B} coached {A} on competition strategy — {A} is grateful.', delta:14 },
    { icon:'🍕', text:'{A} cooked for {B}, who was on slop. Instant loyalty.', delta:16 },
    { icon:'🤫', text:'{A} told {B} a secret they haven\'t shared with anyone else.', delta:22 },
    { icon:'🛡️', text:'{A} defended {B}\'s game to other houseguests.', delta:15 },
    { icon:'🌙', text:'{A} and {B} had a long heart-to-heart. Real connection formed.', delta:17 },
    { icon:'🎯', text:'{B} revealed their target to {A}, cementing their alliance.', delta:19 },
  ],
  negative: [
    { icon:'🗣️', text:'{A} was caught telling {B}\'s secret to the rest of the house.', delta:-18 },
    { icon:'😤', text:'{A} blew up on {B} during a house meeting. Things got heated.', delta:-16 },
    { icon:'🕵️', text:'{B} found out {A} was campaigning against them behind their back.', delta:-20 },
    { icon:'🍽️', text:'{A} ate {B}\'s food without asking. It\'s the little things in the house.', delta:-8 },
    { icon:'🤥', text:'{B} caught {A} in a flat-out lie. Trust is shattered.', delta:-22 },
    { icon:'🎭', text:'{A} was talking game with {B}\'s enemies right in front of them.', delta:-14 },
    { icon:'😒', text:'{A} made a snide remark about {B}\'s gameplay. Word got back.', delta:-12 },
    { icon:'💢', text:'{A} broke a promise they made to {B} last week.', delta:-19 },
    { icon:'👀', text:'{B} saw {A} whispering with the HOH right after noms were set.', delta:-15 },
    { icon:'🧂', text:'{A} threw {B} under the bus to save their own game.', delta:-17 },
  ],
  neutral: [
    { icon:'🃏', text:'{A} and {B} played cards. Mostly just killing time.', delta:2 },
    { icon:'📺', text:'{A} and {B} watched the memory wall together, reading the room.', delta:3 },
    { icon:'🌤️', text:'{A} and {B} sat in the backyard. Kept it surface-level.', delta:1 },
    { icon:'💬', text:'{A} checked in with {B} about the vote — both stayed vague.', delta:2 },
  ],
};

function generateEncounters(count = 4) {
  const hgs = active();
  if (hgs.length < 2) return [];

  const pairs = new Set();
  const encounters = [];

  for (let attempt = 0; attempt < count * 3 && encounters.length < count; attempt++) {
    const a = rand(hgs);
    const b = rand(hgs.filter(h => h.name !== a.name));
    const pairKey = [a.name, b.name].sort().join('|');
    if (pairs.has(pairKey)) continue;
    pairs.add(pairKey);

    const currentRel = a.relationships[b.name] || 50;
    const posWeight = 0.3 + (currentRel / 100) * 0.5;
    const negWeight = 0.6 - (currentRel / 100) * 0.5;
    const roll = Math.random();
    let type;
    if (roll < posWeight) type = 'positive';
    else if (roll < posWeight + negWeight) type = 'negative';
    else type = 'neutral';

    const template = rand(ENCOUNTER_TEMPLATES[type]);
    const text = template.text.replace(/{A}/g, a.name).replace(/{B}/g, b.name);
    const delta = template.delta + Math.round((Math.random() - 0.5) * 4);
    applyRelationshipDelta(a, b, delta, type);

    encounters.push({ a: a.name, b: b.name, icon: template.icon, text, delta, type });
  }

  return encounters;
}

function applyRelationshipDelta(hgA, hgB, delta, type) {
  hgA.relationships[hgB.name] = Math.min(100, Math.max(0, (hgA.relationships[hgB.name] || 50) + delta));
  hgB.relationships[hgA.name] = Math.min(100, Math.max(0, (hgB.relationships[hgA.name] || 50) + delta));

  if (delta < 0) {
    const grudgePenalty = Math.abs(delta) * 0.4;
    hgA.grudges[hgB.name] = (hgA.grudges[hgB.name] || 0) + grudgePenalty;
    hgB.grudges[hgA.name] = (hgB.grudges[hgA.name] || 0) + grudgePenalty;
  }

  if (delta > 10) {
    hgA.grudges[hgB.name] = Math.max(0, (hgA.grudges[hgB.name] || 0) - delta * 0.2);
    hgB.grudges[hgA.name] = Math.max(0, (hgB.grudges[hgA.name] || 0) - delta * 0.2);
  }

  setRelStatus(hgA, hgB);
  setRelStatus(hgB, hgA);
}

function setRelStatus(hg, other) {
  const rel = hg.relationships[other.name] || 50;
  if (rel >= 75) {
    if (!hg.allies) hg.allies = [];
    if (!hg.allies.includes(other.name)) hg.allies.push(other.name);
    hg.enemies = (hg.enemies || []).filter(n => n !== other.name);
  } else if (rel <= 25) {
    if (!hg.enemies) hg.enemies = [];
    if (!hg.enemies.includes(other.name)) hg.enemies.push(other.name);
    hg.allies = (hg.allies || []).filter(n => n !== other.name);
  } else {
    hg.allies = (hg.allies || []).filter(n => n !== other.name);
    hg.enemies = (hg.enemies || []).filter(n => n !== other.name);
  }
}

function runSocialEncounters() {
  const cap = getEncounterCap();
  if (cap === 0) return;
  const count = Math.min(active().length - 1, cap);
  const encounters = generateEncounters(count);
  if (!encounters.length) return;

  encounters.slice(0, 2).forEach(e => {
    const sentiment = e.type === 'positive' ? '💚' : e.type === 'negative' ? '🔴' : '—';
    log(`${sentiment} ${e.text}`, 'social');
  });

  const existing = document.getElementById('encounterStrip');
  if (existing) existing.remove();

  const strip = document.createElement('div');
  strip.id = 'encounterStrip';
  strip.className = 'encounter-strip';
  strip.innerHTML = `
    <div class="encounter-strip-title">🏠 House Social Activity</div>
    <div class="encounter-cards" id="encounterCards">
      ${encounters.map(e => `
        <div class="encounter-entry ${e.type}">
          <span class="encounter-icon">${e.icon}</span>
          <span class="encounter-text"><b>${e.a}</b> &amp; <b>${e.b}</b> — ${e.text.replace(e.a, '').replace(e.b, '').replace('  ', ' ').trim()}</span>
          <span class="encounter-delta ${e.delta >= 0 ? 'pos' : 'neg'}">${e.delta >= 0 ? '+' : ''}${e.delta}</span>
        </div>
      `).join('')}
    </div>
    ${renderTopRelationships()}
  `;

  const gameGrid = document.querySelector('.game-grid');
  if (gameGrid) {
    gameGrid.insertAdjacentElement('afterend', strip);
  }
}

function renderTopRelationships() {
  const hgs = active();
  if (hgs.length < 2) return '';

  const allPairs = [];
  const seen = new Set();
  hgs.forEach(a => {
    hgs.forEach(b => {
      if (a.name === b.name) return;
      const key = [a.name, b.name].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      const rel = (a.relationships[b.name] || 50 + b.relationships[a.name] || 50) / 2;
      allPairs.push({ a: a.name, b: b.name, rel });
    });
  });

  allPairs.sort((x, y) => y.rel - x.rel);
  const topAllies = allPairs.slice(0, 2);
  const topEnemies = [...allPairs].sort((x, y) => x.rel - y.rel).slice(0, 2);

  const renderPair = (pair, isAlly) => {
    const pct = Math.round(pair.rel);
    const cls = isAlly ? 'ally' : 'enemy';
    return `
      <div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
          <span style="color:var(--text)">${pair.a} &amp; ${pair.b}</span>
          <span style="color:var(--muted)">${pct}</span>
        </div>
        <div class="rel-bar-bg"><div class="rel-bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>
    `;
  };

  return `
    <div class="rel-meter-wrap" style="flex-direction:column;align-items:stretch;gap:0">
      <div style="font-family:'Oswald',sans-serif;font-size:9px;letter-spacing:4px;color:var(--safe);margin-bottom:8px;text-transform:uppercase">Top Allies</div>
      ${topAllies.map(p => renderPair(p, true)).join('')}
      <div style="font-family:'Oswald',sans-serif;font-size:9px;letter-spacing:4px;color:var(--red);margin:10px 0 8px;text-transform:uppercase">Top Enemies</div>
      ${topEnemies.map(p => renderPair(p, false)).join('')}
    </div>
  `;
}

// ══════════════════════════════════════
//  ALLIANCE SYSTEM
// ══════════════════════════════════════

const ALLIANCE_NAMES = [
  'The Shield','The Cookout','The Renegades','The Outsiders',
  'The Sovereigns','The Six','The Core Four','The Bomb Squad',
  'The Detonators','The Specialists','The Round Table','The Collective',
  'The Underground','The Syndicate','Midnight Alliance','The Wolves',
  'The Vanguard','Double Trouble','The Trio','The Old Guard',
];

function tryFormAlliances() {
  if (!game.alliances) game.alliances = [];

  const hgs = active();
  if (hgs.length < 2) return;

  const maxAlliances = Math.floor(hgs.length / 3);
  const activeAlliances = game.alliances.filter(a => a.status === 'active');
  if (activeAlliances.length >= maxAlliances) return;

  for (let attempt = 0; attempt < 8; attempt++) {
    const seed = rand(hgs);

    const potentialMembers = hgs
      .filter(h => h.name !== seed.name)
      .map(h => ({ hg: h, rel: seed.relationships[h.name] || 50 }))
      .filter(x => x.rel >= 65)
      .sort((a, b) => b.rel - a.rel);

    if (potentialMembers.length < 1) continue;

    const size = Math.min(4, 2 + Math.floor(Math.random() * 3));
    const memberHGs = [seed, ...potentialMembers.slice(0, size - 1).map(x => x.hg)];
    const memberNames = memberHGs.map(h => h.name).sort();

    const duplicate = game.alliances.some(a => {
      const overlap = a.members.filter(m => memberNames.includes(m)).length;
      return overlap >= memberNames.length - 1 && a.status === 'active';
    });
    if (duplicate) continue;

    let cohesionSum = 0;
    let pairs = 0;
    let allMutual = true;
    for (let i = 0; i < memberHGs.length; i++) {
      for (let j = i + 1; j < memberHGs.length; j++) {
        const r = memberHGs[i].relationships[memberHGs[j].name] || 50;
        cohesionSum += r;
        pairs++;
        if (r < 55) { allMutual = false; break; }
      }
      if (!allMutual) break;
    }
    if (!allMutual) continue;

    const cohesion = pairs > 0 ? cohesionSum / pairs : 50;
    // Formation gate: base 0.55 chance, scaled by setting (rare/normal/common).
    const formChance = Math.min(0.95, 0.55 * getAllianceFormChance());
    if (cohesion < 65 || Math.random() > formChance) continue;

    const usedNames = game.alliances.map(a => a.name);
    const availableNames = ALLIANCE_NAMES.filter(n => !usedNames.includes(n));
    const allianceName = availableNames.length ? rand(availableNames) : `Alliance ${game.alliances.length + 1}`;

    const alliance = {
      id: Date.now() + Math.random(),
      name: allianceName,
      members: memberNames,
      formed: game.week,
      status: 'active',
      cohesion: Math.round(cohesion),
    };

    game.alliances.push(alliance);

    for (let i = 0; i < memberHGs.length; i++) {
      for (let j = i + 1; j < memberHGs.length; j++) {
        applyRelationshipDelta(memberHGs[i], memberHGs[j], 8, 'positive');
      }
    }

    log(`🤝 A new alliance has formed: ${allianceName} (${memberNames.join(', ')})`, 'safe');
    addDiaryEntry(seed.name, 'alliance-formed',
      `We just locked in ${allianceName}. If we stay loyal, we run this house.`, memberNames);

    break;
  }
}

function checkAllianceFractures() {
  if (!game.alliances) return;

  game.alliances.forEach(alliance => {
    if (alliance.status !== 'active') return;

    const activeMembers = alliance.members.filter(n => {
      const hg = byName(n);
      return hg && hg.status !== 'evicted';
    });

    if (activeMembers.length <= 1) {
      alliance.status = 'dissolved';
      return;
    }

    let total = 0, pairs = 0;
    for (let i = 0; i < activeMembers.length; i++) {
      for (let j = i + 1; j < activeMembers.length; j++) {
        const a = byName(activeMembers[i]);
        const b = byName(activeMembers[j]);
        if (a && b) {
          total += a.relationships[b.name] || 50;
          pairs++;
        }
      }
    }
    const newCohesion = pairs > 0 ? Math.round(total / pairs) : 50;
    alliance.cohesion = newCohesion;

    if (game.hoh && alliance.members.includes(game.hoh)) {
      const nominatedAlly = game.nominees.find(n => alliance.members.includes(n));
      if (nominatedAlly && alliance.status === 'active') {
        alliance.status = 'fractured';
        log(`💥 ${alliance.name} has FRACTURED — ${game.hoh} nominated their own ally ${nominatedAlly}!`, 'nom');
        addDiaryEntry(nominatedAlly, 'betrayal',
          `${game.hoh} put me on the block. Our alliance is dead to me.`);
      }
    }

    if (newCohesion < 40 && alliance.status === 'active' && Math.random() > 0.6) {
      alliance.status = 'fractured';
      log(`💥 ${alliance.name} has quietly fractured — too many internal tensions.`, 'social');
    }
  });
}

function allianceNomProtection(hoh, candidate) {
  if (!game.alliances) return 0;
  const shared = game.alliances.find(a =>
    a.status === 'active' &&
    a.members.includes(hoh.name) &&
    a.members.includes(candidate.name)
  );
  return shared ? -30 : 0;
}

function allianceVoteInfluence(voter, nom1, nom2) {
  if (!game.alliances) return null;
  const alliance = game.alliances.find(a =>
    a.status === 'active' && a.members.includes(voter.name)
  );
  if (!alliance) return null;

  let scoreAgainst1 = 0, scoreAgainst2 = 0;
  alliance.members.forEach(m => {
    if (m === voter.name) return;
    const ally = byName(m);
    if (!ally || ally.status === 'evicted') return;
    scoreAgainst1 += (100 - (ally.relationships[nom1] || 50));
    scoreAgainst2 += (100 - (ally.relationships[nom2] || 50));
  });

  if (Math.random() < 0.7) {
    return scoreAgainst1 > scoreAgainst2 ? nom1 : nom2;
  }
  return null;
}

function renderAlliancesPanel() {
  const el = document.getElementById('alliancesPanel');
  if (!el || !game.alliances || !game.alliances.length) {
    if (el) el.innerHTML = '';
    return;
  }

  // Hide dissolved alliances; sort active before fractured.
  const visible = game.alliances
    .filter(a => a.status !== 'dissolved')
    .sort((a, b) => {
      const order = { active: 0, fractured: 1 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

  if (!visible.length) { el.innerHTML = ''; return; }

  const activeCount = visible.filter(a => a.status === 'active').length;

  el.innerHTML = `
    <div class="collapsible-panel" style="margin-top:16px">
      <div class="collapsible-header" onclick="toggleCollapse('alliancesInner','alliancesChev')">
        <span>🤝 Alliances <span class="alliance-count-pill">${activeCount} active</span></span>
        <span id="alliancesChev">▾</span>
      </div>
      <div id="alliancesInner">
        <div class="alliance-list-v2">
          ${visible.map(a => {
            const isFractured = a.status === 'fractured';
            const isDominant  = a.status === 'active' && a.cohesion >= 80;
            const dotClass = isFractured ? 'fractured' : isDominant ? 'dominant' : 'active';

            const liveMembers = a.members.filter(m => {
              const hg = byName(m);
              return hg && hg.status !== 'evicted';
            });

            return `
              <div class="alliance-row ${isFractured ? 'fractured' : ''}">
                <span class="alliance-dot ${dotClass}"></span>
                <div class="alliance-row-body">
                  <div class="alliance-row-top">
                    <span class="alliance-name">${a.name}</span>
                    <span class="alliance-row-meta">${liveMembers.length}/${a.members.length}</span>
                  </div>
                  <div class="alliance-members">
                    ${a.members.map(m => {
                      const hg = byName(m);
                      const evicted = !hg || hg.status === 'evicted';
                      return `<span class="alliance-member-chip ${evicted ? 'evicted-member' : ''}">${m}</span>`;
                    }).join('')}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════
//  DIARY ROOM SYSTEM
// ══════════════════════════════════════

const DR_TEMPLATES = {
  'hoh-win': [
    `I've been waiting for this moment all season. This HOH changes everything for my game.`,
    `Nobody saw me coming. Now I'm running the house and I plan to make a big move.`,
    `I won HOH at exactly the right time. Time to put my game into overdrive.`,
    `This is MY week. I have a plan and I'm going to execute it perfectly.`,
    `Finally. I can breathe. And I can also make sure the people coming for me can't.`,
  ],
  'hoh-loss': [
    `I needed that HOH so bad. Now I have to lay low and hope I'm not the target.`,
    `My game is on the line this week and I don't have the power to protect myself.`,
    `I'm nervous. Without that HOH key, I'm vulnerable and I know it.`,
  ],
  'nominated': [
    `I'm on the block and I refuse to go home. I will fight for that veto with everything I have.`,
    `This is a gut punch. I thought we were good. Clearly I was wrong about this house.`,
    `Being nominated just lit a fire in me. I am NOT going home this week. Period.`,
    `I saw this coming but it still stings. Time to put on my game face.`,
    `They think I'm easy to beat. I'm going to make them regret that decision.`,
  ],
  'veto-win': [
    `Winning the veto was the most important thing I could do today. My game is saved.`,
    `I have the power now and I have to decide very carefully how to use it.`,
    `This veto changes the whole week. Now the real game begins.`,
    `I won when it mattered most. That's what champions do.`,
  ],
  'veto-loss': [
    `I needed that veto more than anyone in this house. Now my fate is in someone else's hands.`,
    `Not winning the veto is my nightmare. I have to work every angle to survive this week.`,
    `I played hard and it wasn't enough. I'm scared — and I don't scare easily.`,
  ],
  'saved-by-veto': [
    `I cannot believe they used the veto on me. I owe them everything in this game.`,
    `Getting pulled off the block — that's the best feeling in the world. New lease on life.`,
    `They saved me and I will not forget it. Loyalty is everything in this house.`,
  ],
  'eviction-survived': [
    `I survived the vote and I am FIRED UP. Whoever put me on the block, watch out.`,
    `I'm still here. They tried to get rid of me and they failed. Mistake.`,
    `Staying off the block next week is priority one. I have to rebuild and recalibrate.`,
  ],
  'betrayal': [
    `I can't believe they did that. I thought we had something real. This game just got personal.`,
    `My own alliance put me on the block. From here on, I'm playing for myself.`,
    `The mask has slipped. I see exactly who they are now and I will not forget this.`,
  ],
  'alliance-formed': [
    `We just locked in something special. If we stay loyal, we run this house.`,
    `The alliance is set. Now we just have to trust each other and execute the plan.`,
    `I feel so much better having real numbers on my side. This is how you win Big Brother.`,
    `I've found my people. Together we're going to do something no one sees coming.`,
  ],
  'jury-sent': [
    `Going to jury is bittersweet — I didn't make it to the end, but I get to decide who wins. And I have opinions.`,
    `I played my heart out. The jury vote is my last move in this game and I'm going to use it well.`,
    `I thought I had more time. But jury means I still have power — I'll use my vote wisely.`,
  ],
  'evicted': [
    `I gave this game everything I had. No regrets — this experience changed me.`,
    `I got outplayed. Simple as that. I'll own it.`,
    `The house made their decision. I'm proud of how I played.`,
  ],
};

function addDiaryEntry(hgName, context, override = null, tags = []) {
  if (getDiaryCap() === 0) return;
  if (!game.diaryRoom) game.diaryRoom = [];
  const templates = DR_TEMPLATES[context] || DR_TEMPLATES['hoh-loss'];
  const quote = override || rand(templates);
  game.diaryRoom.push({ hgName, context, quote, week: game.week, tags });
}

function generateDiaryEntries(event, data = {}) {
  const hgs = active();

  switch (event) {
    case 'hoh': {
      addDiaryEntry(data.hoh, 'hoh-win');
      const atRisk = hgs.filter(h => h.name !== data.hoh)
        .sort((a, b) => (b.grudges[data.hoh] || 0) - (a.grudges[data.hoh] || 0));
      if (atRisk[0]) addDiaryEntry(atRisk[0].name, 'hoh-loss');
      break;
    }
    case 'noms': {
      game.nominees.forEach(n => addDiaryEntry(n, 'nominated'));
      const hohHG = byName(game.hoh);
      if (hohHG) {
        const reason = getNomReason(hohHG, byName(game.nominees[0]));
        addDiaryEntry(game.hoh, 'hoh-win', `My nominations are set. ${reason} That's the game I'm playing.`);
      }
      break;
    }
    case 'veto': {
      addDiaryEntry(data.winner, 'veto-win');
      const losingNom = game.nominees.find(n => n !== data.winner);
      if (losingNom) addDiaryEntry(losingNom, 'veto-loss');
      break;
    }
    case 'veto-saved': {
      addDiaryEntry(data.saved, 'saved-by-veto');
      break;
    }
    case 'eviction': {
      const survivor = game.nominees.find(n => n !== data.evicted);
      if (survivor) addDiaryEntry(survivor, 'eviction-survived');
      addDiaryEntry(data.evicted, data.jury ? 'jury-sent' : 'evicted');
      break;
    }
  }

  renderDiaryRoomPanel();
}

function renderDiaryRoomPanel() {
  const el = document.getElementById('diaryRoomPanel');
  if (!el || !game.diaryRoom) return;

  const cap = getDiaryCap();
  if (cap === 0) { el.innerHTML = ''; return; }
  const weekEntries = [...game.diaryRoom]
    .filter(e => e.week === game.week)
    .reverse()
    .slice(0, Math.min(cap, 5));

  if (!weekEntries.length) { el.innerHTML = ''; return; }

  const contextLabels = {
    'hoh-win': 'After HOH Win',
    'hoh-loss': 'Pre-Nominations',
    'nominated': 'After Nominations',
    'veto-win': 'After Veto Win',
    'veto-loss': 'After Veto Competition',
    'saved-by-veto': 'After Veto Ceremony',
    'eviction-survived': 'After Live Eviction',
    'betrayal': 'After Betrayal',
    'alliance-formed': 'After Alliance Formed',
    'jury-sent': 'Heading to Jury',
    'evicted': 'Final Words',
  };

  el.innerHTML = `
    <div class="collapsible-panel" style="margin-top:16px;border-top-color:#9b59b6">
      <div class="collapsible-header" onclick="toggleCollapse('diaryInner','diaryChev')" style="color:#c39bd3">
        <span>🎙️ Diary Room — Week ${game.week}</span>
        <span id="diaryChev">▾</span>
      </div>
      <div id="diaryInner">
        <div class="diary-entries" style="padding:14px 20px 12px">
          ${weekEntries.map(entry => `
            <div class="diary-entry">
              <div class="diary-entry-header">
                <span class="diary-entry-name">${byName(entry.hgName)?.emoji || '🎙️'} ${entry.hgName}</span>
                <span class="diary-entry-context">${contextLabels[entry.context] || entry.context}</span>
              </div>
              <div class="diary-entry-quote">${entry.quote}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════
//  AUTO-PLAY ENGINE
// ══════════════════════════════════════

let _autoTimer = null;

function scheduleAuto(fn) {
  if (!game || !game.autoPlay) return;
  clearTimeout(_autoTimer);
  _autoTimer = setTimeout(() => { if (game && game.autoPlay) fn(); }, game.autoPlayDelay);
}

function toggleAutoPlay() {
  if (!game) return;
  game.autoPlay = !game.autoPlay;
  const btn = document.getElementById('autoPlayBtn');
  if (btn) {
    btn.textContent = game.autoPlay ? '⏸ Pause' : '▶ Auto-Play';
    btn.className   = game.autoPlay ? 'btn btn-gold' : 'btn btn-outline';
  }
  if (game.autoPlay) autoAdvance();
  else clearTimeout(_autoTimer);
}

function autoAdvance() {
  if (!game || !game.autoPlay) return;
  switch (game.phase) {
    case 'hoh':   scheduleAuto(() => simulateHOH()); break;
    case 'nom':   scheduleAuto(() => confirmNoms()); break;
    case 'veto':  scheduleAuto(() => {
      const players = [
        game.hoh,
        ...game.nominees,
        ...active().filter(h => h.name !== game.hoh && !game.nominees.includes(h.name))
          .slice(0, 3).map(h => h.name)
      ];
      simulateVeto(players.join(','));
    }); break;
    case 'evict': scheduleAuto(() => runEvictionVote()); break;
  }
}

// ══════════════════════════════════════
//  SEASON SCOREBOARD
// ══════════════════════════════════════

function renderScoreboard() {
  // Tier 1 cleanup: scoreboard panel removed; per-houseguest stats now
  // live as inline chips on each .hg-card via renderHGGrid().
  // Kept as a no-op so existing call sites continue to work.
  return;
}

// Right-column tab switcher (Feed / Jury / Stats / History)
function setRightTab(name) {
  document.querySelectorAll('.right-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.right-tab-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.pane === name);
  });
  // History is rendered on-demand to keep things snappy
  if (name === 'history' && typeof renderHistory === 'function') {
    renderHistory();
  }
}

// ══════════════════════════════════════
//  HOUSEGUEST DETAIL MODAL
// ══════════════════════════════════════

function openHGModal(name) {
  const hg = byName(name);
  if (!hg) return;

  const evicted   = hg.status === 'evicted';
  const isJury    = game.jury.includes(name);
  const isHOH     = hg.name === game.hoh;
  const isNom     = game.nominees.includes(name);
  const isVeto    = hg.name === game.vetoHolder;
  const isPrevHOH = hg.name === game.prevHOH;

  const statusLabel = evicted
    ? (isJury ? '⚖️ Jury Member' : '🚪 Evicted')
    : isHOH     ? '👑 Head of Household'
    : isNom     ? '🎯 On the Block'
    : isVeto    ? '⚡ Veto Holder'
    : isPrevHOH ? '🔒 HOH Lockout (ineligible this week)'
    : '🏠 Active';

  const hgAlliances = (game.alliances || []).filter(a => a.members.includes(name));

  const rels = Object.entries(hg.relationships || {})
    .map(([n, v]) => ({ name: n, rel: Math.round(v), grudge: Math.round(hg.grudges[n] || 0) }))
    .sort((a, b) => b.rel - a.rel);

  const drEntries = (game.diaryRoom || []).filter(e => e.hgName === name).slice(-3).reverse();

  const relBar = (pct, colorVar) => `
    <div class="rel-bar-bg" style="flex:1">
      <div class="rel-bar-fill" style="width:${pct}%;background:${colorVar}"></div>
    </div>`;

  document.getElementById('hgModalBody').innerHTML = `
    <div class="modal-hg-header">
      <div class="modal-avatar">${getInitials(name)}</div>
      <div>
        <div class="modal-name">${hg.emoji} ${name}</div>
        <div class="modal-status-label">${statusLabel}</div>
      </div>
    </div>

    <div class="modal-stats-row">
      <div class="modal-stat"><div class="modal-stat-val">${hg.wins.hoh}</div><div class="modal-stat-lbl">HOH Wins</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${hg.wins.veto}</div><div class="modal-stat-lbl">Veto Wins</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${hg.timesNominated || 0}</div><div class="modal-stat-lbl">Times Nom'd</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${(hg.allies||[]).length}</div><div class="modal-stat-lbl">Allies</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${(hg.enemies||[]).length}</div><div class="modal-stat-lbl">Enemies</div></div>
    </div>

    ${hgAlliances.length ? `
      <div class="modal-section-title">Alliances</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px">
        ${hgAlliances.map(a => `
          <span style="font-size:11px;padding:3px 9px;border-radius:2px;font-family:'Oswald',sans-serif;letter-spacing:.5px;
            background:${a.status==='active'?'rgba(245,200,66,0.12)':'rgba(80,80,80,0.2)'};
            border:1px solid ${a.status==='active'?'var(--gold)':'var(--border)'};
            color:${a.status==='active'?'var(--gold)':'var(--muted)'}">
            ${a.name} <span style="opacity:.55;font-size:9px">${a.status.toUpperCase()}</span>
          </span>`).join('')}
      </div>` : ''}

    <div class="modal-section-title">Relationships — Top 6</div>
    <div style="margin-bottom:18px">
      ${rels.slice(0, 6).map(r => {
        const col = r.rel >= 70 ? 'var(--safe)' : r.rel >= 40 ? 'var(--gold)' : 'var(--red)';
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px">
          <span style="width:94px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name}</span>
          ${relBar(r.rel, col)}
          <span style="width:26px;text-align:right;color:var(--muted);font-size:11px">${r.rel}</span>
          ${r.grudge > 12 ? `<span style="font-size:10px;color:var(--red)" title="Grudge ${r.grudge}">⚔️</span>` : ''}
        </div>`;
      }).join('')}
    </div>

    <div class="modal-section-title">Biggest Threats (to ${name})</div>
    <div style="margin-bottom:18px">
      ${[...rels].sort((a,b) => a.rel - b.rel).slice(0, 3).map(r => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px">
          <span style="width:94px;color:var(--text)">${r.name}</span>
          ${relBar(100 - r.rel, 'var(--red)')}
          <span style="width:26px;text-align:right;color:var(--muted);font-size:11px">${r.rel}</span>
        </div>`).join('')}
    </div>

    ${drEntries.length ? `
      <div class="modal-section-title">Diary Room</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
        ${drEntries.map(e => `
          <div style="font-size:12px;color:var(--text);line-height:1.55;font-style:italic;
               padding:10px 13px;background:var(--surface2);border-left:3px solid #9b59b6;border-radius:3px">
            "${e.quote}"
            <div style="font-size:10px;color:var(--muted);margin-top:4px;font-style:normal;letter-spacing:1px">Week ${e.week}</div>
          </div>`).join('')}
      </div>` : ''}

    ${hg.nominatedBy && hg.nominatedBy.length ? `
      <div class="modal-section-title">Nomination History</div>
      <div style="font-size:12px;color:var(--muted)">Nominated by: ${hg.nominatedBy.join(', ')}</div>` : ''}
  `;

  document.getElementById('hgModal').classList.add('open');
}

function closeHGModal() {
  document.getElementById('hgModal').classList.remove('open');
}

// ══════════════════════════════════════
//  COLLAPSIBLE PANEL HELPER
// ══════════════════════════════════════

function toggleCollapse(bodyId, chevId) {
  const body = document.getElementById(bodyId);
  const chev = document.getElementById(chevId);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (chev) chev.textContent = open ? '▸' : '▾';
}

// ══════════════════════════════════════
//  PHASE 1: HOH
// ══════════════════════════════════════

function startHOHPhase() {
  setPhase('hoh');
  renderAll();
  renderScoreboard();

  document.getElementById('diaryRoomPanel').innerHTML = '';
  document.getElementById('alliancesPanel').innerHTML = '';

  if (game.week > 1 && !game._resuming) {
    runSocialEncounters();
    checkAllianceFractures();
  }

  tryFormAlliances();
  renderAlliancesPanel();

  const eligible = active().filter(h => h.name !== game.hoh && h.name !== game.prevHOH);

  const prevNote = game.prevHOH
    ? `<div class="hoh-lockout-note">🔒 <b>${game.prevHOH}</b> is ineligible as outgoing HOH</div>`
    : '';

  const aa = document.getElementById('actionArea');
  aa.innerHTML = `
    <div class="action-title">⚡ Head of Household Competition</div>
    <div class="action-desc">
      ${eligible.length} houseguests are competing. Pick a winner below, or simulate.
    </div>
    ${prevNote}
    <div class="simulate-inline">
      <button class="btn btn-red" onclick="simulateHOH()">⚡ Simulate HOH</button>
    </div>
    <div class="divider"></div>
    <div class="panel-label" style="margin-bottom:8px">Or choose winner manually:</div>
    <div class="nom-select" id="hohChoices">
      ${eligible.map(h => `
        <div class="nom-option" onclick="pickHOH('${h.name.replace(/'/g, "\\'")}')">
          <span class="emoji">${h.emoji}</span>${h.name}
        </div>
      `).join('')}
    </div>
  `;

  if (game.autoPlay) scheduleAuto(() => simulateHOH());
}

function simulateHOH() {
  const eligible = active().filter(h => h.name !== game.hoh && h.name !== game.prevHOH);
  const weights = eligible.map(h => {
    const totalGrudges = Object.values(h.grudges).reduce((a, b) => a + b, 0);
    return Math.random() * 10 + 1 + totalGrudges * 0.05;
  });
  const winner = weightedRand(eligible, weights);
  pickHOH(winner.name);
}

function pickHOH(name) {
  game.hoh = name;
  byName(name).wins.hoh++;
  if (!game.stats.hohWins[name]) game.stats.hohWins[name] = 0;
  game.stats.hohWins[name]++;
  log(`${name} has won the Head of Household competition! 👑`, 'hoh');
  game.currentWeekHistory = [`Week ${game.week}: ${name} is the new HoH`];
  renderAll();
  generateDiaryEntries('hoh', { hoh: name });
  startNomPhase();
}

// ══════════════════════════════════════
//  PHASE 2: NOMINATIONS
// ══════════════════════════════════════

function startNomPhase() {
  setPhase('nom');
  game.nominees = [];
  game.selections = [];

  const hoh = byName(game.hoh);
  const eligible = active().filter(h => h.name !== game.hoh);

  const scored = eligible.map(h => ({ hg: h, score: threatScore(hoh, h) }))
                          .sort((a, b) => b.score - a.score);

  const poolSize = Math.max(3, Math.ceil(eligible.length * 0.4));
  const pool = scored.slice(0, poolSize);

  const nom1 = pool[0].hg;
  const rest = pool.filter(p => p.hg.name !== nom1.name);
  const nom2 = rest[Math.floor(Math.random() * Math.min(2, rest.length))].hg;

  game.selections = [nom1.name, nom2.name];

  const reason1 = getNomReason(hoh, nom1);
  const reason2 = getNomReason(hoh, nom2);

  const aa = document.getElementById('actionArea');
  aa.innerHTML = `
    <div class="action-title">🎯 Nomination Ceremony</div>
    <div class="action-desc">
      ${game.hoh} has made their nominations based on relationships, threats, and past actions in the house.
    </div>
    <div class="nomination-result">
      <div class="nominee-badge">🎯 ${nom1.name}</div>
      <div class="nominee-badge">🎯 ${nom2.name}</div>
    </div>
    <div style="margin:14px 0 20px;font-size:13px;color:var(--muted);line-height:1.8">
      <div>📌 <b>${nom1.name}</b>: ${reason1}</div>
      <div>📌 <b>${nom2.name}</b>: ${reason2}</div>
    </div>
    <div class="action-buttons">
      <button class="btn btn-red" onclick="confirmNoms()">Confirm Nominations →</button>
    </div>
  `;

  if (game.autoPlay) scheduleAuto(() => confirmNoms());
}

function getNomReason(hoh, nominee) {
  const grudgeScore = nominee.grudges[hoh.name] || 0;
  const rel = hoh.relationships[nominee.name] || 50;
  const theyHoldGrudge = grudgeScore > 20;
  const compWins = nominee.wins.hoh + nominee.wins.veto;

  if (hoh.nominatedBy && hoh.nominatedBy.includes(nominee.name)) {
    return `${nominee.name} previously nominated ${hoh.name} — payback.`;
  }
  if (theyHoldGrudge) {
    return `${nominee.name} has held a grudge since being targeted — they're a risk.`;
  }
  if (compWins >= 3) {
    return `${nominee.name} is a major comp threat with ${compWins} wins.`;
  }
  if (rel < 30) {
    return `${hoh.name} has never trusted ${nominee.name}.`;
  }
  if (rel < 50) {
    return `Their relationship with ${hoh.name} has never been solid.`;
  }
  return `${hoh.name} sees ${nominee.name} as a strategic obstacle this week.`;
}

function confirmNoms() {
  if (game.selections.length !== 2) return;
  game.nominees = [...game.selections];

  // AI Arena / MVP: add a third nominee
  const wf = game.weekFlags || {};
  if (wf.aiArena || wf.mvpThirdNom) {
    const eligible = active().filter(h =>
      h.name !== game.hoh && !game.nominees.includes(h.name)
    );
    if (eligible.length) {
      let third;
      if (wf.mvpThirdNom) {
        const dislikeScore = (target) =>
          active().filter(h => h.name !== target.name)
                  .reduce((s, h) => s + (100 - (h.relationships[target.name] || 50)), 0);
        third = eligible.sort((a, b) => dislikeScore(b) - dislikeScore(a))[0];
        log(`⭐ MVP: ${third.name} has been added as a third nominee.`, 'nom');
      } else {
        const hoh = byName(game.hoh);
        third = eligible.map(h => ({ hg: h, score: threatScore(hoh, h) }))
                        .sort((a, b) => b.score - a.score)[0].hg;
        log(`🤖 AI Arena: ${third.name} has been added as a third nominee.`, 'nom');
      }
      game.nominees.push(third.name);
    }
  }

  game.nominees.forEach(n => {
    addGrudge(n, game.hoh, 'nom');
    const hg = byName(n);
    if (hg) hg.timesNominated = (hg.timesNominated || 0) + 1;
    log(`${n} has been nominated for eviction.`, 'nom');
  });

  log(`${game.hoh} has nominated ${game.nominees.join(', ')}.`, 'nom');
  game.currentWeekHistory.push(`Nominees: ${game.nominees.join(', ')}`);
  renderAll();
  checkAllianceFractures();
  renderAlliancesPanel();
  generateDiaryEntries('noms');
  renderScoreboard();
  startVetoPhase();
}

// ══════════════════════════════════════
//  PHASE 3: POWER OF VETO
// ══════════════════════════════════════

function startVetoPhase() {
  setPhase('veto');
  game.vetoHolder = null;
  game.vetoUsed = false;

  const others = active().filter(h => h.name !== game.hoh && !game.nominees.includes(h.name));
  const randOthers = shuffle(others).slice(0, Math.min(3, others.length));
  const vetoPlayers = [byName(game.hoh), ...game.nominees.map(byName), ...randOthers];
  const names = vetoPlayers.map(h => h.name);

  const aa = document.getElementById('actionArea');
  aa.innerHTML = `
    <div class="action-title">⚡ Power of Veto Competition</div>
    <div class="action-desc">
      Playing for Veto: <b>${names.join(', ')}</b>. Pick the winner or simulate.
    </div>
    <div class="simulate-inline">
      <button class="btn btn-red" onclick="simulateVeto('${names.join(',').replace(/'/g, "\\'")}')">⚡ Simulate Veto</button>
    </div>
    <div class="divider"></div>
    <div class="panel-label" style="margin-bottom:8px">Or choose winner manually:</div>
    <div class="nom-select">
      ${vetoPlayers.map(h => `
        <div class="nom-option" onclick="pickVeto('${h.name.replace(/'/g, "\\'")}')">
          <span class="emoji">${h.emoji}</span>${h.name}
        </div>
      `).join('')}
    </div>
  `;

  if (game.autoPlay) scheduleAuto(() => simulateVeto(names.join(',')));
}

function simulateVeto(namesStr) {
  const names = namesStr.split(',');
  const weights = names.map(n => {
    let w = Math.random() * 10 + 1;
    if (game.nominees.includes(n)) w += 18;
    return w;
  });
  const winner = weightedRand(names, weights);
  pickVeto(winner);
}

function pickVeto(name) {
  game.vetoHolder = name;
  byName(name).wins.veto++;
  if (!game.stats.vetoWins[name]) game.stats.vetoWins[name] = 0;
  game.stats.vetoWins[name]++;
  log(`${name} has won the Power of Veto! ⚡`, 'veto');
  game.currentWeekHistory.push(`Veto winner: ${name}`);
  renderAll();
  generateDiaryEntries('veto', { winner: name });
  startVetoDecisionPhase();
}

// ══════════════════════════════════════
//  VETO DECISION
// ══════════════════════════════════════

function startVetoDecisionPhase() {
  const isNominee = game.nominees.includes(game.vetoHolder);

  if (isNominee) {
    log(`${game.vetoHolder} is on the block and MUST use the veto on themselves.`, 'veto');
    setTimeout(() => useVeto(game.vetoHolder), 800);
    const aa = document.getElementById('actionArea');
    aa.innerHTML = `
      <div class="action-title">⚡ Veto Ceremony</div>
      <div class="action-desc">
        ${game.vetoHolder} won the veto while on the block.
        They are automatically saving themselves — this is not a choice.
      </div>
      <div class="tooltip-text" style="margin-top:12px">⏳ Processing veto ceremony...</div>
    `;
    return;
  }

  const nominees = game.nominees;
  const vetoHolderHG = byName(game.vetoHolder);

  const rel0 = vetoHolderHG.relationships[nominees[0]] || 50;
  const rel1 = vetoHolderHG.relationships[nominees[1]] || 50;
  const bestAllyRel = Math.max(rel0, rel1);
  const bestAlly = rel0 >= rel1 ? nominees[0] : nominees[1];
  const shouldUse = bestAllyRel > 68 && Math.random() > 0.3;

  const aa = document.getElementById('actionArea');
  aa.innerHTML = `
    <div class="action-title">⚡ Veto Ceremony</div>
    <div class="action-desc">
      ${game.vetoHolder} holds the Power of Veto. Current nominees: <b>${nominees.join(', ')}</b>.
      ${game.vetoHolder} is deciding whether to use it...
    </div>
    <div class="action-buttons">
      <button class="btn btn-red" onclick="simulateVetoDecision(${shouldUse}, '${bestAlly.replace(/'/g, "\\'")}')">
        Reveal Veto Decision
      </button>
    </div>
    <div class="tooltip-text" style="margin-top:12px">
      ${shouldUse
        ? `💭 ${game.vetoHolder} has a close ally on the block...`
        : `💭 ${game.vetoHolder} is comfortable with the current nominees.`}
    </div>
  `;

  if (game.autoPlay) scheduleAuto(() => simulateVetoDecision(shouldUse, bestAlly));
}

function simulateVetoDecision(shouldUse, bestAlly) {
  if (shouldUse) {
    log(`${game.vetoHolder} has decided to use the Power of Veto on ${bestAlly}!`, 'veto');
    useVeto(bestAlly);
  } else {
    dontUseVeto();
  }
}

function useVeto(savedName) {
  log(`${game.vetoHolder} has used the Power of Veto on ${savedName}! ⚡`, 'veto');
  game.nominees = game.nominees.filter(n => n !== savedName);
  game.vetoUsed = true;
  game.vetoSaved = savedName;
  game.currentWeekHistory.push(`Veto used on ${savedName}`);

  const saved = byName(savedName);
  if (saved && game.vetoHolder !== savedName) {
    saved.relationships[game.vetoHolder] = Math.min(100, (saved.relationships[game.vetoHolder] || 50) + 20);
    log(`${savedName} is grateful to ${game.vetoHolder} for the save.`, 'safe');
    generateDiaryEntries('veto-saved', { saved: savedName });
  }

  const eligible = active().filter(h =>
    h.name !== game.hoh &&
    h.name !== game.vetoHolder &&
    h.name !== game.vetoSaved &&
    !game.nominees.includes(h.name)
  );

  // Diamond Veto twist: veto holder picks the replacement, not the HOH.
  const diamondActive = !!(game.weekFlags && game.weekFlags.diamondVeto);
  const picker = diamondActive ? byName(game.vetoHolder) : byName(game.hoh);
  if (diamondActive) delete game.weekFlags.diamondVeto;

  const scored = eligible.map(h => ({ hg: h, score: threatScore(picker, h) }))
                          .sort((a, b) => b.score - a.score);

  const replacement = scored[0].hg;
  const replacementReason = getNomReason(picker, replacement);

  const protectedNames = [game.vetoHolder];
  if (game.vetoSaved !== game.vetoHolder) protectedNames.push(game.vetoSaved);
  const protectionNote = `🛡️ Protected this week: <b>${protectedNames.join(', ')}</b> (veto holder${game.vetoSaved !== game.vetoHolder ? ' &amp; veto save' : ''})`;

  const aa = document.getElementById('actionArea');
  aa.innerHTML = `
    <div class="action-title">${diamondActive ? '💎 Diamond Replacement' : '🎯 Replacement Nominee'}</div>
    <div class="action-desc">
      ${savedName} has been saved. ${diamondActive
        ? `<b>${picker.name}</b> wields the Diamond Power of Veto and names the replacement.`
        : `${game.hoh} must name a replacement nominee.`}
      Current nominee: <b>${game.nominees[0]}</b>.
    </div>
    <div style="font-size:12px;color:var(--accent);margin-bottom:16px;padding:8px 12px;background:rgba(0,212,255,0.07);border:1px solid rgba(0,212,255,0.2);border-radius:3px">
      ${protectionNote}
    </div>
    <div class="nomination-result">
      <div class="nominee-badge">🎯 ${replacement.name}</div>
    </div>
    <div style="margin:14px 0 20px;font-size:13px;color:var(--muted)">
      📌 ${replacementReason}
    </div>
    <div class="action-buttons">
      <button class="btn btn-red" onclick="nameReplacement('${replacement.name.replace(/'/g, "\\'")}')">Confirm Replacement →</button>
    </div>
  `;

  if (game.autoPlay) scheduleAuto(() => nameReplacement(replacement.name));
}

function nameReplacement(name) {
  game.nominees.push(name);
  const hg = byName(name);
  if (hg) hg.timesNominated = (hg.timesNominated || 0) + 1;
  addGrudge(name, game.hoh, 'renom');
  log(`${game.hoh} has named ${name} as the replacement nominee.`, 'nom');
  game.currentWeekHistory.push(`Replacement nominee: ${name}`);
  renderAll();
  renderScoreboard();
  startEvictionPhase();
}

function dontUseVeto() {
  log(`${game.vetoHolder} has decided NOT to use the Power of Veto.`, 'veto');
  game.currentWeekHistory.push(`Veto not used`);
  renderAll();
  startEvictionPhase();
}

// ══════════════════════════════════════
//  PHASE 4: EVICTION
// ══════════════════════════════════════

function startEvictionPhase() {
  setPhase('evict');
  maybeFireCoup();         // may rewrite game.nominees
  resolveAIArena();        // saves strongest of 3 nominees if Arena/MVP active
  consumeSafetyPower();    // Secret Power: pulls a holder off the block
  renderAll();

  const [nom1, nom2] = game.nominees;
  const voters = active().filter(h => h.name !== game.hoh && !game.nominees.includes(h.name));

  const aa = document.getElementById('actionArea');
  aa.innerHTML = `
    <div class="action-title">🚪 Live Eviction</div>
    <div class="action-desc">
      The houseguests will now vote to evict either <b>${nom1}</b> or <b>${nom2}</b>.
      Votes are cast based on relationships, grudges, and strategic motives.
      <br>${voters.length} eligible voters.
    </div>
    <div class="nomination-result">
      <div class="nominee-badge">🎯 ${nom1}</div>
      <div class="nominee-badge">🎯 ${nom2}</div>
    </div>
    <div class="action-buttons">
      <button class="btn btn-red" onclick="runEvictionVote()">Cast the Votes</button>
    </div>
  `;

  if (game.autoPlay) scheduleAuto(() => runEvictionVote());
}

function runEvictionVote() {
  const voters = active().filter(h => h.name !== game.hoh && !game.nominees.includes(h.name));
  const [nom1, nom2] = game.nominees;

  const votes = { [nom1]: 0, [nom2]: 0 };
  const voteLog = [];

  voters.forEach(voter => {
    const grudge1 = voter.grudges[nom1] || 0;
    const grudge2 = voter.grudges[nom2] || 0;
    const rel1 = voter.relationships[nom1] || 50;
    const rel2 = voter.relationships[nom2] || 50;

    const danger1 = (100 - rel1) + grudge1 * 0.6 + Math.random() * 10;
    const danger2 = (100 - rel2) + grudge2 * 0.6 + Math.random() * 10;

    const allianceVote = allianceVoteInfluence(voter, nom1, nom2);
    const voteFor = allianceVote || (danger1 > danger2 ? nom1 : nom2);
    votes[voteFor]++;
    voteLog.push({ voter: voter.name, vote: voteFor });
  });

  // America's Vote twist — single weighted vote against the least-liked nominee
  if (game.weekFlags && game.weekFlags.americasVote) {
    delete game.weekFlags.americasVote;
    const houseDislike = (name) => {
      const others = active().filter(h => h.name !== name && !game.nominees.includes(h.name));
      if (!others.length) return 50;
      return others.reduce((s, h) => s + (100 - (h.relationships[name] || 50)), 0) / others.length;
    };
    const americaTarget = houseDislike(nom1) >= houseDislike(nom2) ? nom1 : nom2;
    votes[americaTarget]++;
    voteLog.push({ voter: '🇺🇸 America', vote: americaTarget });
    log(`🇺🇸 America's vote goes to evict ${americaTarget}.`, 'evict');
  }

  let evicted;
  if (votes[nom1] === votes[nom2]) {
    const hohHG = byName(game.hoh);
    const rel1 = hohHG.relationships[nom1] || 50;
    const rel2 = hohHG.relationships[nom2] || 50;
    evicted = rel1 < rel2 ? nom1 : nom2;
    log(`TIEBREAKER: ${game.hoh} breaks the tie and evicts ${evicted}!`, 'evict');
  } else {
    evicted = votes[nom1] > votes[nom2] ? nom1 : nom2;
  }

  const saved = evicted === nom1 ? nom2 : nom1;
  const voteCount = votes[evicted];
  const saveCount = votes[saved];

  voteLog.forEach(({ voter, vote }) => {
    if (vote !== evicted) {
      addGrudge(saved, voter, 'vote');
    }
    addGrudge(evicted, voter, vote === evicted ? 'vote' : 'publicTarget');
  });

  const aa = document.getElementById('actionArea');
  aa.innerHTML = `
    <div class="action-title">📊 The Votes Are In</div>
    <div class="vote-list" id="voteReveal"></div>
    <div id="evictionResult" style="display:none">
      <div class="divider"></div>
      <div class="action-title" style="color:var(--red)">🚪 Evicted: ${evicted}</div>
      <div class="action-desc">By a vote of ${voteCount}–${saveCount}, ${evicted} has been evicted from the Big Brother house.</div>
      <div class="action-buttons">
        <button class="btn btn-red" onclick="processEviction('${evicted.replace(/'/g, "\\'")}')">Continue →</button>
      </div>
    </div>
  `;

  let i = 0;
  const revealDelay = game.autoPlay ? 150 : 600;
  function revealNext() {
    // Bail out if the game was restarted/torn down mid-animation.
    if (!game) return;
    const reveal = document.getElementById('voteReveal');
    if (!reveal) return;
    if (i < voteLog.length) {
      const entry = voteLog[i];
      const div = document.createElement('div');
      div.className = 'vote-row';
      div.innerHTML = `<span class="voter">${escapeHtml(entry.voter)}</span><span>votes to evict</span><span class="vote-for">${escapeHtml(entry.vote)}</span>`;
      reveal.appendChild(div);
      i++;
      setTimeout(revealNext, revealDelay);
    } else {
      const result = document.getElementById('evictionResult');
      if (result) result.style.display = 'block';
      if (game.autoPlay) scheduleAuto(() => processEviction(evicted));
    }
  }
  revealNext();

  log(`The house votes to evict ${evicted} (${voteCount}–${saveCount}).`, 'evict');
  game.currentWeekHistory.push(`Evicted: ${evicted}`);
  generateDiaryEntries('eviction', { evicted, jury: game.evicted.length >= (game.houseguests.length - game.jurySize - 2) });
}

function processEviction(name) {
  if (!game) return;
  const hg = byName(name);
  if (!hg) return;
  hg.status = 'evicted';

  const totalPlayers = game.houseguests.length;
  const juryCutoff = totalPlayers - game.jurySize - 2;
  const jury = game.evicted.length >= juryCutoff;

  game.evicted.push({ name, week: game.week, jury });
  if (jury) game.jury.push(name);

  log(`${name} has been evicted from the Big Brother house! ${jury ? '(Jury member 🏛️)' : ''}`, 'evict');

  // Battle Back twist — may bring back the first juror
  if (jury) maybeFireBattleBack(name);

  game.history.push({
    week: game.week,
    hoh: game.hoh,
    nominees: [...game.nominees],
    veto: game.vetoHolder,
    vetoUsed: game.vetoUsed,
    evicted: name,
    events: [...game.currentWeekHistory]
  });

  renderAll();
  renderScoreboard();

  const remaining = active();
  if (remaining.length <= 3) {
    setTimeout(() => startFinal3(), 800);
    return;
  }

  // Double/Triple Eviction twist: stay in the same week, restart from HOH.
  if (game.weekFlags && game.weekFlags.evictionsRemaining > 1) {
    game.weekFlags.evictionsRemaining--;
    game.prevHOH = game.hoh;   // outgoing HOH still locked out
    // Reset week-state for the inner round, but DON'T increment week.
    game.nominees = [];
    game.vetoHolder = null;
    game.vetoUsed = false;
    game.vetoSaved = null;
    game.selections = [];
    log(`⚡ The eviction continues — back-to-back!`, 'evict');
    setTimeout(() => startHOHPhase(), 700);
    return;
  }

  game.prevHOH = game.hoh;
  game.week++;
  game.nominees = [];
  game.vetoHolder = null;
  game.vetoUsed = false;
  game.vetoSaved = null;
  game.selections = [];
  game.weekFlags = {};   // reset per-week twist flags
  onWeekStart(game.week);

  setTimeout(() => startHOHPhase(), 500);
}

// ══════════════════════════════════════
//  FINAL 3 ENDGAME
// ══════════════════════════════════════

function startFinal3() {
  const f3 = active();
  game.f3Players = f3.map(h => h.name);
  game.final3Phase = 'hoh1';
  showScreen('final3Screen');
  startF3Part1();
}

function renderFinal3Cards(container, highlightWinner, eliminatedName) {
  const f3 = game.f3Players.map(byName);
  container.innerHTML = `
    <div class="final3-grid" style="margin-bottom:24px">
      ${f3.map(h => `
        <div class="finalist-card ${highlightWinner === h.name ? 'winner' : ''} ${eliminatedName === h.name ? 'eliminated' : ''}">
          <div class="finalist-avatar" style="border-color:${highlightWinner === h.name ? 'var(--gold)' : 'var(--border)'}">${getInitials(h.name)}</div>
          <div class="finalist-name">${h.name}</div>
          <div class="finalist-role" style="color:${highlightWinner === h.name ? 'var(--gold)' : 'var(--muted)'}">
            ${highlightWinner === h.name ? '🏆 Winner' : eliminatedName === h.name ? '🚪 Evicted' : 'Final 3'}
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:6px">
            HOH Wins: ${h.wins.hoh} | Veto Wins: ${h.wins.veto}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function startF3Part1() {
  const f3 = game.f3Players.map(byName);
  const el = document.getElementById('final3ActionArea');

  el.innerHTML = `
    <div class="hoh-banner" style="margin-bottom:24px">
      <div class="hoh-crown">⚡</div>
      <div>
        <div class="hoh-label">Final HOH Competition</div>
        <div class="hoh-name">Part 1 — Endurance</div>
      </div>
      <div class="hoh-meta">
        <div class="week-label">Week</div>
        <div class="week-num">${game.week}</div>
      </div>
    </div>
  `;

  let cardsDiv = document.createElement('div');
  renderFinal3Cards(cardsDiv, null, null);
  el.appendChild(cardsDiv);

  const desc = document.createElement('div');
  desc.innerHTML = `
    <div class="action-area" style="margin-top:0">
      <div class="action-title">Part 1: Endurance</div>
      <div class="action-desc">All three finalists compete in a grueling endurance competition. The last person standing wins Part 1 and is guaranteed a spot in the Final HOH decision. Simulate or choose the winner.</div>
      <div class="simulate-inline">
        <button class="btn btn-red" onclick="simulateF3Part1()">⚡ Simulate Part 1</button>
      </div>
      <div class="divider"></div>
      <div class="panel-label" style="margin-bottom:8px">Or choose manually:</div>
      <div class="nom-select">
        ${f3.map(h => `<div class="nom-option" onclick="pickF3Part1('${h.name.replace(/'/g, "\\'")}')"><span class="emoji">${h.emoji}</span>${h.name}</div>`).join('')}
      </div>
    </div>
  `;
  el.appendChild(desc);
}

function simulateF3Part1() {
  const f3 = game.f3Players.map(byName);
  const weights = f3.map(h => Math.random() * 10 + 1);
  const winner = weightedRand(f3, weights);
  pickF3Part1(winner.name);
}

function pickF3Part1(name) {
  game.f3HOH1Winner = name;
  byName(name).wins.hoh++;
  log(`${name} wins Part 1 of the Final HOH! ⚡`, 'hoh');

  const el = document.getElementById('final3ActionArea');
  el.innerHTML = '';
  let cardsDiv = document.createElement('div');
  renderFinal3Cards(cardsDiv, name, null);
  el.appendChild(cardsDiv);

  const others = game.f3Players.filter(n => n !== name);
  const desc = document.createElement('div');
  desc.innerHTML = `
    <div class="action-area" style="margin-top:0">
      <div class="action-title">🏆 Part 1 Winner: ${name}</div>
      <div class="action-desc">${name} wins Part 1 and advances directly to Part 3. ${others.join(' and ')} now compete in Part 2.</div>
      <div class="action-buttons">
        <button class="btn btn-red" onclick="startF3Part2()">→ Part 2</button>
      </div>
    </div>
  `;
  el.appendChild(desc);
}

function startF3Part2() {
  const others = game.f3Players.filter(n => n !== game.f3HOH1Winner).map(byName);
  const el = document.getElementById('final3ActionArea');
  el.innerHTML = '';

  let cardsDiv = document.createElement('div');
  renderFinal3Cards(cardsDiv, game.f3HOH1Winner, null);
  el.appendChild(cardsDiv);

  const desc = document.createElement('div');
  desc.innerHTML = `
    <div class="action-area" style="margin-top:0">
      <div class="action-title">Part 2: Mental/Physical</div>
      <div class="action-desc">
        ${others.map(h => h.name).join(' and ')} compete head-to-head. The winner joins ${game.f3HOH1Winner} in Part 3.
        The loser is eliminated from the Final HOH competition.
      </div>
      <div class="simulate-inline">
        <button class="btn btn-red" onclick="simulateF3Part2()">⚡ Simulate Part 2</button>
      </div>
      <div class="divider"></div>
      <div class="panel-label" style="margin-bottom:8px">Or choose manually:</div>
      <div class="nom-select">
        ${others.map(h => `<div class="nom-option" onclick="pickF3Part2('${h.name.replace(/'/g, "\\'")}')"><span class="emoji">${h.emoji}</span>${h.name}</div>`).join('')}
      </div>
    </div>
  `;
  el.appendChild(desc);
}

function simulateF3Part2() {
  const others = game.f3Players.filter(n => n !== game.f3HOH1Winner).map(byName);
  const weights = others.map(() => Math.random() * 10 + 1);
  const winner = weightedRand(others, weights);
  pickF3Part2(winner.name);
}

function pickF3Part2(name) {
  game.f3HOH2Winner = name;
  byName(name).wins.hoh++;
  log(`${name} wins Part 2 of the Final HOH! ⚡`, 'hoh');

  const el = document.getElementById('final3ActionArea');
  el.innerHTML = '';
  let cardsDiv = document.createElement('div');
  renderFinal3Cards(cardsDiv, null, null);
  el.appendChild(cardsDiv);

  const desc = document.createElement('div');
  desc.innerHTML = `
    <div class="action-area" style="margin-top:0">
      <div class="action-title">🏆 Part 2 Winner: ${name}</div>
      <div class="action-desc">
        ${name} advances to Part 3 alongside ${game.f3HOH1Winner}.
        ${game.f3Players.filter(n => n !== game.f3HOH1Winner && n !== name)[0]} is eliminated from the Final HOH competition.
      </div>
      <div class="action-buttons">
        <button class="btn btn-red" onclick="startF3Part3()">→ Part 3</button>
      </div>
    </div>
  `;
  el.appendChild(desc);
}

function startF3Part3() {
  const finalists = [game.f3HOH1Winner, game.f3HOH2Winner].map(byName);
  const spectator = game.f3Players.filter(n => n !== game.f3HOH1Winner && n !== game.f3HOH2Winner)[0];

  const el = document.getElementById('final3ActionArea');
  el.innerHTML = '';
  let cardsDiv = document.createElement('div');
  renderFinal3Cards(cardsDiv, null, null);
  el.appendChild(cardsDiv);

  const desc = document.createElement('div');
  desc.innerHTML = `
    <div class="action-area" style="margin-top:0">
      <div class="action-title">Part 3: Final HOH</div>
      <div class="action-desc">
        ${finalists.map(h => h.name).join(' and ')} face off in the final quiz competition.
        The winner becomes the Final HOH and decides who to bring to the Final 2.
        ${spectator} watches from the sidelines.
      </div>
      <div class="simulate-inline">
        <button class="btn btn-red" onclick="simulateFinalHOH()">⚡ Simulate Part 3</button>
      </div>
      <div class="divider"></div>
      <div class="panel-label" style="margin-bottom:8px">Or choose manually:</div>
      <div class="nom-select">
        ${finalists.map(h => `<div class="nom-option" onclick="pickFinalHOH('${h.name.replace(/'/g, "\\'")}')"><span class="emoji">${h.emoji}</span>${h.name}</div>`).join('')}
      </div>
    </div>
  `;
  el.appendChild(desc);
}

function simulateFinalHOH() {
  const finalists = [game.f3HOH1Winner, game.f3HOH2Winner].map(byName);
  const weights = finalists.map(() => Math.random() * 10 + 1);
  const winner = weightedRand(finalists, weights);
  pickFinalHOH(winner.name);
}

function pickFinalHOH(name) {
  game.f3FinalHOH = name;
  byName(name).wins.hoh++;
  log(`${name} wins the Final HOH! 👑`, 'hoh');

  const others = game.f3Players.filter(n => n !== name);
  const el = document.getElementById('final3ActionArea');
  el.innerHTML = '';
  let cardsDiv = document.createElement('div');
  renderFinal3Cards(cardsDiv, name, null);
  el.appendChild(cardsDiv);

  const desc = document.createElement('div');
  desc.innerHTML = `
    <div class="action-area" style="margin-top:0">
      <div class="action-title">👑 Final HOH: ${name}</div>
      <div class="action-desc">
        ${name} must now choose who to evict and who to bring to the Final 2.
        This decision will be judged by the jury.
      </div>
      <div class="simulate-inline">
        <button class="btn btn-red" onclick="simulateF3Cut()">⚡ Simulate Final Cut</button>
      </div>
      <div class="divider"></div>
      <div class="panel-label" style="margin-bottom:8px">Or choose manually:</div>
      <div class="nom-select">
        ${others.map(n => byName(n)).map(h => `<div class="nom-option" onclick="makeF3Cut('${h.name.replace(/'/g, "\\'")}')"><span class="emoji">${h.emoji}</span>Evict ${h.name}</div>`).join('')}
      </div>
    </div>
  `;
  el.appendChild(desc);
}

function simulateF3Cut() {
  const others = game.f3Players.filter(n => n !== game.f3FinalHOH).map(byName);
  const scored = others.map(h => {
    const juryRels = game.jury.map(j => h.relationships[j] || 50);
    const avgJuryRel = juryRels.length ? juryRels.reduce((a, b) => a + b, 0) / juryRels.length : 50;
    const compWins = h.wins.hoh + h.wins.veto;
    const juryThreat = avgJuryRel + compWins * 5;
    return { hg: h, threat: juryThreat };
  }).sort((a, b) => b.threat - a.threat);

  makeF3Cut(scored[0].hg.name);
}

function makeF3Cut(evictedName) {
  game.f3Cut = evictedName;
  const finalist2 = game.f3Players.filter(n => n !== game.f3FinalHOH && n !== evictedName)[0];
  game.f3Finalists = [game.f3FinalHOH, finalist2];

  const hg = byName(evictedName);
  hg.status = 'evicted';
  game.evicted.push({ name: evictedName, week: game.week, jury: true });
  game.jury.push(evictedName);

  addGrudge(evictedName, game.f3FinalHOH, 'renom');

  log(`${game.f3FinalHOH} has made the FINAL CUT and evicts ${evictedName}!`, 'evict');
  log(`${game.f3FinalHOH} and ${finalist2} are the FINAL 2!`, 'safe');

  const el = document.getElementById('final3ActionArea');
  el.innerHTML = '';
  let cardsDiv = document.createElement('div');
  renderFinal3Cards(cardsDiv, null, evictedName);
  el.appendChild(cardsDiv);

  const desc = document.createElement('div');
  desc.innerHTML = `
    <div class="action-area" style="margin-top:0">
      <div class="action-title">🏆 The Final 2</div>
      <div class="action-desc">
        <b>${game.f3Finalists[0]}</b> and <b>${game.f3Finalists[1]}</b> are your Final 2!
        ${evictedName} joins the jury.
        The jury of ${game.jury.length} will now vote for the winner.
      </div>
      <div class="action-buttons">
        <button class="btn btn-gold" onclick="startJuryVote()">⚖️ Jury Vote</button>
      </div>
    </div>
  `;
  el.appendChild(desc);
}

// ══════════════════════════════════════
//  JURY VOTE
// ══════════════════════════════════════

function startJuryVote() {
  const [f1, f2] = game.f3Finalists;
  const jurors = game.jury.filter(n => n !== f1 && n !== f2).map(byName);
  game.juryVotes = {};

  const el = document.getElementById('final3ActionArea');
  el.innerHTML = `
    <div class="hoh-banner" style="margin-bottom:24px">
      <div class="hoh-crown">⚖️</div>
      <div>
        <div class="hoh-label">Jury Vote</div>
        <div class="hoh-name">${f1} vs ${f2}</div>
      </div>
    </div>
    <div class="action-area" style="margin-top:0">
      <div class="action-title">The Jury Speaks</div>
      <div class="action-desc">
        ${jurors.length} jury members will cast their votes for the winner.
        Relationships, grudges, and game moves all factor into each vote.
        Simulate all votes or reveal one by one.
      </div>
      <div class="jury-vote-grid" id="juryVoteGrid"></div>
      <div class="divider"></div>
      <div class="action-buttons" id="juryButtons">
        <button class="btn btn-red" onclick="simulateAllJuryVotes()">Reveal All Votes</button>
        <button class="btn btn-outline" onclick="revealNextJuryVote()">Reveal Next Vote</button>
      </div>
      <div id="juryTally" style="margin-top:16px;font-family:'Oswald',sans-serif;font-size:18px;color:var(--muted);letter-spacing:2px"></div>
    </div>
  `;

  // Bitterness setting scales how much grudges weigh on the vote.
  // none = 0 (purely relationship-based), mild = 0.7 (default), spicy = 1.4
  const bitter = 1.4 * getJuryBitterness();
  jurors.forEach(juror => {
    const rel1 = juror.relationships[f1] || 50;
    const rel2 = juror.relationships[f2] || 50;
    const grudge1 = juror.grudges[f1] || 0;
    const grudge2 = juror.grudges[f2] || 0;
    const score1 = rel1 - grudge1 * bitter + Math.random() * 15;
    const score2 = rel2 - grudge2 * bitter + Math.random() * 15;
    game.juryVotes[juror.name] = score1 > score2 ? f1 : f2;
  });

  game._juryRevealQueue = [...jurors];
  game._revealedVotes = [];
}

function revealNextJuryVote() {
  if (!game._juryRevealQueue.length) {
    finalizeJuryVote();
    return;
  }
  const juror = game._juryRevealQueue.shift();
  const vote = game.juryVotes[juror.name];
  game._revealedVotes.push({ juror: juror.name, vote });

  const grid = document.getElementById('juryVoteGrid');
  const row = document.createElement('div');
  row.className = 'jury-member-vote';
  row.innerHTML = `
    <div class="jname">${juror.emoji} ${juror.name}</div>
    <div style="text-align:center;font-size:11px;color:var(--muted);letter-spacing:1px;text-transform:uppercase">votes for</div>
    <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:15px;color:var(--gold);text-align:right">${vote}</div>
  `;
  grid.appendChild(row);
  updateJuryTally();

  if (!game._juryRevealQueue.length) {
    document.getElementById('juryButtons').innerHTML = `
      <button class="btn btn-gold" onclick="finalizeJuryVote()">Reveal the Winner!</button>
    `;
  }
}

function simulateAllJuryVotes() {
  while (game._juryRevealQueue.length) revealNextJuryVote();
}

function updateJuryTally() {
  const [f1, f2] = game.f3Finalists;
  const v1 = game._revealedVotes.filter(r => r.vote === f1).length;
  const v2 = game._revealedVotes.filter(r => r.vote === f2).length;
  document.getElementById('juryTally').textContent = `${f1}: ${v1} — ${f2}: ${v2}`;
}

function finalizeJuryVote() {
  const [f1, f2] = game.f3Finalists;
  const votes = { [f1]: 0, [f2]: 0 };
  Object.values(game.juryVotes).forEach(v => votes[v]++);

  let winner, runnerUp;
  if (votes[f1] > votes[f2]) { winner = f1; runnerUp = f2; }
  else if (votes[f2] > votes[f1]) { winner = f2; runnerUp = f1; }
  else {
    winner = rand([f1, f2]);
    runnerUp = winner === f1 ? f2 : f1;
  }

  game.winner = winner;
  game.runnerUp = runnerUp;
  game.finalVotes = votes;

  setTimeout(() => showWinner(winner, runnerUp, votes), 400);
}

// ══════════════════════════════════════
//  WINNER!
// ══════════════════════════════════════

async function showWinner(winner, runnerUp, votes) {
  showScreen('winnerScreen');
  // Season is over — clear the in-progress save (the finished season is
  // archived to Supabase below).
  clearSavedGame();
  const hg = byName(winner);
  const afpResult = getAmericasFavorite() ? pickAFP(winner, runnerUp) : null;
  const afpName = afpResult ? afpResult.name : null;

  // Save season to Supabase automatically
  await archiveCurrentSeason(winner, runnerUp, votes, afpName || 'N/A');

  document.getElementById('winnerName').textContent = winner;
  document.getElementById('voteTally').innerHTML = `
    Jury Vote: <span>${votes[winner]}</span> – ${votes[runnerUp]}
  `;

  document.getElementById('winnerStats').innerHTML = `
    <div class="stat"><div class="stat-val">${hg.wins.hoh}</div><div class="stat-label">HOH Wins</div></div>
    <div class="stat"><div class="stat-val">${hg.wins.veto}</div><div class="stat-label">Veto Wins</div></div>
    <div class="stat"><div class="stat-val">${game.week}</div><div class="stat-label">Total Weeks</div></div>
    <div class="stat"><div class="stat-val">${votes[winner]}</div><div class="stat-label">Jury Votes</div></div>
  `;

  let afpBlock = '';
  if (afpResult) {
    const pct = afpResult.pct;
    const runnersHtml = afpResult.runners.length
      ? `<div style="font-size:11px;color:var(--muted2);margin-top:6px">Runners-up: ${afpResult.runners.join(', ')}</div>`
      : '';
    afpBlock = `
      <div class="afp-block">
        <div class="afp-label">🇺🇸 America's Favorite Player</div>
        <div class="afp-name">${afpResult.name}</div>
        <div class="afp-pct">${pct}% of America's vote</div>
        ${runnersHtml}
      </div>
    `;
  }

  document.getElementById('runnerUpDisplay').innerHTML = `
    Runner-Up: <b>${runnerUp}</b> (${votes[runnerUp]} jury votes)
    ${afpBlock}
  `;
}

// AFP pick: weighted by relationships across the house + competition presence.
// Weight model: average relationship from all OTHER houseguests (40%) +
// HOH/Veto win count as "screen presence" (40%) + random sparkle (20%).
// Eligible: any non-finalist (evicted or active) excluding winner & runnerUp.
function pickAFP(winner, runnerUp) {
  const allHGs = game.houseguests || [];
  const eligible = allHGs.filter(h => h.name !== winner && h.name !== runnerUp);
  if (!eligible.length) return null;

  const scores = eligible.map(h => {
    // Average relationship from every other houseguest about this one
    const others = allHGs.filter(o => o.name !== h.name);
    let relSum = 0, relCount = 0;
    others.forEach(o => {
      if (o.relationships && o.relationships[h.name] != null) {
        relSum += o.relationships[h.name];
        relCount++;
      }
    });
    const avgRel = relCount ? relSum / relCount : 50;

    const presence = (h.wins.hoh || 0) * 8 + (h.wins.veto || 0) * 6 + (h.timesNominated || 0) * 2;
    const sparkle  = Math.random() * 25;

    const score = avgRel * 0.40 + presence * 0.40 + sparkle * 0.20;
    return { name: h.name, score };
  });

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const totalScore = scores.reduce((s, x) => s + Math.max(1, x.score), 0);
  const pct = Math.round((Math.max(1, top.score) / totalScore) * 100);
  const runners = scores.slice(1, 3).map(s => s.name);

  return { name: top.name, pct, runners };
}

// ══════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════

function toggleHistory() {
  toggleCollapse('historyPanelBody', 'historyChev');
  const body = document.getElementById('historyPanelBody');
  if (body && body.style.display !== 'none') renderHistory();
}

function renderHistory() {
  const p = document.getElementById('historyPanel');
  p.innerHTML = `<div class="panel-label" style="margin-bottom:16px">Season History</div>` +
    game.history.map(w => {
      const alliancesThisWeek = (game.alliances || [])
        .filter(a => a.formed === w.week)
        .map(a => `🤝 ${a.name} formed (${a.members.join(', ')})`);
      const twistsThisWeek = (game.twistsApplied || [])
        .filter(t => t.week === w.week)
        .map(t => `${t.icon} ${t.label}`);
      return `
        <div class="history-week">
          <div class="history-week-title">Week ${w.week}</div>
          <div class="history-entry">
            ${twistsThisWeek.length ? `<div style="color:var(--gold);font-weight:600;margin-bottom:4px">${twistsThisWeek.join(' • ')}</div>` : ''}
            👑 HoH: <b>${w.hoh}</b><br>
            🎯 Nominees: <b>${w.nominees.join(', ')}</b><br>
            ⚡ Veto: <b>${w.veto}</b> ${w.vetoUsed ? '(used)' : '(not used)'}<br>
            🚪 Evicted: <b>${w.evicted}</b>
            ${alliancesThisWeek.length ? `<br>${alliancesThisWeek.join('<br>')}` : ''}
          </div>
        </div>
      `;
    }).join('');
}

// ══════════════════════════════════════
//  RESTART
// ══════════════════════════════════════

function restartGame() {
  clearTimeout(_autoTimer);
  clearSavedGame();
  game = null;
  cast = [];
  renderCastList();
  showScreen('setupScreen');
}

// Manual "Abandon season": discard the in-progress game and return to setup.
function abandonSeason() {
  if (!confirm('Abandon this season? Your current progress will be permanently discarded.')) return;
  clearTimeout(_autoTimer);
  clearSavedGame();
  game = null;
  cast = [];
  renderCastList();
  showScreen('setupScreen');
}