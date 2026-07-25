<script lang="ts">
    import type { IPanelAction } from "../types";
    import * as l10n from "@vscode/l10n";

    export let label = l10n.t("Panel");
    export let actions: (IPanelAction | null)[] = [];
</script>

<div class="title">
    <div class="title-label" title={label}>
        {label}
    </div>
    <div class="actions-container">
        {#each actions as action}
            {#if action == null}
                <div class="separator"></div>
            {:else}
                <a role="button" tabindex=0 title={action.tooltip}
                    class="codicon codicon-{action.icon}" on:click={action.onClick}>
                </a>
            {/if}
        {/each}
    </div>
</div>

<style>
    .title {
        box-sizing: border-box;
        padding: 0 8px;
        height: 35px;
        display: flex;
        align-items: center;
        color: var(--vscode-foreground);
        user-select: none;
        flex-shrink: 0;
    }

    .title-label {
        padding-left: 12px;
        padding-right: 4px;
        font-size: 11px;
        font-weight: 400;
        text-transform: uppercase;
        flex-grow: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .actions-container {
        display: flex;
    }

    .actions-container a {
        margin-right: 4px;
        padding: 3px;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        overflow: visible;
        text-align: center;
        cursor: pointer;
    }
    
    .actions-container a:hover {
        background-color: rgba(90, 93, 94, 0.31);
        border-radius: 5px;
    }

    .separator {
        width: 0;
        height: 22px;
        border-left: 1px dashed var(--vscode-foreground);
        margin: 0 12px 0 8px;
        flex: 0 0 auto;
    }
</style>