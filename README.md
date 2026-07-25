<img align="left" width="80" height="80" src="assets/icon.png">

# ZokuZoku Edge
ZokuZoku Edge is a Visual Studio Code extension which acts as the main translation tool for Hachimi. It provides a number of custom editors that are specialized for editing the various JSON dict formats that Hachimi uses, allowing translators to work on translations without having to edit the JSON file directly.

## Features
- **Easy Installation:** Guided setup process directly within VSCode—no command line required.
- **Dynamic Asset Handling:** Real-time data generation removes the need for manual preprocessing, patching, or separate data downloads.
- **Intuitive Interface:** Assets organized in logical tree views with custom editors that provide a familiar VSCode-native experience.
- **Optimized Story Editing:** Features accurate story previews and Hachimi's auto-wrapping system to ensure translations fit perfectly in-game.
- **Integrated Workflow:** Leverages VSCode's power, including built-in Git integration and a robust environment for collaborative translation.

## Installation
Download the .vsix file for the latest version on the [Releases](https://github.com/THShafi170/ZokuZoku-Edge/releases) page. To install it, open the Extensions panel in VSCode, click on the 3 dots button on the top right, choose "Install from VSIX..." and select the file you just downloaded.

### Prerequisites
- **Supported Operating Systems:** Windows 10+ or Linux x64. macOS is not officially supported but might work with some special setup.
- **Recommended Python Version:** Python 3.10 or later.
- **SQLite 3:** Ensure `sqlite3` is installed and accessible in your system's PATH.
- **Visual Studio Code:** v1.96 or later.
- **UM:PD Game Files:**
    - JP Client: Installed through either DMM or Steam.
    - EN Client: Installed from Steam.
    - Android: Game files from either the JP or EN versions.

## Getting started
Follow the usage guide from [here](https://hachimi.noccu.art/docs/translation-guide/using-zokuzoku).

## Development
⚠️ **Please use the pnpm package manager while working on this project.**

To get started, install the dependencies in the root directory and also the `webviews` directory, as there are two separate project trees: one for the extension part, and the other for the editors. There's also another project located in `externals/criCodecs` which contains the source code for the CRI audio decoder native module.

ZokuZoku Edge uses a special Python installation for Node.js called [`pymport`](https://github.com/mmomtchev/pymport), and in development mode, it looks for Python modules in its own directory. To install the required dependencies, instead of following the usual setup procedure, run `npx pympip3 install UnityPy==1.10.18`.

After that, you can work on the project just like you would with any other VSCode extension.

## License
[GNU GPLv3](LICENSE)