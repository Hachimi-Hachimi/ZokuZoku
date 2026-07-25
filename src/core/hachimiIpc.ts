import * as vscode from 'vscode';
import http from "node:http";
import config from "../config";

export type Command = {
    type: "StoryGotoBlock",
    block_id: number,
    incremental: boolean
} | {
    type: "ReloadLocalizedData"
};

export type CommandResponse = {
    type: "Ok"
} | {
    type: "Error",
    message?: string
} | {
    type: "HelloWorld",
    message: string
};

const DEFAULT_ERR_MSG = vscode.l10n.t('Check Hachimi logs for more details');

function call(command: Command): Promise<CommandResponse> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(command);
        const req = http.request({
            hostname: config().get("hachimiIpcAddress"),
            port: 50433,
            method: "POST",
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(postData),
            },
        }, res => {
            res.setEncoding("utf8");

            let data = "";
            res.on("data", chunk =>
                data += chunk
            )
            .on("end", () => {
                const cmdRes: CommandResponse = JSON.parse(data);
                if (cmdRes.type === "Error") {
                    reject(new Error(cmdRes.message ?? DEFAULT_ERR_MSG));
                }
                else {
                    resolve(cmdRes);
                }
            })
            .on("error", e =>
                reject(e)
            );
        })
        .on("error", e => reject(e));

        req.write(postData);
        req.end();
    });
}

async function callWithProgress(command: Command): Promise<CommandResponse> {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: vscode.l10n.t('Hachimi IPC: {0}', {0: command.type})
    }, () => call(command));
}

export const HachimiIpc = {
    call,
    callWithProgress
};
export default HachimiIpc;
