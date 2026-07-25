<script lang="ts">
    import { currentPath, currentTextSlots } from "../stores";
    import type { IPanelAction } from "../types";
    import { translatedSlotProps } from "../utils";
    import TextSlot from "../lib/TextSlot.svelte";
    import GenericSlots from "../lib/GenericSlots.svelte";
    import StorySplitView from "./StorySplitView.svelte";
    import { translatedPreview } from "./stores";
    import * as l10n from "@vscode/l10n";

    const preview = translatedPreview;
    export const actions: IPanelAction[] = [
        {
            icon: "comment",
            tooltip: l10n.t("Dialogue preview"),
            onClick: () => $preview = $preview == "dialogue" ? null : "dialogue"
        },
        {
            icon: "book",
            tooltip: l10n.t("Story preview"),
            onClick: () => $preview = $preview == "story" ? null : "story"
        }
    ];

    const placeholder = l10n.t("Type your translation here...");
</script>

<StorySplitView preview={$preview} translated>
    <GenericSlots>
        {#key $currentTextSlots}
            {#each $currentTextSlots as slot, index}
                <TextSlot {...translatedSlotProps(slot)} {index} entryPath={$currentPath} {placeholder} />
            {/each}
        {/key}
    </GenericSlots>
</StorySplitView>