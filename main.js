const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const INL_VID = 0x16C0;
const INL_PID = 0x05DC;

// app:// acts as a secure context; must register before app.ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { secure: true, standard: true, serviceWorkers: true, supportFetchAPI: true }
  }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1050,
    height: 780,
    title: 'INL Retro Dumper Programmer',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    const filePath = path.join(__dirname, rel);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  win.webContents.session.setDevicePermissionHandler((details) => {
    return (
      details.deviceType === 'usb' &&
      details.device.vendorId === INL_VID &&
      details.device.productId === INL_PID
    );
  });

  win.webContents.session.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    const device = details.deviceList.find(
      (d) => d.vendorId === INL_VID && d.productId === INL_PID
    );
    callback(device ? device.deviceId : '');
  });

  win.loadURL('app://localhost/index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
