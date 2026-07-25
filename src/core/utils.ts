import * as vscode from 'vscode';
import SQLite from '../sqlite';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { PathLike } from 'fs';
import { spawn } from 'child_process';
import config from '../config';
import { STEAM_APP_ID_GLOBAL, STEAM_APP_ID_JP } from '../defines';
import { LocalizedDataManager } from './localizedDataManager';

export enum EntryStatus {
    Missing,
    Ghost,
    Translated
}

export function addIndent(source: string, indent: string, addAtStart = false): string {
    if (indent.length) {
        let res = addAtStart ? indent : "";
        for (const c of source) {
            res += c;
            if (c === "\n") {
                res += indent;
            }
        }
        return res;
    }
    else {
        return source;
    }
}

let _translatedTextDataCache: any = undefined;

export function invalidateTranslatedTextDataCache() {
    _translatedTextDataCache = undefined;
}

export async function getTranslatedTextData(): Promise<any> {
    if (_translatedTextDataCache === undefined) {
         const ldManager = await LocalizedDataManager.instancePromise;
         const uri = await ldManager.getPathUri("text_data_dict");
         if (uri && await uriExists(uri)) {
             try {
                 const data = await vscode.workspace.fs.readFile(uri);
                 const str = Buffer.from(data).toString('utf8');
                 _translatedTextDataCache = JSON.parse(str);
             } catch (e) {
                 console.error(e);
                 _translatedTextDataCache = null;
             }
         } else {
             _translatedTextDataCache = null;
         }
    }
    return _translatedTextDataCache;
}

export async function getTextDataCategory(category: number) {
    const dict: {[key: number]: string} = {};
    try {
        const mdbQueryRes = await SQLite.instance.queryMdb(`SELECT "index", "text" FROM text_data WHERE "category" = ${category}`);
        for (const row of mdbQueryRes[0].rows) {
            const [ index, text ] = row;
            dict[+index] = text;
        }
    }
    catch {}

    return dict;
}

const textDataCache: {[key: number]: {[key: number]: string}} = {};
export async function getTextDataCategoryCached(category: number) {
    let cache = textDataCache[category];
    if (!cache) {
        cache = await getTextDataCategory(category);
        textDataCache[category] = cache;
    }
    return cache;
}

export async function uriExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch {
        return false;
    }
}

export async function pathExists(path: PathLike): Promise<boolean> {
    try {
        await fs.stat(path);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Check the translation status of a file.
 * Returns EntryStatus.Missing if file doesn't exist.
 * Returns EntryStatus.Ghost if file exists but has no translated content.
 * Returns EntryStatus.Translated if file has actual translated content.
 */
export async function getEntryStatus(uri: vscode.Uri | undefined): Promise<EntryStatus> {
    if (!uri || !await uriExists(uri)) {
        return EntryStatus.Missing;
    }

    try {
        const data = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(data).toString('utf8');
        const json = JSON.parse(content);

        if (!json) { return EntryStatus.Ghost; }

        function hasString(obj: any): boolean {
            if (typeof obj === 'string') {
                return obj.trim().length > 0;
            }
            if (Array.isArray(obj)) {
                return obj.some(hasString);
            }
            if (obj && typeof obj === 'object') {
                return Object.values(obj).some(hasString);
            }
            return false;
        }

        // Specific check for Story/Race/Lyrics structures
        if (json.text_block_list && Array.isArray(json.text_block_list)) {
            // StoryTimeline structure
            for (const block of json.text_block_list) {
                if (block.text && typeof block.text === 'string' && block.text.trim().length > 0) {
                    return EntryStatus.Translated;
                }
            }
        } else if (Array.isArray(json)) {
            // RaceStory/Simple Array structure
            if (json.some(hasString)) {
                return EntryStatus.Translated;
            }
        } else if (typeof json === 'object') {
            // Lyrics/MDB Flat Object structure
            if (Object.values(json).some(hasString)) {
                return EntryStatus.Translated;
            }
        }

        return EntryStatus.Ghost;
    }
    catch {
        // If we can't read/parse, treat as ghost if exists, or missing
        return EntryStatus.Ghost;
    }
}

export function makeStatusLabel(label: string, status: EntryStatus) {
    switch (status) {
        case EntryStatus.Translated:
            return "[●] " + label;
        case EntryStatus.Ghost:
            return "[○] " + label;
        case EntryStatus.Missing:
        default:
            return "[   ] " + label;
    }
}

export function normalizeStoryId(id: string | number): string {
    id = id.toString();
    if (id.length < 9) {
        const count = 9 - id.length;
        id = "0".repeat(count) + id;
    }
    return id;
}

export function getStoryIdComponents(id: string | number): [string, string, string] {
    id = normalizeStoryId(id);
    return [id.slice(0, 2), id.slice(2, 6), id.slice(6)];
}
async function queryRegistry(key: string, value: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        try {
            const reg = spawn('reg', ['query', key, '/v', value]);
            let output = '';

            reg.stdout.on('data', (data) => {
                output += data.toString();
            });

            reg.on('close', (code) => {
                if (code !== 0) {
                    return resolve(undefined);
                }
                const match = output.match(new RegExp(`^\\s*${value}\\s+REG_SZ\\s+(.*)$`, 'im'));
                if (match && match[1]) {
                    const resolvedPath = expandEnvironmentVariables(match[1].trim());
                    resolve(resolvedPath);
                } else {
                    resolve(undefined);
                }
            });

            reg.on('error', () => resolve(undefined));
        } catch {
            resolve(undefined);
        }
    });
}

const DMM5_CONFIG_PATH = path.join(os.homedir(), "AppData", "Roaming", "dmmgameplayer5", "dmmgame.cnf");

export async function getAllGameInstallPaths(): Promise<string[]> {
    const paths: string[] = [];

    try {
        const dmmConfig = JSON.parse(await fs.readFile(DMM5_CONFIG_PATH, { encoding: "utf8" }));
        for (const entry of dmmConfig.contents) {
            if (entry.productId === "umamusume" && entry.detail.path) {
                paths.push(entry.detail.path);
            }
        }
    }
    catch {}

    if (os.platform() === 'win32') {
        const steamAppIds = [STEAM_APP_ID_JP, STEAM_APP_ID_GLOBAL];

        for (const appId of steamAppIds) {
            const steamKey = `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${appId}`;
            const gamePath = await queryRegistry(steamKey, 'InstallLocation');

            if (gamePath && await pathExists(gamePath)) {
                if (!paths.includes(gamePath)) {
                    paths.push(gamePath);
                }
            }
        }
    }

    return paths;
}

let cachedInstallPath: string | undefined;
export async function getGameInstallPath(): Promise<string | undefined> {
    if (cachedInstallPath) {
        return cachedInstallPath;
    }

    const allPaths = await getAllGameInstallPaths();
    if (allPaths.length > 0) {
        cachedInstallPath = allPaths[0];
        return cachedInstallPath;
    }

    return undefined;
}

export async function updateHachimiConfig(callback: (config: any) => any) {
    const dumpPath = config().get<string>("localizeDictDump");

    if (!dumpPath) {
        throw new Error("Cannot update Hachimi config: The 'Localize Dict Dump' path is not configured. Please run the setup or set it manually in Settings.");
    }

    const hachimiDir = path.dirname(dumpPath);
    const configPath = path.join(hachimiDir, "config.json");

    try {
        const data = JSON.parse(await fs.readFile(configPath, { encoding: "utf8" }));
        const res = await callback(data);
        if (res) {
            await fs.writeFile(configPath, JSON.stringify(res, null, 2), { encoding: "utf8" });
        }
        return res;
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.warn(`hachimi/config.json not found at ${configPath}. Skipping update.`);
            return;
        }

        throw new Error(`Failed to read or update hachimi config at ${configPath}. Error: ${e}`);
    }
}

export function expandEnvironmentVariables(pathString: string): string {
    if (!pathString) {
        return pathString;
    }

    const platform = os.platform();

    if (platform === 'win32') {
        return pathString.replace(/%(.*?)%/g, (match, varName) => {
            return process.env[varName] || match;
        });
    } else {
        let expandedPath = pathString.replace(/^~(?=$|\/|\\)/, os.homedir());

        expandedPath = expandedPath.replace(/\$(?:(\w+)|\{([^}]+)\})/g, (match, varName, varNameInBraces) => {
            const actualVarName = varName || varNameInBraces;
            return process.env[actualVarName] || match;
        });

        return expandedPath;
    }
}