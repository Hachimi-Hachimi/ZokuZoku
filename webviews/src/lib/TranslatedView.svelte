<script lang="ts">
    import { currentPath } from "../stores";
    import type { IPanelAction } from "../types";
    import { vscode } from "../vscode";
    import PanelTitle from "./PanelTitle.svelte";
    import TranslatedViewInner from "./TranslatedViewInner.svelte";

    export let inner = TranslatedViewInner;

    let actions: IPanelAction[] | undefined;

    $: vscode.postMessage({
        type: "subscribePath",
        path: $currentPath
    });
</script>

<div class="translated-view">
    <PanelTitle label="Translated" {actions} />
    <svelte:component this={inner} bind:actions />
</div>

<style>
    .translated-view {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
    }
</style>