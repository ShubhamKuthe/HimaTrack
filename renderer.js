const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { ipcRenderer } = require('electron');
const activeWin = require('active-win');
const {
  saveUsage: saveLocalUsage,
  loadUsageSince: loadLocalUsageSince,
  deleteOldUsage,
  deleteAllUsage: deleteAllLocalUsage
} = require('./database');
const {
  signUp: firebaseSignUp,
  signIn: firebaseSignIn,
  signOut: firebaseSignOut,
  getCurrentUser: getCurrentFirebaseUser,
  saveUserProfile: saveCloudUserProfile,
  saveUsageSegment: saveCloudUsageSegment,
  loadUsageSince: loadCloudUsageSince,
  deleteAllUsage: deleteAllCloudUsage
} = require('./firebase-service');

const currentAppElement = document.getElementById('current-app');
const currentWindowElement = document.getElementById('current-window');
const trackingStatusElement = document.getElementById('tracking-status');
const usageListElement = document.getElementById('usage-list');
const projectListElement = document.getElementById('project-list');
const totalTimeElement = document.getElementById('total-time');
const appsUsedElement = document.getElementById('apps-used');
const productivityScoreElement = document.getElementById('productivity-score');
const productivityNoteElement = document.getElementById('productivity-note');
const rangeNoteElement = document.getElementById('range-note');
const rangeLabelElement = document.getElementById('range-label');
const rangeModeElement = document.getElementById('range-mode');
const deviceFilterElement = document.getElementById('device-filter');
const prevRangeButton = document.getElementById('prev-range');
const nextRangeButton = document.getElementById('next-range');
const searchInputElement = document.getElementById('search-input');
const newTaskButton = document.getElementById('new-task');
const resetButton = document.getElementById('reset-time');
const usageChartElement = document.getElementById('usage-chart');
const weeklyChartElement = document.getElementById('weekly-chart');
const projectChartElement = document.getElementById('project-chart');
const weekdayChartElement = document.getElementById('weekday-chart');
const hourChartElement = document.getElementById('hour-chart');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const viewPanels = document.querySelectorAll('[data-view-panel]');
const reviewTableElement = document.getElementById('review-table');
const reviewDayListElement = document.getElementById('review-day-list');
const reviewFocusListElement = document.getElementById('review-focus-list');
const detailsTableElement = document.getElementById('details-table');
const reportsStatsElement = document.getElementById('reports-stats');
const reportsAppListElement = document.getElementById('reports-app-list');
const reportsProjectListElement = document.getElementById('reports-project-list');
const startupSplashElement = document.getElementById('startup-splash');
const macPermissionCardElement = document.getElementById('mac-permission-card');
const accessibilityStatusElement = document.getElementById('accessibility-status');
const screenStatusElement = document.getElementById('screen-status');
const openAccessibilityButton = document.getElementById('open-accessibility');
const openScreenRecordingButton = document.getElementById('open-screen-recording');
const authScreenElement = document.getElementById('auth-screen');
const authFormElement = document.getElementById('auth-form');
const authUsernameElement = document.getElementById('auth-username');
const authPasswordElement = document.getElementById('auth-password');
const authErrorElement = document.getElementById('auth-error');
const authSuccessElement = document.getElementById('auth-success');
const authSubmitElement = document.getElementById('auth-submit');
const loginTabElement = document.getElementById('login-tab');
const signupTabElement = document.getElementById('signup-tab');
const currentUserElement = document.getElementById('current-user');
const logoutButton = document.getElementById('logout');
const cloudSyncStatusElement = document.getElementById('cloud-sync-status');

const OLD_STORAGE_KEY = 'himatrackUsageHistory';
const MIGRATION_KEY = 'himatrackSqliteMigrated';
const ACTIVE_TASK_KEY = 'himatrackActiveTask';
const CURRENT_USER_KEY = 'himatrackCurrentUserId';
const CURRENT_USER_SESSION_KEY = 'himatrackCurrentUserSession';
const DEVICE_ID_KEY = 'himatrackDeviceId';
const PLATFORM_FILTER_KEY = 'himatrackPlatformFilter';
const CLOUD_SYNC_INTERVAL_MS = 5000;
const POLL_INTERVAL_MS = 1000;
const COMMIT_INTERVAL_MS = 5000;
const IDLE_AFTER_SECONDS = 60;
const HISTORY_DAYS = 30;
const STARTUP_SPLASH_MS = 2100;
const DEFAULT_APP_ICON = 'assets/default-app-icon.svg';

const chartColors = [
  '#70e3a4',
  '#61a8ff',
  '#f5df61',
  '#ffad66',
  '#a880ff',
  '#59d9d0',
  '#ff79b2',
  '#8fdd61',
  '#d2b16d',
  '#d57cff'
];

const productiveKeywords = [
  'code',
  'visual studio',
  'terminal',
  'powershell',
  'cmd',
  'github',
  'git',
  'figma',
  'excel',
  'word',
  'powerpoint',
  'outlook',
  'notion',
  'docs',
  'sheets',
  'slack',
  'teams',
  'chatgpt'
];

const distractingKeywords = [
  'youtube',
  'netflix',
  'instagram',
  'tiktok',
  'twitter',
  'x.com',
  'facebook',
  'reddit',
  'steam',
  'spotify'
];

let segments = [];
let cloudSegments = [];
let currentWindow = null;
let currentStartedAt = Date.now();
let selectedDate = new Date();
let rangeDays = 30;
let searchText = '';
let platformFilter = localStorage.getItem(PLATFORM_FILTER_KEY) || process.platform;
let isPolling = false;
let isIdle = false;
let idleStartedAt = null;
let activeTaskName = '';
let activeView = 'overview';
let authMode = 'login';
let currentUser = null;
const appIconCache = new Map();
const pendingIconRequests = new Map();
let isCloudRefreshPending = false;
let cloudStatusTimer = null;

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createDeviceId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCurrentDevice() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = createDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  return {
    id: deviceId,
    name: os.hostname() || 'This device',
    platform: process.platform
  };
}

const currentDevice = getCurrentDevice();
const supportedPlatformFilters = new Set(['win32', 'darwin']);

function getPlatformLabel(platform = currentDevice.platform) {
  if (platform === 'darwin') {
    return 'Mac';
  }

  if (platform === 'win32') {
    return 'Windows';
  }

  if (platform === 'linux') {
    return 'Linux';
  }

  return 'This Device';
}

function getCurrentDeviceLabel() {
  return getPlatformLabel();
}

function getSelectedPlatformLabel() {
  return getPlatformLabel(platformFilter);
}

function inferSegmentPlatform(segment) {
  if (segment.devicePlatform) {
    return segment.devicePlatform;
  }

  const text = `${segment.deviceName || ''} ${segment.executablePath || ''}`.toLowerCase();

  if (
    text.includes('mac') ||
    text.includes('/applications/') ||
    text.includes('.app/')
  ) {
    return 'darwin';
  }

  if (
    text.includes('windows') ||
    text.includes('win') ||
    text.includes('c:\\') ||
    text.includes('.exe')
  ) {
    return 'win32';
  }

  return '';
}

function normalizePlatformFilter() {
  if (!supportedPlatformFilters.has(platformFilter)) {
    platformFilter = supportedPlatformFilters.has(process.platform) ? process.platform : 'win32';
  }
}

function createSegmentId(segment) {
  const fingerprint = [
    segment.deviceId || currentDevice.id,
    segment.timestamp,
    segment.appName,
    segment.title || '',
    segment.taskName || '',
    Math.round(segment.durationMs)
  ].map((part) => String(part)).join('|');
  const hash = crypto
    .createHash('sha1')
    .update(fingerprint)
    .digest('hex')
    .slice(0, 18);

  return `${segment.deviceId || currentDevice.id}-${segment.timestamp.replace(/[^0-9]/g, '')}-${hash}`;
}

function playStartupSplash() {
  if (!startupSplashElement) {
    return;
  }

  setTimeout(() => {
    startupSplashElement.classList.add('leaving');

    setTimeout(() => {
      startupSplashElement.classList.remove('active');
    }, 460);
  }, STARTUP_SPLASH_MS);
}

function formatPermissionStatus(status) {
  if (!status) {
    return 'Unknown';
  }

  if (status === 'granted') {
    return 'Granted';
  }

  if (status === 'denied' || status === 'restricted') {
    return 'Needs permission';
  }

  return String(status).replace(/-/g, ' ');
}

async function refreshMacPermissions() {
  if (!macPermissionCardElement) {
    return;
  }

  try {
    const status = await ipcRenderer.invoke('get-mac-permission-status');

    if (!status?.isMac) {
      macPermissionCardElement.classList.remove('active');
      return;
    }

    macPermissionCardElement.classList.add('active');
    setText(accessibilityStatusElement, formatPermissionStatus(status.accessibility));
    setText(screenStatusElement, formatPermissionStatus(status.screenRecording));
  } catch (error) {
    console.warn('Could not check macOS permissions:', error);
  }
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getTimestamp(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${getDateKey(date)} ${hours}:${minutes}:${seconds}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeAppName(windowInfo) {
  const ownerName = normalizeText(windowInfo?.owner?.name);
  const ownerPath = normalizeText(windowInfo?.owner?.path);
  const title = normalizeText(windowInfo?.title);

  if (ownerPath) {
    const parsedName = path.basename(ownerPath, path.extname(ownerPath));

    if (parsedName && parsedName.toLowerCase() !== 'electron') {
      return parsedName;
    }
  }

  if (ownerName && ownerName.toLowerCase() !== 'electron') {
    return ownerName;
  }

  if (title.toLowerCase().includes('himatrack')) {
    return 'HimaTrack';
  }

  return ownerName || title || 'Unknown app';
}

function normalizeWindow(windowInfo) {
  if (!windowInfo) {
    return null;
  }

  return {
    appName: normalizeAppName(windowInfo),
    title: normalizeText(windowInfo.title),
    executablePath: normalizeText(windowInfo.owner?.path),
    id: windowInfo.id || null
  };
}

function areSameWindow(first, second) {
  if (!first || !second) {
    return false;
  }

  return (
    first.appName === second.appName &&
    first.title === second.title &&
    first.executablePath === second.executablePath
  );
}

function migrateLocalStorageToSQLite() {
  if (!currentUser || localStorage.getItem(`${MIGRATION_KEY}:${currentUser.id}`)) {
    return;
  }

  try {
    const oldHistory = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY)) || {};

    Object.entries(oldHistory).forEach(([dateKey, apps]) => {
      Object.entries(apps).forEach(([appName, durationMs]) => {
        saveLocalUsage(
          appName,
          durationMs,
          `${dateKey} 12:00:00`,
          '',
          '',
          '',
          currentUser.id,
          currentDevice.id,
          currentDevice.name,
          currentDevice.platform
        );
      });
    });
  } catch (error) {
    console.warn('Could not migrate old localStorage data:', error);
  }

  localStorage.setItem(`${MIGRATION_KEY}:${currentUser.id}`, 'true');
}

function deleteOldHistory() {
  const oldestDate = addDays(new Date(), -HISTORY_DAYS);
  deleteOldUsage(`${getDateKey(oldestDate)} 00:00:00`);
}

async function resetTrackedTime() {
  if (!currentUser) {
    return;
  }

  const shouldReset = window.confirm(
    'Reset all tracked time? This clears the saved app history and starts the current timer from zero.'
  );

  if (!shouldReset) {
    return;
  }

  deleteAllLocalUsage(currentUser.id);

  try {
    await deleteAllCloudUsage(currentUser.id);
  } catch (error) {
    console.warn('Could not reset cloud usage:', error);
  }

  segments = [];
  cloudSegments = [];
  currentStartedAt = Date.now();

  if (!currentUser) {
    setText(currentAppElement, 'Paused');
    setText(currentWindowElement, 'Sign in to start tracking');
    setText(trackingStatusElement, 'Sign in required');
  } else if (isIdle) {
    idleStartedAt = currentStartedAt;
  }

  renderDashboard();
}

function loadHistoryFromDatabase() {
  if (!currentUser) {
    segments = [];
    return;
  }

  const oldestDate = addDays(new Date(), -HISTORY_DAYS);
  const oldestTimestamp = `${getDateKey(oldestDate)} 00:00:00`;

  segments = loadLocalUsageSince(oldestTimestamp, currentUser.id).map((row) => ({
    appName: row.app_name,
    title: row.window_title || '',
    executablePath: row.executable_path || '',
    iconDataUrl: '',
    taskName: row.task_name || '',
    durationMs: row.duration_ms,
    timestamp: row.timestamp,
    deviceId: row.device_id || 'legacy-local',
    deviceName: row.device_name || 'Legacy local data',
    devicePlatform: row.device_platform || ''
  }));
}

async function loadHistoryFromCloud() {
  if (!currentUser) {
    return;
  }

  if (isCloudRefreshPending) {
    return;
  }

  const oldestDate = addDays(new Date(), -HISTORY_DAYS);
  const oldestTimestamp = `${getDateKey(oldestDate)} 00:00:00`;

  isCloudRefreshPending = true;

  try {
    const cloudRows = await loadCloudUsageSince(currentUser.id, oldestTimestamp);

    cloudSegments = cloudRows;
    renderDashboard();
  } catch (error) {
    console.warn('Could not load cloud usage, using local cache:', error);
    setCloudSyncStatus(`Cloud read failed: ${getSyncErrorMessage(error)}`, 'error', false);
  } finally {
    isCloudRefreshPending = false;
  }
}

function commitCurrentSegment(force = false, endTime = Date.now()) {
  if (!currentUser || !currentWindow) {
    return;
  }

  const durationMs = endTime - currentStartedAt;

  if (durationMs < 500 || (!force && durationMs < COMMIT_INTERVAL_MS)) {
    return;
  }

  const timestamp = getTimestamp(new Date(currentStartedAt));
  const iconKey = getIconKey(currentWindow);
  const cachedIcon = appIconCache.get(iconKey);
  const segment = {
    appName: currentWindow.appName,
    title: currentWindow.title,
    executablePath: currentWindow.executablePath,
    iconDataUrl: cachedIcon && cachedIcon !== DEFAULT_APP_ICON ? cachedIcon : '',
    taskName: activeTaskName,
    durationMs,
    timestamp,
    deviceId: currentDevice.id,
    deviceName: currentDevice.name,
    devicePlatform: currentDevice.platform
  };

  segment.id = createSegmentId(segment);

  saveLocalUsage(
    segment.appName,
    segment.durationMs,
    segment.timestamp,
    segment.title,
    segment.executablePath,
    segment.taskName,
    currentUser.id,
    segment.deviceId,
    segment.deviceName,
    segment.devicePlatform
  );

  saveCloudUsageSegment(currentUser.id, segment).then(() => {
    if (!cloudSegments.some((savedSegment) => savedSegment.id === segment.id)) {
      cloudSegments.push(segment);
    }

    setCloudSyncStatus('Cloud sync saved', 'ok');
    renderDashboard();
  }).catch((error) => {
    console.warn('Could not save cloud usage:', error);
    setCloudSyncStatus(`Cloud upload failed: ${getSyncErrorMessage(error)}`, 'error', false);
  });

  segments.push(segment);
  currentStartedAt = endTime;
}

function getLiveSegment() {
  if (!currentWindow || isIdle) {
    return null;
  }

  const iconKey = getIconKey(currentWindow);
  const cachedIcon = appIconCache.get(iconKey);

  return {
    appName: currentWindow.appName,
    title: currentWindow.title,
    executablePath: currentWindow.executablePath,
    iconDataUrl: cachedIcon && cachedIcon !== DEFAULT_APP_ICON ? cachedIcon : '',
    taskName: activeTaskName,
    durationMs: Math.max(0, Date.now() - currentStartedAt),
    timestamp: getTimestamp(new Date(currentStartedAt)),
    deviceId: currentDevice.id,
    deviceName: currentDevice.name,
    devicePlatform: currentDevice.platform,
    isLive: true
  };
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getRangeDates() {
  const dates = [];
  const startDate = addDays(selectedDate, -(rangeDays - 1));

  for (let index = 0; index < rangeDays; index += 1) {
    dates.push(addDays(startDate, index));
  }

  return dates;
}

function getRangeBounds() {
  const dates = getRangeDates();
  const start = getTimestamp(startOfDay(dates[0]));
  const end = getTimestamp(endOfDay(dates[dates.length - 1]));

  return { start, end };
}

function isInSelectedRange(segment) {
  const { start, end } = getRangeBounds();

  return segment.timestamp >= start && segment.timestamp <= end;
}

function matchesDeviceScope(segment) {
  return inferSegmentPlatform(segment) === platformFilter;
}

function getRangeSegments(includeLive = true) {
  const isCurrentPlatform = platformFilter === currentDevice.platform;
  const cloudPlatformSegments = cloudSegments.filter(matchesDeviceScope);
  const baseSegments = isCurrentPlatform
    ? segments
    : cloudPlatformSegments;
  const liveSegment = getLiveSegment();
  const shouldIncludeLive = includeLive && liveSegment && isCurrentPlatform;
  const allSegments = shouldIncludeLive
    ? [...baseSegments, liveSegment]
    : [...baseSegments];

  return allSegments
    .filter(isInSelectedRange)
    .filter(matchesDeviceScope);
}

function matchesSearch(segment) {
  if (!searchText) {
    return true;
  }

  const haystack = `${segment.appName} ${segment.title}`.toLowerCase();
  return haystack.includes(searchText);
}

function getFilteredRangeSegments() {
  return getRangeSegments(true).filter(matchesSearch);
}

function summarizeBy(items, getKey) {
  return items.reduce((summary, item) => {
    const key = getKey(item) || 'Unknown';
    summary[key] = (summary[key] || 0) + item.durationMs;
    return summary;
  }, {});
}

function sortUsage(summary) {
  return Object.entries(summary).sort((a, b) => b[1] - a[1]);
}

function summarizeApplications(items) {
  const apps = items.reduce((summary, item) => {
    const appName = item.appName || 'Unknown';

    if (!summary[appName]) {
      summary[appName] = {
        name: appName,
        durationMs: 0,
        executablePath: '',
        iconDataUrl: '',
        devicePlatform: item.devicePlatform || ''
      };
    }

    summary[appName].durationMs += item.durationMs;

    if (!summary[appName].executablePath && item.executablePath) {
      summary[appName].executablePath = item.executablePath;
    }

    if (!summary[appName].iconDataUrl && item.iconDataUrl) {
      summary[appName].iconDataUrl = item.iconDataUrl;
    }

    if (!summary[appName].devicePlatform && item.devicePlatform) {
      summary[appName].devicePlatform = item.devicePlatform;
    }

    return summary;
  }, {});

  return Object.values(apps).sort((a, b) => b.durationMs - a.durationMs);
}

function getIconKey(appEntry) {
  const appName = appEntry.name || appEntry.appName || 'Unknown app';

  if (appEntry.iconDataUrl) {
    return `uploaded:${appEntry.devicePlatform || inferSegmentPlatform(appEntry)}:${appName}`;
  }

  return appEntry.executablePath || `app:${appName}`;
}

function updateIconElements(iconKey) {
  const iconSource = appIconCache.get(iconKey) || DEFAULT_APP_ICON;

  document.querySelectorAll('.app-icon[data-icon-key]').forEach((image) => {
    if (image.dataset.iconKey === iconKey) {
      image.src = iconSource;
    }
  });
}

function requestAppIcon(appEntry) {
  const iconKey = getIconKey(appEntry);

  if (appEntry.iconDataUrl) {
    appIconCache.set(iconKey, appEntry.iconDataUrl);
    updateIconElements(iconKey);
    return;
  }

  if (appIconCache.has(iconKey) || pendingIconRequests.has(iconKey)) {
    return;
  }

  if (!appEntry.executablePath) {
    appIconCache.set(iconKey, DEFAULT_APP_ICON);
    updateIconElements(iconKey);
    return;
  }

  const request = ipcRenderer.invoke('get-app-icon', appEntry.executablePath)
    .then((iconDataUrl) => {
      appIconCache.set(iconKey, iconDataUrl || DEFAULT_APP_ICON);
      updateIconElements(iconKey);
    })
    .catch((error) => {
      console.warn(`Could not request icon for ${appEntry.name || appEntry.appName}:`, error);
      appIconCache.set(iconKey, DEFAULT_APP_ICON);
      updateIconElements(iconKey);
    })
    .finally(() => {
      pendingIconRequests.delete(iconKey);
    });

  pendingIconRequests.set(iconKey, request);
}

async function getSystemIdleSeconds() {
  try {
    return await ipcRenderer.invoke('get-system-idle-time');
  } catch (error) {
    console.warn('System idle detection is unavailable:', error);
    return 0;
  }
}

function enterIdleMode(idleSeconds) {
  if (isIdle) {
    return;
  }

  const now = Date.now();
  const estimatedIdleStart = now - idleSeconds * 1000;
  const safeIdleStart = Math.max(currentStartedAt, estimatedIdleStart);

  commitCurrentSegment(true, safeIdleStart);
  isIdle = true;
  idleStartedAt = safeIdleStart;
}

function leaveIdleMode() {
  if (!isIdle) {
    return;
  }

  isIdle = false;
  idleStartedAt = null;
  currentWindow = null;
  currentStartedAt = Date.now();
}

function classifySegment(segment) {
  const text = `${segment.appName} ${segment.title}`.toLowerCase();

  if (distractingKeywords.some((keyword) => text.includes(keyword))) {
    return 'distracting';
  }

  if (productiveKeywords.some((keyword) => text.includes(keyword))) {
    return 'productive';
  }

  return 'neutral';
}

function getProductivityScore(rangeSegments) {
  const totalMs = rangeSegments.reduce((total, segment) => total + segment.durationMs, 0);

  if (!totalMs) {
    return 0;
  }

  const weightedMs = rangeSegments.reduce((total, segment) => {
    const classification = classifySegment(segment);

    if (classification === 'productive') {
      return total + segment.durationMs;
    }

    if (classification === 'neutral') {
      return total + segment.durationMs * 0.5;
    }

    return total;
  }, 0);

  return Math.round((weightedMs / totalMs) * 100);
}

function getProjectName(segment) {
  if (segment.taskName) {
    return segment.taskName;
  }

  const title = normalizeText(segment.title);

  if (!title) {
    return segment.appName;
  }

  const separators = [
    ' - Google Chrome',
    ' - Microsoft Edge',
    ' - Visual Studio Code',
    ' - Cursor',
    ' - Brave',
    ' - Mozilla Firefox',
    ' | '
  ];

  let projectName = title;

  separators.forEach((separator) => {
    if (projectName.includes(separator)) {
      projectName = projectName.split(separator)[0];
    }
  });

  return projectName.slice(0, 80) || segment.appName;
}

function setText(element, value) {
  if (element) {
    const textTarget = element.querySelector?.('.user-pill-text');

    if (textTarget) {
      textTarget.textContent = value;
      element.title = value;
      return;
    }

    element.textContent = value;
  }
}

function getSyncErrorMessage(error) {
  const code = error?.code || '';
  const message = error?.message || 'Unknown Firebase error';

  if (code === 'permission-denied' || message.includes('permission-denied')) {
    return 'Firebase blocked the write. Publish the Firestore rules for signed-in users.';
  }

  if (code === 'unavailable' || message.includes('offline')) {
    return 'Firebase is offline or unreachable. Check internet and try again.';
  }

  if (code === 'failed-precondition' && message.includes('index')) {
    return 'Firebase needs an index for this query. Open the console link in DevTools.';
  }

  return `${code ? `${code}: ` : ''}${message}`;
}

function setCloudSyncStatus(message, type = 'info', autoHide = true) {
  if (!cloudSyncStatusElement) {
    return;
  }

  if (cloudStatusTimer) {
    clearTimeout(cloudStatusTimer);
    cloudStatusTimer = null;
  }

  cloudSyncStatusElement.textContent = message;
  cloudSyncStatusElement.className = `toolbar-box sync-toast active ${type}`;

  if (autoHide) {
    cloudStatusTimer = setTimeout(() => {
      cloudSyncStatusElement.classList.remove('active');
    }, 3500);
  }
}

function setAuthMode(nextMode) {
  authMode = nextMode;
  const isSignup = authMode === 'signup';

  loginTabElement?.classList.toggle('active', !isSignup);
  signupTabElement?.classList.toggle('active', isSignup);
  authSuccessElement?.classList.remove('active');
  setText(authSubmitElement, isSignup ? 'Create Account' : 'Sign In');
  setText(authErrorElement, '');

  if (authPasswordElement) {
    authPasswordElement.autocomplete = isSignup ? 'new-password' : 'current-password';
  }
}

function getFirebaseAuthMessage(error, mode) {
  const code = error?.code || '';

  const messages = {
    'auth/email-already-in-use': 'This email already has an account. Use Sign In instead.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/missing-email': 'Enter your email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/user-not-found': 'No account found with this email. Use Sign Up first.',
    'auth/wrong-password': 'Wrong password for this email.',
    'auth/invalid-credential': mode === 'signup'
      ? 'Could not create account. Check the email and password.'
      : 'Wrong email or password.',
    'auth/network-request-failed': 'Network error. Check your internet connection.',
    'auth/configuration-not-found': 'Firebase Email/Password sign-in is not enabled yet.'
  };

  return messages[code] || error?.message || 'Could not complete sign in.';
}

function showAuthScreen() {
  authScreenElement?.classList.add('active');
  setText(currentUserElement, 'Not signed in');
  setText(trackingStatusElement, 'Sign in required');
  setText(currentAppElement, 'Paused');
  setText(currentWindowElement, 'Sign in to start tracking');
}

function hideAuthScreen() {
  authScreenElement?.classList.remove('active');
}

function saveLocalUserSession(user) {
  if (!user?.id) {
    return;
  }

  localStorage.setItem(CURRENT_USER_KEY, String(user.id));
  localStorage.setItem(CURRENT_USER_SESSION_KEY, JSON.stringify({
    id: user.id,
    username: user.username || user.email || 'Firebase user',
    email: user.email || ''
  }));
}

function getLocalUserSession() {
  try {
    const savedUser = JSON.parse(localStorage.getItem(CURRENT_USER_SESSION_KEY));

    if (savedUser?.id) {
      return savedUser;
    }
  } catch (error) {
    console.warn('Could not read saved user session:', error);
  }

  return null;
}

function clearLocalUserSession() {
  localStorage.removeItem(CURRENT_USER_KEY);
  localStorage.removeItem(CURRENT_USER_SESSION_KEY);
}

async function applySignedInUser(user) {
  if (!user?.id) {
    throw new Error('Firebase signed in, but no user profile was returned.');
  }

  currentUser = user;
  saveLocalUserSession(user);
  activeTaskName = localStorage.getItem(`${ACTIVE_TASK_KEY}:${user.id}`) || '';
  hideAuthScreen();
  setText(currentUserElement, user.username);
  currentWindow = null;
  currentStartedAt = Date.now();

  setCloudSyncStatus('Connecting to Firebase...', 'info', false);

  try {
    await saveCloudUserProfile(user, currentDevice);
    setCloudSyncStatus('Firebase connected', 'ok');
  } catch (error) {
    console.warn('Could not save Firebase profile:', error);
    setCloudSyncStatus(`Firebase setup failed: ${getSyncErrorMessage(error)}`, 'error', false);
  }

  try {
    migrateLocalStorageToSQLite();
    deleteOldHistory();
    loadHistoryFromDatabase();
  } catch (error) {
    console.warn('Could not load local tracking cache:', error);
    segments = [];
  }

  renderDashboard();
  pollActiveWindow();

  loadHistoryFromCloud()
    .then(() => {
      renderDashboard();
    })
    .catch((error) => {
      console.warn('Could not refresh cloud history:', error);
    });
}

function signOut() {
  if (!currentUser) {
    showAuthScreen();
    return;
  }

  if (!isIdle) {
    commitCurrentSegment(true);
  }

  firebaseSignOut().catch((error) => {
    console.warn('Could not sign out of Firebase:', error);
  }).finally(() => {
    currentUser = null;
    currentWindow = null;
    segments = [];
    cloudSegments = [];
    activeTaskName = '';
    clearLocalUserSession();
    showAuthScreen();
    renderDashboard();
  });
}

async function restoreSession() {
  const savedUser = getLocalUserSession();

  if (savedUser) {
    await applySignedInUser(savedUser);
  }

  const user = await getCurrentFirebaseUser();
  
  if (!user) {
    if (!savedUser) {
      clearLocalUserSession();
      showAuthScreen();
    }

    return;
  }

  await applySignedInUser(user);
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = String(authUsernameElement?.value || '').trim().toLowerCase();
  const password = authPasswordElement?.value || '';

  if (authUsernameElement) {
    authUsernameElement.value = email;
  }

  setText(authErrorElement, authMode === 'signup' ? 'Creating account...' : 'Signing in...');

  if (authSubmitElement) {
    authSubmitElement.disabled = true;
  }

  try {
    const authUser = authMode === 'signup'
      ? await firebaseSignUp(email, password)
      : await firebaseSignIn(email, password);
    const user = authUser || await getCurrentFirebaseUser();

    if (authPasswordElement) {
      authPasswordElement.value = '';
    }

    setText(authErrorElement, '');

    if (authMode === 'signup') {
      authSuccessElement?.classList.add('active');
      await wait(900);
    }

    await applySignedInUser(user);
  } catch (error) {
    authSuccessElement?.classList.remove('active');
    setText(authErrorElement, getFirebaseAuthMessage(error, authMode));
  } finally {
    if (authSubmitElement) {
      authSubmitElement.disabled = false;
    }
  }
}

function setActiveView(viewName) {
  activeView = viewName;

  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  viewPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.viewPanel === viewName);
  });

  renderDashboard();
}

function getRangeLabel() {
  const dates = getRangeDates();
  const first = dates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const last = dates[dates.length - 1].toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const todayKey = getDateKey(new Date());
  const selectedKey = getDateKey(selectedDate);

  if (rangeDays === 1 && selectedKey === todayKey) {
    return 'Today';
  }

  if (rangeDays === 1) {
    return first;
  }

  return `${first} - ${last}`;
}

function renderList(element, entries, emptyText) {
  if (!element) {
    return;
  }

  if (!entries.length) {
    element.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }

  const maxMs = entries[0][1] || 1;

  element.innerHTML = entries.slice(0, 12).map(([name, durationMs]) => {
    const width = Math.max(4, Math.round((durationMs / maxMs) * 100));

    return `
      <div class="usage-row">
        <div class="row-main">
          <span>${escapeHtml(name)}</span>
          <div class="row-meter">
            <div style="width: ${width}%"></div>
          </div>
        </div>
        <span>${formatTime(durationMs)}</span>
      </div>
    `;
  }).join('');
}

function renderAppList(element, entries, emptyText) {
  if (!element) {
    return;
  }

  if (!entries.length) {
    element.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }

  const maxMs = entries[0].durationMs || 1;

  element.innerHTML = entries.slice(0, 12).map((entry) => {
    const iconKey = getIconKey(entry);
    const iconSource = appIconCache.get(iconKey) || DEFAULT_APP_ICON;
    const width = Math.max(4, Math.round((entry.durationMs / maxMs) * 100));

    requestAppIcon(entry);

    return `
      <div class="usage-row">
        <div class="row-main">
          <div class="app-label">
            <img
              class="app-icon"
              src="${escapeHtml(iconSource)}"
              data-icon-key="${escapeHtml(iconKey)}"
              alt=""
            />
            <span>${escapeHtml(entry.name)}</span>
          </div>
          <div class="row-meter">
            <div style="width: ${width}%"></div>
          </div>
        </div>
        <span>${formatTime(entry.durationMs)}</span>
      </div>
    `;
  }).join('');
}

function formatClock(timestamp) {
  const date = new Date(timestamp.replace(' ', 'T'));

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderReviewView(rangeSegments) {
  if (reviewTableElement) {
    const rows = [...rangeSegments]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 80);

    reviewTableElement.innerHTML = rows.length
      ? rows.map((segment) => `
          <tr>
            <td>${escapeHtml(formatClock(segment.timestamp))}</td>
            <td>${escapeHtml(segment.appName)}</td>
            <td title="${escapeHtml(segment.title)}">${escapeHtml(segment.title || 'Active window')}</td>
            <td>${escapeHtml(segment.taskName || '-')}</td>
            <td>${formatTime(segment.durationMs)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="5">No review history yet</td></tr>';
  }

  const dayEntries = getDayTotals(rangeSegments)
    .filter((day) => day.totalMs > 0)
    .map((day) => [
      day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      day.totalMs
    ])
    .sort((a, b) => b[1] - a[1]);

  const focusEntries = sortUsage(summarizeBy(rangeSegments, classifySegment));

  renderList(reviewDayListElement, dayEntries, 'No daily totals yet');
  renderList(reviewFocusListElement, focusEntries, 'No focus data yet');
}

function renderDetailsView(rangeSegments) {
  if (!detailsTableElement) {
    return;
  }

  const apps = summarizeApplications(rangeSegments).map((app) => {
    const latestSegment = rangeSegments
      .filter((segment) => segment.appName === app.name)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

    return {
      ...app,
      lastUsed: latestSegment?.timestamp || '',
      executablePath: app.executablePath || latestSegment?.executablePath || ''
    };
  });

  detailsTableElement.innerHTML = apps.length
    ? apps.map((app) => `
        <tr>
          <td>${escapeHtml(app.name)}</td>
          <td>${formatTime(app.durationMs)}</td>
          <td>${escapeHtml(app.lastUsed ? formatClock(app.lastUsed) : '-')}</td>
          <td title="${escapeHtml(app.executablePath)}">${escapeHtml(app.executablePath || '-')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No application details yet</td></tr>';
}

function renderReportsView(rangeSegments, appEntries, projectEntries, productivityScore) {
  const totalMs = rangeSegments.reduce((total, segment) => total + segment.durationMs, 0);
  const activeDays = getDayTotals(rangeSegments).filter((day) => day.totalMs > 0).length;
  const topApp = appEntries[0]?.name || '-';

  if (reportsStatsElement) {
    reportsStatsElement.innerHTML = `
      <div class="stat-box">
        <div class="stat-label">Total Time</div>
        <div class="stat-value">${formatTime(totalMs)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Productivity</div>
        <div class="stat-value">${productivityScore}%</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Active Days</div>
        <div class="stat-value">${activeDays}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Applications</div>
        <div class="stat-value">${appEntries.length}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Top App</div>
        <div class="stat-value">${escapeHtml(topApp)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Range</div>
        <div class="stat-value">${escapeHtml(getRangeLabel())}</div>
      </div>
    `;
  }

  renderAppList(reportsAppListElement, appEntries, 'No app report yet');
  renderList(reportsProjectListElement, projectEntries, 'No project report yet');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function prepareCanvas(canvas) {
  if (!canvas) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  return { context, width, height };
}

function drawEmptyCanvas(canvas, text) {
  const prepared = prepareCanvas(canvas);

  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  context.fillStyle = '#8c969e';
  context.font = '14px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, width / 2, height / 2);
}

function drawDonutChart(canvas, entries) {
  if (!entries.length) {
    drawEmptyCanvas(canvas, 'No data yet');
    return;
  }

  const prepared = prepareCanvas(canvas);

  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(42, Math.min(width, height) * 0.38);
  const lineWidth = Math.max(20, radius * 0.3);
  let angle = -Math.PI / 2;

  entries.slice(0, chartColors.length).forEach((entry, index) => {
    const value = entry[1];
    const slice = (value / total) * Math.PI * 2;

    context.beginPath();
    context.arc(centerX, centerY, radius, angle, angle + slice);
    context.strokeStyle = chartColors[index % chartColors.length];
    context.lineWidth = lineWidth;
    context.lineCap = 'butt';
    context.stroke();

    angle += slice;
  });

  context.fillStyle = '#d6dde3';
  context.font = '700 20px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(formatTime(total), centerX, centerY - 4);
  context.fillStyle = '#8c969e';
  context.font = '12px Arial';
  context.fillText('total', centerX, centerY + 18);
}

function drawMiniBars(canvas, labels, values, color) {
  const prepared = prepareCanvas(canvas);

  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  const maxValue = Math.max(...values, 1);
  const gap = 5;
  const labelHeight = 18;
  const chartHeight = height - labelHeight - 6;
  const barWidth = Math.max(4, (width - gap * (values.length - 1)) / values.length);

  values.forEach((value, index) => {
    const barHeight = Math.max(value > 0 ? 3 : 0, (value / maxValue) * chartHeight);
    const x = index * (barWidth + gap);
    const y = chartHeight - barHeight;

    context.fillStyle = value > 0 ? color : '#26323a';
    context.fillRect(x, y, barWidth, barHeight);

    context.fillStyle = '#87919a';
    context.font = '11px Arial';
    context.textAlign = 'center';
    context.fillText(labels[index], x + barWidth / 2, height - 4);
  });
}

function drawDailyChart(canvas, dayTotals) {
  if (!dayTotals.some((item) => item.totalMs > 0)) {
    drawEmptyCanvas(canvas, 'Tracking will appear here');
    return;
  }

  const prepared = prepareCanvas(canvas);

  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  const padding = { top: 12, right: 18, bottom: 34, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...dayTotals.map((item) => item.totalMs), 1);
  const gap = 6;
  const barWidth = Math.max(7, (chartWidth - gap * (dayTotals.length - 1)) / dayTotals.length);

  context.strokeStyle = '#2d3941';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding.left, padding.top);
  context.lineTo(padding.left, padding.top + chartHeight);
  context.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  context.stroke();

  dayTotals.forEach((item, index) => {
    const barHeight = Math.max(item.totalMs > 0 ? 3 : 0, (item.totalMs / maxValue) * chartHeight);
    const x = padding.left + index * (barWidth + gap);
    const y = padding.top + chartHeight - barHeight;

    context.fillStyle = '#61a8ff';
    context.fillRect(x, y, barWidth, barHeight);

    if (rangeDays <= 7 || index % Math.ceil(rangeDays / 8) === 0) {
      context.fillStyle = '#87919a';
      context.font = '11px Arial';
      context.textAlign = 'center';
      context.fillText(
        item.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        x + barWidth / 2,
        height - 12
      );
    }
  });

  context.fillStyle = '#cbd3d9';
  context.font = '12px Arial';
  context.textAlign = 'left';
  context.fillText(formatTime(maxValue), 4, padding.top + 10);
}

function getWeekdayTotals(rangeSegments) {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const values = Array(7).fill(0);

  rangeSegments.forEach((segment) => {
    const date = new Date(segment.timestamp.replace(' ', 'T'));
    values[date.getDay()] += segment.durationMs;
  });

  return { labels, values };
}

function getHourTotals(rangeSegments) {
  const labels = ['0', '3', '6', '9', '12', '15', '18', '21'];
  const buckets = Array(8).fill(0);

  rangeSegments.forEach((segment) => {
    const hour = Number(segment.timestamp.slice(11, 13));
    const bucket = Math.min(7, Math.floor(hour / 3));
    buckets[bucket] += segment.durationMs;
  });

  return { labels, values: buckets };
}

function getDayTotals(rangeSegments) {
  const totalsByDate = summarizeBy(rangeSegments, (segment) => segment.timestamp.slice(0, 10));

  return getRangeDates().map((date) => ({
    date,
    totalMs: totalsByDate[getDateKey(date)] || 0
  }));
}

function renderDashboard() {
  const rangeSegments = getFilteredRangeSegments();
  const totalMs = rangeSegments.reduce((total, segment) => total + segment.durationMs, 0);
  const appEntries = summarizeApplications(rangeSegments);
  const appChartEntries = appEntries.map((entry) => [entry.name, entry.durationMs]);
  const projectEntries = sortUsage(summarizeBy(rangeSegments, getProjectName));
  const productivityScore = getProductivityScore(rangeSegments);
  const weekdayTotals = getWeekdayTotals(rangeSegments);
  const hourTotals = getHourTotals(rangeSegments);

  setText(currentUserElement, currentUser ? currentUser.username : 'Not signed in');
  setText(totalTimeElement, formatTime(totalMs));
  setText(appsUsedElement, String(appEntries.length));
  setText(rangeLabelElement, getRangeLabel());
  setText(
    rangeNoteElement,
    searchText
      ? 'Filtered range'
      : getSelectedPlatformLabel()
  );
  setText(productivityScoreElement, `${productivityScore}%`);
  setText(
    productivityNoteElement,
    totalMs ? `${formatTime(totalMs)} scored` : 'No scored time yet'
  );

  if (isIdle) {
    const idleMs = idleStartedAt ? Date.now() - idleStartedAt : 0;

    setText(currentAppElement, 'Idle');
    setText(currentWindowElement, `Paused for ${formatTime(idleMs)}`);
    setText(trackingStatusElement, 'Idle');
  } else if (currentWindow) {
    setText(currentAppElement, currentWindow.appName);
    setText(currentWindowElement, currentWindow.title || 'Active window detected');
    setText(trackingStatusElement, 'Tracking live');
  } else {
    setText(currentAppElement, 'Waiting');
    setText(currentWindowElement, 'Switch to another app to start tracking');
  }

  renderAppList(usageListElement, appEntries, 'No usage data yet');
  renderList(projectListElement, projectEntries, 'No history yet');
  drawDonutChart(usageChartElement, appChartEntries);
  drawDonutChart(projectChartElement, projectEntries);
  drawMiniBars(weekdayChartElement, weekdayTotals.labels, weekdayTotals.values, '#70e3a4');
  drawMiniBars(hourChartElement, hourTotals.labels, hourTotals.values, '#f5df61');
  drawDailyChart(weeklyChartElement, getDayTotals(rangeSegments));

  if (newTaskButton) {
    newTaskButton.textContent = activeTaskName || 'New Task';
    newTaskButton.title = activeTaskName
      ? `Tracking task: ${activeTaskName}`
      : 'Create a task for tracked time';
  }

  renderReviewView(rangeSegments);
  renderDetailsView(rangeSegments);
  renderReportsView(rangeSegments, appEntries, projectEntries, productivityScore);
}

async function pollActiveWindow() {
  if (!currentUser) {
    return;
  }

  if (isPolling) {
    return;
  }

  isPolling = true;

  try {
    const idleSeconds = await getSystemIdleSeconds();

    if (idleSeconds >= IDLE_AFTER_SECONDS) {
      enterIdleMode(idleSeconds);
      renderDashboard();
      return;
    }

    if (isIdle) {
      leaveIdleMode();
    }

    const windowInfo = normalizeWindow(await activeWin());

    if (!windowInfo) {
      commitCurrentSegment(true);
      currentWindow = null;
      setText(trackingStatusElement, 'No active window');
      renderDashboard();
      return;
    }

    requestAppIcon({
      name: windowInfo.appName,
      executablePath: windowInfo.executablePath,
      devicePlatform: currentDevice.platform
    });

    if (!currentWindow) {
      currentWindow = windowInfo;
      currentStartedAt = Date.now();
    } else if (!areSameWindow(currentWindow, windowInfo)) {
      commitCurrentSegment(true);
      currentWindow = windowInfo;
      currentStartedAt = Date.now();
    } else {
      commitCurrentSegment(false);
    }

    renderDashboard();
  } catch (error) {
    console.error('Unable to read active window:', error);
    setText(currentAppElement, 'Paused');
    setText(currentWindowElement, error.message || 'Active window unavailable');
    setText(trackingStatusElement, 'Tracking error');
    renderDashboard();
  } finally {
    isPolling = false;
  }
}

function moveRange(days) {
  selectedDate = addDays(selectedDate, days);
  renderDashboard();
}

function bindEvents() {
  loginTabElement?.addEventListener('click', () => {
    setAuthMode('login');
  });

  signupTabElement?.addEventListener('click', () => {
    setAuthMode('signup');
  });

  authFormElement?.addEventListener('submit', handleAuthSubmit);

  logoutButton?.addEventListener('click', () => {
    signOut();
  });

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      setActiveView(item.dataset.view);
    });
  });

  openAccessibilityButton?.addEventListener('click', () => {
    ipcRenderer.invoke('open-mac-permission-pane', 'accessibility');
  });

  openScreenRecordingButton?.addEventListener('click', () => {
    ipcRenderer.invoke('open-mac-permission-pane', 'screen');
  });

  rangeModeElement?.addEventListener('change', () => {
    rangeDays = Number(rangeModeElement.value);
    selectedDate = new Date();
    renderDashboard();
  });

  if (deviceFilterElement) {
    normalizePlatformFilter();
    deviceFilterElement.value = platformFilter;

    deviceFilterElement.addEventListener('change', () => {
      platformFilter = deviceFilterElement.value;
      localStorage.setItem(PLATFORM_FILTER_KEY, platformFilter);
      loadHistoryFromCloud();
      renderDashboard();
    });
  }

  prevRangeButton?.addEventListener('click', () => {
    moveRange(-rangeDays);
  });

  nextRangeButton?.addEventListener('click', () => {
    moveRange(rangeDays);
  });

  searchInputElement?.addEventListener('input', () => {
    searchText = searchInputElement.value.trim().toLowerCase();
    renderDashboard();
  });

  newTaskButton?.addEventListener('click', () => {
    if (!currentUser) {
      showAuthScreen();
      return;
    }

    const taskName = window.prompt('Task name for new tracked time:', activeTaskName);

    if (taskName === null) {
      return;
    }

    commitCurrentSegment(true);
    activeTaskName = taskName.trim();

    if (activeTaskName) {
      localStorage.setItem(`${ACTIVE_TASK_KEY}:${currentUser.id}`, activeTaskName);
    } else {
      localStorage.removeItem(`${ACTIVE_TASK_KEY}:${currentUser.id}`);
    }

    renderDashboard();
  });

  resetButton?.addEventListener('click', () => {
    resetTrackedTime();
  });

  window.addEventListener('beforeunload', () => {
    if (!isIdle) {
      commitCurrentSegment(true);
    }
  });

  window.addEventListener('resize', () => {
    renderDashboard();
  });
}

function start() {
  normalizePlatformFilter();
  bindEvents();
  setAuthMode('login');
  playStartupSplash();
  refreshMacPermissions();
  restoreSession().catch((error) => {
    console.warn('Could not restore Firebase session:', error);
    showAuthScreen();
  });
  renderDashboard();
  pollActiveWindow();
  setInterval(pollActiveWindow, POLL_INTERVAL_MS);
  setInterval(() => {
    if (!isIdle) {
      commitCurrentSegment(false);
    }

    renderDashboard();
  }, POLL_INTERVAL_MS);
  setInterval(loadHistoryFromCloud, CLOUD_SYNC_INTERVAL_MS);
}

start();
