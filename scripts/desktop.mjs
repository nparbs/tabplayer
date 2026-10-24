// Starts the desktop app in development (npm run desktop), downloading the Electron binary if needed.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
execFileSync(process.execPath, [path.join(root, 'node_modules/electron/install.js')], { stdio: 'inherit' });
const electron = (await import('electron')).default;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set in some editor terminals; it would make Electron run as plain Node
spawn(electron, [root, ...process.argv.slice(2)], { stdio: 'inherit', env }).on('exit', code => process.exit(code ?? 0));
