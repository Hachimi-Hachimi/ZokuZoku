import * as vscode from 'vscode';
import { getEditorHtml, makeEditForArray } from './utils';
import { ControllerMessage, EditorMessage, IEntryTreeNode, ITreeNode, TreeNodeId } from './sharedTypes';
import { JsonDocument } from '../core';
import assetHelper from '../core/assetHelper';
import fontHelper from './fontHelper';
import { EditorBase } from './editorBase';
import path from 'path';
import { HCA_KEY, ZOKUZOKU_DIR } from '../defines';
import { ACB } from "cricodecs";
import fs from 'fs/promises';
import { pathExists } from '../core/utils';
import { extractRaceStoryData } from '../pythonBridge';
import config from '../config';
import SQLite from '../sqlite';
import { resolve as resolvePath } from 'path';

export class RaceStoryEditorProvider extends EditorBase implements vscode.CustomTextEditorProvider {
    static readonly viewType = 'zokuzoku.raceStoryEditor';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new RaceStoryEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(RaceStoryEditorProvider.viewType, provider);
    }

    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken) {
        // Json document setup
        const json = new JsonDocument<string[] | null>(document.uri, null, () => {
            const subscribedKey = this.subscribedPath[0];
            const content = getDictValue(subscribedKey);
            postMessage({
                type: "setTextSlotContent",
                entryPath: this.subscribedPath,
                index: 0,
                content
            });
            postMessage({
                type: "setExists",
                path: this.subscribedPath,
                exists: content !== null
            });
        });
        const initReadPromise = json.readTextDocument().catch(_ => { });
        json.watchTextDocument(document);
        function getDictProperty(id: TreeNodeId): jsonToAst.ValueNode | undefined {
            id = Number(id);
            if (json.ast.type !== "Array" || isNaN(id)) { return; }
            return json.ast.children[id];
        }
        function getDictValue(id: TreeNodeId): string | null {
            const valueNode = getDictProperty(id);
            return (!valueNode || valueNode.type !== "Literal" || typeof valueNode.value !== "string") ?
                null :
                valueNode.value;
        }

        // Init webview
        const assetInfo = RaceStoryEditorProvider.parseFilename(document.uri);
        const panelDisposables = this.setupWebview(webviewPanel, [
            vscode.Uri.file(assetInfo.voiceCacheDir)
        ]);
        panelDisposables.push(json);

        // Messaging setup
        function postMessage(message: ControllerMessage) {
            webviewPanel.webview.postMessage(message);
        }

        let prevEditPromise = Promise.resolve();
        const nodesPromise = RaceStoryEditorProvider.generateNodes(assetInfo);
        let loadVoicePromise: Promise<{ [key: string]: string }> | undefined;
        panelDisposables.push(webviewPanel.webview.onDidReceiveMessage(async (message: EditorMessage) => {
            switch (message.type) {
                case "init":
                    postMessage({ type: "setExplorerTitle", title: vscode.l10n.t("Race Story") });
                    // Just making sure to prevent data races
                    initReadPromise.finally(() => {
                        nodesPromise.then(nodes => {
                            postMessage({ type: "setNodes", nodes });
                            postMessage({ type: "enableVoicePlayer" });
                        })
                            .catch(e => vscode.window.showErrorMessage("" + e));
                    });
                    fontHelper.onInit(webviewPanel.webview);
                    break;

                case "getTextSlotContent": {
                    const key = message.entryPath[0];
                    postMessage({
                        type: "setTextSlotContent",
                        entryPath: message.entryPath,
                        index: message.index,
                        content: getDictValue(key)
                    });
                    break;
                }

                case "getExists": {
                    const key = message.path[0];
                    postMessage({
                        type: "setExists",
                        path: message.path,
                        exists: getDictValue(key) !== null
                    });
                    break;
                }

                case "setTextSlotContent": {
                    const key = Number(message.entryPath[0]);
                    if (isNaN(key)) { break; }

                    // Wait for previous edit to finish before applying another
                    prevEditPromise = prevEditPromise.then(async () => {
                        try {
                            if (json.ast.type !== "Array") {
                                throw new Error(vscode.l10n.t("Root node is not an array"));
                            }
                            const applied = await json.applyEdit(
                                makeEditForArray(json.ast, "", key, message.content)
                            );
                            if (!applied) {
                                vscode.window.showErrorMessage(vscode.l10n.t("Failed to apply edit"));
                            }
                        }
                        catch (e) {
                            vscode.window.showErrorMessage("" + e);
                        }
                    });
                    break;
                }

                case "loadVoice":
                    if (!loadVoicePromise || !(await pathExists(assetInfo.voiceCacheDir))) {
                        loadVoicePromise = (async () => {
                            const hash = await assetHelper.getAssetHash(assetInfo.voiceAssetName);
                            if (!hash) {
                                throw new Error(vscode.l10n.t("Voice data is not available for this story"));
                            }
                            const acbPath = await assetHelper.ensureAssetDownloaded(hash, true);
                            return vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                                title: vscode.l10n.t("Decoding audio")
                            }, async progress => {
                                const acb = await ACB.fromFile(acbPath);
                                const paths = await acb.decodeToWavFiles(HCA_KEY, assetInfo.voiceCacheDir, (current, total) => {
                                    progress.report({
                                        message: `${current}/${total}`,
                                        increment: current ? (1 / total) * 100 : 0
                                    });
                                });
                                const uris = Object.fromEntries(paths.map((v, i) => [
                                    i.toString(),
                                    webviewPanel.webview.asWebviewUri(vscode.Uri.file(v)).toString()
                                ]));
                                return uris;
                            });
                        })();
                    }
                    loadVoicePromise
                        .then(uris => postMessage({ type: "loadVoice", uris }))
                        .catch(e => vscode.window.showErrorMessage("" + e));
                    break;
            }
        }));

        // Always try to clean up voice cache, regardless if voice was loaded in *this session*
        panelDisposables.push(new vscode.Disposable(() => {
            return fs.rm(assetInfo.voiceCacheDir, { recursive: true, force: true });
        }));
    }

    static parseFilename(uri: vscode.Uri): RaceStoryAssetInfo {
        const pathSplit = uri.path.split("/");
        const filename = pathSplit.at(-1);
        const matches = filename?.match(/^(storyrace_\d{9})\.json$/);
        const assetName = matches?.[1];
        if (!assetName) {
            throw new Error(vscode.l10n.t("Failed to parse asset name from filename"));
        }

        return {
            assetBundleName: `race/storyrace/text/${assetName}`,
            assetName,
            voiceAssetName: `sound/s/snd_voi_${assetName}.acb`,
            voiceCacheDir: path.join(ZOKUZOKU_DIR, "cache", `snd_voi_${assetName}`)
        }
    }

    static async generateNodes(info: RaceStoryAssetInfo): Promise<ITreeNode[]> {
        const { assetBundleName, assetName } = info;

        const hash = await assetHelper.getAssetHash(assetBundleName);
        if (!hash) {
            throw new Error(vscode.l10n.t(`Could not find hash for asset bundle: {0}`, { 0: assetBundleName }));
        }
        const assetPath = await assetHelper.ensureAssetDownloaded(hash, false);

        const useDecryption = config().get<boolean>("decryption.enabled");
        const metaPath = SQLite.instance.getMetaPath();
        const metaKey = config().get<string>("decryption.metaKey");

        if (useDecryption && !metaPath) {
            throw new Error(vscode.l10n.t("Decryption is enabled, but the meta path is not set."));
        }

        const absoluteAssetPath = resolvePath(assetPath);
        const absoluteMetaPath = metaPath ? resolvePath(metaPath) : '';

        const raceData = await extractRaceStoryData({
            assetPath: absoluteAssetPath,
            assetName: assetName,
            useDecryption: useDecryption ?? false,
            metaPath: absoluteMetaPath,
            bundleHash: hash,
            metaKey: metaKey
        });

        const nodes: IEntryTreeNode[] = [];
        for (const [i, text] of raceData.texts.entries()) {
            const id = i;
            const prevNode = nodes[nodes.length - 1];
            if (prevNode) {
                prevNode.next = id;
            }
            nodes.push({
                type: "entry", id, name: text,
                content: [{ content: text, multiline: true }],
                prev: prevNode?.id
            });
        }

        return nodes;
    }

    protected override getHtmlForWebview(webview: vscode.Webview): string {
        return getEditorHtml(this.context.extensionUri, webview, "commonEditor", "Race Story Editor");
    }
}

interface RaceStoryAssetInfo {
    assetBundleName: string;
    assetName: string;
    voiceAssetName: string;
    voiceCacheDir: string;
}