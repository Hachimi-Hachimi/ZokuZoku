import * as vscode from 'vscode';
import { getEditorHtml, makeEditForStringProperty } from './utils';
import { ControllerMessage, EditorMessage, IEntryTreeNode, ITreeNode, TreeNodeId } from './sharedTypes';
import { JsonDocument } from '../core';
import assetHelper from '../core/assetHelper';
import { parse as parseCsv } from 'csv-parse/sync';
import fontHelper from './fontHelper';
import { EditorBase } from './editorBase';
import { extractLyricsData } from '../pythonBridge';
import config from '../config';
import SQLite from '../sqlite';
import { resolve as resolvePath } from 'path';

export class LyricsEditorProvider extends EditorBase implements vscode.CustomTextEditorProvider {
    static readonly viewType = 'zokuzoku.lyricsEditor';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new LyricsEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(LyricsEditorProvider.viewType, provider);
    }

    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken) {
        // Json document setup
        const json = new JsonDocument<{[key: string]: string} | null>(document.uri, null, () => {
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
        const initReadPromise = json.readTextDocument().catch(_ => {});
        json.watchTextDocument(document);
        function getDictProperty(id: TreeNodeId): jsonToAst.PropertyNode | undefined {
            if (json.ast.type !== "Object" || typeof id !== "string") { return; }
            return json.astObjectsProps.get(json.ast)?.[id];
        }
        function getDictValue(id: TreeNodeId): string | null {
            const valueNode = getDictProperty(id)?.value;
            return (!valueNode || valueNode.type !== "Literal" || typeof valueNode.value !== "string") ?
                null :
                valueNode.value;
        }
        
        // Init webview
        const panelDisposables = this.setupWebview(webviewPanel);
        panelDisposables.push(json);

        // Messaging setup
        function postMessage(message: ControllerMessage) {
            webviewPanel.webview.postMessage(message);
        }

        let prevEditPromise = Promise.resolve();
        const nodesPromise = LyricsEditorProvider.generateNodes(document.uri);
        panelDisposables.push(webviewPanel.webview.onDidReceiveMessage((message: EditorMessage) => {
            switch (message.type) {
                case "init":
                    postMessage({
                        type: "setExplorerTitle",
                        title: vscode.l10n.t('Lyrics')
                    });
                    // Just making sure to prevent data races
                    initReadPromise.finally(() => {
                        nodesPromise.then(nodes => {
                            postMessage({ type: "setNodes", nodes });
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
                    const key = message.entryPath[0];
                    if (typeof key !== "string") { break; }

                    // Wait for previous edit to finish before applying another
                    prevEditPromise = prevEditPromise.then(async () => {
                        try {
                            const applied = await json.applyEdit(
                                makeEditForStringProperty(key, message.content)
                            );
                            if (!applied) {
                                vscode.window.showErrorMessage(
                                    vscode.l10n.t('Failed to apply edit')
                                );
                            }
                        }
                        catch (e) {
                            vscode.window.showErrorMessage("" + e);
                        }
                    });
                    break;
                }
            }
        }));
    }

    static async generateNodes(uri: vscode.Uri): Promise<ITreeNode[]> {
        const pathSplit = uri.path.split("/");
        const filename = pathSplit.at(-1);
        const matches = filename?.match(/^(m\d{4})(_lyrics\.json)$/);
        const musicId = matches?.[1];
        if (!musicId) {
            throw new Error(
                vscode.l10n.t('Failed to parse song index from filename')
            );
        }

        const lyricsAssetName = musicId + "_lyrics";
        const assetBundleName = `live/musicscores/${musicId}/${lyricsAssetName}`;

        const hash = await assetHelper.getAssetHash(assetBundleName);
        if (!hash) {
            throw new Error(vscode.l10n.t('Could not find hash for asset bundle: {0}', {0: assetBundleName}));
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

        const lyricsData = await extractLyricsData({
            assetPath: absoluteAssetPath,
            assetName: lyricsAssetName,
            useDecryption: useDecryption,
            metaPath: absoluteMetaPath,
            bundleHash: hash,
            metaKey: metaKey
        });

        const data: [string, string][] = parseCsv(lyricsData.csv_data, {
            encoding: "utf8", from: 2, relax_column_count_more: true,
            skip_empty_lines: true
        });

        const nodes: IEntryTreeNode[] = [];
        for (const row of data) {
            const [ time, lyrics ] = row;
            if (!lyrics) { continue; }
            const prevNode = nodes[nodes.length - 1];
            if (prevNode) { prevNode.next = time; }
            nodes.push({
                type: "entry", id: time, name: lyrics,
                content: [{ content: lyrics, multiline: true }],
                prev: prevNode?.id
            });
        }

        return nodes;
    }

    protected override getHtmlForWebview(webview: vscode.Webview): string {
        return getEditorHtml(
            this.context.extensionUri,
            webview,
            "commonEditor",
            vscode.l10n.t('Lyrics Editor')
        );
    }
}
