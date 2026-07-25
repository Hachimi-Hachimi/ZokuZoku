import * as vscode from 'vscode';
import assetHelper from '../core/assetHelper';
import config from '../config';
import { ControllerMessage } from './sharedTypes';

async function getGameFontUri() {
    const fontHash = await assetHelper.getAssetHash("font/dynamic01.otf");
    if (!fontHash) {
        throw new Error(vscode.l10n.t("Could not find hash for game font asset."));
    }

    const assetPath = await assetHelper.ensureAssetDownloaded(fontHash, true);
    return vscode.Uri.file(assetPath);
}

async function onInit(webview: vscode.Webview): Promise<void> {
    const useGameFont = config().get<boolean>('useGameFont');
    const customFont  = config().get<string>('customFont');

    if (!useGameFont && !customFont) {
        return;
    }

    try {
        let uri: vscode.Uri;

        try {
            uri = customFont ? vscode.Uri.file(customFont) : await getGameFontUri();
        } catch (e) {
            throw new AggregateError(
                [e],
                vscode.l10n.t('Failed to load font asset')
            );
        }

        const message: ControllerMessage = {
            type: 'setGameFont',
            uri : webview.asWebviewUri(uri).toString()
        };

        await webview.postMessage(message);
    } catch (e) {
        vscode.window.showWarningMessage(
            vscode.l10n.t(
                'Failed to load game font: {0}',
                {0: String(e)}
            )
        );
    }
}

export default {
    getGameFontUri,
    onInit
};
