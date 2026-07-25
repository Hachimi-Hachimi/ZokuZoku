export let setReady: () => void;
export const whenReady: Promise<void> = new Promise(resolve => {
    setReady = resolve;
});