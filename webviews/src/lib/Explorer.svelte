<script lang="ts">
    import PanelTitle from "./PanelTitle.svelte";
    import Sash from "./Sash.svelte";
    import TreeNode from "./TreeNode.svelte";
    import type { ControllerMessage, ITreeNode } from "../sharedTypes";
    import InputBox from "./InputBox.svelte";
    import type { SearchOptions, SearchRequest, SearchResponse } from "../treeSearchWorker";
    import TreeSearchWorker from "../treeSearchWorker?worker&inline";
    import { tick } from "svelte";
    import { copyingNodes, currentNav, currentPath, currentSiblings, currentTextSlots, explorerScrollTop, selectedNodes } from "../stores";
    import { findNodeByPath, getNodeTlContent, gotoNode } from "../utils";
    import type { IPanelAction } from "../types";
    import { vscode } from "../vscode";
    import * as l10n from "@vscode/l10n";

    let nodes: ITreeNode[] = [];

    let treeView: HTMLDivElement;
    let size = 240;
    let title = l10n.t("Explorer");
    let searchOptionsOpen = false;
    $: searchExpandIcon = searchOptionsOpen ? "chevron-down" : "chevron-left";
    let searchOptions: SearchOptions = {
        caseSensitive: false,
        regex: false,
        searchInContent: false,
        excludeCategoryNames: false
    };
    let searchNodes: ITreeNode[] = [];
    let searchQuery = "";
    let hideExists = false;

    function onMessage(e: MessageEvent<ControllerMessage>) {
        const message = e.data;
        switch (message.type) {
            case "setExplorerTitle":
                title = message.title;
                break;

            case "setNodes":
                nodes = message.nodes;

                // Restore the currently selected node's states
                let [currentNode, siblings] = findNodeByPath($currentPath, nodes) || [null, null];
                if (currentNode && currentNode.type == "entry") {
                    $currentTextSlots = currentNode.content
                    $currentNav = {
                        next: currentNode.next,
                        prev: currentNode.prev
                    };
                    $currentSiblings = siblings!;
                }

                // Restore the scroll state once the node tree has been rendered
                tick().then(() => {
                    treeView.scrollTop = $explorerScrollTop;
                });
                break;
        }
    }
    
    function onSearchOptionsToggle() {
        searchOptionsOpen = !searchOptionsOpen;
    }

    $: if (searchQuery) scheduleSearch(); else searchNodes = [];
    $: searchOptions, search();

    let searchTimeout: number | undefined;
    function scheduleSearch() {
        searchWorker?.terminate();
        searchWorker = undefined;
        searchNodes = [];

        clearTimeout(searchTimeout);
        // @ts-ignore
        searchTimeout = setTimeout(search, 200);
    }

    interface SearchCategoryMapping {
        children: ITreeNode[]
        map: {[key: string]: SearchCategoryMapping}
    }

    let searchWorker: Worker | undefined;
    function search() {
        if (!searchQuery) return;
        searchWorker?.terminate();
        searchNodes = [];
        searchWorker = new TreeSearchWorker;

        let rootCategoryMap: SearchCategoryMapping = {
            children: searchNodes,
            map: {}
        };
        searchWorker.onmessage = e => {
            const message: SearchResponse = e.data;
            switch (message.type) {
                case "result":
                    let targetCategory = rootCategoryMap;
                    for (const parent of message.parents) {
                        let prevTarget = targetCategory;
                        targetCategory = targetCategory.map[parent.id];
                        if (!targetCategory) {
                            // Create the real category node
                            let categoryNode: ITreeNode = {
                                type: "category",
                                ...parent,
                                children: []
                            };
                            prevTarget.children.push(categoryNode);

                            // Create the mapping
                            targetCategory = {
                                children: categoryNode.children,
                                map: {}
                            };
                            prevTarget.map[parent.id] = targetCategory;
                        }
                    }

                    // Push the node
                    let node = message.node;
                    targetCategory.children.push(node);
                    // Create the mapping
                    if (node.type == "category") {
                        targetCategory.map[node.id] = {
                            children: node.children,
                            map: {}
                        }
                    }

                    searchNodes = searchNodes; // trigger update
                    break;
                
                case "end":
                    searchWorker = undefined;
                    break;
            }
        };

        const message: SearchRequest = {
            type: "start",
            nodes,
            query: searchQuery,
            options: searchOptions
        };
        searchWorker.postMessage(message);
    }

    function onScroll() {
        $explorerScrollTop = treeView.scrollTop;
    }

    enum ScrollDirection {
        None,
        Up,
        Down
    }
    let autoScrollDirection = ScrollDirection.None;
    const autoScrollAreaSize = 40;
    function onMouseMove(e: MouseEvent) {
        if (e.ctrlKey && e.buttons == 1) {
            const element = e.currentTarget as HTMLElement;
            const rect = element.getBoundingClientRect();
            if (e.clientY - rect.top < autoScrollAreaSize) {
                autoScrollDirection = ScrollDirection.Up;
                startAutoScroll(element);
            }
            else if (rect.bottom - e.clientY < autoScrollAreaSize) {
                autoScrollDirection = ScrollDirection.Down;
                startAutoScroll(element);
            }
            else {
                autoScrollDirection = ScrollDirection.None;
            }
        }
    }

    function startAutoScroll(element: HTMLElement) {
        if (autoScrollDirection == ScrollDirection.None) return;
        requestAnimationFrame(time => autoScrollStep(element, time));
    }

    let autoScrollDelta = 0;
    let lastAutoScrollTime = -1;
    function autoScrollStep(element: HTMLElement, time: number) {
        const delta = lastAutoScrollTime == -1 ? 0 : time - lastAutoScrollTime;
        lastAutoScrollTime = time;

        const scrollDelta = delta / 5;

        switch (autoScrollDirection) {
            case ScrollDirection.None:
                autoScrollDelta = 0;
                lastAutoScrollTime = -1;
                return;

            case ScrollDirection.Up:
                autoScrollDelta -= scrollDelta;
                break;

            case ScrollDirection.Down:
                autoScrollDelta += scrollDelta;
                break;
        }

        let intDelta = Math.floor(autoScrollDelta);
        element.scrollTop += intDelta;
        autoScrollDelta -= intDelta;

        requestAnimationFrame(time => autoScrollStep(element, time));
    }

    function onMouseUp() {
        autoScrollDirection = ScrollDirection.None;
    }

    function onKeyDown(e: KeyboardEvent) {
        let isPrevDirection = e.key == "ArrowUp" || e.key == "ArrowLeft";
        if (isPrevDirection || e.key == "ArrowDown" || e.key == "ArrowRight") {
            e.preventDefault();

            let id = isPrevDirection ? $currentNav.prev : $currentNav.next;
            if (id == null) { return; }

            const [ node ] = findNodeByPath([ id ], $currentSiblings) || [ null ];
            if (node) {
                gotoNode(node, [ ...$currentPath.slice(0, -1), id ]);
            }
        }
    }

    function windowOnKeyDown(e: KeyboardEvent) {
        if (e.target != treeView && e.altKey) {
            onKeyDown(e);
        }
    }

    export let extraActions: IPanelAction[] = [];
    
    let actions: IPanelAction[];
    $: actions = [
        {
            icon: "copy",
            tooltip: l10n.t("Copy"),
            onClick: () => {
                $copyingNodes = Object.assign({}, $selectedNodes);
                $selectedNodes = {};
            }
        },
        {
            icon: "clippy",
            tooltip: l10n.t("Paste / Fill"),
            onClick: async () => {
                const src = Object.entries($copyingNodes);
                const dest = Object.entries($selectedNodes);
                $copyingNodes = {};
                $selectedNodes = {};

                if (!src.length || !dest.length) { return; }

                const res = await vscode.showInputBox(
                    "pasteSlotCount", 
                    l10n.t("How many text slots do you want to paste? (leave empty to paste all)")
                );
                if (res == null) { return; }

                const maxSlots = Math.max(
                    0,
                    res.length ? +res : NaN
                );

                let i = 0;
                let j = 0;
                while (j < dest.length) {
                    const [ srcPathStr, srcCount ] = src[i++];
                    const [ destPathStr, destCount ] = dest[j++];
                    const srcPath = srcPathStr.split("/");
                    const destPath = destPathStr.split("/");

                    const contentArr = await getNodeTlContent(srcPath, srcCount);
                    let pasteCount = Math.min(srcCount, destCount);
                    if (!isNaN(maxSlots)) {
                        pasteCount = Math.min(pasteCount, maxSlots);
                    }
                    let hasContent = false;
                    for (let k = 0; k < pasteCount; ++k) {
                        let content = contentArr[k];
                        if (content === null) { continue; }

                        vscode.postMessage({
                            type: "setTextSlotContent",
                            entryPath: destPath,
                            index: k,
                            content
                        });
                        hasContent = true;
                    }
                    if (hasContent) {
                        // Manually trigger setExists
                        window.postMessage({
                            type: "setExists",
                            path: destPath,
                            exists: true
                        })
                    }

                    // Wrap around
                    if (i >= src.length) {
                        i = 0
                    }
                }
            }
        },
        {
            icon: "clear-all",
            tooltip: l10n.t("Clear"),
            onClick: () => {
                const selectedNodes = $selectedNodes;
                for (const pathStr in selectedNodes) {
                    const path = pathStr.split("/");
                    const contentCount = selectedNodes[pathStr];
                    for (let i = 0; i < contentCount; ++i) {
                        vscode.postMessage({
                            type: "setTextSlotContent",
                            entryPath: path,
                            index: i,
                            content: null
                        });
                    }
                    // Manually trigger setExists
                    window.postMessage({
                        type: "setExists",
                        path,
                        exists: false
                    })
                }
                $selectedNodes = {};
            }
        },
        {
            icon: hideExists ? "eye" : "eye-closed",
            tooltip: hideExists ? l10n.t("Show translated entries") : l10n.t("Hide translated entries"),
            onClick: () => hideExists = !hideExists
        },
        ...extraActions
    ];
</script>

<svelte:window on:message={onMessage} on:keydown={windowOnKeyDown} />

<div class="root" style="width: {size}px;">
    <Sash bind:size minSize={200} />
    <PanelTitle label={title} {actions} />
    <div class="search-container">
        <div class="search-box-container">
            <InputBox placeholder={l10n.t("Search")} bind:value={searchQuery} />
            <div class="search-expand-btn" on:click={onSearchOptionsToggle}>
                <div class="codicon codicon-{searchExpandIcon}"></div>
            </div>
        </div>
        {#if searchOptionsOpen}
            <div class="search-options">
                <div><input type="checkbox" bind:checked={searchOptions.caseSensitive}>{l10n.t("Case sensitive")}</div>
                <div><input type="checkbox" bind:checked={searchOptions.regex}>{l10n.t("Use regular expression")}</div>
                <div><input type="checkbox" bind:checked={searchOptions.searchInContent}>{l10n.t("Search in content")}</div>
                <div><input type="checkbox" bind:checked={searchOptions.excludeCategoryNames}>{l10n.t("Exclude category names")}</div>
            </div>
        {/if}
    </div>
    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
    <div class="tree-view" style={searchQuery ? "display: none;" : null} tabindex="0" bind:this={treeView} on:scroll={onScroll} on:mousemove={onMouseMove} on:mouseup={onMouseUp} on:keydown={onKeyDown}>
        {#each nodes as node}
            <TreeNode {node} siblings={nodes} {hideExists} />
        {/each}
    </div>
    {#if searchQuery}
        <div class="tree-view" on:mousemove={onMouseMove} on:mouseup={onMouseUp}>
            {#if searchWorker}
                <div class="searching-label">{l10n.t("Searching...")}</div>
            {/if}
            {#each searchNodes as node}
                <TreeNode {node} openAll {hideExists} />
            {/each}
        </div>
    {/if}
</div>

<style>
    .root {
        display: flex;
        flex-direction: column;
        background-color: var(--vscode-menu-background);
        height: 100%;
        position: relative;
    }

    .tree-view {
        width: 100%;
        height: 100%;
        overflow-y: auto;
    }

    .tree-view:focus-visible {
        outline: none;
    }

    .search-container {
        padding: 0 4px 0 12px;
        margin-top: 2px;
        margin-bottom: 8px;
        display: flex;
        flex-direction: column;
    }

    .search-box-container {
        display: flex;
    }

    .search-expand-btn {
        height: 100%;
        display: flex;
        align-items: center;
        color: var(--vscode-icon-foreground);
        margin-left: 2px;
    }

    .search-expand-btn:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
    }

    .search-options {
        margin-top: 4px;
    }

    .search-options > div {
        display: flex;
    }

    .search-options > div > input {
        margin-right: 4px;
    }

    .searching-label {
        padding: 0 20px;
    }
</style>