<script lang="ts">
    import type { IPanelAction } from "../types";
    import OriginalViewInner from "./OriginalViewInner.svelte";
    import PanelTitle from "./PanelTitle.svelte";
    import Sash from "./Sash.svelte";
    import AudioPlayerWidget from "../lib/AudioPlayerWidget.svelte";
    import type { ControllerMessage, TreeNodeId } from "../sharedTypes";
    import { currentPath } from "../stores";
    import * as l10n from "@vscode/l10n";

    export let inner = OriginalViewInner;

    let actions: IPanelAction[] | undefined;
    let size = window.innerHeight / 2.1; // little bias for the translated view

    let audioPlayerHidden = true;
    let audioElement: HTMLAudioElement | undefined;
    let voiceUris: {[key: string]: string} | undefined;

    function onMessage(e: MessageEvent<ControllerMessage>) {
        const message = e.data;
        if (message.type == "loadVoice") {
            voiceUris = message.uris;
            updateVoiceSrc($currentPath);
            audioPlayerHidden = false;
        }
    }

    let voiceSrc: string | undefined;
    function updateVoiceSrc(path: TreeNodeId[]) {
        if (!audioElement) return;

        const index = path.join("/");
        let src = voiceUris?.[index] || "";
        if (src) {
            audioElement.load();
            audioElement.addEventListener("canplay", function() {
                this.play()
            }, { once: true });
        }
        voiceSrc = src;
    }

    $: !audioPlayerHidden && updateVoiceSrc($currentPath);
</script>

<svelte:window on:message={onMessage} />

<div class="original-view" style="height: {size}px;">
    <Sash horizontal bind:size maxSize={1000} />
    <PanelTitle label={l10n.t("Original")} {actions} />
    <svelte:component this={inner} bind:actions />
    <AudioPlayerWidget bind:audioElement bind:hidden={audioPlayerHidden} src={voiceSrc} />
</div>

<style>
    .original-view {
        position: relative;
        display: flex;
        flex-direction: column;
        border-bottom: 1px solid var(--vscode-tree-indentGuidesStroke);
    }
</style>