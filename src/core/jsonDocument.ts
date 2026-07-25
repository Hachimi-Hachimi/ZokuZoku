import * as vscode from 'vscode';
import jsonToAst from "json-to-ast";
import * as utils from './utils.js';

export type JsonEdit<T> =
    (T extends Array<infer R> ? JsonArrayEdit<R> :
    (T extends object ? JsonObjectEdit<T> : T));

export type JsonObjectEdit<T> = {type: "object"} & ({
    action: "set",
    values: T
} | {
    action: "update",
    property: keyof T extends never ? {
        key: string,
        value: any
    } : {[K in keyof T]: {
        key: K,
        value: JsonEdit<T[K]>
    }}[keyof T];
} | {
    action: "delete",
    key: keyof T extends never ? string : keyof T
});

export type JsonArrayEdit<T> = {type: "array"} & ({
    action: "set" | "push",
    values: T[]
} | {
    action: "update",
    index: number,
    value: JsonEdit<T>
} | {
    action: "delete",
    index: number
});

function isObjectOrArrayEdit(edit: unknown): edit is (JsonObjectEdit<any> | JsonArrayEdit<any>) {
    return edit !== null && typeof edit === "object";
}

function posConv(pos: { line: number, column: number }): vscode.Position {
    return new vscode.Position(pos.line - 1, pos.column - 1);
}

function rangeConv(range: jsonToAst.Location): vscode.Range {
    return new vscode.Range(posConv(range.start), posConv(range.end));
}

const BASE_INDENT = 4;
export class JsonDocument<T> extends vscode.Disposable {
    uri: vscode.Uri;
    defaultData: T; // can be null
    private readSuccessful = false;
    get isReadSuccessful() { return this.readSuccessful; }

    fsWatcher?: vscode.FileSystemWatcher;
    onDidChangeTextDocument?: vscode.Disposable;

    private _onDidChange: vscode.EventEmitter<void> = new vscode.EventEmitter();
    readonly onDidChange = this._onDidChange.event;

    private _ast: jsonToAst.ValueNode;
    astObjectsProps: Map<jsonToAst.ObjectNode, {[key: string]: jsonToAst.PropertyNode}>;
    set ast(value: jsonToAst.ValueNode) {
        this._ast = value;
        this.buildAstObjectProps();
        this._onDidChange.fire();
    }

    get ast(): jsonToAst.ValueNode {
        return this._ast;
    }

    private buildAstObjectProps() {
        this.astObjectsProps.clear();
        this.visit(node => {
            if (node.type === "Object") {
                const props: {[key: string]: jsonToAst.PropertyNode} = {};
                for (const child of node.children) {
                    props[child.key.value] = child;
                }
                this.astObjectsProps.set(node, props);
            }
        });
    }

    private formatter?: (data: T) => string;

    constructor(uri: vscode.Uri, defaultData: T, onChange?: () => void, formatter?: (data: T) => string) {
        super(() => this.onDispose());

        this.uri = uri;
        this.defaultData = defaultData;
        this.formatter = formatter;
        if (onChange) {
            this.onDidChange(onChange);
        }

        this._ast = jsonToAst(JSON.stringify(this.defaultData, null, BASE_INDENT));
        this.astObjectsProps = new Map;
        this.buildAstObjectProps();
    }

    private onDispose() {
        this.fsWatcher?.dispose();
        this.onDidChangeTextDocument?.dispose();
    }

    watchFileSystem() {
        // Detect file changes in fs (will not trigger when editing, only on save)
        const pattern = new vscode.RelativePattern(this.uri, "*");
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate(() => this.readFile().catch(_ => {}));
        watcher.onDidChange(() => this.readFile().catch(_ => {}));
        watcher.onDidDelete(() => this.loadDefault());
        this.fsWatcher?.dispose();
        this.fsWatcher = watcher;
    }

    watchTextDocument(doc: vscode.TextDocument) {
        this.onDidChangeTextDocument?.dispose();
        this.onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === doc) {
                this.readTextDocument().catch(_ => {});
            }
            else if (doc.isClosed) {
                this.onDidChangeTextDocument!.dispose();
                this.onDidChangeTextDocument = undefined;
            }
        });
    }

    loadDefault() {
        this.ast = jsonToAst(JSON.stringify(this.defaultData, null, BASE_INDENT));
    }

    async readFile() {
        try {
            const buffer = await vscode.workspace.fs.readFile(this.uri);
            const json = new TextDecoder().decode(buffer);
            this.ast = jsonToAst(json);
            this.readSuccessful = true;
        }
        catch (e) {
            this.loadDefault();
            this.readSuccessful = false;
            throw e;
        }
    }

    async readTextDocument() {
        try {
            const document = await vscode.workspace.openTextDocument(this.uri);
            this.ast = jsonToAst(document.getText());
            this.readSuccessful = true;
        }
        catch (e) {
            this.loadDefault();
            this.readSuccessful = false;
            throw e;
        }
    }

    static visit(node: jsonToAst.ValueNode, visitor: (node: jsonToAst.ValueNode) => void) {
        visitor(node);
        switch (node.type) {
            case "Object":
                for (const child of node.children) {
                    this.visit(child.value, visitor);
                }
                break;
            
            case "Array":
                for (const child of node.children) {
                    this.visit(child, visitor);
                }
                break;
        }
    }

    visit(visitor: (node: jsonToAst.ValueNode) => void) {
        JsonDocument.visit(this.ast, visitor);
    }

    private nodeReplace(wsEdit: vscode.WorkspaceEdit, node: jsonToAst.ASTNode, value: any, indentLevel: number) {
        const indent = " ".repeat(indentLevel * BASE_INDENT);
        const json = utils.addIndent(JSON.stringify(value, null, BASE_INDENT), indent);
        wsEdit.replace(this.uri, rangeConv(node.loc!), json);
    }

    private insertObjectOrArrayEntries(
        wsEdit: vscode.WorkspaceEdit, node: jsonToAst.ObjectNode, content: object, indentLevel: number
    ): void;
    private insertObjectOrArrayEntries(
        wsEdit: vscode.WorkspaceEdit, node: jsonToAst.ArrayNode, content: any[], indentLevel: number
    ): void;
    private insertObjectOrArrayEntries(
        wsEdit: vscode.WorkspaceEdit, node: jsonToAst.ObjectNode | jsonToAst.ArrayNode,
        content: object | any[], indentLevel: number
    ) {
        if (Array.isArray(content)) {
            if (content.length === 0) { return; }
        }
        else {
            if (Object.keys(content).length === 0) { return; }
        }

        const children = node.children;
        const hasEntry = children.length !== 0;
        let insertPos;
        if (hasEntry) {
            const lastEntryNode = children[children.length - 1];
            insertPos = posConv(lastEntryNode.loc!.end);
        }
        else {
            const nodeStart = node.loc!.start;
            insertPos = posConv({
                line: nodeStart.line,
                column: nodeStart.column + 1
            });
        }

        // Add prop right after last prop or as the first property, indenting the closing bracket
        const indent = " ".repeat(indentLevel * BASE_INDENT);
        // Just the entries without the brackets and the leading/preceding newlines
        const newEntries = utils.addIndent(JSON.stringify(content, null, BASE_INDENT).slice(2, -2), indent, true);
        const insert = hasEntry ?
            (",\n" + newEntries) :
            (`\n${newEntries}\n${" ".repeat(indentLevel * BASE_INDENT)}`);
        wsEdit.insert(this.uri, insertPos, insert);
    }

    private deleteObjectOrArrayEntry(
        wsEdit: vscode.WorkspaceEdit, node: jsonToAst.ObjectNode, key: string
    ): void;
    private deleteObjectOrArrayEntry(
        wsEdit: vscode.WorkspaceEdit, node: jsonToAst.ArrayNode, index: number
    ): void;
    private deleteObjectOrArrayEntry(
        wsEdit: vscode.WorkspaceEdit, node: jsonToAst.ObjectNode | jsonToAst.ArrayNode, keyOrIndex: string | number
    ) {
        let i: number;
        if (typeof keyOrIndex === "number") {
            i = keyOrIndex;
        }
        else {
            if (node.type !== "Object") { return; }
            const children = node.children;
            for (i = 0; i < children.length; ++i) {
                const child = children[i];
                if (child.key.value === keyOrIndex) { break; }
            }
            // if it was not found, i = children.length -> target = undefined
        }

        const target = node.children.at(i);
        if (!target) { return; }

        const children = node.children;
        const nextChild = children.at(i + 1);
        const prevChild = i > 0 ? children.at(i - 1) : undefined;
        const parentStart = node.loc!.start;
        const parentEnd = node.loc!.end;
        const start = posConv(nextChild ?
            target.loc!.start :
            (
                prevChild ?
                prevChild.loc!.end :
                {
                    line: parentStart.line,
                    column: parentStart.column + 1
                }
            )
        );
        const end = posConv(nextChild ?
            nextChild.loc!.start :
            (
                prevChild ?
                target.loc!.end :
                {
                    line: parentEnd.line,
                    column: parentEnd.column - 1
                }
            )
        );
        
        wsEdit.delete(this.uri, new vscode.Range(start, end));
    }

    makeEdit(edit: JsonEdit<T>, wsEdit = new vscode.WorkspaceEdit, node = this.ast, indentLevel = 0): vscode.WorkspaceEdit {
        if (!this.readSuccessful) {
            throw new Error(vscode.l10n.t('Document has not been read successfully, refusing to make edit'));
        }

        if (isObjectOrArrayEdit(edit)) {
            // Shared actions
            switch (edit.action) {
                case "set":
                    this.nodeReplace(wsEdit, node, edit.values, indentLevel);
                    return wsEdit;
            }

            // Type-specific actions
            switch (edit.type) {
                case "object":
                    if (node.type !== "Object") {
                        console.error(node);
                        throw new Error(vscode.l10n.t('JSON node type differs from schema'));
                    }
                    switch (edit.action) {
                        case "update": {
                            const property = edit.property;
                            const props = this.astObjectsProps.get(node);
                            if (!props) {
                                throw new Error(vscode.l10n.t('Attempted to perform object update on non-object node'));
                            }
                            const stringKey = property.key.toString();
                            const propNode = props[stringKey];
                            if (propNode) {
                                this.makeEdit(property.value, wsEdit, propNode.value, indentLevel + 1);
                            }
                            else {
                                let setValue;
                                if (isObjectOrArrayEdit(property.value)) {
                                    const edit = property.value;
                                    if (edit.action === "set") {
                                        setValue = edit.values;
                                    }
                                    else {
                                        throw new Error(vscode.l10n.t('Attempted to perform update on missing property'));
                                    }
                                }
                                else {
                                    setValue = property.value;
                                }

                                this.insertObjectOrArrayEntries(wsEdit, node, {[stringKey]: setValue}, indentLevel);
                            }
                            break;
                        }
                        case "delete": {
                            this.deleteObjectOrArrayEntry(wsEdit, node, edit.key.toString());
                            break;
                        }
                    }
                    break;

                case "array":
                    if (node.type !== "Array") {
                        console.error(node);
                        throw new Error(vscode.l10n.t('JSON node type differs from schema'));
                    }
                    switch (edit.action) {
                        case "push":
                            this.insertObjectOrArrayEntries(wsEdit, node, edit.values, indentLevel);
                            break;
                        
                        case "update": {
                            const childNode = node.children[edit.index];
                            if (!childNode) {
                                throw new Error(vscode.l10n.t('Attempted to perform update on missing array element'));
                            }
                            this.makeEdit(edit.value, wsEdit, childNode, indentLevel + 1);
                            break;
                        }
                        case "delete": {
                            this.deleteObjectOrArrayEntry(wsEdit, node, edit.index);
                            break;
                        }
                    }
                    break;
            }
        }
        else {
            // Primitive value
            this.nodeReplace(wsEdit, node, edit, indentLevel * BASE_INDENT);
        }

        return wsEdit;
    }

    async applyEdit(data: JsonEdit<T>, options: {force?: boolean, save?: boolean} = {}): Promise<boolean> {
        let document: vscode.TextDocument | undefined;
        try {
            // Ignore new files that haven't existed in the file system yet
            if (this.uri.scheme !== "untitled") {
                await vscode.workspace.fs.stat(this.uri);
            }
        }
        catch (e) {
            if (!options.force) { throw e; }
            document = await this.writeTextDocument({ force: true });
        }
        if (!this.readSuccessful && options.force) {
            document = await this.writeTextDocument({ force: true });
            // The default value is serialized the same way it was parsed, so a safe edit operation is guaranteed
            this.readSuccessful = true;
        }

        if (options.save && !document) {
            document = await vscode.workspace.openTextDocument(this.uri);
        }

        if (this.formatter) {
            const newData = JsonDocument.applyJsonEdit(this.getValue(), data);
            const edit = new vscode.WorkspaceEdit();
            const fullText = this.formatter(newData);
            
            if (!document) {
                document = await vscode.workspace.openTextDocument(this.uri);
            }
            
            edit.replace(this.uri, new vscode.Range(0, 0, document.lineCount, 0), fullText);
            const res = await vscode.workspace.applyEdit(edit);
            if (res) {
                this.ast = jsonToAst(fullText);
            }
            if (options.save) {
                await document.save();
            }
            return res;
        }

        const res = await vscode.workspace.applyEdit(this.makeEdit(data));
        if (options.save) {
            document!.save();
        }
        return res;
    }

    private static applyJsonEdit(data: any, edit: JsonEdit<any>): any {
        if (!isObjectOrArrayEdit(edit)) {
            return edit;
        }

        const e = edit as (JsonObjectEdit<any> | JsonArrayEdit<any>);

        switch (e.action) {
            case "set": return e.values;
        }

        if (e.type === "object") {
            const obj = { ...(data || {}) };
            switch (e.action) {
                case "update":
                    obj[e.property.key] = this.applyJsonEdit(obj[e.property.key], e.property.value);
                    return obj;
                case "delete":
                    delete obj[e.key];
                    return obj;
            }
        } else if (e.type === "array") {
            const arr = [...(Array.isArray(data) ? data : [])];
            switch (e.action) {
                case "push": return [...arr, ...e.values];
                case "update":
                    arr[e.index] = this.applyJsonEdit(arr[e.index], e.value);
                    return arr;
                case "delete":
                    arr.splice(e.index, 1);
                    return arr;
            }
        }
        return data;
    }

    static getValue(node: jsonToAst.ValueNode): any {
        switch (node.type) {
            case "Object": {
                const value: {[key: string]: any} = {};
                for (const child of node.children) {
                    value[child.key.value] = this.getValue(child.value);
                }
                return value;
            }
            
            case "Array": {
                const value: any[] = [];
                for (const child of node.children) {
                    value.push(this.getValue(child));
                }
                return value;
            }

            case "Literal":
                return node.value;
        }
    }

    getValue(): T {
        return JsonDocument.getValue(this.ast);
    }

    async writeTextDocument(options: { force?: boolean } = {}): Promise<vscode.TextDocument> {
        let fileExists = false;
        try {
            await vscode.workspace.fs.stat(this.uri);
            fileExists = true;
        }
        catch {
            // File doesn't exist, safe to create
        }

        if (fileExists && !this.readSuccessful && !options.force) {
            throw new Error(vscode.l10n.t('Document has not been read successfully and file exists. Refusing to overwrite to prevent data loss.'));
        }

        if (!fileExists) {
            const edit = new vscode.WorkspaceEdit;
            edit.createFile(this.uri);
            await vscode.workspace.applyEdit(edit);
        }
        const document = await vscode.workspace.openTextDocument(this.uri);
        const edit = new vscode.WorkspaceEdit;
        const text = this.formatter ? this.formatter(this.getValue()) : JSON.stringify(this.getValue(), null, BASE_INDENT);
        edit.replace(
            this.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            text
        );
        await vscode.workspace.applyEdit(edit);
        return document;
    }

    waitForChange(): Promise<void> {
        return new Promise(resolve => {
            const listener = this.onDidChange(() => {
                resolve();
                listener.dispose();
            });
        });
    }
}