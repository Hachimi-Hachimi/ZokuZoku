<script lang="ts">
    import type { ControllerMessage, ITreeNode, TreeNodeId } from "../sharedTypes";
    import { copyingNodes, currentNav, currentPath, currentSiblings, currentTextSlots, nodeStates, selectedNodes, type NodeState } from "../stores";
    import { vscode } from "../vscode";
    import IntersectionObserver from "svelte-intersection-observer";
    import * as l10n from "@vscode/l10n";

    export let node: ITreeNode;
    export let parentPath: TreeNodeId[] = [];
    export let siblings: ITreeNode[] = [];
    export let openAll = false;
    export let hideExists = false;

    const defaultNodeState = {
        open: false,
        childrenStart: 0
    };

    let element: HTMLDivElement;
    let path = [...parentPath, node.id];
    let pathStr = path.join("/");
    let state = $nodeStates[pathStr] || defaultNodeState;
    let open = openAll || state.open === true;
    $: icon = node.type == "category" ?
        (open ? "chevron-down" : "chevron-right") :
        (node.icon ?? "symbol-string");
    let focus = false;
    let isEntry = node.type == "entry";
    let noContent = isEntry;
    let childrenStart = state.childrenStart || 0;
    const maxChildren = 500;
    $: selectionIndex = updateSelectionIndex($selectedNodes);

    //// State saving
    const defaultNodeStateJson = JSON.stringify(defaultNodeState);
    function updateNodeState(updateFn: (state: NodeState) => void) {
        let nodeState = $nodeStates[pathStr];
        if (!nodeState) {
            nodeState = defaultNodeState;
            $nodeStates[pathStr] = nodeState;
        }
        updateFn(nodeState);

        // quick n dirty comparison
        if (JSON.stringify(nodeState) == defaultNodeStateJson) {
            delete $nodeStates[pathStr];
        }
        return state;
    }
    // update on open, but only when openAll is false (ignore search nodes states)
    $: open, openAll || updateNodeState(state => state.open = open);
    $: childrenStart, updateNodeState(state => state.childrenStart = childrenStart);

    function updateSelectionIndex(selectedNodes: {[key: string]: number}) {
        let index = null;
        let i = 0;
        for (const otherPathStr in selectedNodes) {
            if (index == null && otherPathStr == pathStr) {
                index = i + 1;
                // keep counting...
            }
            ++i;
        }

        if (i == 1) {
            // Don't show selection index if it's the only selection
            return null;
        }
        else {
            return index;
        }
    }

    function nodeOnSelect(unselectOthers: boolean): boolean {
        if (node.type == "entry") {
            if (unselectOthers) {
                $selectedNodes = {};
            }
            if (pathStr in $selectedNodes) {
                delete $selectedNodes[pathStr];
                $selectedNodes = $selectedNodes; // force update
                return false;
            }

            $selectedNodes[pathStr] = node.content.length;
            $currentPath = path;
            $currentTextSlots = node.content;
            $currentNav = {
                next: node.next,
                prev: node.prev
            };
            $currentSiblings = siblings;
        }
        return true;
    }

    function onClick(e: PointerEvent) {
        if (!nodeOnSelect(!e.ctrlKey)) {
            return;
        }

        let justFocused = false;
        if (focus) e.stopPropagation();
        else justFocused = true;
        focus = true;
        open = !open;

        document.addEventListener("click", () => {
            if (justFocused) {
                document.addEventListener("click", () => focus = false, { once: true });
                return;
            }
            focus = false;
        }, { once: true });
    }

    function onMouseMove(e: MouseEvent) {
        if (e.ctrlKey && e.buttons == 1 && !(pathStr in $selectedNodes)) {
            nodeOnSelect(false);
        }
    }

    let categoryFull = false;
    let onMessage = (e: MessageEvent<ControllerMessage>) => {
        const message = e.data;
        if (isEntry) {
            if (message.type == "setExists" && message.path.join("/") == pathStr) {
                noContent = !message.exists;
            }
        }
        else if (message.type == "setCategoryFull" && message.path.join("/") == pathStr) {
            categoryFull = message.full;
        }
    }

    let existsChecked = false;
    let isInView = false;
    $: if (isEntry && isInView && !existsChecked) {
        vscode.postMessage({
            type: "getExists",
            path
        });
        existsChecked = true;
    }

    $: if (hideExists && node.type == "category" && isInView) {
        vscode.postMessage({
            type: "getCategoryFull",
            path
        });
    }

    function prevEntries() {
        childrenStart -= maxChildren;
        element.scrollIntoView();
    }

    function nextEntries() {
        childrenStart += maxChildren;
        element.scrollIntoView();
    }
</script>

<svelte:window on:message={onMessage} />

{#if !hideExists || noContent || (!isEntry && !categoryFull)}
    <IntersectionObserver {element} bind:intersecting={isInView}>
        <div bind:this={element}
            class="tree-node" class:focus class:noContent
            class:selected={pathStr in $selectedNodes}
            class:copying={pathStr in $copyingNodes}
            title={pathStr} on:click={onClick} on:click
            on:mousemove={onMouseMove}
        >
            {#if selectionIndex !== null}
                <div class="selection-index">{selectionIndex}</div>
            {/if}
            {#each {length: path.length - 1} as _}
                <div class="indent"></div>
            {/each}
            <div class="codicon codicon-{icon}"></div>
            <div class="node-name">{node.name}</div>
        </div>
    </IntersectionObserver>

    {#if node.type == "category" && open}
        {#key childrenStart}
            {#if childrenStart > 0}
                <svelte:self node={{
                    type: "dummy",
                    id: "__prevEntries",
                    name: l10n.t("Previous {0} entries...", maxChildren),
                    icon: "arrow-up"
                }} parentPath={path} on:click={prevEntries} />
            {/if}

            {#each {length: Math.min(node.children.length - childrenStart, maxChildren)} as _, i}
                <svelte:self node={node.children[childrenStart + i]} parentPath={path} siblings={node.children} {openAll} {hideExists} />
            {/each}

            {#if childrenStart + maxChildren < node.children.length}
                <svelte:self node={{
                    type: "dummy",
                    id: "__nextEntries",
                    name: l10n.t("Next {0} entries...", maxChildren),
                    icon: "arrow-down"
                }} parentPath={path} on:click={nextEntries} />
            {/if}
        {/key}
    {/if}
{/if}

<style>
    .tree-node {
        box-sizing: border-box;
        width: 100%;
        height: 22px;
        padding: 0 16px;
        line-height: 22px;
        font-size: 13px;
        user-select: none;
        color: var(--vscode-foreground);
        display: flex;
        align-items: center;
        cursor: pointer;
        position: relative;
    }

    .tree-node.noContent {
        color: #8c8c8c;
    }

    .tree-node:hover {
        background-color: var(--vscode-list-hoverBackground);
    }

    .tree-node.selected {
        background-color: var(--vscode-list-inactiveSelectionBackground);
    }

    .tree-node.focus, .tree-node.current.focus {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }

    .tree-node.focus {
        border: 1px solid var(--vscode-list-focusOutline);
    }

    .tree-node.selected.noContent, .tree-node.focus.noContent {
        color: #8c8c8c;
    }

    .tree-node.copying, .tree-node.focus.copying {
        border: 1px dashed var(--vscode-list-focusOutline);
    }

    .node-name {
        margin-left: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .indent {
        border-left: 1px solid var(--vscode-tree-inactiveIndentGuidesStroke);
        box-sizing: border-box;
        height: 100%;
        margin-left: 5px;
        width: 5px;
        flex-shrink: 0;
    }

    .selection-index {
        position: absolute;
        left: 0;
        width: 16px;
        color: #8c8c8c;
        text-align: center;
        font-size: 10px;
    }
</style>