import type { Command as HachimiCommand } from "../core/hachimiIpc";
export type { Command as HachimiCommand } from "../core/hachimiIpc";

export type ControllerMessage = {
    type: "setExplorerTitle",
    title: string
} | {
    type: "setNodes",
    nodes: ITreeNode[]
} | {
    type: "setTextSlotContent",
    entryPath: TreeNodeId[],
    index: number,
    content: string | null
} | {
    type: "setExists",
    path: TreeNodeId[],
    exists: boolean
} | {
    type: "setGameFont",
    uri: string
} | {
    type: "undo"
} | {
    type: "redo"
} | {
    type: "showInputBoxResult",
    id: string,
    result?: string
} | {
    type: "setCategoryFull",
    path: TreeNodeId[],
    full: boolean
} | {
    type: "loadVoice",
    uris: {[key: string]: string}
} | {
    type: "enableVoicePlayer"
};

export type StoryEditorControllerMessage = ControllerMessage | {
    type: "setConfig",
    config: StoryEditorConfig
};

export interface StoryEditorConfig {
    noWrap: boolean,
    isStoryView: boolean,
    lineSpacingMultiplier?: number,
    fontSizeMultiplier?: number,
    lineWidthMultiplier?: number
}

export type EditorMessage = {
    type: "init"
} | {
    type: "getTextSlotContent",
    entryPath: TreeNodeId[],
    index: number
} | {
    type: "setTextSlotContent",
    entryPath: TreeNodeId[],
    index: number,
    content: string | null
} | {
    type: "subscribePath",
    path: TreeNodeId[]
} | {
    type: "getExists",
    path: TreeNodeId[]
} | {
    type: "showMessage",
    content: string,
    messageType?: "info" | "warning" | "error";
} | {
    type: "callHachimiIpc",
    command: HachimiCommand
} | {
    type: "showInputBox",
    id: string,
    placeholder: string
} | {
    type: "getCategoryFull",
    path: TreeNodeId[]
} | {
    type: "loadVoice"
} | {
    type: "setNoWrap",
    value: boolean
};

export type TreeNodeId = string | number;

type ExtendsTextSlot<T> = T extends ITextSlot ? T : never;
export type ITreeNode<TS = ITextSlot> = {
    type: "entry",
    id: TreeNodeId,
    name: string,
    icon?: string, // codicon icon name, default: symbol-string
    content: ExtendsTextSlot<TS>[],
    next?: TreeNodeId,
    prev?: TreeNodeId
} | {
    type: "category",
    id: TreeNodeId,
    name: string,
    children: ITreeNode[]
} | {
    type: "dummy",
    id: TreeNodeId,
    name: string,
    icon?: string
};

// util type
export type IEntryTreeNode<TS = ITextSlot> = ITreeNode<TS> & { type: "entry" };

export interface ITextSlot<UD = any> {
    content: string;
    multiline?: boolean;
    userData?: UD;
    link?: TreeNodeId;
    tooltip?: string;
}

export type IStoryTextSlot = ITextSlot<IStoryTextSlotUserData>;

export type IStoryTextSlotUserData = {
    type: Exclude<StoryTextSlotType, StoryTextSlotType.Choice>;
} | {
    type: StoryTextSlotType.Choice;
    gender?: "male" | "female";
};

export enum StoryTextSlotType {
    Name,
    Content,
    Choice,
    ColorText
}