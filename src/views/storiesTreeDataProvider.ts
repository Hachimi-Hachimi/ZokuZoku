import * as vscode from 'vscode';
import SQLite from '../sqlite';
import { LocalizedDataManager, utils } from '../core';
import RefreshableTreeDataProviderBase from './refreshableTreeDataProviderBase';
import { whenReady } from '../extensionContext';
import config from '../config';

function queryCategories() {
    return SQLite.instance.queryMeta(
        "SELECT DISTINCT SUBSTR(n, 12, 2) FROM a WHERE n LIKE 'story/data/__/____/storytimeline\\__________' ESCAPE '\\'"
    );
}

function queryGroups(categoryId: string) {
    return SQLite.instance.queryMeta(
        `SELECT DISTINCT SUBSTR(n, 15, 4)
        FROM a WHERE n LIKE 'story/data/${categoryId}/____/storytimeline\\__________' ESCAPE '\\'`
    );
}

function queryStories(categoryId: string, groupId: string) {
    return SQLite.instance.queryMeta(
        `SELECT SUBSTR(n, 34, 9)
        FROM a WHERE n LIKE 'story/data/${categoryId}/${groupId}/storytimeline\\__________' ESCAPE '\\'`
    );
}

enum TreeLevel {
    None,
    Category,
    Group,
    Story
}

const categoryNames: {[key: string]: string} = {
    "00": vscode.l10n.t("> Short Episodes"),
    "01": vscode.l10n.t("> Tutorials"),
    "02": vscode.l10n.t("> Main Story"),
    "04": vscode.l10n.t("> Umamusume Stories"),
    "08": vscode.l10n.t("> Scenario Intros"),
    "09": vscode.l10n.t("> Story Events"),
    "10": vscode.l10n.t("> Anniv. Stories"),
    "11": vscode.l10n.t("> G1 Outfit Episodes"),
    "12": vscode.l10n.t("> New Year Short Episodes"),
    "13": vscode.l10n.t("Kirari Magic Show"),
    "14": vscode.l10n.t("The White Era"),
    "40": vscode.l10n.t("> Scenario Career Events"),
    "50": vscode.l10n.t("> Umamusume Career Events"),
    "80": vscode.l10n.t("> Support Card Events (R)"),
    "82": vscode.l10n.t("> Support Card Events (SR)"),
    "83": vscode.l10n.t("> Support Card Events (SSR)")
};



export default class StoriesTreeDataProvider extends RefreshableTreeDataProviderBase implements vscode.TreeDataProvider<vscode.TreeItem> {
    private static _instance?: StoriesTreeDataProvider;
    static get instance(): StoriesTreeDataProvider | undefined { return this._instance; }

    override refresh() {
        utils.invalidateTranslatedTextDataCache();
        super.refresh();
    }

    private async getGroupName(categoryId: string, groupId: string): Promise<string | undefined> {
        switch (+categoryId) {
            case 4:
            case 50: {
                if (config().get<boolean>("showTranslatedCharacterNames")) {
                    const translatedData = await utils.getTranslatedTextData();
                    if (translatedData && translatedData["6"]) {
                        const translatedName = translatedData["6"][groupId];
                        if (translatedName) {
                            return translatedName;
                        }
                    }
                }

                const characterNames = await utils.getTextDataCategoryCached(6);
                return characterNames[+groupId];
            }
            case 40:
                return (await utils.getTextDataCategory(119))[+groupId]?.replaceAll("\\n", " ");
        }
    }

    private async getStoryName(categoryId: string, storyId: string) {
        switch (+categoryId) {
            case 4:
                return (await utils.getTextDataCategory(92))[+storyId];
        }
    
        // Training events span across multiple categories
        return (await utils.getTextDataCategoryCached(181))[+storyId];
    }

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        const treeDataProvider = new StoriesTreeDataProvider;
        StoriesTreeDataProvider._instance = treeDataProvider;

        const treeView = vscode.window.createTreeView('stories', {
            treeDataProvider
        });

        treeDataProvider.initRefreshWatcher(treeView, async () => {
            const dir = await LocalizedDataManager.instancePromise
                .then(m => m.getPathUri("assets_dir", undefined, "story", "data"));
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
                let label = id;
                const name = categoryNames[id];
                if (name) {
                    label += ` ${name}`;
                }
                items.push({
                    id,
                    tooltip: id,
                    label,
                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                });
            }
        }
        else {
            const components = element.id!.split("/");
            const level = components.length as TreeLevel;
            const [ categoryId, groupId ] = components;

            switch (level) {
                case TreeLevel.Category: {
                    const result = await queryGroups(categoryId);
                    for (const [ groupId ] of result[0].rows) {
                        const itemId = `${categoryId}/${groupId}`;
                        let label = groupId;
                        const name = await this.getGroupName(categoryId, groupId);
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
                case TreeLevel.Group: {
                    const ldManager = LocalizedDataManager.instance!;
                    const result = await queryStories(categoryId, groupId);
                    for (const [ storyId ] of result[0].rows) {
                        const itemId = `${categoryId}/${groupId}/${storyId}`;
                        let label = storyId.slice(6);
                        const name = await this.getStoryName(categoryId, storyId);
                        if (name) {
                            label += ` ${name}`;
                        }

                        const dictPath = await ldManager.getPathUri("assets_dir", undefined,
                            "story", "data", categoryId, groupId, `storytimeline_${storyId}.json`);
                        const status = await utils.getEntryStatus(dictPath);

                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label: utils.makeStatusLabel(label, status),
                            command: {
                                title: "ZokuZoku: Open story editor",
                                command: "zokuzoku.openStoryEditor",
                                arguments: [ "story", storyId ]
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
