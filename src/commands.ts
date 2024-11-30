import * as vscode from 'vscode';
import { LocalizeDictEditorProvider } from './editors/localizeDictEditor';
import { automation, LocalizedDataManager, setActive, utils } from './core';
import config from './config';
import { LyricsEditorProvider } from './editors/lyricsEditor';
import { MdbEditorProvider } from './editors/mdbEditor';
import HachimiIpc from './core/hachimiIpc';
import { EditorBase } from './editors/editorBase';
import StoriesTreeDataProvider from './views/storiesTreeDataProvider';
import HomeStoriesTreeDataProvider from './views/homeStoriesTreeDataProvider';
import MainStoriesTreeDataProvider from './views/mainStoryTreeDataProvider';
import LyricsTreeDataProvider from './views/lyricsTreeDataProvider';
import { RaceStoryEditorProvider } from './editors/raceStoryEditor';
import { StoryEditorProvider } from './editors/storyEditor';
import { updateHachimiConfig } from './core/utils';
import { MdbTableName } from './sqlite';

type CommandTree = {[key: string]: ((...args: any[]) => any) | CommandTree};

const COMMANDS: CommandTree = {
    zokuzoku: {
        enable() {
            config().update("enabled", true, false);
            setActive(true);
        },

        openLocalizeDictEditor() {
            LocalizedDataManager.with(async ldManager => {
                const document = await ldManager.getPathUriAndOpenTextDocument("{}", "localize_dict", "localize_dict.json");
                vscode.commands.executeCommand("vscode.openWith", document.uri, LocalizeDictEditorProvider.viewType);
            });
        },

        openLyricsEditor(songIndex?: string) {
            if (!songIndex) {
                vscode.window.showErrorMessage("This command cannot be activated manually.");
                return;
            }
            LocalizedDataManager.with(async ldManager => {
                const document = await ldManager.getPathUriAndOpenTextDocument(
                    "{}", "assets_dir",
                    "assets", "lyrics", `m${songIndex}_lyrics.json`
                );
                vscode.commands.executeCommand("vscode.openWith", document.uri, LyricsEditorProvider.viewType);
            });
        },

        openMdbEditor(tableName?: MdbTableName) {
            if (!tableName) {
                vscode.window.showErrorMessage("This command cannot be activated manually.");
                return;
            }
            LocalizedDataManager.with(async ldManager => {
                const dictName = tableName + "_dict";
                MdbEditorProvider.nextTableName = tableName;
                try {
                    const document = await ldManager.getPathUriAndOpenTextDocument(
                        // @ts-ignore
                        "{}", dictName, `${dictName}.json`
                    );
                    vscode.commands.executeCommand("vscode.openWith", document.uri, MdbEditorProvider.viewType);
                }
                catch {
                    MdbEditorProvider.nextTableName = undefined;
                }
            });
        },

        openRaceStoryEditor(storyId?: string | number) {
            if (!storyId) {
                vscode.window.showErrorMessage("This command cannot be activated manually.");
                return;
            }
            const nStoryId = utils.normalizeStoryId(storyId);
            LocalizedDataManager.with(async ldManager => {
                const document = await ldManager.getPathUriAndOpenTextDocument(
                    "[]", "assets_dir",
                    "assets", "race", "storyrace", "text", `storyrace_${nStoryId}.json`
                );
                vscode.commands.executeCommand("vscode.openWith", document.uri, RaceStoryEditorProvider.viewType);
            });
        },

        openStoryEditor(type?: "story" | "home", storyId?: string, categoryId?: string, groupId?: string) {
            if (!type || !storyId) {
                vscode.window.showErrorMessage("This command cannot be activated manually.");
                return;
            }

            let relDictPath: string[];
            switch (type) {
                case "story":
                    if (!categoryId) {
                        categoryId = storyId.slice(0, 2);
                    }
                    if (!groupId) {
                        groupId = storyId.slice(2, 6);
                    }
                    const nStoryId = utils.normalizeStoryId(storyId);
                    relDictPath = ["story", "data", categoryId, groupId, `storytimeline_${nStoryId}.json`];
                    break;
                
                case "home":
                    if (!categoryId || !groupId) {
                        vscode.window.showErrorMessage("Missing arguments.");
                        return;
                    }
                    relDictPath = ["home", "data", categoryId, groupId, `hometimeline_${categoryId}_${groupId}_${storyId}.json`];
                    break;
            }

            LocalizedDataManager.with(async ldManager => {
                const document = await ldManager.getPathUriAndOpenTextDocument(
                    "{}", "assets_dir",
                    "assets", ...relDictPath
                );
                vscode.commands.executeCommand("vscode.openWith", document.uri, StoryEditorProvider.viewType);
            });
        },

        runAllAutomations() {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Running automations..."
            }, async () => {
                try {
                    await automation.runAll();
                }
                catch (e) {
                    vscode.window.showErrorMessage("" + e);
                }
            });
        },

        async runAutomation() {
            const filename = await vscode.window.showQuickPick(automation.getScripts(), {
                placeHolder: "Pick a script to run"
            });
            if (filename) {
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Running ${filename}...`
                }, async () => {
                    try {
                        await automation.run(filename);
                    }
                    catch (e) {
                        vscode.window.showErrorMessage("" + e);
                    }
                });
            }
        },

        hachimi: {
            reloadLocalizedData() {
                HachimiIpc.callWithProgress({ type: "ReloadLocalizedData" }).catch(e => {
                    vscode.window.showErrorMessage("" + e);
                });
            },
            setLocalizedDataDir() {
                let localizedDataDir = LocalizedDataManager.instance?.dirUri.fsPath;
                if (!localizedDataDir) {
                    return vscode.window.showErrorMessage("ZokuZoku has not been activated.");
                }

                updateHachimiConfig(config => {
                    if (config._localized_data_dir || config._translation_repo_index) {
                        vscode.window.showWarningMessage(
                            "The localized data dir has already been set by ZokuZoku. Revert it " +
                            "first if you want to swap it with the current folder."
                        );
                        return;
                    }

                    config._localized_data_dir = config.localized_data_dir ?? null;
                    config._translation_repo_index = config.translation_repo_index ?? null;

                    config.localized_data_dir = localizedDataDir;
                    delete config.translation_repo_index;

                    return config;
                })
                .then(res => {
                    if (res) {
                        vscode.window.showInformationMessage(
                            `Localized data dir has been set to \"${localizedDataDir}\"`
                        );
                    }
                })
                .catch(e => {
                    vscode.window.showErrorMessage("" + e);
                });
            },
            revertLocalizedDataDir() {
                updateHachimiConfig(config => {
                    if (!("_localized_data_dir" in config || "_translation_repo_index" in config)) {
                        vscode.window.showWarningMessage("Nothing to revert in the config file.");
                        return;
                    }

                    if ("_localized_data_dir" in config) {
                        const v = config._localized_data_dir;
                        if (v === null) {
                            delete config.localized_data_dir;
                        }
                        else {
                            config.localized_data_dir = v;
                        }
                        delete config._localized_data_dir;
                    }

                    if ("_translation_repo_index" in config) {
                        const v = config._translation_repo_index;
                        if (v === null) {
                            delete config.translation_repo_index;
                        }
                        else {
                            config.translation_repo_index = v;
                        }
                        delete config._translation_repo_index;
                    }

                    return config;
                })
                .then(res => {
                    if (res) {
                        vscode.window.showInformationMessage(
                            `Localized data dir has been reverted to \"${res.localized_data_dir}\"`
                        );
                    }
                })
                .catch(e => {
                    vscode.window.showErrorMessage("" + e);
                });
            }
        },

        stories:     { refresh: () => StoriesTreeDataProvider.instance?.refresh() },
        homeStories: { refresh: () => HomeStoriesTreeDataProvider.instance?.refresh() },
        mainStories: { refresh: () => MainStoriesTreeDataProvider.instance?.refresh() },
        lyrics:      { refresh: () => LyricsTreeDataProvider.instance?.refresh() }
    },

    undo: () => {
        if (EditorBase.activeWebview) {
            EditorBase.activeWebview.postMessage({ type: "undo" });
        }
        else {
            vscode.commands.executeCommand("default:undo");
        }
    },

    redo: () => {
        if (EditorBase.activeWebview) {
            EditorBase.activeWebview.postMessage({ type: "redo" });
        }
        else {
            vscode.commands.executeCommand("default:redo");
        }
    }
};

export function registerCommands(
    context: vscode.ExtensionContext, commandTree = COMMANDS, disposables: vscode.Disposable[] = [], prefix = ""
): vscode.Disposable[] {
    for (const name in commandTree) {
        let node = commandTree[name];
        if (typeof node === "function") {
            disposables.push(vscode.commands.registerCommand(prefix + name, node));
        }
        else {
            registerCommands(context, node, disposables, prefix + name + ".");
        }
    }

    return disposables;
}