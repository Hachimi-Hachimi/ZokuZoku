import * as vscode from 'vscode';
import SQLite from '../sqlite';
import { LocalizedDataManager, utils } from '../core';
import RefreshableTreeDataProviderBase from './refreshableTreeDataProviderBase';
import { whenReady } from '../extensionContext';

function queryCategories() {
    return SQLite.instance.queryMeta(
        `SELECT DISTINCT SUBSTR(n, 11, 5)
        FROM a WHERE n LIKE 'home/data/_____/__/hometimeline\\______\\___\\________' ESCAPE '\\'`
    );
}

function queryGroups(categoryId: string) {
    return SQLite.instance.queryMeta(
        `SELECT DISTINCT SUBSTR(n, 17, 2)
        FROM a WHERE n LIKE 'home/data/${categoryId}/__/hometimeline\\_${categoryId}\\___\\________' ESCAPE '\\'`
    );
}

function queryCharacters(categoryId: string, groupId: string) {
    return SQLite.instance.queryMeta(
        `SELECT DISTINCT SUBSTR(n, 42, 4)
        FROM a
        WHERE n LIKE 'home/data/${categoryId}/${groupId}/hometimeline\\_${categoryId}\\_${groupId}\\________' ESCAPE '\\'`
    );
}

function queryStories(categoryId: string, groupId: string, charaId: string) {
    return SQLite.instance.queryMeta(
        `SELECT SUBSTR(n, 42, 7)
        FROM a
        WHERE n LIKE 'home/data/${categoryId}/${groupId}/hometimeline\\_${categoryId}\\_${groupId}\\_${charaId}___' ESCAPE '\\'`
    );
}

enum TreeLevel {
    None,
    Category,
    Group,
    Character,
    Story
}

async function getCharaName(charaId: string): Promise<string | undefined> {
    const characterNames = await utils.getTextDataCategoryCached(6);
    return characterNames[+charaId];
}

export default class HomeStoriesTreeDataProvider extends RefreshableTreeDataProviderBase implements vscode.TreeDataProvider<vscode.TreeItem> {
    private static _instance?: HomeStoriesTreeDataProvider;
    static get instance(): HomeStoriesTreeDataProvider | undefined { return this._instance; }

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        const treeDataProvider = new HomeStoriesTreeDataProvider;
        HomeStoriesTreeDataProvider._instance = treeDataProvider;

        const treeView = vscode.window.createTreeView('home-stories', {
            treeDataProvider
        });

        treeDataProvider.initRefreshWatcher(treeView, async () => {
            const dir = await LocalizedDataManager.instancePromise
                .then(m => m.getPathUri("assets_dir", undefined, "home", "data"));
            if (!dir) { return; }
            return new vscode.RelativePattern(dir, "**/*.json");
        });

        return treeView;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        await whenReady;

        const items: vscode.TreeItem[] = [];
        if (!element) {
            // Categories
            const result = await queryCategories();
            for (const [ id ] of result[0].rows) {
                items.push({
                    id,
                    tooltip: id,
                    label: id,
                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                });
            }
        }
        else {
            const components = element.id!.split("/");
            const level = components.length as TreeLevel;
            const [ categoryId, groupId, charaId ] = components;

            switch (level) {
                case TreeLevel.Category: {
                    const result = await queryGroups(categoryId);
                    for (const [ groupId ] of result[0].rows) {
                        const itemId = `${categoryId}/${groupId}`;
                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label: groupId,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                        });
                    }
                    break;
                }
                case TreeLevel.Group: {
                    // This level is an abstraction
                    const result = await queryCharacters(categoryId, groupId);
                    for (const [ charaId ] of result[0].rows) {
                        const itemId = `${categoryId}/${groupId}/${charaId}`;
                        let label = charaId;
                        const name = await getCharaName(charaId);
                        if (name) {
                            label += ` ${name}`;
                        }
                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                        });
                    }
                    break;
                }
                case TreeLevel.Character: {
                    const ldManager = LocalizedDataManager.instance!;
                    const result = await queryStories(categoryId, groupId, charaId);
                    for (const [ storyId ] of result[0].rows) {
                        const itemId = `${categoryId}/${groupId}/${charaId}/${storyId}`;

                        const dictPath = await ldManager.getPathUri("assets_dir", undefined,
                            "home", "data", categoryId, groupId, `hometimeline_${categoryId}_${groupId}_${storyId}.json`);
                        const status = await utils.getEntryStatus(dictPath);

                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label: utils.makeStatusLabel(storyId.slice(4), status),
                            command: {
                                title: "ZokuZoku: Open story editor",
                                command: "zokuzoku.openStoryEditor",
                                arguments: [ "home", storyId, categoryId, groupId ]
                            }
                        });
                    }
                    break;
                }
            }
        }

        return items;
    }
}