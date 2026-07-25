<script lang="ts">
    import type { ControllerMessage, TreeNodeId } from "../sharedTypes";
    import { currentPath, currentSiblings } from "../stores";
    import { findNodeByPath, gotoNode } from "../utils";
    import { vscode } from "../vscode";
    import TextSlotInner from "./TextSlotInner.svelte";
    import * as l10n from "@vscode/l10n";

    export let inner = TextSlotInner;
    export let content: string | null = null;
    export let multiline: boolean = false;
    export let readonly = false;
    export let index = 0;
    export let entryPath: TreeNodeId[] = [];
    export let postContent = false;
    export let placeholder = "";
    export let userData: any = undefined;
    export let link: TreeNodeId | null = null;
    export let tooltip = "";

    if (link) {
        tooltip = tooltip ? tooltip + l10n.t(" (Ctrl + Click to follow link...)") : l10n.t("Ctrl + Click to follow link...");
    }

    let focused = false;
    function onFocus() {
        focused = true;
    }

    function onBlur() {
        focused = false;
        // Post content immediately after unfocus
        clearTimeout(postTimeout);
        doPostContent();
    }

    function onKeyDown(e: KeyboardEvent) {
        // Allow empty content
        if (postContent && e.altKey && e.code == "Enter" && content == "") {
            vscode.postMessage({
                type: "setTextSlotContent",
                entryPath,
                index,
                content: ""
            });
            vscode.postMessage({
                type: "showMessage",
                content: l10n.t("Slot {0} has been set to an empty string.", index)
            });
        }
    }

    let prevPostedContent = content;

    let onMessage: ((e: MessageEvent<ControllerMessage>) => void) | undefined;
    if (content === null) {
        onMessage = e => {
            const message: ControllerMessage = e.data;
            if (!focused &&
                message.type == "setTextSlotContent" &&
                message.entryPath.join("/") == entryPath.join("/") &&
                message.index == index)
            {
                prevPostedContent = message.content;
                content = message.content;
            }
        }
        vscode.postMessage({
            type: "getTextSlotContent",
            entryPath,
            index
        });
    }

    $: content, postContent ? schedulePostContent() : null;

    let postTimeout: number | undefined;
    function schedulePostContent() {
        clearTimeout(postTimeout);
        // @ts-ignore
        postTimeout = setTimeout(doPostContent, 500);
    }

    function doPostContent() {
        if (content === null || prevPostedContent == content) return;
        if (!content.length) {
            content = null;
        }
        vscode.postMessage({
            type: "setTextSlotContent",
            entryPath,
            index,
            content
        });
        prevPostedContent = content;
    }

    let active = false;
    function onMouseMove(e: MouseEvent) {
        active = e.ctrlKey;
    }

    function onClick(e: MouseEvent) {
        if (e.ctrlKey && link != null) {
            e.preventDefault();
            const [ node ] = findNodeByPath([ link ], $currentSiblings) || [ null ];
            if (node) {
                gotoNode(node, [ ...$currentPath.slice(0, -1), link ]);
            }
        }
    }
</script>

<svelte:window on:message={onMessage} />

<svelte:component this={inner} {readonly} {multiline} {link} {active} bind:value={content} {placeholder} title={tooltip} {userData}
    on:focus={onFocus} on:blur={onBlur} on:keydown={onKeyDown}
    on:mousemove={onMouseMove} on:click={onClick} />