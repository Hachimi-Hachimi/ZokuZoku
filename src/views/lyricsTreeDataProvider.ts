import * as vscode from 'vscode';
import SQLite from '../sqlite';
import { LocalizedDataManager, utils } from '../core';
import RefreshableTreeDataProviderBase from './refreshableTreeDataProviderBase';
import { whenReady } from '../extensionContext';

const LYRICS_PATH_QUERY = "SELECT n FROM a WHERE n LIKE 'live/musicscores/%\\_lyrics' ESCAPE '\\'";

export default class LyricsTreeDataProvider extends RefreshableTreeDataProviderBase implements vscode.TreeDataProvider<vscode.TreeItem> {
    private static _instance?: LyricsTreeDataProvider;
    static get instance(): LyricsTreeDataProvider | undefined { return this._instance; }

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        const treeDataProvider = new LyricsTreeDataProvider;
        LyricsTreeDataProvider._instance = treeDataProvider;

        const treeView = vscode.window.createTreeView('lyrics', {
            treeDataProvider
        });
        
        treeDataProvider.initRefreshWatcher(treeView, async () => {
            const dir = await LocalizedDataManager.instancePromise
                .then(m => m.getPathUri("assets_dir", undefined, "lyrics"));
            if (!dir) { return; }
            return new vscode.RelativePattern(dir, "*.json");
        });

        return treeView;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        await whenReady;

        if (element) { return []; }

        const items: vscode.TreeItem[] = [];

        const sqlite = SQLite.instance;
        const queryRes = await sqlite.queryMeta(LYRICS_PATH_QUERY);

        // Try to get all of the song names (tl;dr single query faster than multiple queries, process spawning bla bla)
        const songNames = await utils.getTextDataCategory(16);
        const ldManager = LocalizedDataManager.instance!;

        for (const row of queryRes[0].rows) {
            const path = row[0];
            const index = path.slice(-11, -7);

            const dictPath = await ldManager.getPathUri("assets_dir", undefined, "lyrics", `m${index}_lyrics.json`);
            const status = await utils.getEntryStatus(dictPath);

            // Try to get the name of the song, otherwise use the index as the label
            const label = utils.makeStatusLabel(songNames[+index] ?? index, status);

            items.push({
                id: index,
                label,
                tooltip: index,
                command: {
                    title: "ZokuZoku: Open lyrics editor",
                    command: "zokuzoku.openLyricsEditor",
                    arguments: [ index ]
                }
            });
        }

        return items;
    }
}