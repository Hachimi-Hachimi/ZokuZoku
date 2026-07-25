import path from "path";
import os from "os";

export const ZOKUZOKU_DIR = path.join(os.homedir(), ".zokuzoku");
export const PYMPORT_DIR = path.join(ZOKUZOKU_DIR, "pymport");
export const PYMPORT_INSTALLED_FILE = path.join(PYMPORT_DIR, ".installed");
export const PYMPORT_VER = "v1.6.0-rc.2";
export const UNITYPY_VER = "1.10.18";
export const APSW_VER = "3.50.4.0";
export const SQLITE_WIN32_VER = "sqlite-v3.26.0-win32-x86.exe";

export const HCA_KEY = 75923756697503n;

export const META_KEY_JP = "9c2bab97bcf8c0c4f1a9ea7881a213f6c9ebf9d8d4c6a8e43ce5a259bde7e9fd";
export const META_KEY_GLOBAL = "a713a5c79dbc9497c0a88669";

export const STEAM_APP_ID_JP = '3564400';
export const STEAM_APP_ID_GLOBAL = '3224770';
