import * as vscode from 'vscode';
import { JsonDocument, type JsonEdit } from './jsonDocument';

export interface LocalizedDataConfig {
    localize_dict?: string,
    hashed_dict?: string,
    text_data_dict?: string,
    character_system_text_dict?: string,
    race_jikkyo_comment_dict?: string,
    race_jikkyo_message_dict?: string,
    assets_dir?: string,

    plural_form?: string,
    ordinal_form?: string,
    ordinal_types: string[],
    months: string[],
    month_text_format?: string,

    use_text_wrapper: boolean,
    line_width_multiplier?: number,

    auto_adjust_story_clip_length: boolean,
    story_line_count_offset?: number,
    text_frame_line_spacing_multiplier?: number,
    text_frame_font_size_multiplier?: number,
    skill_list_item_desc_font_size_multiplier?: number,
    text_common_allow_overflow: boolean,
    now_loading_comic_title_ellipsis: boolean,

    remove_ruby: boolean,
    character_note_top_gallery_button?: UITextConfig,
    character_note_top_talk_gallery_button?: UITextConfig,

    news_url?: string,
}

export interface UITextConfig {
    text?: string,
    font_size?: number,
    line_spacing?: number
}

const DEFAULT_CONFIG: LocalizedDataConfig = {
    ordinal_types: [],
    months: [],
    use_text_wrapper: false,
    auto_adjust_story_clip_length: false,
    text_common_allow_overflow: false,
    now_loading_comic_title_ellipsis: false,
    remove_ruby: false
};

export class LocalizedDataManager {
    config = DEFAULT_CONFIG;
    dirUri: vscode.Uri;
    configJson: JsonDocument<LocalizedDataConfig>;

    private constructor() {
        const folderUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!folderUri) {
            throw new Error(vscode.l10n.t('No workspace folder.'));
        }
        this.dirUri = vscode.Uri.joinPath(folderUri, "localized_data");
        const configUri = vscode.Uri.joinPath(this.dirUri, "config.json");
        this.configJson = new JsonDocument(
            configUri, DEFAULT_CONFIG, () => this.config = this.configJson.getValue()
        );
        this.configJson.watchFileSystem();
    }

    private static _instance?: LocalizedDataManager;
    static get instance(): LocalizedDataManager | undefined { return this._instance; }

    private static _instancePromiseResolve: ((i: LocalizedDataManager) => void) | null = null;
    private static _instancePromise: Promise<LocalizedDataManager> = new Promise(resolve =>
        this._instancePromiseResolve = resolve
    );
    static get instancePromise(): Promise<LocalizedDataManager> { return this._instancePromise; }

    static init() {
        if (this._instance) { return; }

        let instance;
        try {
            instance = new LocalizedDataManager();
        }
        catch (e) {
            vscode.window.showErrorMessage("" + e);
            return;
        }

        instance.configJson.readFile()
        .catch(reason => {
            console.error(reason);
            vscode.window.showWarningMessage(
                vscode.l10n.t('Failed to load config.json. It will be created or overwritten automatically when it\'s used.')
            );
        })
        .finally(() => {
            this._instance = instance;
            this._instancePromiseResolve?.(instance);
        });
    }

    static uninit() {
        this._instance = undefined;
    }

    static async with(callback: (ldManager: LocalizedDataManager) => any) {
        const ldManager = LocalizedDataManager.instance;
        if (!ldManager) {
            vscode.window.showErrorMessage(vscode.l10n.t('ZokuZoku is inactive.'));
            return;
        }
        
        try {
            await callback(ldManager);
        }
        catch (e) {
            vscode.window.showErrorMessage("" + e);
        }
    }

    async updateConfig(edit: JsonEdit<LocalizedDataConfig>) {
        await vscode.workspace.fs.createDirectory(this.dirUri);
        await this.configJson.applyEdit(edit, { force: true, save: true });
    }

    async getPathUri<K extends keyof LocalizedDataConfig>(
        key: K, defaultValue: LocalizedDataConfig[K] & string, ...pathSegments: string[]
    ): Promise<vscode.Uri>;
    async getPathUri<K extends keyof LocalizedDataConfig>(
        key: K, defaultValue?: undefined, ...pathSegments: string[]
    ): Promise<vscode.Uri | undefined>;
    async getPathUri<K extends keyof LocalizedDataConfig>(
        key: K, defaultValue?: LocalizedDataConfig[K] & string, ...pathSegments: string[]
    ): Promise<vscode.Uri | undefined> {
        // Keys for other properties will never pass type check, tell the type system it is a `string?` anyways
        let value = this.config[key] as unknown as string | undefined;
        if (!value) {
            if (defaultValue === undefined) {
                return;
            }
            await this.updateConfig({
                type: "object",
                action: "update",
                property: {
                    // @ts-ignore
                    key,
                    value: defaultValue
                }
            });
            value = defaultValue;
        }

        return vscode.Uri.joinPath(this.dirUri, value, ...pathSegments);
    }

    static autoCreatedUris = new Set<string>();
    async getPathUriAndOpenTextDocument<K extends keyof LocalizedDataConfig>(
        defaultFileContent: string, key: K, defaultValue: LocalizedDataConfig[K] & string, ...pathSegments: string[]
    ): Promise<vscode.TextDocument> {
        const parentUri = await this.getPathUri(key, defaultValue, ...pathSegments.slice(0, -1));
        // if there are no path segments, that means it's in localized_data which is guaranteed to exist at this point
        if (pathSegments.length > 0) {
            await vscode.workspace.fs.createDirectory(parentUri);
        }

        const uri = vscode.Uri.joinPath(parentUri, ...pathSegments.slice(-1));
        let document: vscode.TextDocument;
        try {
            // Yes, stat AND read the document. Documents that were deleted while
            // an editor was open just sticks around in cache, i guess.
            await vscode.workspace.fs.stat(uri);
            document = await vscode.workspace.openTextDocument(uri);
        }
        catch {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(defaultFileContent));
            LocalizedDataManager.autoCreatedUris.add(uri.toString());
            document = await vscode.workspace.openTextDocument(uri);
        }

        return document;
    }
}