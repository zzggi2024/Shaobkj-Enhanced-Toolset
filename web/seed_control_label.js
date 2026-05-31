import { app } from "/scripts/app.js";

function normalizeControlModeValue(val) {
	if (typeof val !== "string") return null;
	const s = val.toLowerCase();
	if (s.includes("before") || s.includes("previous") || s.includes("prior") || val.includes("之前")) return "before";
	if (s.includes("after") || s.includes("next") || s.includes("post") || val.includes("之后")) return "after";
	return null;
}

function findWidgetControlModeValue(obj) {
	if (!obj || typeof obj !== "object") return null;
	for (const [k, v] of Object.entries(obj)) {
		if (typeof k === "string" && /control/i.test(k) && /mode/i.test(k)) {
			const norm = normalizeControlModeValue(v);
			if (norm) return norm;
		}
		const nested = findWidgetControlModeValue(v);
		if (nested != null) return nested;
	}
	return null;
}

function getWidgetControlPlacementFromApp() {
	const settings = app?.ui?.settings;
	if (!settings) return null;

	const candidates = [
		"Comfy.NodeWidgetControlMode",
		"Comfy.WidgetControlMode",
		"Comfy.NodeWidgetControl",
		"Comfy.WidgetControl",
		"Comfy.WidgetControlPlacement",
		"Comfy.ControlWidgetPlacement",
	];
	for (const key of candidates) {
		try {
			const v = settings.getSettingValue?.(key);
			const norm = normalizeControlModeValue(v);
			if (norm) return norm;
		} catch {}
	}

	const container = settings.settings ?? settings.settingValues ?? settings;
	const norm = findWidgetControlModeValue(container);
	if (norm) return norm;
	return null;
}

function getWidgetControlPlacementFromStorage() {
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			try {
				const data = JSON.parse(raw);
				const norm = findWidgetControlModeValue(data);
				if (norm) return norm;
			} catch {
				const norm = normalizeControlModeValue(raw);
				if (norm) return norm;
			}
		}
	} catch {}
	return null;
}

function getWidgetControlPlacement() {
	return getWidgetControlPlacementFromApp() ?? getWidgetControlPlacementFromStorage();
}

function applySeedControlLabels(node) {
	if (!node || !node.widgets) return;

	const widgets = node.widgets;
	const seedIndex = widgets.findIndex((w) => w?.name === "seed");
	const controlIndex = widgets.findIndex((w) => w?.name === "control_after_generate");

	if (seedIndex !== -1) {
		widgets[seedIndex].label = "随机种子";
	}

	if (controlIndex !== -1) {
		const placement = getWidgetControlPlacement();
		const label =
			placement === "before"
				? "生成前控制"
				: placement === "after"
					? "生成后控制"
					: seedIndex !== -1 && controlIndex < seedIndex
						? "生成前控制"
						: "生成后控制";
		widgets[controlIndex].label = label;
	}
}

app.registerExtension({
	name: "ShaobkjEnhancedToolset.SeedControlLabel",
	async beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData?.name !== "ShaobkjImageTextDetect") return;

		const onNodeCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			onNodeCreated?.apply(this, arguments);
			applySeedControlLabels(this);
			setTimeout(() => applySeedControlLabels(this), 0);
		};

		const onConfigure = nodeType.prototype.onConfigure;
		nodeType.prototype.onConfigure = function () {
			onConfigure?.apply(this, arguments);
			applySeedControlLabels(this);
			setTimeout(() => applySeedControlLabels(this), 0);
		};
	},
});
