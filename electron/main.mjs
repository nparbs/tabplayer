// TabPlayer desktop app: runs the same Express server inside Electron and shows the web app in a window.
// Files opened from Explorer (file associations), the command line or File > Open are sent to the page.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env.TABPLAYER_USER_DATA) app.setPath('userData', process.env.TABPLAYER_USER_DATA); // tests use a scratch profile
// Downloaded soundfonts go to the user's app data (the install folder is read-only).
process.env.TABPLAYER_SOUNDFONT_DIR ||= path.join(app.getPath('userData'), 'soundfonts');
const { app: server } = await import('../server.js'); // after the env var, which server.js reads on load

// A fixed port keeps the page's origin the same between runs, so the library, favourites and settings
// (stored per origin in the browser storage) are still there next time.
const PORT = 47813;
const OPENABLE = /\.(gp|gpx|gp3|gp4|gp5|gp6|gp7|gp8|musicxml|mxl|xml|cap|atex|tex)$/i;
const FILE_FILTERS = [
  { name: 'Guitar Pro and music files', extensions: ['gp', 'gpx', 'gp3', 'gp4', 'gp5', 'gp7', 'gp8', 'musicxml', 'mxl', 'xml', 'cap', 'atex', 'tex'] },
  { name: 'All files', extensions: ['*'] },
];

let win = null;
let rendererReady = false;
const pending = []; // files to open once the page is listening

// One window per user; files opened later go to it. A scratch test profile (TABPLAYER_USER_DATA) runs on its
// own so tests work while TabPlayer is open.
if (!process.env.TABPLAYER_USER_DATA && !app.requestSingleInstanceLock()) {
  app.quit(); // the running instance gets our files via 'second-instance'
} else {
  app.on('second-instance', (_e, argv) => {
    openFiles(filesFromArgs(argv));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-file', (e, file) => { e.preventDefault(); openFiles([file]); }); // macOS
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}

function filesFromArgs(argv) {
  return argv.slice(1).filter(a => OPENABLE.test(a) && fs.existsSync(a)).map(a => path.resolve(a));
}

function openFiles(files) {
  for (const file of files) {
    try {
      const bytes = fs.readFileSync(file);
      const message = { name: path.basename(file), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
      if (rendererReady && win) win.webContents.send('open-file', message);
      else pending.push(message);
      app.addRecentDocument(file);
    } catch (e) {
      dialog.showErrorBox('Could not open file', `${file}\n\n${e.message}`);
    }
  }
}

ipcMain.handle('renderer-ready', () => {
  rendererReady = true;
  for (const message of pending.splice(0)) win?.webContents.send('open-file', message);
});

/** Starts the server on `port`, or the next free one. Express 5 passes listen errors to the callback. */
function listen(port, attempts = 10) {
  return new Promise((resolve, reject) => {
    const s = server.listen(port, '127.0.0.1', err => {
      if (!err) resolve(s.address().port);
      else if (err.code === 'EADDRINUSE' && attempts > 1) resolve(listen(port + 1, attempts - 1));
      else reject(err);
    });
  });
}

async function start() {
  let port;
  try {
    port = await listen(PORT);
  } catch (e) {
    dialog.showErrorBox('TabPlayer could not start', `The built-in server could not start: ${e.message}`);
    app.quit();
    return;
  }
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 720, minHeight: 500,
    title: 'TabPlayer',
    icon: path.join(here, '..', 'build', 'icon.png'),
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  buildMenu();
  // Links to other sites (Songsterr, YouTube pages) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  // The page asks before closing with unsaved edits; Electron needs us to show that question.
  win.webContents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Close without saving', 'Keep editing'], defaultId: 1, cancelId: 1,
      title: 'Unsaved edits', message: 'Some tabs have edits that are not saved.', detail: 'Save them with "Save .gp" first if you want to keep them.',
    });
    if (choice === 0) e.preventDefault(); // go ahead and close
  });
  win.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => { if (isMainFrame) rendererReady = false; });
  if (port !== PORT) console.warn(`Port ${PORT} was busy; using ${port} (the library from other runs won't show).`);
  openFiles(filesFromArgs(process.argv));
  await win.loadURL(`${origin}/`);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…', accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: FILE_FILTERS });
            if (!canceled) openFiles(filePaths);
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: 'Help',
      submenu: [{ label: 'Project page', click: () => shell.openExternal('https://github.com/nparbs/tabplayer') }],
    },
  ]));
}
