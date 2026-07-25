
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { execSync } from 'child_process';

const TEMP_DIR = 'temp_l10n_extract';

function extractFromSvelte(content) {
    let scriptContent = '';
    let templateContent = content;

    // Extract script blocks
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let match;
    while ((match = scriptRegex.exec(content)) !== null) {
        scriptContent += match[1] + '\n;\n';
        // Remove script from template content to avoid double processing
        templateContent = templateContent.replace(match[0], '');
    }

    // Extract l10n.t calls from template
    // Simple parser to handle nested parentheses and strings
    let extraCalls = '';
    const l10nRegex = /\bl10n\.t\s*\(/g;
    while ((match = l10nRegex.exec(templateContent)) !== null) {
        const startIndex = match.index;
        let currentIndex = startIndex + match[0].length;
        let parenDepth = 1;
        let inString = null; // ' or " or `
        let isEscaped = false;

        while (currentIndex < templateContent.length && parenDepth > 0) {
            const char = templateContent[currentIndex];
            
            if (inString) {
                if (isEscaped) {
                    isEscaped = false;
                } else {
                    if (char === '\\') {
                        isEscaped = true;
                    } else if (char === inString) {
                        inString = null;
                    }
                }
            } else {
                if (char === "'" || char === '"' || char === '`') {
                    inString = char;
                } else if (char === '(') {
                    parenDepth++;
                } else if (char === ')') {
                    parenDepth--;
                }
            }
            currentIndex++;
        }

        if (parenDepth === 0) {
            extraCalls += templateContent.substring(startIndex, currentIndex) + ';\n';
        }
    }

    return scriptContent + '\n// Extracted from template:\n' + extraCalls;
}

async function main() {
    // Clean up temp dir
    if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    // Process Svelte files
    const svelteFiles = await glob('webviews/src/**/*.svelte');
    for (const file of svelteFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const tsContent = extractFromSvelte(content);
        
        const relPath = path.relative('webviews/src', file);
        const destPath = path.join(TEMP_DIR, relPath + '.ts');
        
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, tsContent);
    }

    // Run vscode-l10n-dev
    // We include 'src' (original TS files) and 'temp_l10n_extract' (processed Svelte files)
    // We also need to include webviews/src for regular TS files inside webviews
    const command = `npx vscode-l10n-dev export --outDir ./l10n ./src ./webviews/src ./${TEMP_DIR}`;
    
    console.log(`Running: ${command}`);
    try {
        execSync(command, { stdio: 'inherit' });
    } catch (e) {
        console.error('l10n export failed');
        process.exit(1);
    }

    // Cleanup
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('Done.');
}

main();
