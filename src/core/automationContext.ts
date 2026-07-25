import * as vscode from 'vscode';
import SQLite from '../sqlite';
import { LocalizedDataManager } from './localizedDataManager';
import path from 'path';
import fs from 'fs/promises';
import { PyObject } from 'pymport';
import json from '../pythonJson';
import { whenReady } from '../extensionContext';

function zk() {
    let mdbTextData: {[key: string]: {[key: string]: string}} | undefined;
    let mdbCharacterSystemText: {[key: string]: {[key: string]: string}} | undefined;
    let mdbRaceJikkyoComment: {[key: string]: string} | undefined;
    let mdbRaceJikkyoMessage: {[key: string]: string} | undefined;

    function getFullPath(relPath: string) {
        const localizedDataDir = LocalizedDataManager.instance?.dirUri.fsPath;
        if (!localizedDataDir) {
            throw new Error(vscode.l10n.t('ZokuZoku has not been activated'));
        }
        const fullPath = path.join(localizedDataDir, relPath);
        if (fullPath[localizedDataDir.length] !== path.sep || !fullPath.startsWith(localizedDataDir)) {
            throw new Error(vscode.l10n.t('Invalid file path'));
        }
        return fullPath;
    }

    function getDictFullPath(relPath: string) {
        const fullPath = getFullPath(relPath);
        if (!fullPath.endsWith(".json")) {
            throw new Error(vscode.l10n.t('Invalid file path'));
        }
        return fullPath;
    }

    class JsonValue {
        private _value: PyObject;
        constructor(value: PyObject) {
            this._value = value;
        }

        get(index: any) {
            const item = this._value.item(index);
            if (!item) { return; }
            return new JsonValue(item);
        }

        set(index: any, value: any) {
            (this._value as any).__setitem__(index, PyObject.fromJS(value));
        }

        get length() {
            return this._value.length;
        }

        get value() {
            return this._value.toJS();
        }

        get type() {
            return this._value.type;
        }

        toJson(indent?: number) {
            return json.dumps(this._value, { ensure_ascii: false, indent }).toJS();
        }
    }

    return {
        mdb: {
            async loadTextData() {
                if (!mdbTextData) { mdbTextData = await loadMdbTextData("text_data"); }
                return mdbTextData;
            },

            async loadCharacterSystemText() {
                if (!mdbCharacterSystemText) { mdbCharacterSystemText = await loadMdbTextData("character_system_text"); }
                return mdbCharacterSystemText;
            },

            async loadRaceJikkyoComment() {
                if (!mdbRaceJikkyoComment) { mdbRaceJikkyoComment = await loadMdbRaceJikkyo("race_jikkyo_comment"); }
                return mdbRaceJikkyoComment;
            },

            async loadRaceJikkyoMessage() {
                if (!mdbRaceJikkyoMessage) { mdbRaceJikkyoMessage = await loadMdbRaceJikkyo("race_jikkyo_message"); }
                return mdbRaceJikkyoMessage;
            }
        },

        async loadDict(relPath: string) {
            const fullPath = getDictFullPath(relPath);
            return JSON.parse(await fs.readFile(fullPath, { encoding: "utf8" }));
        },

        async saveDict(relPath: string, content: any) {
            const fullPath = getDictFullPath(relPath);
            await fs.writeFile(fullPath, JSON.stringify(content, null, 4), { encoding: "utf8" });
        },

        async updateDict(relPath: string, updateFn: (content: any) => Promise<boolean | void> | boolean | void) {
            const fullPath = getDictFullPath(relPath);
            const jsonStr = await fs.readFile(fullPath, { encoding: "utf8" });
            const jsonValue = new JsonValue(json.loads(jsonStr));
            const res = await updateFn(jsonValue);
            if (res === false) { return; }

            await fs.writeFile(fullPath, jsonValue.toJson(4), { encoding: "utf8" });
        },

        async loadLocalizedDataConfig() {
            const ldManager = await LocalizedDataManager.instancePromise;
            return ldManager.config;
        },

        showInfo(c: string) { vscode.window.showInformationMessage(c) },
        showWarning(c: string) { vscode.window.showWarningMessage(c) },
        showError(c: string) { vscode.window.showErrorMessage(c) }
    }
}

async function loadMdbTextData(tableName: "text_data" | "character_system_text") {
    await whenReady;
    const rows = await SQLite.instance.loadMdbTable(tableName);
    const res: {[key: string]: {[key: string]: string}} = {};

    for (const [ categoryId, id, text ] of rows) {
        let category = res[categoryId];
        if (!category) {
            category = {};
            res[categoryId] = category;
        }
        category[id] = text;
    }

    return res;
}

async function loadMdbRaceJikkyo(tableName: "race_jikkyo_comment" | "race_jikkyo_message") {
    await whenReady;
    const rows = await SQLite.instance.loadMdbTable(tableName);
    const res: {[key: string]: string} = {};

    for (const [ id, text ] of rows) {
        res[id] = text;
    }

    return res;
}

function instantiate() {
    return {
        zk: zk()
    }
}

export default { instantiate }