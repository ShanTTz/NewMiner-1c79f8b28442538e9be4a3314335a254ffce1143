const state = {
    contextHistory: [],
    isDebating: false,
    debateRound: 0,
    globalFileContent: "",
    isFileEnabled: false,
    isMapOpen: false,
    currentViewMode: '2d', // '2d' or '3d'
    lastSentIndex: 0,
    lastHostData: null // [新增] 存储主持人的最终结构化成果数据
};

export default state;

export function addHistoryItem(role, key, content) {
    state.contextHistory.push({
        role,
        key,
        content: (typeof content === 'string') ? content : JSON.stringify(content)
    });
}

export function clearHistory() {
    state.contextHistory = [];
    state.lastSentIndex = 0;
    state.lastHostData = null; // [新增] 清空历史时重置数据
}

export function buildContextString() {
    if (state.contextHistory.length === 0) return "";
    return state.contextHistory.map(item => {
        const idInfo = item.key ? ` (ID: ${item.key})` : "";
        return `【${item.role}${idInfo}】:\n${item.content}`;
    }).join("\n\n");
}

export function buildIncrementalContext(forceFull = false) {
    if (state.contextHistory.length === 0) return "";
    const startIndex = forceFull ? 0 : state.lastSentIndex;
    const newItems = state.contextHistory.slice(startIndex);
    state.lastSentIndex = state.contextHistory.length;
    if (newItems.length === 0 && !forceFull) return "";

    return newItems.map(item => {
        const idInfo = item.key ? ` (ID: ${item.key})` : "";
        return `【${item.role}${idInfo}】:\n${item.content}`;
    }).join("\n\n");
}