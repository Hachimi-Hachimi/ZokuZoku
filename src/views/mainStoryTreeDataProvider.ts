import * as vscode from 'vscode';
import SQLite from '../sqlite';
import { LocalizedDataManager, utils } from '../core';
import RefreshableTreeDataProviderBase from './refreshableTreeDataProviderBase';
import { whenReady } from '../extensionContext';

function queryAllChapters() {
    return SQLite.instance.queryMdb('SELECT DISTINCT "part_id" FROM main_story_data');
}

function queryChapters(actNum: number) {
    return SQLite.instance.queryMdb(
        `SELECT DISTINCT "part_id"
        FROM main_story_data
        WHERE "part_id" > ${actNum === 1 ? 0 : actNum * 10} AND "part_id" < ${(actNum + 1) * 10}`
    );
}

function queryEpisodes(chapterId: number) {
    return SQLite.instance.queryMdb(`SELECT "id", "episode_index" FROM main_story_data WHERE "part_id" = ${chapterId}`);
}

function queryStories(id: number) {
    return SQLite.instance.queryMdb(
        `SELECT "story_type_1", "story_id_1", "story_type_2", "story_id_2", "story_type_3", "story_id_3",
        "story_type_4", "story_id_4", "story_type_5", "story_id_5"
        FROM main_story_data
        WHERE "id" = ${id}`
    );
}

enum TreeLevel {
    None,
    Act,
    Chapter,
    Episode,
    Story
}

export default class MainStoriesTreeDataProvider extends RefreshableTreeDataProviderBase implements vscode.TreeDataProvider<vscode.TreeItem> {
    private static _instance?: MainStoriesTreeDataProvider;
    static get instance(): MainStoriesTreeDataProvider | undefined { return this._instance; }

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        const treeDataProvider = new MainStoriesTreeDataProvider;
        MainStoriesTreeDataProvider._instance = treeDataProvider;

        const treeView = vscode.window.createTreeView('main-stories', {
            treeDataProvider
        });

        treeDataProvider.initRefreshWatcher(treeView, async () => {
            const dir = await LocalizedDataManager.instancePromise
                .then(m => m.getPathUri("assets_dir", undefined, "story", "data"));
            if (!dir) { return; }
            return new vscode.RelativePattern(dir, "**/*.json");
        });

        treeDataProvider.initRefreshWatcher(treeView, async () => {
            const dir = await LocalizedDataManager.instancePromise
                .then(m => m.getPathUri("assets_dir", undefined, "race", "storyrace", "text"));
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

        const items: vscode.TreeItem[] = [];
        if (!element) {
            // Acts
            const result = await queryAllChapters();
            const chapterRows = result[0].rows;
            const lastChapter = chapterRows?.[chapterRows.length - 1]?.[0];
            if (lastChapter !== undefined) {
                let actCount = Math.floor(+lastChapter / 10);
                if (actCount < 1) { actCount = 1; }

                for (let i = 1; i <= actCount; ++i) {
                    items.push({
                        id: i.toString(),
                        tooltip: i.toString(),
                        label: vscode.l10n.t("Act {0}", i),
                        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                    });
                }
            }
        }
        else {
            const components = element.id!.split("/");
            const level = components.length as TreeLevel;
            const [ actNum, chapterId, id ] = components;

            switch (level) {
                case TreeLevel.Act: {
                    const chapterNames = await utils.getTextDataCategory(93);
                    const result = await queryChapters(+actNum);

                    for (const [ chapterId ] of result[0].rows) {
                        const itemId = `${actNum}/${chapterId}`;
                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label: chapterNames[+chapterId] ?? itemId,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                        });
                    }

                    break;
                }
                case TreeLevel.Chapter: {
                    const episodeNames = await utils.getTextDataCategory(94);
                    const result = await queryEpisodes(+chapterId);

                    for (const [ id, episodeIndex ] of result[0].rows) {
                        const itemId = `${actNum}/${chapterId}/${id}`;
                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label: `E${episodeIndex} - ${episodeNames[+id] ?? "Unknown"}`,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                        });
                    }
                    break;
                }
                case TreeLevel.Episode: {
                    const result = await queryStories(+id);
                    const row = result[0].rows[0];
                    const ldManager = LocalizedDataManager.instance!;

                    let noTranslatables = true;
                    for (let i = 0; i < 10; i += 2) {
                        const [ storyType, storyId ] = row.map(v => +v).slice(i, i + 2);
                        if (storyType === 0) { break; }

                        const nStoryId = utils.normalizeStoryId(storyId);
                        let iconId: string;
                        let dictPath: vscode.Uri | undefined;
                        let command: vscode.Command | undefined;
                        switch (storyType) {
                            case 1: { // normal story
                                iconId = "book";
                                const comp = utils.getStoryIdComponents(storyId);
                                dictPath = await ldManager.getPathUri("assets_dir", undefined,
                                    "story", "data", comp[0], comp[1], `storytimeline_${nStoryId}.json`);
                                command = {
                                    title: "ZokuZoku: Open story editor",
                                    command: "zokuzoku.openStoryEditor",
                                    arguments: [ "story", nStoryId ]
                                };
                                break;
                            }

                            case 3: // race story
                                iconId = "device-camera-video";
                                dictPath = await ldManager.getPathUri("assets_dir", undefined,
                                    "race", "storyrace", "text", `storyrace_${nStoryId}.json`);
                                command = {
                                    title: "ZokuZoku: Open race story editor",
                                    command: "zokuzoku.openRaceStoryEditor",
                                    arguments: [ nStoryId ]
                                };
                                break;

                            default: continue;
                        }
                        const status = await utils.getEntryStatus(dictPath);

                        noTranslatables = false;

                        const itemId = `${actNum}/${chapterId}/${id}/${storyId}`;
                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label: utils.makeStatusLabel(`Part ${(i / 2) + 1}`, status),
                            iconPath: new vscode.ThemeIcon(iconId),
                            command
                        });
                    }

                    if (noTranslatables) {
                        const itemId = `${actNum}/${chapterId}/${id}/nope`;
                        items.push({
                            id: itemId,
                            tooltip: itemId,
                            label: vscode.l10n.t("No translatable parts.")
                        });
                    }
                    break;
                }
            }
        }

        return items;
    }
}