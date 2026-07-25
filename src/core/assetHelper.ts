import * as vscode from "vscode";
import SQLite from "../sqlite";
import path from "path";
import fs from "fs/promises";
import downloader from "./downloader";
import config from "../config";
import { loadBundle as loadBundleViaBridge } from '../pythonBridge';
import { resolve as resolvePath } from 'path';
import { whenReady } from '../extensionContext';

async function getAssetHash(name: string) {
    await whenReady;
    const sqlite = SQLite.instance;
    const query = `SELECT h FROM a WHERE n = '${name.replace("'", "")}'`;
    const queryRes = await sqlite.queryMeta(query);
    return queryRes.at(0)?.rows.at(0)?.at(0);
}

function getAssetPath(hash: string) {
    const gameDataDir = config().get<string>("gameDataDir");
    if (!gameDataDir) {
        throw new Error(vscode.l10n.t(
            'Attempted to load an asset file, but the game data directory is not set'));
    }

    const assetDir = path.join(gameDataDir, "dat", hash.slice(0, 2));
    return {
        assetDir,
        assetPath: path.join(assetDir, hash)
    };
}

const META_PLATFORM_QUERY = `SELECT n FROM c WHERE n = '//Android' OR n = '//Windows'`;
async function getMetaPlatform(): Promise<string | undefined> {
    const sqlite = SQLite.instance;
    const queryRes = await sqlite.queryMeta(META_PLATFORM_QUERY);
    return queryRes.at(0)?.rows.at(0)?.at(0)?.slice(2);
}

const ASSET_BASE_URL_JP = "https://prd-storage-game-umamusume.akamaized.net/dl/resources/";
const ASSET_BASE_URL_GL = "https://assets-umamusume-en.akamaized.net/dl/vertical/resources/";
let assetBaseUrl: string | undefined;

async function getAssetBaseUrl(): Promise<string> {
    if (assetBaseUrl) {
        return assetBaseUrl;
    }

    await getMetaPlatform();

    if (SQLite.detectedGameVersion === "GL") {
        assetBaseUrl = ASSET_BASE_URL_GL;
    } else {
        assetBaseUrl = ASSET_BASE_URL_JP;
    }

    return assetBaseUrl;
}

async function getBundleDownloadUrl(platform: string, hash: string) {
    const baseUrl = await getAssetBaseUrl();
    return `${baseUrl}${platform}/assetbundles/${hash.slice(0, 2)}/${hash}`;
}

async function loadGenericAsset(name: string): Promise<string> {
    const hash = await getAssetHash(name);
    if (hash) {
        return loadGenericAssetByHash(hash);
    }
    else {
        throw new Error(vscode.l10n.t(
            'Failed to resolve generic asset with name: {0}',
            {0: name}
        ));
    }
}

async function getGenericDownloadUrl(hash: string) {
    const baseUrl = await getAssetBaseUrl();
    return `${baseUrl}Generic/${hash.slice(0, 2)}/${hash}`;
}

async function ensureAssetDownloaded(hash: string, isGeneric: boolean): Promise<string> {
    const { assetDir, assetPath } = getAssetPath(hash);

    try {
        await fs.stat(assetPath);
        return assetPath;
    } catch {
    }

    const autoDownloadBundles = config().get<boolean>("autoDownloadBundles");
    if (!autoDownloadBundles) {
        throw new Error(vscode.l10n.t(
            'Asset not found and auto-download is disabled: {0}',
            {0: hash}
        ));
    }

    let downloadUrl: string;
    let assetType: string;

    if (isGeneric) {
        downloadUrl = await getGenericDownloadUrl(hash);
        assetType = "generic asset";
    } else {
        const platform = await getMetaPlatform();
        if (!platform) {
            throw new Error("Could not determine platform from meta DB to download asset bundle.");
        }
        downloadUrl = await getBundleDownloadUrl(platform, hash);
        assetType = "asset bundle";
    }

    await fs.mkdir(assetDir, { recursive: true });
    await downloader.downloadToFile(
        downloadUrl,
        vscode.l10n.t('Downloading {0}: {1}', {0: assetType, 1: hash}),
        assetPath,
        true
    );

    return assetPath;
}

async function loadGenericAssetByHash(hash: string): Promise<string> {
    return ensureAssetDownloaded(hash, true);
}

export default {
    getAssetHash,
    getAssetPath,
    ensureAssetDownloaded
};
