<script lang="ts">
    import { StoryTextSlotType, type IStoryTextSlotUserData, type TreeNodeId } from "../sharedTypes";
    import TMPText from "./TMPText.svelte";

    export let readonly: boolean;
    export let multiline: boolean;
    export let link: TreeNodeId | null;
    export let active: boolean;
    export let value: string | null;
    export let placeholder: string;
    export let title: string | null;
    export let userData: any = undefined;

    // unused
    const _ = { readonly, multiline, value, placeholder };

    $: info = userData as IStoryTextSlotUserData;
    $: gender = info.type == StoryTextSlotType.Choice ? info.gender : null;
</script>

<div class="choice-outer" {title} class:link class:active on:focus on:blur on:keydown on:mousemove on:click>
    <div class="choice" class:blue={gender == "male"} class:pink={gender == "female"}>
        <TMPText content={value ?? ""} sizeMultiplier={38.2608/44} />
    </div>
</div>

<style>
    .choice-outer {
        padding: 2.34375% 3.33%;
        aspect-ratio: 1008 / 115;
        container-type: size;
    }

    .choice {
        font-family: "CustomFont", var(--vscode-font-family);
        color: #794016;
        background-image: linear-gradient(130deg, #fff 0%, #fff 89%, #c5f58b 89.1%, #e1ffbf);
        aspect-ratio: 1008 / 115;
        border-radius: 1.6%/13.91%;
        box-sizing: border-box;
        border: 4cqh solid #7acf03;
        position: relative;
        white-space: pre;
        padding: 21.7391cqh 8.9286cqw;
        font-size: 38.2608cqh;
        min-height: 0;
        overflow: visible;
        line-height: 1.5;
    }

    .choice::before {
        content: "";
        display: block;
        position: absolute;
        top: 27.826cqh;
        left: 1.488cqw;
        width: 44.35cqh;
        height: 44.35cqh;
        border-radius: 50%/50%;
        box-sizing: border-box;
        border: 12.17cqh solid #99db2e;
    }

    .choice.blue {
        background-image: linear-gradient(130deg, #fff 0%, #fff 89%, #b3e5fd 89.1%, #d7f7ff);
        border-color: #52c9fc;
    }

    .choice.blue::before {
        border-color: #55cbfb;
    }

    .choice.pink {
        background-image: linear-gradient(130deg, #fff 0%, #fff 89%, #ffccdd 89.1%, #ffe0f1);
        border-color: #ff77bb;
    }

    .choice.pink::before {
        border-color: #ff83b6;
    }

    .choice-outer.link:hover .choice {
        text-decoration: underline;
    }

    .choice-outer.link.active:hover {
        cursor: pointer;
    }

    .choice-outer.link.active:hover .choice {
        color: var(--vscode-editorLink-activeForeground);
    }
</style>