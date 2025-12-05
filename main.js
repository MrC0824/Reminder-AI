const { app, BrowserWindow, Notification, Tray, Menu, ipcMain, nativeImage, powerSaveBlocker, screen, dialog, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// 0. 解决自动播放策略限制 (NotAllowedError)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 1. 设置 App ID (Windows 通知需要)
if (process.platform === 'win32') {
  app.setAppUserModelId("com.sedentary.reminder.app");
}

// 2. 核心机制：阻止系统挂起应用，确保后台计时器精准运行
const powerId = powerSaveBlocker.start('prevent-app-suspension');

// --- AutoUpdater 配置 ---
autoUpdater.autoDownload = false; // 手动下载
autoUpdater.verifyUpdateCodeSignature = false; // 防止开发环境报错
autoUpdater.disableWebInstaller = true; 
autoUpdater.allowDowngrade = false;
autoUpdater.fullChangelog = true;

// 设置日志
// autoUpdater.logger = require("electron-log");
// autoUpdater.logger.transports.file.level = "info";

let mainWindow = null;
// Use a Map to store multiple notification windows: key=id, value={ win, data, type }
const notificationWindows = new Map(); 

// Store user's preferred position for notifications by TYPE
const notificationPositions = {
    main: null,
    interval: null,
    onetime: null
};

let tray = null;
let isQuitting = false;

// 获取图标路径 helper
function getIconPath() {
    return process.env.NODE_ENV === 'development'
        ? path.join(__dirname, 'public/icon.ico')
        : path.join(__dirname, 'dist/icon.ico');
}

function createTray() {
  if (tray) return;

  let image;
  try {
      image = nativeImage.createFromPath(getIconPath());
  } catch (e) {
      image = nativeImage.createEmpty();
  }
  
  tray = new Tray(image);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: '退出', click: () => {
        isQuitting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setToolTip('提醒助手');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) mainWindow.show();
  });

  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
  });
}

function repositionAllNotifications() {
    try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { workArea } = primaryDisplay; 
        const WIN_WIDTH = 420;
        const WIN_HEIGHT = 360;
        const padding = 0;

        let index = 0;
        for (const [id, entry] of notificationWindows) {
            if (entry.win && !entry.win.isDestroyed() && entry.win.isVisible()) {
                const type = entry.type || 'main';
                let x, y;
                const savedPos = notificationPositions[type];

                if (savedPos) {
                    x = Math.min(Math.max(workArea.x, savedPos.x), workArea.x + workArea.width - WIN_WIDTH);
                    y = Math.min(Math.max(workArea.y, savedPos.y), workArea.y + workArea.height - WIN_HEIGHT);
                } else {
                    const stackOffset = index * 10;
                    x = workArea.x + workArea.width - WIN_WIDTH - padding - stackOffset;
                    y = workArea.y + workArea.height - WIN_HEIGHT - padding - stackOffset;
                }
                
                entry.win.setPosition(Math.round(x), Math.round(y));
                index++;
            }
        }
    } catch (e) {
        console.error('Failed to reposition windows:', e);
    }
}

function hasVisibleNotifications() {
    for (const [_, entry] of notificationWindows) {
        if (entry.win && !entry.win.isDestroyed() && entry.win.isVisible()) {
            return true;
        }
    }
    return false;
}

function createOrUpdateNotificationWindow(id, data) {
    let entry = notificationWindows.get(id);

    if (entry && !entry.win.isDestroyed()) {
        entry.data = data; 
        entry.type = data.type || 'main'; 
        
        entry.win.setOpacity(0);
        entry.win.webContents.send('notification-data-response', data);
        entry.win.show();
        entry.win.restore(); 
        
        updateWindowPosition(entry.win, entry.type);

        setTimeout(() => {
            if (!entry.win.isDestroyed()) {
                entry.win.setOpacity(1);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-alarm');
                }
            }
        }, 100); 

        return;
    } else {
        notificationWindows.delete(id);
    }

    const WIN_WIDTH = 420;
    const WIN_HEIGHT = 360;
    const type = data.type || 'main';

    const win = new BrowserWindow({
        width: WIN_WIDTH,
        height: WIN_HEIGHT,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false, 
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false, 
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false 
        }
    });

    notificationWindows.set(id, { win, data, type });
    updateWindowPosition(win, type);

    const searchParams = `mode=notification&id=${id}`;

    if (process.env.NODE_ENV === 'development') {
        win.loadURL(`http://localhost:5173?${searchParams}`);
    } else {
        win.loadFile(path.join(__dirname, 'dist/index.html'), { search: searchParams });
    }

    win.once('ready-to-show', () => {
        win.setOpacity(0);
        win.show();
        
        setTimeout(() => {
            if (!win.isDestroyed()) {
                win.setOpacity(1);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-alarm');
                }
            }
        }, 100);
    });

    win.on('close', (event) => {
        if (isQuitting) return;
        event.preventDefault();
        handleWindowDismiss(id);
    });
}

function updateWindowPosition(win, type) {
    try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { workArea } = primaryDisplay;
        const WIN_WIDTH = 420;
        const WIN_HEIGHT = 360;
        const padding = 0;
        let x, y;
        const savedPos = notificationPositions[type];

        if (savedPos) {
            x = savedPos.x;
            y = savedPos.y;
            if (x < workArea.x) x = workArea.x;
            if (x + WIN_WIDTH > workArea.x + workArea.width) x = workArea.x + workArea.width - WIN_WIDTH;
            if (y < workArea.y) y = workArea.y;
            if (y + WIN_HEIGHT > workArea.y + workArea.height) y = workArea.y + workArea.height - WIN_HEIGHT;
        } else {
            x = workArea.x + workArea.width - WIN_WIDTH - padding;
            y = workArea.y + workArea.height - WIN_HEIGHT - padding;
        }
        win.setPosition(Math.round(x), Math.round(y));
    } catch (e) {
        console.error("Failed to set position", e);
    }
}

// FIX: Add try-catch and safer checks to prevent crash on exit
function handleWindowDismiss(id) {
    try {
        const entry = notificationWindows.get(id);
        if (entry && entry.win && !entry.win.isDestroyed()) {
            entry.win.hide(); 
            entry.win.setOpacity(0); 
        }
        
        // Only notify main window if it exists and is valid
        if (mainWindow && !mainWindow.isDestroyed()) {
             mainWindow.webContents.send('notification-closed', id);
             if (!hasVisibleNotifications()) {
                 mainWindow.webContents.send('stop-alarm');
             }
        }
    } catch (error) {
        console.error("Error in handleWindowDismiss:", error);
    }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 600,
    minWidth: 600,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    },
    autoHideMenuBar: true,
    icon: getIconPath()
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.webContents.send('show-close-confirm');
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

// --- AutoUpdater Events ---

autoUpdater.on('update-available', (info) => {
    // 1. Detect if running as Portable
    const isPortable = process.env.PORTABLE_EXECUTABLE_DIR !== undefined;

    if (isPortable) {
        // If Portable, show dialog and open browser, do NOT tell renderer to update
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '发现新版本',
            message: `检测到新版本 v${info.version}。\n由于您使用的是便携版(Portable)，无法自动覆盖更新。\n请前往浏览器下载最新版本。`,
            buttons: ['去下载', '取消'],
            defaultId: 0,
            cancelId: 1
        }).then(({ response }) => {
            if (response === 0) {
                // Open Release Page (Replace with your actual repo URL if needed, or let electron-updater logic handle if possible, but manual link is safest)
                // Assuming package.json has repository info, but hardcoding provided structure:
                shell.openExternal('https://github.com/MrC0824/Reminder-AI/releases/latest');
            }
        });
        return; // STOP here for portable
    }

    // 2. If Setup/Installed version, proceed with normal flow
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', info);
    }
});

autoUpdater.on('update-not-available', () => {
    console.log('Update not available');
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', progressObj.percent);
    }
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded', info);
    }
});

autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-error', err.message);
    }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  
  if (process.env.NODE_ENV !== 'development') {
      // Check for updates shortly after startup
      setTimeout(() => {
          autoUpdater.checkForUpdates().catch(e => console.error("Check for updates failed:", e));
      }, 3000);
  } else {
      console.log('Skipping update check in development mode');
  }

  screen.on('display-metrics-changed', () => { repositionAllNotifications(); });
  screen.on('work-area-added', () => { repositionAllNotifications(); });
  screen.on('work-area-removed', () => { repositionAllNotifications(); });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Communication ---

ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow) mainWindow.setSize(width, height);
});

ipcMain.on('trigger-notification', (event, data) => {
    createOrUpdateNotificationWindow(data.id, data);
});

ipcMain.on('request-notification-data', (event, id) => {
    const entry = notificationWindows.get(id);
    if (entry && entry.data) {
        event.sender.send('notification-data-response', entry.data);
    }
});

ipcMain.on('dismiss-notification', (event, { id }) => {
    handleWindowDismiss(id);
});

ipcMain.on('window-move', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    let currentId = null;
    let currentType = 'main';

    for (const [id, entry] of notificationWindows) {
        if (entry.win === win) {
            currentId = id;
            currentType = entry.type || 'main';
            break;
        }
    }

    if (win) {
        const currentDisplay = screen.getDisplayMatching(win.getBounds());
        const { workArea } = currentDisplay;
        const [winWidth, winHeight] = win.getSize();

        let newX = Math.round(x);
        let newY = Math.round(y);

        if (newX < workArea.x) newX = workArea.x;
        if (newX + winWidth > workArea.x + workArea.width) newX = workArea.x + workArea.width - winWidth;
        if (newY < workArea.y) newY = workArea.y;
        if (newY + winHeight > workArea.y + workArea.height) newY = workArea.y + workArea.height - winHeight;

        win.setPosition(newX, newY);
        notificationPositions[currentType] = { x: newX, y: newY };
    }
});

ipcMain.on('confirm-minimize', () => {
    if (mainWindow) {
        mainWindow.hide();
        createTray();
    }
});

ipcMain.on('confirm-quit', () => {
    isQuitting = true;
    app.quit();
});

ipcMain.on('start-download', () => {
    // FIX: Catch download errors to prevent unhandled rejection crashes
    autoUpdater.downloadUpdate().catch(e => {
        console.error("Download failed:", e);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-error', e.message);
        }
    });
});

ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});