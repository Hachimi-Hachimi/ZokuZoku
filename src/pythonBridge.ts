import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { PYMPORT_DIR } from './defines';
import { ResultSet } from './sqlite/common';
import config from './config';
import SQLite from './sqlite';

export interface StoryChoiceData {
    text: string;
    nextBlock: number;
    differenceFlag: number;
}

export interface StoryColorTextData {
    text: string;
}

export interface StoryBlockData {
    name: string;
    text: string;
    nextBlock: number;
    differenceFlag: number;
    cueId: number;
    choices: StoryChoiceData[];
    colorTexts: StoryColorTextData[];
}

export interface ExtractedStoryData {
    title: string;
    blockList: StoryBlockData[];
}

let pythonExecutable: string;

interface PythonResponse<T> {
    status: 'success' | 'error';
    data?: T;
    message?: string;
}

export function initPythonBridge() {
    const exe = os.platform() === 'win32' ? 'python.exe' : path.join('bin', 'python3');
    pythonExecutable = path.join(PYMPORT_DIR, exe);
}

async function execute<T>(command: string, params: object): Promise<T> {
    if (!pythonExecutable) {
        throw new Error('Python bridge is not initialized.');
    }

    const bridgeScriptPath = path.resolve(__dirname, 'py', 'py_bridge.py');
    const paramsJson = JSON.stringify(params);

    return new Promise((resolve, reject) => {
        const childProcess = spawn(pythonExecutable, [
            '-u',
            bridgeScriptPath,
            command,
            paramsJson
        ], {
            env: { ...process.env, PYTHONHOME: PYMPORT_DIR }
        });

        let stdoutData = '';
        let stderrData = '';

        childProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        childProcess.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`Python script exited with code ${code}. Stderr: ${stderrData}`));
            }
            try {
                const jsonStartIndex = stdoutData.indexOf('{');
                if (jsonStartIndex === -1) {
                    throw new Error('No JSON object found in Python script output.');
                }

                const jsonString = stdoutData.substring(jsonStartIndex);
                const response = JSON.parse(jsonString) as PythonResponse<T>;

                if (response.status === 'success') {
                    resolve(response.data!);
                } else {
                    reject(new Error(`Python script error: ${response.message}`));
                }
            } catch (e) {
                reject(new Error(`Failed to parse Python script output. Stdout: ${stdoutData}. Error: ${e}`));
            }
        });

        childProcess.on('error', (err) => {
            reject(err);
        });
    });
}

export async function getUnityPyVersion(): Promise<{ unitypy_version: string }> {
    return execute<{ unitypy_version: string }>('version', {});
}

export async function checkApsw(): Promise<{ apsw_installed: boolean; version?: string }> {
    return execute<{ apsw_installed: boolean; version?: string }>('check_apsw', {});
}

export async function queryEncryptedDb(db_path: string, query: string, key?: string): Promise<ResultSet> {
    const result = await execute<{ header: string[], rows: string[][] }>('query_db', { db_path, query, key });
    return [{
        stmt: query,
        header: result.header,
        rows: result.rows
    }];
}

interface ExtractStoryDataParams {
    assetPath: string;
    assetName: string;
    useDecryption: boolean;
    metaPath: string;
    bundleHash: string;
    metaKey?: string;
}

async function getMetaKeyIfEnabled(useDecryption: boolean): Promise<string | undefined> {
    return useDecryption ? SQLite.getMetaKey() : undefined;
}

export async function loadBundle(
    args: ExtractStoryDataParams
): Promise<{ success: boolean; asset_count: number }> {
    const metaKey = await getMetaKeyIfEnabled(args.useDecryption);
    const params = {
        "asset_path": args.assetPath,
        "use_decryption": args.useDecryption,
        "meta_path": args.metaPath,
        "bundle_hash": args.bundleHash,
        "meta_key": metaKey
    };
    return execute<{ success: boolean; asset_count: number }>('load_bundle', params);
}

export async function extractStoryData(
    args: ExtractStoryDataParams
): Promise<ExtractedStoryData> {
    const metaKey = await getMetaKeyIfEnabled(args.useDecryption);
    const params = {
        "asset_path": args.assetPath,
        "asset_name": args.assetName,
        "use_decryption": args.useDecryption,
        "meta_path": args.metaPath,
        "bundle_hash": args.bundleHash,
        "meta_key": metaKey
    };

    console.log("[ZokuZoku] Sending parameters to Python bridge:", params);

    return execute<ExtractedStoryData>('extract_story_data', params);
}

export async function extractRaceStoryData(
    args: ExtractStoryDataParams
): Promise<{ texts: string[] }> {
    const metaKey = await getMetaKeyIfEnabled(args.useDecryption);
    const params = {
        "asset_path": args.assetPath,
        "asset_name": args.assetName,
        "use_decryption": args.useDecryption,
        "meta_path": args.metaPath,
        "bundle_hash": args.bundleHash,
        "meta_key": metaKey
    };
    return execute<{ texts: string[] }>('extract_race_story_data', params);
}

export async function extractLyricsData(
    args: ExtractStoryDataParams
): Promise<{ csv_data: string }> {
    const metaKey = await getMetaKeyIfEnabled(args.useDecryption);
    const params = {
        "asset_path": args.assetPath,
        "asset_name": args.assetName,
        "use_decryption": args.useDecryption,
        "meta_path": args.metaPath,
        "bundle_hash": args.bundleHash,
        "meta_key": metaKey
    };
    return execute<{ csv_data: string }>('extract_lyrics_data', params);
}