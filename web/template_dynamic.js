import { app } from "/scripts/app.js";

const NODE_NAMES = ["ShaobkjImageTextDetect", "QianwenPromptRewriter"];
const TEMPLATE_PREFIX = "image_";
const VIDEO_PREFIX = "video_";
const MIN_INPUTS = 2;
const MAX_TEMPLATE_INDEX = 12;
const QWEN_WIDGET_LABELS = {
	prompt: "提示词",
	prompt_style: "提示词模式",
	llm_model: "模型",
	max_retries: "最大重试次数",
	API_KEY: "API密钥",
	write_api_file: "写入本地API文件",
	save_tokens: "节省Token",
	skip_rewrite: "跳过改写",
	seed: "随机种子",
};

function parseTemplateIndex(name) {
	if (typeof name !== "string") return null;
	if (!name.startsWith(TEMPLATE_PREFIX)) return null;
	const suffix = name.slice(TEMPLATE_PREFIX.length);
	if (!suffix || !/^\d+$/.test(suffix)) return null;
	return parseInt(suffix, 10);
}

function parseVideoIndex(name) {
	if (typeof name !== "string") return null;
	if (!name.startsWith(VIDEO_PREFIX)) return null;
	const suffix = name.slice(VIDEO_PREFIX.length);
	if (!suffix || !/^\d+$/.test(suffix)) return null;
	return parseInt(suffix, 10);
}

function findInputSlot(node, name) {
	if (!node) return -1;
	if (typeof node.findInputSlot === "function") return node.findInputSlot(name);
	if (!Array.isArray(node.inputs)) return -1;
	return node.inputs.findIndex((i) => i?.name === name);
}

function hasConnectedInput(node, prefix) {
	if (!Array.isArray(node?.inputs)) return false;
	return node.inputs.some((input) => {
		if (!input?.name?.startsWith(prefix)) return false;
		const link = input.link;
		return link !== null && link !== undefined && link !== -1;
	});
}

function applyQianwenLocalization(node) {
	if (!node) return false;
	const isQwenNode = node.type === "QianwenPromptRewriter" || node.comfyClass === "QianwenPromptRewriter";
	if (!isQwenNode) return false;
	let changed = false;

	if (Array.isArray(node.inputs)) {
		for (const input of node.inputs) {
			if (!input || typeof input.name !== "string") continue;
			if (input.name.startsWith(VIDEO_PREFIX)) {
				const idx = parseVideoIndex(input.name);
				const target = idx && idx > 1 ? `视频输入_${idx}` : "视频输入";
				if (input.label !== target) {
					input.label = target;
					changed = true;
				}
			}
			if (input.name.startsWith(TEMPLATE_PREFIX)) {
				const idx = parseTemplateIndex(input.name);
				const target = idx ? `图像_${idx}` : "图像";
				if (input.label !== target) {
					input.label = target;
					changed = true;
				}
			}
		}
	}

	if (Array.isArray(node.outputs)) {
		for (const output of node.outputs) {
			if (!output || typeof output.name !== "string") continue;
			if (output.name === "STRING" && output.label !== "提示词") {
				output.label = "提示词";
				changed = true;
			}
		}
	}

	if (Array.isArray(node.widgets)) {
		for (const widget of node.widgets) {
			if (!widget || typeof widget.name !== "string") continue;
			const target = QWEN_WIDGET_LABELS[widget.name];
			if (target && widget.label !== target) {
				widget.label = target;
				changed = true;
			}
		}
	}

	if (changed) node.setDirtyCanvas(true, true);
	return changed;
}

function syncQwenPromptMode(node) {
	if (!node) return false;
	const isQwenNode = node.type === "QianwenPromptRewriter" || node.comfyClass === "QianwenPromptRewriter";
	if (!isQwenNode || !Array.isArray(node.widgets)) return false;
	const widget = node.widgets.find((w) => w?.name === "prompt_style");
	if (!widget) return false;
	if (widget.options?.values) widget.options.values = ["提示词扩写", "图像改写", "视频反推"];
	const target = hasConnectedInput(node, VIDEO_PREFIX) ? "视频反推" : (hasConnectedInput(node, TEMPLATE_PREFIX) ? "图像改写" : "提示词扩写");
	if (widget.value === target) return false;
	widget.value = target;
	widget.callback?.(target);
	node.setDirtyCanvas(true, true);
	return true;
}

function ensureQwenVideoInput(node) {
	if (!node) return false;
	const isQwenNode = node.type === "QianwenPromptRewriter" || node.comfyClass === "QianwenPromptRewriter";
	if (!isQwenNode) return false;
	let changed = false;
	let slotIndex = findInputSlot(node, "video_1");
	if (slotIndex === -1) {
		node.addInput("video_1", "VIDEO");
		slotIndex = findInputSlot(node, "video_1");
		changed = true;
	}
	if (slotIndex !== -1) {
		const slot = node.inputs[slotIndex];
		if (slot) {
			slot.required = false;
			slot.optional = true;
			if (!node.optional) node.optional = {};
			node.optional.video_1 = true;
		}
	}
	return changed;
}

function manageTemplateInputs(node, onlyAdd = false) {
	if (!node) return;
	if (!Array.isArray(node.inputs)) node.inputs = [];
	let changed = ensureQwenVideoInput(node);

	const legacyIndex = findInputSlot(node, "image");
	if (legacyIndex !== -1) {
		node.removeInput(legacyIndex);
		if (node.optional) delete node.optional.image;
		changed = true;
	}

	let highestConnectedIndex = 0;
	for (const input of node.inputs) {
		const idx = parseTemplateIndex(input?.name);
		if (idx === null) continue;
		const link = input?.link;
		const connected = link !== null && link !== undefined && link !== -1;
		if (connected && idx > highestConnectedIndex) highestConnectedIndex = idx;
	}

	const targetCount = Math.max(highestConnectedIndex + 1, MIN_INPUTS);
	for (let i = 1; i <= targetCount; i++) {
		const name = `${TEMPLATE_PREFIX}${i}`;
		let slotIndex = findInputSlot(node, name);
		if (slotIndex === -1) {
			node.addInput(name, "IMAGE");
			slotIndex = findInputSlot(node, name);
			changed = true;
		}
		if (slotIndex !== -1) {
			const slot = node.inputs[slotIndex];
			if (slot) {
				slot.required = false;
				slot.optional = true;
				if (!node.optional) node.optional = {};
				node.optional[name] = true;
			}
		}
	}

	if (!onlyAdd) {
		for (let i = MAX_TEMPLATE_INDEX; i > targetCount; i--) {
			const name = `${TEMPLATE_PREFIX}${i}`;
			const slotIndex = findInputSlot(node, name);
			if (slotIndex === -1) continue;
			const input = node.inputs[slotIndex];
			const link = input?.link;
			const connected = link !== null && link !== undefined && link !== -1;
			if (!connected) {
				node.removeInput(slotIndex);
				changed = true;
			}
		}
	}

	if (!node.optional) node.optional = {};
	for (const input of node.inputs || []) {
		if (input && input.name && (input.name.startsWith(TEMPLATE_PREFIX) || input.name.startsWith(VIDEO_PREFIX))) {
			input.required = false;
			input.optional = true;
			node.optional[input.name] = true;
		}
	}

	if (applyQianwenLocalization(node)) changed = true;
	if (syncQwenPromptMode(node)) changed = true;
	if (changed) {
		node.onResize?.(node.size);
		node.setDirtyCanvas(true, true);
	}
}

app.registerExtension({
	name: "ShaobkjEnhancedToolset.TemplateDynamicInputs",
	async beforeRegisterNodeDef(nodeType, nodeData) {
		if (!NODE_NAMES.includes(nodeData?.name)) return;

		const onNodeCreated = nodeType.prototype.onNodeCreated;
		const onConfigure = nodeType.prototype.onConfigure;
		const onConnectionsChange = nodeType.prototype.onConnectionsChange;

		nodeType.prototype.onNodeCreated = function () {
			onNodeCreated?.apply(this, arguments);
			manageTemplateInputs(this, true);
			setTimeout(() => manageTemplateInputs(this, true), 50);
		};

		nodeType.prototype.onConfigure = function () {
			onConfigure?.apply(this, arguments);
			manageTemplateInputs(this, true);
			setTimeout(() => manageTemplateInputs(this, true), 50);
		};

		nodeType.prototype.onConnectionsChange = function () {
			const r = onConnectionsChange?.apply(this, arguments);
			setTimeout(() => manageTemplateInputs(this, false), 50);
			return r;
		};
	},
});
