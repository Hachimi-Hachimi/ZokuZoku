import { Writable } from 'stream';
import { https } from 'follow-redirects';
import fs from 'fs';
import fsPromises from 'fs/promises';
import * as vscode from 'vscode';

function downloadToStream(url: string | URL, title: string, output: Writable): Thenable<void> {
    const progressOptions: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true
    };
    return vscode.window.withProgress(progressOptions, (progress, token) => {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { maxBodyLength: Infinity }, res => {
                if (res.statusCode !== 200) {
                    reject(new Error(vscode.l10n.t('Server returned status code: {0}', {0: res.statusCode})));
                    return;
                }

                const clHeader = res.headers['content-length'];
                const contentLength = clHeader ? parseInt(clHeader, 10) : 100000;

                res.on("data", c => {
                    const chunk = c as Buffer;
                    output.write(chunk);
                    if (clHeader) {
                        progress.report({ increment: (chunk.length / contentLength) * 100 });
                    }
                    else {
                        // Fake progress
                        progress.report({ increment: 1 });
                    }
                })
                .on("end", () => {
                    output.end();
                    resolve();
                })
                .on("error", e => {
                    res.destroy();
                    reject(e);
                });

                token.onCancellationRequested(() => {
                    res.destroy();
                    reject(new Error(vscode.l10n.t('Download cancelled by user')));
                });
            })
            .on("error", e => {
                req.destroy();
                reject(e);
            });
        });
    });
}

async function downloadToFile(url: string | URL, title: string, filePath: fs.PathLike, forceSync = false) {
    const file = fs.createWriteStream(filePath);
    try {
        await downloadToStream(url, title, file);
        if (forceSync) {
            const file = await fsPromises.open(filePath);
            await new Promise(resolve => fs.fdatasync(file.fd, resolve));
            await file.close();
        }
    }
    catch (e) {
        await fsPromises.unlink(filePath);
        console.error(e);
        throw e;
    }
}

export default {
    downloadToFile,
    downloadToStream
};
