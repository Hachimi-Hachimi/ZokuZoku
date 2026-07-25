<script lang="ts">
  import Editor from "../lib/Editor.svelte";
  import Explorer from "../lib/Explorer.svelte";
  import EditorInner from "./EditorInner.svelte";
  import { config } from "./stores";
  import { vscode } from "../vscode";
  import * as l10n from "@vscode/l10n";

  $: extraActions = [
    {
      icon: ($config?.noWrap ?? false) ? "symbol-text" : "word-wrap",
      tooltip:
        ($config?.noWrap ?? false)
          ? l10n.t("Enable Word Wrap")
          : l10n.t("Disable Word Wrap"),
      onClick: () => {
        const currentNoWrap = $config?.noWrap ?? false;
        const newValue = !currentNoWrap;
        if ($config) {
          $config = { ...$config, noWrap: newValue };
        }
        vscode.postMessage({
          type: "setNoWrap",
          value: newValue,
        });
      },
    },
  ];
</script>

<main>
  <Explorer {extraActions} />
  <Editor inner={EditorInner} />
</main>

<style>
  main {
    display: flex;
    width: 100%;
    height: 100%;
  }
</style>
