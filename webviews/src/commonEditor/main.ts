import '../app.css'
import "@vscode/codicons/dist/codicon.css"
import * as l10n from "@vscode/l10n"

if (window.l10nContents) {
    l10n.config({
        contents: window.l10nContents
    });
}

import('./App.svelte').then(({ default: App }) => {
    // i really dont know why the app is mounted twice so i do this
    const target = document.getElementById('app')!;
    // @ts-ignore
    if (!window.__zokuzoku_app_mounted && target.children.length === 0) {
        // @ts-ignore
        window.__zokuzoku_app_mounted = true;
        new App({
            target,
        })
    }
});
