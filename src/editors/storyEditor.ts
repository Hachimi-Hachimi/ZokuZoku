import * as vscode from 'vscode';
import { getEditorHtml, makeEditForArray, makeEditForStringProperty } from './utils';
import { StoryEditorControllerMessage, EditorMessage, IEntryTreeNode, IStoryTextSlot, ITreeNode, StoryTextSlotType, TreeNodeId } from './sharedTypes';
import { JsonArrayEdit, JsonDocument, JsonEdit, JsonObjectEdit, LocalizedDataManager } from '../core';
import { createFormatter } from '../core/jsonFormatter';
import assetHelper from '../core/assetHelper';
import fontHelper from './fontHelper';
import { EditorBase } from './editorBase';
import { HCA_KEY, ZOKUZOKU_DIR } from '../defines';
import path from 'path';
import { AFS2 } from 'cricodecs';
import fs from 'fs/promises';
import { pathExists } from '../core/utils';
import { extractStoryData } from '../pythonBridge';
import { resolve as resolvePath } from 'path';
import config from '../config';
import SQLite from '../sqlite';

const STORY_VIEW_CATEGORIES = new Set<string>(["02", "04", "09"]);

export class StoryEditorProvider extends EditorBase implements vscode.CustomTextEditorProvider {
    static readonly viewType = 'zokuzoku.storyEditor';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new StoryEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(StoryEditorProvider.viewType, provider);
    }

    constructor(context: vscode.ExtensionContext) {
        super(context);
    }

    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken) {
        // Json document setup
        const json = new JsonDocument<StoryTimelineDataDict | null>(document.uri, null, async () => {
            const subscribedKey = this.subscribedPath[0];
            if (subscribedKey === "title") {
                const content = await getDictValue(subscribedKey);
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
            }
            else {
                const blockIndex = +subscribedKey;
                const ranges = (await dataPromise).contentRanges[+blockIndex];
                if (!ranges) { return; }

                const count = 2 + ranges.choiceDataList.length + ranges.colorTextInfoList.length;
                let exists = false;
                for (let i = 0; i < count; ++i) {
                    const content = await getDictValue(blockIndex, i);
                    postMessage({
                        type: "setTextSlotContent",
                        entryPath: this.subscribedPath,
                        index: i,
                        content
                    });
                    if (content !== null) {
                        exists = true;
                    }
                }
                postMessage({
                    type: "setExists",
                    path: this.subscribedPath,
                    exists
                });
            }
        }, createFormatter({
            keyOrder: [
                "title",
                "no_wrap",
                "text_block_list",
                "name",
                "text",
                "choice_data_list",
                "color_text_info_list",
                "voice_id",
                "voice_length"
            ],
            compact: (_value) => {
                // Never compact any objects - always expand for readability
                return false;
            }
        }));
        const initReadPromise = json.readTextDocument().catch(_ => { });
        json.watchTextDocument(document);
        async function getDictValueNode(id: TreeNodeId, index?: number): Promise<jsonToAst.ValueNode | undefined> {
            if (json.ast.type !== "Object") { return; }
            if (id === "title") {
                return json.astObjectsProps.get(json.ast)?.title?.value;
            }

            id = Number(id);
            if (isNaN(id)) { return; }

            const textBlockList = json.astObjectsProps.get(json.ast)?.text_block_list?.value;
            if (!textBlockList || textBlockList.type !== "Array") { return; }

            const textBlock = textBlockList.children.at(id);
            if (!textBlock || textBlock.type !== "Object") { return; }

            if (index === undefined) {
                return textBlock;
            }

            const textBlockProps = json.astObjectsProps.get(textBlock);
            if (!textBlockProps) { return; }

            const ranges = (await dataPromise).contentRanges[id];
            if (index === 0) {
                return textBlockProps.name?.value;
            }
            else if (index === 1) {
                return textBlockProps.text?.value;
            }
            else if (ranges.choiceDataList.contains(index)) {
                const choiceDataList = textBlockProps.choice_data_list?.value;
                if (!choiceDataList || choiceDataList.type !== "Array") { return; }
                return choiceDataList.children[ranges.choiceDataList.offset(index)];
            }
            else if (ranges.colorTextInfoList.contains(index)) {
                const colorTextInfoList = textBlockProps.color_text_info_list?.value;
                if (!colorTextInfoList || colorTextInfoList.type !== "Array") { return; }
                return colorTextInfoList.children[ranges.colorTextInfoList.offset(index)];
            }
        }
        async function getDictValue(id: "title"): Promise<string | null>;
        async function getDictValue(id: TreeNodeId, index: number): Promise<string | null>;
        async function getDictValue(id: TreeNodeId, index?: number): Promise<string | null> {
            const valueNode = await getDictValueNode(id, index);
            return (!valueNode || valueNode.type !== "Literal" || typeof valueNode.value !== "string") ?
                null :
                valueNode.value;
        }

        async function applyEdit(edit: JsonEdit<StoryTimelineDataDict>) {
            try {
                const applied = await json.applyEdit(edit);
                if (!applied) {
                    vscode.window.showErrorMessage(vscode.l10n.t("Failed to apply edit"));
                }
            }
            catch (e) {
                vscode.window.showErrorMessage("" + e);
            }
        }

        function applyTextBlockListEdit(edit: JsonArrayEdit<TextBlockDict>) {
            return applyEdit({
                type: "object",
                action: "update",
                property: {
                    key: "text_block_list",
                    value: edit
                }
            });
        }

        // Init webview
        const assetInfo = StoryEditorProvider.parseFilename(document.uri);
        const panelDisposables = this.setupWebview(webviewPanel, [
            vscode.Uri.file(assetInfo.voiceCacheDir)
        ]);
        panelDisposables.push(json);

        // Messaging setup
        function postMessage(message: StoryEditorControllerMessage) {
            webviewPanel.webview.postMessage(message);
        }

        const dataPromise = StoryEditorProvider.generateData(assetInfo);
        let prevEditPromise: Promise<any> = Promise.resolve();
        let loadVoicePromise: Promise<{ [key: string]: string }> | undefined;
        panelDisposables.push(webviewPanel.webview.onDidReceiveMessage(async (message: EditorMessage) => {
            let data: InitData;
            try {
                data = await dataPromise;
            }
            catch (e) {
                return vscode.window.showErrorMessage("" + e);
            }
            switch (message.type) {
                case "init":
                    postMessage({ type: "setExplorerTitle", title: vscode.l10n.t("Story") });
                    initReadPromise.finally(async () => {
                        if (!json.isReadSuccessful) {
                            vscode.window.showErrorMessage(vscode.l10n.t("Failed to read the document. Editing may cause data loss."));
                        }
                        let noWrap = false;
                        if (json.ast.type === "Object") {
                            const noWrapValue = json.astObjectsProps.get(json.ast)?.no_wrap?.value;
                            noWrap = noWrapValue?.type === "Literal" && noWrapValue.value === true;
                        }
                        const ldManager = await LocalizedDataManager.instancePromise;
                        const config = ldManager.config;
                        postMessage({
                            type: "setConfig",
                            config: {
                                noWrap: !config?.use_text_wrapper || noWrap,
                                isStoryView: assetInfo.isStoryView,
                                lineSpacingMultiplier: config?.text_frame_line_spacing_multiplier,
                                fontSizeMultiplier: config?.text_frame_font_size_multiplier,
                                lineWidthMultiplier: config?.line_width_multiplier
                            }
                        });
                        postMessage({ type: "setNodes", nodes: data.nodes });
                        if (data.title) {
                            postMessage({ type: "setExplorerTitle", title: vscode.l10n.t("Story: {0}", { 0: data.title }) });
                        }
                    });
                    fontHelper.onInit(webviewPanel.webview);
                    break;

                case "getTextSlotContent": {
                    const key = message.entryPath[0];
                    postMessage({
                        type: "setTextSlotContent",
                        entryPath: message.entryPath,
                        index: message.index,
                        content: await getDictValue(key, message.index)
                    });
                    break;
                }

                case "getExists": {
                    const key = message.path[0];
                    postMessage({
                        type: "setExists",
                        path: message.path,
                        // eslint-disable-next-line eqeqeq
                        exists: (await getDictValueNode(key)) != null
                    });
                    break;
                }

                case "setTextSlotContent": {
                    LocalizedDataManager.autoCreatedUris.delete(document.uri.toString());
                    prevEditPromise = prevEditPromise.then(async () => {
                        const key = message.entryPath[0];
                        if (key === "title") {
                            await applyEdit(makeEditForStringProperty("title", message.content));
                            return;
                        }

                        const blockIndex = +key;
                        const ranges = data.contentRanges[blockIndex];
                        if (!ranges) { return; }

                        if (json.ast.type !== "Object") { return; }
                        let textBlockList = json.astObjectsProps.get(json.ast)?.text_block_list?.value;
                        if (!textBlockList || textBlockList.type !== "Array") {
                            await applyTextBlockListEdit({
                                type: "array",
                                action: "set",
                                values: new Array(blockIndex + 1).fill({})
                            });
                        }
                        else if (textBlockList.children.length <= blockIndex) {
                            await applyTextBlockListEdit(makeEditForArray(textBlockList, {}, blockIndex, {}));
                        }
                        textBlockList = json.astObjectsProps.get(json.ast)!.text_block_list.value as jsonToAst.ArrayNode;

                        let textBlockEdit: JsonObjectEdit<TextBlockDict> | undefined;
                        const index = message.index;
                        if (index === 0 || index === 1) {
                            textBlockEdit = makeEditForStringProperty(index === 0 ? "name" : "text", message.content);
                        }
                        else {
                            const isChoiceData = ranges.choiceDataList.contains(index);
                            if (isChoiceData || ranges.colorTextInfoList.contains(index)) {
                                const textBlock = textBlockList.children[blockIndex];
                                if (!textBlock || textBlock.type !== "Object") {
                                    return vscode.window.showErrorMessage(vscode.l10n.t("Invalid text block dict at index {0}", { 0: blockIndex }));
                                }

                                const arrayName = isChoiceData ? "choice_data_list" : "color_text_info_list";
                                const listRange = isChoiceData ? ranges.choiceDataList : ranges.colorTextInfoList;

                                const array = json.astObjectsProps.get(textBlock)?.[arrayName]?.value;
                                const listIndex = listRange.offset(index);
                                let listEdit: JsonEdit<string[]>;
                                if (!array || array.type !== "Array") {
                                    if (message.content !== null) {
                                        const values = new Array<string>(listIndex + 1).fill("");
                                        values[listIndex] = message.content;
                                        listEdit = {
                                            type: "array",
                                            action: "set",
                                            values
                                        };
                                    }
                                    else {
                                        return vscode.window.showErrorMessage(vscode.l10n.t("Attempted to clear nonexistent list entry"));
                                    }
                                }
                                else {
                                    listEdit = makeEditForArray(array, "", listIndex, message.content);
                                }
                                textBlockEdit = {
                                    type: "object",
                                    action: "update",
                                    property: {
                                        key: arrayName,
                                        value: listEdit
                                    }
                                };
                            }
                            else {
                                return vscode.window.showErrorMessage(vscode.l10n.t("Invalid text slot"));
                            }
                        }

                        if (textBlockEdit) {
                            await applyTextBlockListEdit({
                                type: "array",
                                action: "update",
                                index: blockIndex,
                                value: textBlockEdit
                            });
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
                            const awbPath = await assetHelper.ensureAssetDownloaded(hash, true);
                            return vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                                title: vscode.l10n.t("Decoding audio")
                            }, async progress => {
                                const awb = await AFS2.fromFile(awbPath);
                                const paths = await awb.decodeToWavFiles(HCA_KEY, assetInfo.voiceCacheDir, (current, total) => {
                                    progress.report({
                                        message: `${current}/${total}`,
                                        increment: current ? (1 / total) * 100 : 0
                                    });
                                });
                                const uris = Object.fromEntries(data.voiceCues.map(([id, cueId]) => [
                                    id, webviewPanel.webview.asWebviewUri(vscode.Uri.file(paths[cueId])).toString()
                                ]));
                                return uris;
                            });
                        })();
                    }
                    loadVoicePromise
                        .then(uris => postMessage({ type: "loadVoice", uris }))
                        .catch(e => vscode.window.showErrorMessage("" + e));
                    break;
                
                case "setNoWrap":
                    applyEdit({
                        type: "object",
                        action: "update",
                        property: {
                            key: "no_wrap",
                            value: message.value
                        }
                    });
                    break;
            }
        }));

        panelDisposables.push(new vscode.Disposable(() => {
            return fs.rm(assetInfo.voiceCacheDir, { recursive: true, force: true });
        }));
    }

    static parseFilename(uri: vscode.Uri): StoryAssetInfo {
        const pathSplit = uri.path.split("/");
        const filename = pathSplit.at(-1);
        if (!filename) {
            throw new Error(vscode.l10n.t("Failed to parse filename"));
        }

        let assetBundleName: string;
        let assetName: string;
        let isStoryView: boolean;
        let voiceAssetName: string;
        let voiceCacheDir: string;
        //                               1              2 3      4
        const matches = filename.match(/^(storytimeline_((\d{2})(\d{4})\d{3}))\.json$/) ||
            filename.match(/^(hometimeline_((\d{5})_(\d{2})_\d{7}))\.json$/);
        if (matches) {
            const timelineType = filename.startsWith("story") ? "story" : "home";
            isStoryView = timelineType === "story" ? STORY_VIEW_CATEGORIES.has(matches[3]) : false;
            assetBundleName = `${timelineType}/data/${matches[3]}/${matches[4]}/${matches[1]}`;
            assetName = `assets/_gallopresources/bundle/resources/${assetBundleName}.asset`;
            voiceAssetName = `sound/c/snd_voi_story_${matches[2]}.awb`;
            voiceCacheDir = path.join(ZOKUZOKU_DIR, "cache", `snd_voi_story_${matches[2]}`);
        }
        else {
            throw new Error(vscode.l10n.t("Failed to parse filename"));
        }

        return {
            assetBundleName,
            assetName,
            isStoryView,
            voiceAssetName,
            voiceCacheDir
        }
    }

    static async generateData(info: StoryAssetInfo): Promise<InitData> {
        const { assetBundleName, assetName } = info;

        const hash = await assetHelper.getAssetHash(assetBundleName);
        if (!hash) {
            throw new Error(vscode.l10n.t("Could not find hash for asset bundle: {0}", { 0: assetBundleName }));
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

        const timelineData = await extractStoryData({
            assetPath: absoluteAssetPath,
            assetName: assetName,
            useDecryption: useDecryption ?? false,
            metaPath: absoluteMetaPath,
            bundleHash: hash,
            metaKey: metaKey
        });

        const nodes: ITreeNode<IStoryTextSlot>[] = [];
        let resTitle: string | undefined;
        if (timelineData.title && timelineData.title !== "0") {
            nodes.push({
                type: "entry",
                id: "title",
                name: vscode.l10n.t("Title"),
                icon: "whole-word",
                content: [{ content: timelineData.title }],
                next: 0
            });
            resTitle = timelineData.title;
        }

        const contentRanges: BlockContentRanges[] = [];
        let prevMaleNode: IEntryTreeNode | undefined;
        let prevFemaleNode: IEntryTreeNode | undefined;
        const voiceCues: [string, number][] = [];
        let globalCueOffset = 0;

        for (const [i, block] of timelineData.blockList.entries()) {
            const content: IStoryTextSlot[] = [
                {
                    content: block.name,
                    userData: { type: StoryTextSlotType.Name },
                    tooltip: vscode.l10n.t("Name")
                },
                {
                    content: block.text,
                    multiline: true,
                    userData: { type: StoryTextSlotType.Content },
                    tooltip: vscode.l10n.t("Content")
                }
            ];

            let start = 2;
            let end = start;
            for (const choiceData of block.choices) {
                let tooltip: string | undefined;
                let gender: "male" | "female" | undefined;
                switch (choiceData.differenceFlag) {
                    case DifferenceFlag.GenderMale:
                        tooltip = vscode.l10n.t("Male trainer choice");
                        gender = "male";
                        break;
                    case DifferenceFlag.GenderFemale:
                        tooltip = vscode.l10n.t("Female trainer choice");
                        gender = "female";
                        break;
                    default:
                        tooltip = vscode.l10n.t("Choice");
                        break;
                }
                content.push({
                    content: choiceData.text,
                    userData: { type: StoryTextSlotType.Choice, gender },
                    link: choiceData.nextBlock - 1,
                    tooltip
                });
                ++end;
            }
            const choiceRange = new ContentRange(start, end);

            start = end;
            for (const colorTextInfo of block.colorTexts) {
                content.push({
                    content: colorTextInfo.text,
                    userData: { type: StoryTextSlotType.ColorText },
                    tooltip: vscode.l10n.t("Color text")
                });
                ++end;
            }
            const colorRange = new ContentRange(start, end);

            const id = i;
            let name = id.toString();
            const differenceFlag = block.differenceFlag;

            function updatePrevMaleNode() {
                if (prevMaleNode && id >= +prevMaleNode.next!) {
                    prevMaleNode.next = id;
                    prevMaleNode = undefined;
                }
            }

            function updatePrevFemaleNode() {
                if (prevFemaleNode && id >= +prevFemaleNode.next!) {
                    prevFemaleNode.next = id;
                    for (const slot of prevFemaleNode.content) {
                        if (slot.link) { slot.link = id; }
                    }
                    prevFemaleNode = undefined;
                }
            }

            let cueOffset = 0;
            switch (differenceFlag) {
                case DifferenceFlag.GenderMale:
                    name += ` (${vscode.l10n.t("male trainer")})`;
                    updatePrevMaleNode();
                    cueOffset = 1;
                    break;
                case DifferenceFlag.GenderFemale:
                    name += ` (${vscode.l10n.t("female trainer")})`;
                    updatePrevFemaleNode();
                    break;
                default:
                    updatePrevMaleNode();
                    updatePrevFemaleNode();
                    break;
            }

            const node: ITreeNode<IStoryTextSlot> = {
                type: "entry",
                id,
                name,
                content,
                prev: nodes[nodes.length - 1]?.id,
                next: block.nextBlock - 1
            };
            nodes.push(node);
            contentRanges.push({
                choiceDataList: choiceRange,
                colorTextInfoList: colorRange
            });

            const cueId = block.cueId;
            if (cueId !== -1) {
                voiceCues.push([id.toString(), cueId + cueOffset + globalCueOffset]);
            }

            switch (differenceFlag) {
                case DifferenceFlag.GenderMale:
                    prevMaleNode = node;
                    break;
                case DifferenceFlag.GenderFemale:
                    prevFemaleNode = node;
                    if (cueId !== -1) {
                        globalCueOffset += 1;
                    }
                    break;
            }
        }

        return {
            title: resTitle,
            nodes,
            contentRanges,
            voiceCues
        };
    }

    protected override getHtmlForWebview(webview: vscode.Webview): string {
        return getEditorHtml(this.context.extensionUri, webview, "storyEditor", "Story Editor");
    }
}

interface StoryTimelineDataDict {
    title?: string,
    no_wrap?: boolean,
    text_block_list?: TextBlockDict[]
}

interface TextBlockDict {
    name?: string,
    text?: string,
    choice_data_list?: string[],
    color_text_info_list?: string[]
}

interface StoryAssetInfo {
    assetBundleName: string;
    assetName: string;
    isStoryView: boolean;
    voiceAssetName: string;
    voiceCacheDir: string;
}

interface InitData {
    title?: string;
    nodes: ITreeNode[];
    contentRanges: BlockContentRanges[];
    voiceCues: [string, number][];
}

interface BlockContentRanges {
    choiceDataList: ContentRange;
    colorTextInfoList: ContentRange;
}

class ContentRange {
    start: number;
    end: number;

    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }

    contains(i: number) {
        return i >= this.start && i < this.end;
    }

    offset(i: number) {
        return i - this.start;
    }

    at(i: number) {
        return this.start + i;
    }

    get length(): number {
        return this.end - this.start;
    }
}

enum DifferenceFlag {
    None = 0,
    GenderMale = 2,
    GenderFemale = 4
}