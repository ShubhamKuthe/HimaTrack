const path = require('path');
const {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  Tray,
  Menu,
  nativeImage,
  shell,
  systemPreferences
} = require('electron');

let win;
let tray;
let isQuitting = false;
const iconCache = new Map();
const appIconPath = path.join(__dirname, 'assets', 'app-icon-small.png');
const trayIconPath = path.join(__dirname, 'assets', 'tray-icon.png');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.himatrack.desktop');
}

function getTrayIcon() {
  const icon = nativeImage.createFromPath(trayIconPath);

  if (icon.isEmpty()) {
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    );
  }

  return icon.resize({ width: 16, height: 16 });
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }

  win.show();
  win.restore();
  win.focus();
  win.setSkipTaskbar(false);
}

function hideToTray() {
  if (!win || isQuitting) {
    return;
  }

  win.hide();
  win.setSkipTaskbar(true);
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(getTrayIcon());
  tray.setToolTip('HimaTrack is tracking in the background');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open HimaTrack',
      click: showWindow
    },
    {
      label: 'Tracking runs while minimized',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Quit HimaTrack',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));

  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function createWindow() {
  createTray();

  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1050,
    minHeight: 650,
    title: 'HimaTrack',
    icon: appIconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  win.loadFile('index.html');

  if (process.platform === 'darwin') {
    systemPreferences.isTrustedAccessibilityClient(true);
  }

  win.on('minimize', (event) => {
    event.preventDefault();
    hideToTray();
  });

  win.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    hideToTray();
  });

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(createWindow);

function getMacPermissionStatus() {
  if (process.platform !== 'darwin') {
    return {
      platform: process.platform,
      isMac: false,
      accessibility: 'not-required',
      screenRecording: 'not-required'
    };
  }

  let screenRecording = 'unknown';

  try {
    screenRecording = systemPreferences.getMediaAccessStatus('screen');
  } catch (error) {
    screenRecording = 'unknown';
  }

  return {
    platform: process.platform,
    isMac: true,
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
    screenRecording
  };
}

function openMacPermissionPane(permission) {
  if (process.platform !== 'darwin') {
    return false;
  }

  const panes = {
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  };

  const paneUrl = panes[permission];

  if (!paneUrl) {
    return false;
  }

  shell.openExternal(paneUrl);
  return true;
}

ipcMain.handle('get-system-idle-time', () => {
  return powerMonitor.getSystemIdleTime();
});

ipcMain.handle('get-mac-permission-status', () => {
  return getMacPermissionStatus();
});

ipcMain.handle('open-mac-permission-pane', (event, permission) => {
  return openMacPermissionPane(permission);
});

ipcMain.handle('get-app-icon', async (event, executablePath) => {
  if (!executablePath || typeof executablePath !== 'string') {
    return null;
  }

  if (iconCache.has(executablePath)) {
    return iconCache.get(executablePath);
  }

  try {
    const icon = await app.getFileIcon(executablePath, { size: 'normal' });

    if (!icon || icon.isEmpty()) {
      iconCache.set(executablePath, null);
      return null;
    }

    const dataUrl = icon.resize({ width: 32, height: 32 }).toDataURL();
    iconCache.set(executablePath, dataUrl);
    return dataUrl;
  } catch (error) {
    console.warn(`Could not load icon for ${executablePath}:`, error.message);
    iconCache.set(executablePath, null);
    return null;
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showWindow();
  }
});
