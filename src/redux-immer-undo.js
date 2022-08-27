/* 可插拔的撤销重做插件 */
import { enablePatches, produceWithPatches, applyPatches } from "immer"

// 启用对 Patches 的支持 
enablePatches()

export const undoEnhancer = (reducer, option = {}) => {

	const config = {
		limit: false, // 日志流水最大长度, 默认false为不限制
		undoType: "@@undoEnhancer/UNDO", // 撤销操作类型
		redoType: "@@undoEnhancer/REDO", // 重做操作类型
		clearHistoryType: "@@undoEnhancer/CLEAR_HISTORY", // 清空历史记录类型
		historyKey: "UNDO_HISTORY", // 若你开启了 addHistoryToState 配置，自定义变量名，默认为 UNDO_HISTORY
		include: [], // 需要加入日志流水的操作类型
		openMergeOption: false, // !实验性功能，请勿开启。开启该配置，会对相同路径修改的单一操作合并为一个操作行为
		addHistoryToState: false, // 是否将历史堆栈记录加入到 State 中, UNDO_HISTORY:{ ... }
		...option
	}

	let initialState = reducer(undefined, {})
	let history = createHistory(initialState)

	// 判断 action 是否加入撤销重做流水
	const isInclude = (actionType) => config.include.find(item => item.type === actionType) ? true : false

	return (state = initialState, action) => {
		function switchAction (currentAction) {
			const { type } = currentAction
			switch (type) {
				case config.undoType:
					// 撤销操作
					if (history.undoStack.length <= 0) {
						return history.present
					}
					history = undoOption(history)
					return history.present

				case config.redoType:
					// 重做操作
					if (history.redoStack.length <= 0) {
						return history.present
					}
					history = redoOption(history)
					return history.present

				case config.clearHistoryType:
					// 清空历史记录
					history = clearHistory(history)
					return history.present

				default:
					if (isInclude(type)) {
						// 打断撤销重做操作时
						history = clearRedoStack(history)
						const [ nextState, patches, inversePatches ] = produceWithPatches(
							state,
							draft => reducer(draft, action)
						)
						if (config.limit && history.undoStack.length >= config.limit) {
							history.undoStack.shift()
						}
						if (patches.length > 0 && inversePatches.length > 0) {
							history = insertHistory(history, type, nextState, patches, inversePatches, config.openMergeOption)
						}
						return nextState
					}
					return reducer(state, action)
			}
		}
		if (config.addHistoryToState) {
			return addHistoryToState(switchAction(action), history, config.historyKey)
		}
		return switchAction(action)
	}
}

// 创建历史堆栈
function createHistory (present = null) {
	return {
		undoStack: [],
		redoStack: [],
		present
	}
}

// 清空历史记录
function clearHistory (history) {
	return {
		...history,
		undoStack: [],
		redoStack: []
	}
}

// 特殊情况: 打断撤销重做操作时，清空 redoStack
function clearRedoStack (history) {
	return {
		...history,
		redoStack: []
	}
}

// 推入撤销重做记录
function insertHistory (history, actionType, nextState, patches, inversePatches, openMergeOption) {

	const { undoStack } = history

	// 对相同路径修改的操作合并为一个操作行为
	if (undoStack.length > 0) {
		let last = {...undoStack[undoStack.length - 1]}
		if (openMergeOption && last.actionType === actionType && last.patches.length === patches.length && patches.length === 1) {
			const isSameAllPath = patches.every((patch, index) => patch.path.join("") === last.patches[index].path.join("") && patch.op === last.patches[index].op)
			if (isSameAllPath) {
				last = {
					...last,
					patches: [...patches]
				}
				return {
					...history,
					undoStack: [ ...undoStack.slice(0, undoStack.length - 1), last ],
					present: nextState
				}
			}
		}
	}
	return {
		...history,
		undoStack: [ ...history.undoStack, { actionType, patches, inversePatches }],
		present: nextState
	}
}

// 撤销操作
function undoOption (history) {
	const { undoStack, present } = history
	const { patches, inversePatches, actionType } = undoStack.pop()
	const nextState = applyPatches(present, inversePatches)
	return {
		...history,
		redoStack: [ ...history.redoStack, { actionType, patches, inversePatches }],
		present: nextState
	}
}

// 重做操作
function redoOption (history) {
	const { redoStack, present } = history
	const { patches, inversePatches, actionType } = redoStack.pop()
	const nextState = applyPatches(present, patches)
	return {
		...history,
		undoStack: [ ...history.undoStack, { actionType, patches, inversePatches }],
		present: nextState
	}
}

// 将历史堆栈对象，暴露到 state 中
function addHistoryToState (newState, history, historyKey) {
	return {
		...newState,
		[historyKey]: {
			undoStack: [...history.undoStack],
			redoStack: [...history.redoStack]
		}
	}
}
