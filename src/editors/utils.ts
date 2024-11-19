import * as vscode from 'vscode';
import { JsonDocument, JsonEdit } from '../core';
import config from '../config';

export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getAssetUris(extensionUri: vscode.Uri, webview: vscode.Webview, pageName: string) {
    let distAssetsUri = vscode.Uri.joinPath(extensionUri, "webviews", "dist", "assets");
    return {
        scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(distAssetsUri, `${pageName}.js`)),
        styleUri: webview.asWebviewUri(vscode.Uri.joinPath(distAssetsUri, `${pageName}.css`))
    };
}

export function getEditorHtml(extensionUri: vscode.Uri, webview: vscode.Webview, pageName: string, pageTitle: string) {
    let { scriptUri, styleUri } = getAssetUris(extensionUri, webview, pageName);
    return `
        <!doctype html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>${pageTitle}</title>
            <script type="module" nonce="${getNonce()}" src="${scriptUri}"></script>
            <link rel="stylesheet" href="${styleUri}">
        </head>
        <body>
            <div id="app"></div>
        </body>
        </html>
    `;
}

export function makeEditForStringProperty(key: string, value: string | null): JsonEdit<any> {
    const edit: JsonEdit<object> = value !== null ?
    {
        type: "object",
        action: "update",
        property: {
            key,
            value
        }
    } :
    {
        type: "object",
        action: "delete",
        key
    };
    return edit;
}

export function makeUpdateEditForArray(index: number, value: any): JsonEdit<any> {
    let editValue: JsonEdit<any>;
    if (Array.isArray(value) || typeof value === "object") {
        editValue = {
            type: Array.isArray(value) ? "array" : "object",
            action: "set",
            values: value
        };
    }
    else {
        editValue = value;
    }
    return {
        type: "array",
        action: "update",
        index,
        value
    };
}

export function makeEditForArray<T>(
    array: jsonToAst.ArrayNode, fillValue: T, index: number, value: T | null
): JsonEdit<any> {
    let edit: JsonEdit<T[]>;
    if (value === null) {
        if (index === array.children.length - 1) {
            edit = {
                type: "array",
                action: "delete",
                index
            };
        }
        else {
            edit = makeUpdateEditForArray(index, fillValue);
        }
    }
    else if (index === array.children.length) {
        edit = {
            type: "array",
            action: "push",
            values: [ value ]
        };
    }
    else if (index > array.children.length) {
        const values: T[] = new Array(index + 1).fill(fillValue);
        for (let i = 0; i < array.children.length; ++i) {
            values[i] = JsonDocument.getValue(array.children[i]);
        }
        values[index] = value;
        edit = {
            type: "array",
            action: "set",
            values
        };
    }
    else {
        edit = makeUpdateEditForArray(index, value);
    }
    return edit;
}

export function setupWebview(provider: {
    getHtmlForWebview(this: any, webview: vscode.Webview): string,
    context: vscode.ExtensionContext
}, webview: vscode.Webview) {
    const gameDataDir = config().get<string>("gameDataDir");
    webview.options = {
        enableScripts: true,
        localResourceRoots: [
            provider.context.extensionUri,
            ...(gameDataDir ? [ vscode.Uri.file(gameDataDir) ] : [])
        ]
    };
    webview.html = provider.getHtmlForWebview(webview);
}