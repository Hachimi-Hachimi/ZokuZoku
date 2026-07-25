<script lang="ts">
    import * as l10n from "@vscode/l10n";

    export let src: string | undefined = undefined;
    export let hidden = false;
    export let audioElement: HTMLAudioElement | undefined;

    function onClose() {
        hidden = true;
        audioElement!.pause();
    }
</script>

<div class="audio-player" class:hidden>
    <audio
        controls
        controlsList="noplaybackrate nodownload"
        {src}
        bind:this={audioElement}
    >
        <slot />
    </audio>
    <button
        title={l10n.t("Close")}
        class="codicon codicon-chrome-close close-btn"
        on:click={onClose}
    ></button>
</div>

<style>
    .audio-player {
        position: absolute;
        top: 35px;
        right: 8px;
        z-index: 100;
        background-color: var(--vscode-editorWidget-background);
        box-shadow: 0 0 8px 2px var(--vscode-widget-shadow);
        border-bottom-left-radius: 4px;
        border-bottom-right-radius: 4px;
        width: 300px;
        height: 32px;
        box-sizing: border-box;
        padding: 3px 4px;
        display: flex;
        flex-direction: row;
        transition: 0.2s;
        opacity: 1;
        overflow: hidden;
    }

    .audio-player.hidden {
        opacity: 0;
        height: 0;
        pointer-events: none;
    }

    audio {
        height: 24px;
        color-scheme: dark;
        transition: 0.2s;
    }

    .audio-player.hidden audio {
        margin-top: -24px;
    }

    audio::-webkit-media-controls {
        font-family: var(--vscode-font-family);
    }

    audio::-webkit-media-controls-enclosure {
        background: none;
        padding: 0;
    }

    audio::-webkit-media-controls-current-time-display {
        color: var(--vscode-foreground);
    }

    audio::-webkit-media-controls-time-remaining-display {
        display: none;
    }

    .close-btn {
        padding: 4px;
        width: 26px;
        height: 26px;
        flex: 0 0 auto;
        overflow: visible;
        text-align: center;
        cursor: pointer;
        box-sizing: border-box;
        transition: 0.2s;
        /* Reset button defaults */
        background: none;
        border: none;
        color: inherit;
        font-family: codicon;
    }

    .close-btn:hover {
        background-color: rgba(90, 93, 94, 0.31);
        border-radius: 5px;
    }

    .audio-player.hidden .close-btn {
        margin-top: -26px;
    }
</style>
