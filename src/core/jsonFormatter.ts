import * as utils from './utils.js';

export interface FormatterOptions {
    keyOrder?: (string | RegExp)[];
    compact?: boolean | ((value: any) => boolean);
    baseIndent?: number;
}

export function createFormatter(options: FormatterOptions = {}) {
    const baseIndent = options.baseIndent ?? 4;
    const indentStr = " ".repeat(baseIndent);
    
    function getKeyPriority(key: string): number {
        if (!options.keyOrder) { return 9999; }
        const index = options.keyOrder.findIndex(k => {
            if (typeof k === "string") {
                return k === key;
            }
            return k.test(key);
        });
        return index === -1 ? 9999 : index;
    }

    function shouldCompact(value: any): boolean {
        if (typeof options.compact === "function") {
            return options.compact(value);
        }
        return !!options.compact;
    }

    function format(value: any, level: number = 0): string {
        const currentIndent = indentStr.repeat(level);
        const nextIndent = indentStr.repeat(level + 1);

        if (Array.isArray(value)) {
            if (value.length === 0) { return "[]"; }
            
            if (shouldCompact(value)) {
                return JSON.stringify(value);
            }

            const items = value.map(item => format(item, level + 1));
            return `[\n${nextIndent}${items.join(`,\n${nextIndent}`)}\n${currentIndent}]`;
        }
        else if (typeof value === "object" && value !== null) {
            const keys = Object.keys(value);
            if (keys.length === 0) { return "{}"; }

            if (shouldCompact(value)) {
                // Ensure key order even in compact mode
                const sortedKeys = keys.sort((a, b) => getKeyPriority(a) - getKeyPriority(b));
                const obj: any = {};
                for (const key of sortedKeys) {
                    obj[key] = value[key];
                }
                return JSON.stringify(obj);
            }

            keys.sort((a, b) => {
                const prioA = getKeyPriority(a);
                const prioB = getKeyPriority(b);
                if (prioA !== prioB) { return prioA - prioB; }
                // Native sort as fallback for same priority
                return 0; // Keep original order if priority is same? Or alphabetical? 
                // Let's stick to stable sort of existing keys if no priority
            });

            const entries = keys.map(key => {
                const formattedValue = format(value[key], level + 1);
                return `"${key}": ${formattedValue}`;
            });

            return `{\n${nextIndent}${entries.join(`,\n${nextIndent}`)}\n${currentIndent}}`;
        }
        else {
            return JSON.stringify(value);
        }
    }

    return (data: any) => format(data, 0);
}
