export function createWorkbench(bridge) {
    return {
        call: bridge.call.bind(bridge),
    };
}
