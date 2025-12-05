const { app, BrowserWindow, Notification, Tray, Menu, ipcMain, nativeImage, powerSaveBlocker, screen } = require('electron');
const path = require('path');

// 0. 解决自动播放策略限制 (NotAllowedError)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 1. 设置 App ID (Windows 通知需要)
if (process.platform === 'win32') {
  app.setAppUserModelId("com.sedentary.reminder.app");
}

// 2. 核心机制：阻止系统挂起应用，确保后台计时器精准运行
const powerId = powerSaveBlocker.start('prevent-app-suspension');

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

// Helper to reposition all active notification windows to bottom-right
// Only used when screen metrics change
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

                // Check if we have a saved position for THIS specific type
                const savedPos = notificationPositions[type];

                if (savedPos) {
                    // Validate saved position against current work area
                    x = Math.min(Math.max(workArea.x, savedPos.x), workArea.x + workArea.width - WIN_WIDTH);
                    y = Math.min(Math.max(workArea.y, savedPos.y), workArea.y + workArea.height - WIN_HEIGHT);
                } else {
                    // Default bottom right
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

// Helper: Check if any notification window is currently visible
function hasVisibleNotifications() {
    for (const [_, entry] of notificationWindows) {
        if (entry.win && !entry.win.isDestroyed() && entry.win.isVisible()) {
            return true;
        }
    }
    return false;
}

// Helper to create or reuse a specific notification window
function createOrUpdateNotificationWindow(id, data) {
    let entry = notificationWindows.get(id);

    // Reuse existing window
    if (entry && !entry.win.isDestroyed()) {
        entry.data = data; // Update stored data
        entry.type = data.type || 'main'; // Update type
        
        // 1. Set Opacity 0 to hide any potential "flash" of old content or window frame artifacts
        entry.win.setOpacity(0);
        
        // 2. Send new data to React
        entry.win.webContents.send('notification-data-response', data);
        
        // 3. Show the window (still invisible due to opacity 0)
        // This forces the DWM to compose the window surface
        entry.win.show();
        entry.win.restore(); // Ensure it's not minimized
        
        // 4. Position Logic (Update position in case it was moved or type changed)
        updateWindowPosition(entry.win, entry.type);

        // 5. Fade in / Reveal after a short delay to allow rendering to settle
        // This eliminates the "blink" effect
        setTimeout(() => {
            if (!entry.win.isDestroyed()) {
                entry.win.setOpacity(1);
                // Signal main window to play sound AFTER visual is ready
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-alarm');
                }
            }
        }, 100); 

        return;
    } else {
        // Clean up invalid entry if any
        notificationWindows.delete(id);
    }

    const WIN_WIDTH = 420;
    const WIN_HEIGHT = 360;
    const type = data.type || 'main';

    // Create new window
    const win = new BrowserWindow({
        width: WIN_WIDTH,
        height: WIN_HEIGHT,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000', // Explicitly transparent
        hasShadow: false, // CRITICAL: Disable system shadow to prevent artifacts/flickering
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false, // Don't show until ready
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false // IMPORTANT: Prevent animations from freezing when hidden
        }
    });

    // Store window and data in map with TYPE
    notificationWindows.set(id, { win, data, type });

    // Initial Positioning Logic
    updateWindowPosition(win, type);

    const searchParams = `mode=notification&id=${id}`;

    if (process.env.NODE_ENV === 'development') {
        win.loadURL(`http://localhost:5173?${searchParams}`);
    } else {
        win.loadFile(path.join(__dirname, 'dist/index.html'), { search: searchParams });
    }

    win.once('ready-to-show', () => {
        // Same opacity trick for initial show
        win.setOpacity(0);
        win.show();
        
        setTimeout(() => {
            if (!win.isDestroyed()) {
                win.setOpacity(1);
                 // Signal main window to play sound
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-alarm');
                }
            }
        }, 100);
    });

    win.on('close', (event) => {
        if (isQuitting) return;
        // If user manually closes via Alt+F4 (rare since frame is false), treat as dismiss
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

        // Retrieve saved position for this SPECIFIC type
        const savedPos = notificationPositions[type];

        if (savedPos) {
            x = savedPos.x;
            y = savedPos.y;

            // Clamp X
            if (x < workArea.x) x = workArea.x;
            if (x + WIN_WIDTH > workArea.x + workArea.width) x = workArea.x + workArea.width - WIN_WIDTH;

            // Clamp Y
            if (y < workArea.y) y = workArea.y;
            if (y + WIN_HEIGHT > workArea.y + workArea.height) y = workArea.y + workArea.height - WIN_HEIGHT;

        } else {
            // Default: Bottom Right
            // We don't stack offset here for simplicity in 'type' mode, or could base on visible count
            x = workArea.x + workArea.width - WIN_WIDTH - padding;
            y = workArea.y + workArea.height - WIN_HEIGHT - padding;
        }
        
        win.setPosition(Math.round(x), Math.round(y));
    } catch (e) {
        console.error("Failed to set position", e);
    }
}

function handleWindowDismiss(id) {
    const entry = notificationWindows.get(id);
    if (entry && entry.win && !entry.win.isDestroyed()) {
        entry.win.hide(); // HIDE instead of destroy to reuse
        entry.win.setOpacity(0); // Reset opacity for next reveal
    }

    // Notify main window that this ID is closed
    if (mainWindow && !mainWindow.isDestroyed()) {
         mainWindow.webContents.send('notification-closed', id);
         
         // If no more VISIBLE notifications, stop alarm
         if (!hasVisibleNotifications()) {
             mainWindow.webContents.send('stop-alarm');
         }
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

app.whenReady().then(() => {
  createWindow();
  createTray();
  
  // Listen for screen changes to keep notifications in place
  screen.on('display-metrics-changed', () => {
      repositionAllNotifications();
  });
  screen.on('work-area-added', () => {
      repositionAllNotifications();
  });
  screen.on('work-area-removed', () => {
      repositionAllNotifications();
  });

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
  if (mainWindow) {
    mainWindow.setSize(width, height);
  }
});

// TRIGGER: Create or Reuse window for this alert ID
ipcMain.on('trigger-notification', (event, data) => {
    createOrUpdateNotificationWindow(data.id, data);
});

// PULL DATA: Renderer asks for data based on ID
ipcMain.on('request-notification-data', (event, id) => {
    const entry = notificationWindows.get(id);
    if (entry && entry.data) {
        event.sender.send('notification-data-response', entry.data);
    }
});

// DISMISS: Hide specific window by ID
ipcMain.on('dismiss-notification', (event, { id }) => {
    handleWindowDismiss(id);
});

// Custom window move handler
ipcMain.on('window-move', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    
    // Find which notification window this is
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

        // Clamp values
        let newX = Math.round(x);
        let newY = Math.round(y);

        if (newX < workArea.x) newX = workArea.x;
        if (newX + winWidth > workArea.x + workArea.width) newX = workArea.x + workArea.width - winWidth;

        if (newY < workArea.y) newY = workArea.y;
        if (newY + winHeight > workArea.y + workArea.height) newY = workArea.y + workArea.height - winHeight;

        win.setPosition(newX, newY);
        
        // Remember this position for THIS SPECIFIC TYPE
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