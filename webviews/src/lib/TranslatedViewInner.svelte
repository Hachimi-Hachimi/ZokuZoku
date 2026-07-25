<script lang="ts">
    import { currentPath, currentTextSlots } from "../stores";
    import type { IPanelAction } from "../types";
    import { translatedSlotProps } from "../utils";
    import GenericSlots from "./GenericSlots.svelte";
    import TextSlot from "./TextSlot.svelte";
    import * as l10n from "@vscode/l10n";

    export const actions: (IPanelAction | null)[] | undefined = undefined;

    const placeholder = l10n.t("Type your translation here...");
</script>

<GenericSlots>
    {#key $currentTextSlots}
        {#each $currentTextSlots as slot, index}
            <TextSlot {...translatedSlotProps(slot)} {index} entryPath={$currentPath} {placeholder} />
        {/each}
    {/key}
</GenericSlots>