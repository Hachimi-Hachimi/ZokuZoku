import * as vscode from 'vscode';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import * as tar from 'tar';
import { spawn } from "child_process";

import downloader from './core/downloader';
import { getAllGameInstallPaths, expandEnvironmentVariables } from './core/utils';
import config, { CONFIG_SECTION } from './config';
import { whenReady, setReady } from './extensionContext';
import { ZOKUZOKU_DIR, PYMPORT_DIR, PYMPORT_INSTALLED_FILE, PYMPORT_VER, UNITYPY_VER, APSW_VER } from "./defines";

const YES = vscode.l10n.t('Yes');
const NO = vscode.l10n.t('No');
const OK = vscode.l10n.t('OK');
const CANCEL = vscode.l10n.t('Cancel');

import { initPythonBridge, getUnityPyVersion, checkApsw } from './pythonBridge';
// Any other module from this package must be imported dynamically,
// after pymport bindings have been downloaded.


async function checkPymport(): Promise<boolean> {
    try {
        const installedVer = await fs.readFile(PYMPORT_INSTALLED_FILE, { encoding: "utf8" });
        return installedVer === PYMPORT_VER;
    }
    catch {
        return false;
    }
}

async function installPymport() {
    await fs.rm(PYMPORT_DIR, { recursive: true, force: true });
    await fs.mkdir(PYMPORT_DIR, { recursive: true });
    const downloadUrl = `https://github.com/mmomtchev/pymport/releases/download/${PYMPORT_VER}/${os.platform()}-x64.tar.gz`;
    const downloadPath = path.join(ZOKUZOKU_DIR, "tmp.tar.gz");
    await downloader.downloadToFile(
        downloadUrl,
        vscode.l10n.t('Downloading pymport {0}', { 0: PYMPORT_VER }
        ),
        downloadPath,
        true
    );

    const progressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Installing pymport...')
    };
    await vscode.window.withProgress(progressOptions, async () => {
        await tar.x({
            file: downloadPath,
            strip: 1,
            cwd: PYMPORT_DIR
        });
        await fs.unlink(downloadPath);
        await fs.writeFile(PYMPORT_INSTALLED_FILE, PYMPORT_VER, { encoding: "utf8" });
    });
}

async function checkUnityPy(): Promise<boolean> {
    try {
        const versionResult = await getUnityPyVersion();
        return versionResult.unitypy_version === UNITYPY_VER;
    }
    catch (e) {
        console.error("checkUnityPy failed:", e);
        return false;
    }
}

async function checkApswPackage(): Promise<boolean> {
    try {
        const result = await checkApsw();
        return result.apsw_installed;
    } catch (e) {
        console.error("checkApswPackage failed:", e);
        return false;
    }
}

async function installUnityPy() {
    const exe = os.platform() === 'win32' ? 'python.exe' : path.join('bin', 'python3');
    const python = path.join(PYMPORT_DIR, exe);

    try {
        await fs.stat(python);
    }
    catch {
        throw new Error(vscode.l10n.t('Python binary not found in pymport install dir'));
    }

    const pip = spawn(python, ['-m', 'pip', 'install', 'UnityPy==' + UNITYPY_VER, 'apsw-sqlite3mc==' + APSW_VER, '--force-reinstall'], {
        stdio: 'inherit',
        env: {
            ...process.env,
            PYTHONHOME: PYMPORT_DIR
        }
    });

    const progressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Installing UnityPy...')
    };
    await vscode.window.withProgress(progressOptions, () => {
        return new Promise<void>((resolve, reject) => {
            pip.on("error", e => {
                reject(e);
            })
                .on("exit", code => {
                    if (code === 0) {
                        resolve();
                        return;
                    }
                    reject(new Error(vscode.l10n.t('Python pip process exited with code {0}', { 0: code })));
                });
        });
    });

    if (await checkUnityPy() === false) {
        throw new Error(vscode.l10n.t('Failed to verify UnityPy installation.'));
    }
}

const GAME_DATA_FILES = ["meta", path.join("master", "master.mdb")];

async function checkGameDataDir() {
    if (config().get("gameDataDir")) { return; }

    const foundGameDataDirs: string[] = [];
    const potentialDataDirs = new Set<string>();

    const localLowBase = path.join(os.homedir(), "AppData", "LocalLow", "Cygames");
    potentialDataDirs.add(path.join(localLowBase, "Umamusume"));
    potentialDataDirs.add(path.join(localLowBase, "umamusume"));

    const installPaths = await getAllGameInstallPaths();
    for (const installPath of installPaths) {
        potentialDataDirs.add(path.join(installPath, "umamusume_Data", "Persistent"));
        potentialDataDirs.add(path.join(installPath, "UmamusumePrettyDerby_Jpn_Data", "Persistent"));
    }

    for (const dir of potentialDataDirs) {
        let isDirValid = true;
        for (const file of GAME_DATA_FILES) {
            try {
                await fs.stat(path.join(dir, file));
            } catch {
                isDirValid = false;
                break;
            }
        }
        if (isDirValid) {
            foundGameDataDirs.push(dir);
        }
    }

    if (foundGameDataDirs.length === 0) {
        throw new Error(vscode.l10n.t("Game data directory was not automatically detected. Please set it manually in Settings."));
    }

    if (foundGameDataDirs.length === 1) {
        const gameDataDir = foundGameDataDirs[0];
        const res = await vscode.window.showWarningMessage(vscode.l10n.t('The game data directory has not been set. Would you like to set it to "{0}"?', { 0: gameDataDir }),
            YES, NO);
        if (res === YES) {
            await config().update("gameDataDir", gameDataDir, true);
        } else {
            throw new Error(vscode.l10n.t("Game data directory selection was cancelled."));
        }
        return;
    }

    if (foundGameDataDirs.length > 1) {
        const selectedDir = await vscode.window.showQuickPick(foundGameDataDirs, {
            placeHolder: vscode.l10n.t("Multiple game data directories found. Please select which one to use."),
            ignoreFocusOut: true
        });
        if (selectedDir) {
            await config().update("gameDataDir", selectedDir, true);
        } else {
            throw new Error(vscode.l10n.t("Game data directory selection was cancelled."));
        }
    }
}

async function checkLocalizeDictDump() {
    if (config().get("localizeDictDump")) { return; }

    const foundDumpPaths: string[] = [];
    const installPaths = await getAllGameInstallPaths();

    for (const installPath of installPaths) {
        try {
            const potentialPath = path.join(installPath, "hachimi", "localize_dump.json");
            await fs.stat(potentialPath);
            foundDumpPaths.push(potentialPath);
        }
        catch { }
    }

    if (foundDumpPaths.length === 0) {
        throw new Error("The localize dict dump path was not automatically detected. Please set it manually in Settings.");
    }

    if (foundDumpPaths.length === 1) {
        const dumpPath = foundDumpPaths[0];
        const res = await vscode.window.showWarningMessage(vscode.l10n.t('The localize dict dump path has not been set. Would you like to set it to "{0}"?', { 0: dumpPath }), YES, NO);
        if (res === YES) {
            await config().update("localizeDictDump", dumpPath, true);
        } else {
            throw new Error("Localize dict dump selection was cancelled.");
        }
    }
    else {
        vscode.window.showWarningMessage(
            vscode.l10n.t('The localize dict dump path has not been set and was not automatically detected. Please set it manually in Settings.')
        );
        return;
    }

    if (foundDumpPaths.length > 1) {
        const selectedPath = await vscode.window.showQuickPick(foundDumpPaths, {
            placeHolder: "Multiple localize_dump.json files found. Please select which one to use.",
            ignoreFocusOut: true
        });
        if (selectedPath) {
            await config().update("localizeDictDump", selectedPath, true);
        } else {
            throw new Error("Localize dict dump selection was cancelled.");
        }
    }
}

async function checkEnabled() {
    const { setActive } = await import("./core/index.js");
    const enabled = config().inspect<boolean>("enabled")?.workspaceValue;
    if (typeof enabled === "boolean") {
        setActive(enabled);
    }
    else {
        setActive(false);
        vscode.window.showInformationMessage(
            vscode.l10n.t('Would you like to enable ZokuZoku for this workspace?'),
            YES, NO
        )
            .then(res => {
                if (res === YES) {
                    config().update("enabled", true, false);
                    setActive(true);
                }
            });
    }
}


async function runInitialSetup(context: vscode.ExtensionContext) {
    initPythonBridge();

    const pyInstalled = await checkPymport();
    const apswInstalled = pyInstalled ? await checkApswPackage() : false;
    const unityPyInstalled = pyInstalled ? await checkUnityPy() : false;
    if (!pyInstalled || !unityPyInstalled || !apswInstalled) {
        const res = await vscode.window.showInformationMessage(
            vscode.l10n.t('ZokuZoku needs to install some dependencies before it can be used.'),
            OK, CANCEL
        );
        if (res === CANCEL) {
            throw new Error(vscode.l10n.t("Dependency installation was cancelled by the user."));
        }
        if (!pyInstalled) { await installPymport(); }
        if (!unityPyInstalled || !apswInstalled) { await installUnityPy(); }
        vscode.window.showInformationMessage(
            vscode.l10n.t('ZokuZoku\'s dependencies have been installed to "{0}"', { 0: ZOKUZOKU_DIR })
        );
    }

    await checkGameDataDir();
    await checkLocalizeDictDump();

    const { default: SQLite } = await import('./sqlite/index.js');
    SQLite.init(context.extensionPath);

    setReady();

    await checkEnabled();
}

// note: vscode won't wait for this promise
export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('zokuzoku.retrySetup', () => {
        runInitialSetup(context).catch(err => {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`ZokuZoku setup failed: ${message}`, "Retry Setup")
                .then(selection => {
                    if (selection === "Retry Setup") {
                        vscode.commands.executeCommand('zokuzoku.retrySetup');
                    }
                });
        });
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
            const { default: SQLite } = await import('./sqlite/index.js');
            SQLite.init(context.extensionPath);
            checkEnabled();
        }
    }));

    try {
        await runInitialSetup(context);
        await runInitialSetup(context);
        
        const { registerCommands } = await import("./commands.js");
        const { registerEditors } = await import("./editors/index.js");
        const { registerViews } = await import("./views/index.js");

        context.subscriptions.push(
            ...registerCommands(context),
            ...registerEditors(context),
            ...registerViews(context)
        );
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`ZokuZoku setup failed: ${message}`, "Retry Setup")
            .then(selection => {
                if (selection === "Retry Setup") {
                    vscode.commands.executeCommand('zokuzoku.retrySetup');
                }
            });
    }
}

export function deactivate() { }